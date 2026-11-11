# VVVion Space — связка сайта с Android-приложением 2.5.0 (музыка в фоне, уведомления, push) — задача для Cursor

## Правила для Cursor
- Сначала найди код по подсказкам `rg`, прочитай его и только потом меняй. Имена функций в бандле минифицированы, ищи по смыслу и по строкам.
- Всё, что касается приложения, оборачивай проверкой `isApp()`. В обычном браузере поведение не должно меняться (кроме `mediaSession`: он полезен и в Chrome).
- Серверный push шли только пользователю, чей токен привязан к его сессии. `userId` от клиента не принимай никогда.
- Ключ сервисного аккаунта Firebase держи только в переменных окружения сервера. Не логируй, не коммить, не отдавай клиенту.
- В тексте push не клади то, что нельзя видеть на заблокированном экране (полный текст личных сообщений). Сделай настройку «Показывать текст сообщений в уведомлениях» (по умолчанию выкл → «Новое сообщение от X»).
- Одна задача — один коммит с понятным сообщением. После каждой задачи проверь критерии приёмки.

## Что уже умеет приложение 2.5.0 (менять в нём ничего не нужно)
Приложение — обёртка WebView над https://vvvion.space. В User-Agent есть `vvvionApp/2.5`. На каждой странице оно само подкладывает скрипт и объект `window.VvvionApp`.

| Что | Как работает |
|---|---|
| Музыка в фоне | Приложение само ловит `<audio>` (в том числе созданные через `new Audio()` и Howler), поднимает foreground-сервис «Плеер» с уведомлением, обложкой и кнопками ⏮ ⏯ ⏭. Работает при выключенном экране. **Для этого менять сайт не обязательно.** |
| Данные трека | Приложение берёт их так: `navigator.mediaSession.metadata` (если сайт задал) → иначе читает разметку плеера (название, исполнитель, обложка) |
| Кнопки в шторке | Вызывают обработчики `navigator.mediaSession.setActionHandler`, если сайт их зарегистрировал; иначе нажимают кнопки плеера «Слушать/Пауза/Дальше/Назад» |
| Уведомления | `VvvionApp.notify({...})` показывает системное уведомление в шторке; тап открывает нужную страницу сайта без перезагрузки |
| Push при закрытом приложении | Через Firebase Cloud Messaging. Нужен файл `google-services.json` (см. раздел «Что делает Ярослав») |
| Квадратная подсветка при нажатии | Приложение убирает её само (CSS ниже). Добавь тот же CSS в сайт тоже |

### API для сайта (`window.VvvionApp`, есть только в приложении)
```ts
VvvionApp.isApp: true
VvvionApp.version: '2.5.0'
VvvionApp.notify({ id, channel, title, body, url, onlyWhenBackground?: boolean }): boolean
// channel: 'messages' | 'ai' | 'subs' | 'player'; url — путь на сайте ('/chat/abc') или полный https://vvvion.space/...
// onlyWhenBackground по умолчанию true: если приложение открыто на экране, уведомление не показывается
VvvionApp.cancelNotification(id)
VvvionApp.requestNotificationPermission()   // Android 13+, результат придёт событием vvvion-app-notifications
VvvionApp.notificationsEnabled(): boolean
VvvionApp.openNotificationSettings()
VvvionApp.getPushToken(): string            // FCM-токен или '' (если сборка без Firebase / токен ещё не готов)
VvvionApp.pushAvailable(): boolean
```
События на `window`:
- `vvvion-app-ready` — объект `VvvionApp` готов (скрипт приложения может появиться чуть позже загрузки страницы, не полагайся на него на старте).
- `vvvion-app-push-token` — `e.detail.token`, новый FCM-токен.
- `vvvion-app-notifications` — `e.detail.enabled`, состояние разрешения на уведомления.

Опциональный хук: если сайт определит `window.__vvvionNavigate = (path) => router.navigate({ to: path })`, приложение откроет тап по уведомлению через роутер сайта. Без хука оно само делает `history.pushState` + `popstate`, а если страница не переключилась — обычную загрузку.

---

## P0 — CSS: убрать квадратную подсветку при нажатии
**Где искать:** `rg -n "tap-highlight|:focus-visible|outline" src/ styles/` и главный CSS (`styles.css`).

Добавь в глобальные стили (в приложение он уже подкладывается, но сайту он тоже нужен):
```css
*, *::before, *::after { -webkit-tap-highlight-color: transparent; }
:focus:not(:focus-visible) { outline: none; }   /* клавиатурный :focus-visible остаётся */
button, [role="button"], a { -webkit-user-select: none; user-select: none; }
```
**Приёмка:** в приложении нажатие на круглую кнопку play/pause не показывает квадрат. Табом с клавиатуры (на десктопе) фокус по-прежнему виден.

---

## P1 — плеер: `navigator.mediaSession` (лучшее качество кнопок и обложки)
Сейчас сайт не задаёт `mediaSession`, поэтому приложение читает данные из разметки. Это работает, но надёжнее отдать данные явно (заодно заработают медиа-клавиши и уведомление плеера в обычном Chrome).

**Где искать:** `rg -n "new Howl|html5: ?true|aria-label=\"Слушать\"|aria-label=\"Пауза\"|vvvion.player" src/` — это глобальный модуль плеера (одиночка с состоянием: треки, индекс, shuffle, repeat). Функции в нём делают: старт трека, play/pause, следующий, предыдущий, seek, закрыть, и есть подписка на изменение состояния (в бандле это `Z()`/`Sa()`).

**Что сделать:** в модуле плеера добавить функцию `syncMediaSession()` и вызывать её при каждом изменении состояния плеера (смена трека, play/pause, загрузка метаданных/обложки), а обработчики зарегистрировать один раз.

```ts
// src/lib/player/media-session.ts
type Track = { title: string; artist?: string; album?: string; cover?: string | null };

export function syncMediaSession(t: Track | null, playing: boolean, pos: number, dur: number) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  if (!t) { ms.metadata = null; ms.playbackState = 'none'; return; }
  ms.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist || '',
    album: t.album || '',
    artwork: t.cover ? [{ src: t.cover, sizes: '512x512', type: 'image/jpeg' }] : [],   // blob:/data:/https: — всё подходит
  });
  ms.playbackState = playing ? 'playing' : 'paused';
  try { if (dur > 0) ms.setPositionState({ duration: dur, position: Math.min(pos, dur), playbackRate: 1 }); } catch {}
}

let handlersSet = false;
export function initMediaSessionHandlers(api: {
  play(): void; pause(): void; next(): void; prev(): void; seek(sec: number): void; stop(): void;
}) {
  if (handlersSet || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  handlersSet = true;
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => { try { navigator.mediaSession.setActionHandler(a, h); } catch {} };
  set('play', () => api.play());
  set('pause', () => api.pause());
  set('nexttrack', () => api.next());
  set('previoustrack', () => api.prev());
  set('seekto', (d) => { if (typeof d.seekTime === 'number') api.seek(d.seekTime); });
  set('stop', () => api.stop());
}
```
Подключи к существующим функциям плеера (play → то, что вызывает кнопка «Слушать», pause → «Пауза», next → «Дальше», prev → «Назад», seek — перемотка по секундам, stop — «Закрыть»). Ничего не дублируй: используй те же функции, что и кнопки в интерфейсе.

**Важно:** `title` — это название трека, `artist` — исполнитель из тегов файла. Обложка — тот же URL, что показывается в плеере.

**Приёмка:** в Chrome на Android при воспроизведении в шторке появляется медиа-уведомление с названием, исполнителем, обложкой и работающими ⏮ ⏯ ⏭. В приложении то же самое. Перемотка из шторки работает.

---

## P1 — клиентский хелпер для приложения
**Где искать:** `rg -n "navigator.userAgent|serviceWorker|useSession|authClient" src/` — найди место, где известен залогиненный пользователь и есть общий клиентский код.

```ts
// src/lib/app-bridge.ts
declare global { interface Window { VvvionApp?: any } }

export const isApp = () => typeof navigator !== 'undefined' && /vvvionApp\//.test(navigator.userAgent);

export function appNotify(o: { id: string; channel: 'messages' | 'ai' | 'subs' | 'player'; title: string; body?: string; url?: string; onlyWhenBackground?: boolean }) {
  try { return !!window.VvvionApp?.notify(o); } catch { return false; }
}

export function appAskNotifications() { try { window.VvvionApp?.requestNotificationPermission(); } catch {} }

/** Регистрирует FCM-токен на сервере. Вызывай после входа и по событию нового токена. */
export async function registerPushToken(token?: string) {
  const t = token || window.VvvionApp?.getPushToken?.();
  if (!t) return;
  await fetch('/api/push/register', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: t, platform: 'android', appVersion: window.VvvionApp?.version ?? '' }),
  }).catch(() => {});
}

export async function unregisterPushToken() {
  const t = window.VvvionApp?.getPushToken?.();
  if (!t) return;
  await fetch('/api/push/unregister', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }) }).catch(() => {});
}

export function initAppBridge(isLoggedIn: () => boolean) {
  if (!isApp()) return;
  const tryRegister = () => { if (isLoggedIn()) registerPushToken(); };
  window.addEventListener('vvvion-app-ready', tryRegister);
  window.addEventListener('vvvion-app-push-token', (e: any) => { if (isLoggedIn()) registerPushToken(e.detail?.token); });
  tryRegister();
}
```
- Вызови `initAppBridge` один раз при старте клиента и ещё раз сразу после входа.
- **При выходе из аккаунта** вызывай `unregisterPushToken()` ДО сброса сессии, чтобы чужие уведомления не приходили на это устройство.
- Разрешение на уведомления: в настройках профиля добавь переключатель «Уведомления в приложении». По включению — `appAskNotifications()`. (Приложение само один раз спросит при первом запуске музыки и со второго запуска; кнопка нужна для повторного запроса. Если пользователь отказал дважды, показывай «Открыть настройки» → `VvvionApp.openNotificationSettings()`.)

**Приёмка:** после входа в приложении на сервер уходит один `POST /api/push/register`. При выходе уходит `unregister`.

---

## P1 — локальные уведомления из сайта (работают, пока приложение живо в фоне)
**Где искать:** `rg -n "vvvion-sounds|playSound|text/event-stream|EventSource|/api/chat" src/` — место, где сайт уже играет звук «ответ пришёл/сообщение» (в бандле это функция `ja('message' | 'notice' | 'fail')`) и где завершается стрим ответа модели.

1. **Ответ модели готов.** Когда стрим ответа закончился (успешно или с ошибкой) и `document.hidden === true`:
```ts
appNotify({ id: `ai:${chatId}:${messageId}`, channel: 'ai', title: modelName || 'Чат с ИИ', body: 'Ответ готов', url: `/chat/${chatId}` });
```
2. **Новое сообщение** (личка/группа), когда `document.hidden`:
```ts
appNotify({ id: `msg:${dialogId}`, channel: 'messages', title: senderName, body: showPreview ? text.slice(0, 120) : 'Новое сообщение', url: `/messages/${dialogId}` });
```
`id` одинаковый для одного диалога — новые сообщения заменяют старое уведомление, а не копятся. При открытии диалога вызови `VvvionApp.cancelNotification('msg:' + dialogId)`.

3. **Подписки.** Сроки считает сервер (см. ниже) и шлёт push. Локально можно показать при входе в приложение, если осталось ≤ 3 дней:
```ts
appNotify({ id: 'sub:mega', channel: 'subs', title: 'MegaDisk', body: 'Подписка заканчивается через 3 дня', url: '/disk', onlyWhenBackground: false });
```

Реальные URL страниц возьми из роутера сайта (`rg -n "createFileRoute|route\\(" src/`).

**Приёмка:** пока приложение свёрнуто (но не закрыто), по окончании ответа модели в шторке появляется уведомление «Ответ готов». Тап открывает нужный чат без полной перезагрузки.

---

## P0 — сервер: хранение токенов и эндпоинты
**Где искать:** схему БД и роуты — `rg -n "createServerFn|/api/|drizzle|prisma|CREATE TABLE|sqliteTable|pgTable" src/ server/ app/`.

### 1. Таблицы
```sql
CREATE TABLE push_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,                 -- ТОЛЬКО из сессии
  token         TEXT NOT NULL UNIQUE,
  platform      TEXT NOT NULL DEFAULT 'android',
  app_version   TEXT,
  created_at    TIMESTAMP NOT NULL,
  last_seen_at  TIMESTAMP NOT NULL
);
CREATE INDEX push_tokens_user ON push_tokens(user_id);

CREATE TABLE push_settings (
  user_id   TEXT PRIMARY KEY,
  messages  BOOLEAN NOT NULL DEFAULT TRUE,
  ai        BOOLEAN NOT NULL DEFAULT TRUE,
  subs      BOOLEAN NOT NULL DEFAULT TRUE,
  preview   BOOLEAN NOT NULL DEFAULT FALSE     -- показывать текст сообщений
);

CREATE TABLE push_log (                          -- дедупликация
  user_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,                        -- 'msg' | 'ai' | 'mega_3d' | 'mega_1d' | 'premium_3d' | 'premium_1d'
  ref_id   TEXT NOT NULL,                        -- id сообщения / подписки + дата окончания
  sent_at  TIMESTAMP NOT NULL,
  PRIMARY KEY (user_id, kind, ref_id)
);
```
Подстрой типы под вашу БД и миграции.

### 2. Эндпоинты
- `POST /api/push/register` — нужна сессия (иначе 401). Тело `{ token, platform, appVersion }`. Проверь: `token` — строка 100–4096 символов, `platform === 'android'`. Сделай upsert **по `token`**: если токен уже был у другого пользователя, перепиши `user_id` на текущего (устройство сменило аккаунт). Лимит: не больше 10 токенов на пользователя (старые удаляй). Rate-limit на эндпоинт.
- `POST /api/push/unregister` — нужна сессия. Удаляет токен, только если он принадлежит текущему пользователю.
- `GET/PUT /api/push/settings` — читает/сохраняет `push_settings` текущего пользователя.

**Приёмка:** без сессии → 401. Токен, зарегистрированный пользователем A, нельзя удалить от имени B. Повторный `register` не создаёт дубль.

---

## P0 — сервер: отправка через FCM (HTTP v1)
**Переменные окружения:** `FIREBASE_SERVICE_ACCOUNT_JSON` (содержимое JSON ключа, лучше в base64) и `FIREBASE_PROJECT_ID`.

Проще всего через `firebase-admin` (он сам получает OAuth-токен и ходит в FCM HTTP v1: `POST https://fcm.googleapis.com/v1/projects/<PROJECT_ID>/messages:send`).
```ts
// src/server/push.ts
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

function app() {
  if (getApps().length) return getApps()[0];
  const json = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!, 'base64').toString('utf8'));
  return initializeApp({ credential: cert(json) });
}

export type PushKind = 'messages' | 'ai' | 'subs';
export async function sendPush(userId: string, kind: PushKind, p: { id: string; title: string; body: string; url: string }) {
  const settings = await getPushSettings(userId);          // push_settings (по умолчанию всё включено)
  if (!settings[kind]) return;
  const tokens = await getTokens(userId);                  // push_tokens
  for (const t of tokens) {
    try {
      await getMessaging(app()).send({
        token: t.token,
        // ТОЛЬКО data-сообщение: приложение само рисует уведомление в нужном канале
        data: { id: p.id, channel: kind, title: p.title, body: p.body, url: p.url },
        android: { priority: 'high', ttl: 60 * 60 * 1000 },
      });
    } catch (e: any) {
      const code = e?.errorInfo?.code || e?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') await deleteToken(t.token);
      else console.error('push failed', code);              // не логируй сами токены и тексты
    }
  }
}
```
Правила формата (по ним работает приложение):
- Все значения в `data` — строки. Поля: `id` (стабильный, для замены/дедупа), `channel` (`messages`/`ai`/`subs`), `title`, `body`, `url` (**только путь** на сайте вроде `/chat/abc` — приложение откроет только vvvion.space).
- Не добавляй поле `notification`: тогда при закрытом приложении Android показал бы уведомление сам и в обход каналов.
- По умолчанию приложение не показывает push, пока открыто на экране. Если нужно показать всегда — добавь `fg: '1'`.

### Когда слать
1. **Новое сообщение.** При сохранении сообщения получателю, если получатель не «онлайн» (нет живой SSE/WebSocket-связи или последняя активность > 30 с назад). `id = msg:<dialogId>`, текст — по настройке `preview`. Группируй: не чаще одного push на диалог в 10 секунд.
2. **Чат с ИИ завершил ответ.** Когда генерация закончилась на сервере, а клиентское соединение уже закрыто или не было активности > 30 с. `id = ai:<chatId>:<messageId>` — тот же формат, что у локального `appNotify`, поэтому один и тот же ответ не задвоится (уведомление с тем же `id` заменяется).
3. **MegaDisk заканчивается** — за 3 дня и за 1 день до окончания.
4. **Премиум заканчивается** — за 3 дня и за 1 день.

### Cron для подписок
Раз в час (cron/планировщик вашего хостинга; найди, что используется: `rg -n "cron|schedule|setInterval" server/ src/`):
```ts
// псевдокод
for (const s of await subscriptionsEndingBetween(now + 2d, now + 3d, 'mega'))   await notifyOnce(s.userId, 'mega_3d', `${s.id}:${s.endsAt.toISOString().slice(0,10)}`, ...);
for (const s of await subscriptionsEndingBetween(now,      now + 1d, 'mega'))   await notifyOnce(s.userId, 'mega_1d', ...);
// то же для 'premium'
async function notifyOnce(userId, kind, refId, payload) {
  const inserted = await insertIgnore('push_log', { user_id: userId, kind, ref_id: refId, sent_at: new Date() }); // PRIMARY KEY даёт дедуп
  if (inserted) await sendPush(userId, 'subs', payload);
}
```
Тексты: «MegaDisk: подписка заканчивается через 3 дня», «Премиум закончится завтра», ссылка на страницу продления. `refId` включает дату окончания: после продления новая дата → новое напоминание.

### Настройки (UI)
В профиле, блок «Уведомления в приложении»: переключатели «Сообщения», «Ответы ИИ», «Подписки», «Показывать текст сообщений». Сохраняются через `PUT /api/push/settings`.

**Приёмка:** (1) отправка на тестовый токен приходит при закрытом приложении; (2) повторный запуск cron не шлёт то же напоминание второй раз; (3) отключённый тип уведомлений не приходит; (4) недействительный токен удаляется из БД; (5) в логах нет токенов и текстов сообщений.

---

## Безопасность (чек-лист для Cursor)
- `user_id` берётся только из серверной сессии.
- Токены уникальны, при смене аккаунта на устройстве переписываются, при выходе удаляются.
- В `url` push принимаются только относительные пути сайта.
- Ключ сервисного аккаунта лежит только в окружении сервера.
- Rate-limit на `/api/push/*`; лимит токенов на пользователя.
- `appNotify`/`VvvionApp.notify` вызывай только из доверенного кода сайта. Не подставляй в `title/body` необработанные данные из чужих источников без обрезки длины.

---

## Что делает Ярослав (не Cursor)
1. Зайти на https://console.firebase.google.com → **Add project** (например, «VVVion Space»). Google Analytics можно отключить.
2. В проекте: **Add app → Android**. Package name строго `space.vvvion.app`. SHA-1 для push не нужен. Скачать **`google-services.json`** и отправить мне — я пересоберу приложение с push (версия 2.6.0). Этот файл не секретный, он входит в каждое приложение.
3. **Project settings → Service accounts → Generate new private key.** Скачается JSON. Положить его **только** в переменную окружения сервера `FIREBASE_SERVICE_ACCOUNT_JSON` (лучше в base64) и `FIREBASE_PROJECT_ID`. Мне и в чат этот файл не отправлять.
4. Дать Cursor этот файл как задачу и выкатить сайт.
5. Установить приложение 2.5.0 поверх старого (подпись та же, обновится без удаления).

Без шагов 1–3 приложение 2.5.0 уже даёт: музыку в фоне, локальные уведомления (пока приложение живо в фоне), убранную подсветку. Нет только push при полностью закрытом приложении.
Push не работает на телефонах без Google Play Services (например, новые Huawei).

---

## Чек-лист проверки на телефоне
**Музыка**
1. Запустить трек, свернуть приложение → музыка играет, в шторке карточка плеера с названием, исполнителем и обложкой.
2. Выключить экран на 5–10 минут → музыка не прерывается; на экране блокировки есть кнопки.
3. Нажать ⏸ в шторке → пауза, значок меняется на ▶. Нажать ▶ → играет. ⏭ / ⏮ переключают треки.
4. Дать треку доиграть до конца в фоне → следующий трек стартует сам.
5. Позвонить на телефон / включить видео в другом приложении → музыка встаёт на паузу.
6. Выдернуть наушники → пауза.
7. Поставить на паузу и подождать 5 минут → уведомление можно смахнуть, сервис завершился.
8. Смахнуть приложение из списка недавних → музыка и уведомление исчезли.
9. Кнопка «назад» на главной странице при играющей музыке сворачивает приложение, а не закрывает его.

**Подсветка**
10. Нажимать круглую кнопку play/pause, кнопки «назад/дальше», иконки в шапке → квадратной рамки нет.

**Уведомления**
11. Android 13+: разрешение спросили (при первой музыке или со 2-го запуска), после «Разрешить» события приходят.
12. Отправить сообщение модели, свернуть приложение → по окончании ответа приходит «Ответ готов», тап открывает этот чат.
13. Новое сообщение от другого аккаунта при свёрнутом приложении → уведомление, тап открывает диалог.
14. Открыть диалог → его уведомление пропадает.
15. (После push) закрыть приложение полностью → тестовый push приходит; тап запускает приложение на нужной странице.
16. Выход из аккаунта → push на устройство больше не приходят.
17. Заблокированный экран: текст сообщений скрыт, если выключена настройка «Показывать текст».
