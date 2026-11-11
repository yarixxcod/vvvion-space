# VVVion Space — связка сайта с Android-приложением 2.8.0 (музыка в фоне, уведомления, push, скорость, FAQ и юр. страницы) — задача для Cursor

## Правила для Cursor
- Сначала найди код по подсказкам `rg`, прочитай его и только потом меняй. Имена функций в бандле минифицированы, ищи по смыслу и по строкам.
- Всё, что касается приложения, оборачивай проверкой `isApp()`. В обычном браузере поведение не должно меняться (кроме `mediaSession`: он полезен и в Chrome).
- Серверный push шли только пользователю, чей токен привязан к его сессии. `userId` от клиента не принимай никогда.
- Ключ сервисного аккаунта Firebase держи только в переменных окружения сервера. Не логируй, не коммить, не отдавай клиенту.
- В тексте push не клади то, что нельзя видеть на заблокированном экране (полный текст личных сообщений). Сделай настройку «Показывать текст сообщений в уведомлениях» (по умолчанию выкл → «Новое сообщение от X»).
- Одна задача — один коммит с понятным сообщением. После каждой задачи проверь критерии приёмки.
- Порядок работы: P0 (скорость и касания, белая полоса — проверка, `touch-action`) → P1 (каталог уведомлений, FAQ и юр. страницы) → P2. Замеры производительности повторяй до и после правок (раздел «скорость и плавность»).

## Что уже умеет приложение 2.8.0 (менять в нём ничего не нужно)
Приложение — обёртка WebView над https://vvvion.space. В User-Agent есть `vvvionApp/2.8`. На каждой странице оно само подкладывает скрипт и объект `window.VvvionApp`.

| Что | Как работает |
|---|---|
| Музыка в фоне | Приложение само ловит `<audio>` (в том числе созданные через `new Audio()` и Howler), поднимает foreground-сервис «Плеер» с уведомлением, обложкой и кнопками ⏮ ⏯ ⏭. Работает при выключенном экране. **Для этого менять сайт не обязательно.** |
| Данные трека | Приложение берёт их так: `navigator.mediaSession.metadata` (если сайт задал) → иначе читает разметку плеера (название, исполнитель, обложка) |
| Кнопки в шторке | Вызывают обработчики `navigator.mediaSession.setActionHandler`, если сайт их зарегистрировал; иначе нажимают кнопки плеера «Слушать/Пауза/Дальше/Назад» |
| Уведомления | `VvvionApp.notify({...})` показывает системное уведомление в шторке; тап открывает нужную страницу сайта без перезагрузки |
| Push при закрытом приложении | Через Firebase Cloud Messaging, проект `space-vvvion-app`. В приложении 2.6.0 он подключён; серверу нужен ключ сервисного аккаунта (раздел «Что делает Ярослав») |
| Квадратная подсветка при нажатии | Приложение убирает её само (CSS ниже). Добавь тот же CSS в сайт тоже |

### API для сайта (`window.VvvionApp`, есть только в приложении)
```ts
VvvionApp.isApp: true
VvvionApp.version: '2.8.0'
VvvionApp.notify({ id, channel, title, body, url, onlyWhenBackground?: boolean }): boolean
// channel: 'messages' | 'ai' | 'subs' | 'player' | 'money' | 'security' | 'system'; url — путь на сайте ('/chat/abc') или полный https://vvvion.space/...
// onlyWhenBackground по умолчанию true: если приложение открыто на экране, уведомление не показывается
VvvionApp.cancelNotification(id)
VvvionApp.requestNotificationPermission()   // Android 13+, результат придёт событием vvvion-app-notifications
VvvionApp.notificationsEnabled(): boolean
VvvionApp.openNotificationSettings()
VvvionApp.getPushToken(): string            // FCM-токен или '' (если сборка без Firebase / токен ещё не готов)
VvvionApp.pushAvailable(): boolean
VvvionApp.haptic(type): void                // 2.7.0+, см. раздел «Вибрация»
```
События на `window`:
- `vvvion-app-ready` — объект `VvvionApp` готов (скрипт приложения может появиться чуть позже загрузки страницы, не полагайся на него на старте).
- `vvvion-app-push-token` — `e.detail.token`, новый FCM-токен.
- `vvvion-app-notifications` — `e.detail.enabled`, состояние разрешения на уведомления.

Опциональный хук: если сайт определит `window.__vvvionNavigate = (path) => router.navigate({ to: path })`, приложение откроет тап по уведомлению через роутер сайта. Без хука оно само делает `history.pushState` + `popstate`, а если страница не переключилась — обычную загрузку.

---

## 2.8.0 — что изменилось в приложении и что обязан сделать сайт

### В приложении (уже сделано, менять не нужно)
| Что | Суть |
|---|---|
| **Белая полоса сверху при открытой клавиатуре** | См. раздел «P0 — белая полоса» ниже: тёмная пластина поверх зоны статус-бара + все цвета окна принудительно `#0c0c0e` |
| **Сенсорика** | `setTextZoom(100)`, зум запрещён, `UseWideViewPort` + `LoadWithOverviewMode=false`, скроллбары выключены; нативный pull-to-refresh стал строже (см. ниже); скрипт приложения больше не вызывает `getComputedStyle` на каждый тап |
| **Хуки производительности** | Классы на `<html>`: `vv-app` (всегда в приложении), `vv-lowend` (слабый телефон: ≤3.3 ГБ ОЗУ, Android ≤8.1, `isLowRamDevice`, либо замер FPS в рантайме), `vv-reduce-motion` (в системе выключены анимации) |
| **Автоотключение декоративных анимаций** | Если на `<html>` есть `vv-lowend` или `vv-reduce-motion`, приложение само гасит `.orb`, `.chat-paper`-«туман», `.circle-glow`, `.mark-*`, `.mic-live`, `.player-wash/.player-cover`, а при `vv-lowend` ещё и `backdrop-filter`. Это временная страховка; настоящее лечение — правки сайта ниже |
| **Новые каналы уведомлений** | `money` («Вубли и платежи»), `security` («Безопасность аккаунта», высокая важность), `system` («Новости проекта», тихий). К прежним `messages`/`ai`/`subs`/`player` |
| `touch-action: manipulation` | Приложение добавляет на кнопки/ссылки/поля само; добавь то же в CSS сайта (нужно и для браузера) |

Новое в `window.VvvionApp`:
```ts
VvvionApp.version: '2.8.0'
VvvionApp.perf(): { lowEnd, reduceMotion, hz, ramMb, cores, sdk, lowEndActive }
VvvionApp.setLowEnd(on: boolean)        // принудительно включить/выключить режим «слабый телефон» (хранится ~7 дней)
VvvionApp.pullToRefresh(on: boolean)    // выключить НАТИВНЫЙ pull-to-refresh приложения, если на сайте останется только свой
// notify(): channel теперь 'messages' | 'ai' | 'subs' | 'player' | 'money' | 'security' | 'system'
```
В переключателе настроек сайта можно показать «Режим экономии анимаций» → `VvvionApp.setLowEnd(true/false)`.

---

## P0 — белая полоса сверху при открытой клавиатуре (приложение 2.8.0)
**Симптом:** при открытии клавиатуры сверху появляется светлая (бело-зелёная) полоса, закрыл клавиатуру — пропала.
**Вероятная причина (на устройстве не воспроизводил, исходил из кода и поведения Android):** при показе IME на ряде оболочек возвращается системный статус-бар, который был скрыт immersive-режимом. С Android 15 (targetSdk 35) `statusBarColor` игнорируется, и статус-бар прозрачный: цвет под ним определяет то, что нарисовано в *нашем* окне — `windowBackground`/`windowBackgroundFallback`/фон корня. В 2.4.0 я сдвигал страницу вниз паддингом, но под паддингом оставался фон, который оболочка (Material You) могла подменять.
**Что сделано в 2.8.0 (по слоям, любого хватает, вместе — гарантия):**
1. Тема: `colorBackground`, `colorBackgroundFloating`, `windowBackgroundFallback`, `windowBackground`, `statusBarColor`, `navigationBarColor` = `#0c0c0e` для API 24/28/31+, `windowLightStatusBar=false`, `forceDarkAllowed=false`.
2. В коде: `applyBarColors()` на создании, `onResume` и **каждое** изменение инсетов (идемпотентно, без цикла): цвета баров, фон окна/DecorView, сброс `APPEARANCE_LIGHT_STATUS_BARS/NAVIGATION_BARS` (API 30+) и `SYSTEM_UI_FLAG_LIGHT_*` (API 23–29).
3. Главное: **тёмная пластина `topScrim` в `ViewGroupOverlay` корня** — рисуется *поверх* WebView на всю высоту верхнего паддинга (статус-бар/вырез), её размер синхронизируется с паддингом. Что бы система или оболочка ни рисовала под видимым статус-баром, поверх будет `#0c0c0e`, а иконки статус-бара белые.
4. Раскладка не прыгает: паддинг сверху = высота статус-бара только пока он видим (IME его вернул), снизу — только клавиатура; бары повторно скрываются сразу и через 350 мс.
**Проходы по API:** 24–28 — `windowFullscreen` + глобальный layout-listener, паддинг и пластина обновляются там же; 29 — то же + `setStatusBarContrastEnforced(false)`; 30–34 — `WindowInsets` listener, `setDecorFitsSystemWindows(false)`, `statusBarColor` честно работает; 35 — `statusBarColor` игнорируется → работают пункты 1 и 3.
**Что нужно на сайте:** ничего обязательного. Рекомендуется: `html{background:#0c0c0e}` до загрузки CSS (уже есть inline-скрипт с `#0c0c0e/#f4f2ee`), `<meta name="theme-color" content="#0c0c0e">` (есть). Фиксированную шапку не прижимай к `top:0` через `100vh`; используй `top:0` + `position:sticky`, высоту экрана — `100dvh`.
**Приёмка (на телефоне):** открыть чат → тапнуть поле ввода → сверху ни одной светлой полосы, ни в светлой, ни в тёмной теме системы; закрыть клавиатуру → ничего не прыгает. Проверить Pixel (Android 15), Samsung (One UI), Xiaomi.

---

## P0 — скорость и плавность: что именно тормозит и как лечить
Замер (Chrome 156, эмуляция телефона 390×844, **CPU ×4 медленнее**, страница чата, 5 с; метрика — доля времени, когда главный поток занят; без GPU, поэтому абсолют условный, но относительные цифры показательны):

| Сценарий | Главный поток занят |
|---|---|
| Как сейчас (фон «Туман») | **15.5 %** в простое |
| Все CSS-анимации выключены | 1.6 % |
| Только «Туман» (`.chat-paper`) выключен | 14.8 % |
| Только `.orb` выключен | 13.0 % |
| Только `.circle-glow` выключен | 9.8 % |
| Только `.mark-*` выключены | 10.6 % |
| Туман + orb + circle-glow выключены | 6.9 % |
| Пакет «декор выкл» (то, что делает `vv-lowend`) | **1.1 %** (0.5 % в проверке с самим скриптом приложения) |
| Стрим ответа: как сейчас → пакет «декор выкл» | 35.7 % → 34.2 %, но пересчёт стилей за 9.5 с: **519 → 116 мс** |

Вывод: ~10 бесконечных декоративных анимаций держат главный поток занятым постоянно, а во время стрима к ним добавляется работа React. По отдельности каждая даёт 2–5 %, вместе — львиную долю. «Анимаций текста» (по символам/словам) в бандле **нет**: текст при стриме лагает от перерисовки сообщений (см. п. 2) и от фоновых анимаций, которые конкурируют за кадр.

### 1. Декоративные бесконечные анимации (`styles-*.css`)
Найди: `rg -n "animation:.*infinite|@keyframes (drift|fog-drift|circle-shimmer|orbit|mic-pulse)" src/`

| Селектор | Почему дорого | Чем заменить |
|---|---|---|
| `html[data-paper=mesh] .chat-paper` (`fog-drift`) | анимируется `background-position` у 4 радиальных градиентов на всю область чата → полная перерисовка *каждый кадр*, плюс это скроллящийся контейнер | сделать статичным; если нужен дрейф — вынести градиент в `::before { position:fixed; inset:-10%; transform:translate3d(...)}` и анимировать **только** `transform`, `will-change: transform`, 40–60 с |
| `.orb` (`filter:blur(70px)` + `drift`) | огромный размытый слой, при смене размеров перерастеризуется | заранее запечённая картинка/радиальный градиент без `filter`, `transform` анимация, не более 2 штук |
| `.circle-glow` (`circle-shimmer`) | анимируется `background-position` → перерисовка | градиент на `::before` шириной 280 %, анимировать `transform: translateX()` |
| `.mark-dot` (`orbit`, `offset-distance`) | `offset-path` анимируется в главном потоке | вращать контейнер `transform: rotate()` |
| `.mic-live` (`mic-pulse`, `box-shadow`) | `box-shadow` — перерисовка | кольцо `::after` + `transform: scale()` + `opacity` |
| `.mark-ring-2`, `.mark-core`, `.player-wash`, `.player-cover` | компоситор, но постоянно живые | пауза вне экрана (`animation-play-state`), `vv-lowend` |

Общее правило сайта: анимировать только `transform` и `opacity`; ни `filter`, ни `box-shadow`, ни `background-position`, ни `width/height/top/left`. Каждая бесконечная анимация должна выключаться тремя условиями:
```css
@media (prefers-reduced-motion: reduce) { .orb,.chat-paper,.circle-glow,.mark-ring-2,.mark-core,.mark-dot,.mic-live { animation: none !important } .orb { display: none } }
html.vv-lowend .orb, html.vv-reduce-motion .orb { display: none }
html.vv-lowend .chat-paper, html.vv-lowend .circle-glow, html.vv-lowend .mark-dot, html.vv-lowend .mark-ring-2, html.vv-lowend .mark-core, html.vv-lowend .mic-live { animation: none !important }
html.vv-lowend * { backdrop-filter: none !important }       /* стеклянные шапки/панели на слабых GPU */
```
(`vv-lowend`/`vv-reduce-motion` ставит приложение; в обычном браузере остаётся `prefers-reduced-motion`.) Для сайта в целом можно добавить «Режим экономии» в настройки, который ставит `html.vv-lowend` и `localStorage`.

### 2. Самая «горячая» JS-функция при стриме: форматирование времени в каждом пересчёте
Профиль JS во время стрима (CPU ×4): первая по собственному времени функция сайта — `DS(e)` в чанке `transcript-*.js` — это `new Date(e).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})`, вызывается в футере **каждого** сообщения при **каждом** обновлении (каждый токен). `toLocaleTimeString` с локалью каждый раз создаёт `Intl.DateTimeFormat` — это очень дорого.
Найди: `rg -n "toLocaleTimeString" src/`
```ts
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });   // один раз на модуль
const timeCache = new Map<number, string>();
export function formatTime(ts: number | string | Date): string {
  const k = +new Date(ts);
  let s = timeCache.get(k);
  if (s === undefined) { s = timeFmt.format(k); if (timeCache.size > 500) timeCache.clear(); timeCache.set(k, s); }
  return s;
}
```
То же для `toLocaleDateString`, `toLocaleString`, `Intl.NumberFormat` (вубли, размеры файлов) в горячих местах.

### 3. Стрим: не перерисовывать всё сообщение и весь список на каждый токен
- Компонент одного сообщения оберни в `React.memo` с сравнением по `id` и `content`/`updatedAt`; уже завершённые сообщения не должны перерисовываться при стриме последнего.
- Дописывание токенов копи в буфер и сбрасывай в state не чаще, чем раз в кадр (`requestAnimationFrame`) или раз в 60–80 мс; на `vv-lowend` — раз в 120 мс.
- Markdown парси инкрементально: закрытые блоки (абзацы, списки, код до закрывающих ```) кешируй по хэшу и не парси заново; перепарсивай только последний открытый блок. Подсветку кода (highlight) и KaTeX запускай после закрытия блока, не на каждом токене.
- Старые сообщения: `content-visibility: auto; contain-intrinsic-size: auto 320px;` на корне пузыря и `contain: layout paint style` — браузер не считает layout для того, что вне экрана.
- Автоскролл во время стрима: один `scrollTo` на кадр, без чтения `scrollHeight` в цикле (layout thrashing); читать и писать геометрию в разных фазах кадра.
- Если нужен эффект «появления» текста — анимируй **только `opacity` и `transform` у нового блока целиком**, без `filter: blur`, без покадровых `span` на слово/символ и без `animation` на каждый токен; на `vv-lowend`/`prefers-reduced-motion` — без анимации.

### 4. Проверка
Chrome DevTools → Performance → CPU 4× → записать 8 секунд стрима: долгих задач > 50 мс не должно быть, «Recalculate Style» не выше нескольких процентов. Скрипт замера (`Performance.getMetrics` до/после) можно оставить в репозитории. Целевое: простой ≤ 3 % занятости при ×4, стрим ≤ 20 %.

---

## P0 — касания и «высокая чувствительность при низком FPS»
**Что происходит:** при просадке FPS главный поток отдаёт события пачкой, жест «перепрыгивает» через пороги, и срабатывают случайные действия (обновление, закрытие шторки, долгое нажатие) или прокрутка «залипает». Нашёл в приложении и на сайте:

### Приложение (исправлено в 2.8.0)
- Нативный pull-to-refresh: порог начала 18 dp (было 12), вертикальность жеста dy > 2.2·dx (было 1.5), отмена при боковом сдвиге > 16 dp (было 24); обновление только если жест длился ≥ 220 мс (скачок одним событием при лаге больше не перезагружает страницу). Скрипт проверки «страница вверху» без `getComputedStyle`, только `scrollTop`.
- WebView: `setTextZoom(100)` (системный масштаб шрифта больше не раздувает вёрстку), зум и double-tap-zoom выключены, viewport — как в мета-теге сайта.
- Нативного `onTouch` с `return true`/перехвата жестов нет; слушатель не потребляет события.

### Сайт (нужно сделать)
1. **Два «потяни вниз» одновременно.** В корне сайта (компонент вокруг `<Outlet/>`, в бандле `Gp` в `index-*.js`, в журнале «Тяга вниз обновляет экран») висит собственный pull-to-refresh: `window.addEventListener('touchmove', …, { passive: false })`, на каждом `touchstart` `getComputedStyle` по всем предкам, `preventDefault` уже после 10 px, а по отпусканию дерево пересоздаётся (`key={n}`). В приложении параллельно работает нативный PTR (перезагрузка страницы). Итого: жест срабатывает дважды; non-passive `touchmove` на `window` заставляет компоситор ждать главный поток на каждое движение пальца — именно из-за него при низком FPS прокрутка «липнет» и «прыгает».
   Найди: `rg -n "touchmove" src/` и `rg -n "key=\{" src/ | rg -i "refresh|pull"`.
   **Правка:**
   ```ts
   // 1) В приложении свой PTR уже есть — сайтовый не монтировать
   if (isApp()) return <>{children}</>;     // либо VvvionApp.pullToRefresh(false), если оставляешь сайтовый
   // 2) В браузере — без блокирующих слушателей и дорогих проверок
   useEffect(() => {
     let startY = 0, armed = false, t0 = 0;
     const onStart = (e: TouchEvent) => { armed = (window.scrollY <= 0) && !(e.target as Element)?.closest('[data-scroll]'); startY = e.touches[0].clientY; t0 = performance.now(); };
     const onEnd = (e: TouchEvent) => {
       if (!armed) return; armed = false;
       const dy = (e.changedTouches[0]?.clientY ?? startY) - startY;
       if (dy > 140 && performance.now() - t0 > 220) refresh();         // порог 140 px и «человеческая» скорость
     };
     addEventListener('touchstart', onStart, { passive: true });
     addEventListener('touchend', onEnd, { passive: true });
     return () => { removeEventListener('touchstart', onStart); removeEventListener('touchend', onEnd); };
   }, []);
   ```
   И CSS: `html, body { overscroll-behavior-y: contain }` вместо `preventDefault()`. Визуальный индикатор рисуй из `touchmove` с `{passive:true}` через `transform` (без чтения layout).
2. **Закрытие шторок свайпом слишком чувствительное.** В `routes-*.js` две шторки закрываются по `onPointerUp`, если `clientY - startY > 48` (и `> 56`) — на любом месте шторки, без проверки скорости и без `pointercancel`. Подними порог до 96 px, начинай жест только с «ручки» (`touch-action: none` только на ручке), закрывай по `pointerup` при `dy > 96` **и** (`dy/dt > 0.4 px/мс` или `dy > 160`), отменяй по `pointercancel`/`pointermove` с `|dx| > 24`.
3. **Долгие нажатия.** В `library-*.js` и мессенджере `onPointerDown` запускает таймер 380 мс; отмена только на `pointerup/leave/cancel`. Добавь отмену по `pointermove`, если палец ушёл > 10 px (иначе «скролл с задержкой» превращается в контекстное меню). `contextmenu` на сенсорных — `preventDefault` только на элементе, где меню своё.
4. **Модалки.** Radix/`react-remove-scroll` вешает `touchmove {passive:false}` на `document`, пока диалог открыт. Это ок только пока он открыт; для «лёгких» меню/поповеров используй `modal={false}`; в шторках — `overscroll-behavior: contain`.
5. **`touch-action: manipulation`** на кнопки/ссылки/поля (в приложении добавляется само, в браузере нет):
   ```css
   a, button, [role=button], [role=tab], [role=menuitem], summary, label, input, select, textarea { touch-action: manipulation }
   ```
6. **Нажатия по `click`, не по `pointerdown`/`touchstart`.** Действия (отправка, удаление, навигация) вешай на `onClick`. `onPointerDown`/`onTouchStart` допустимы только для визуального «нажато» (`:active`) и для жестов с порогом. Найди: `rg -n "onPointerDown|onTouchStart|onMouseDown" src/ | rg -v "setPointerCapture"`. Ссылки роутера с `preload="intent"` стартуют загрузку маршрута на `touchstart` — на длинных списках каждый скролл тянет сеть и JS; ставь `preload="viewport"` с задержкой или `false` для карточек списков (проверь: `rg -n "preload=" src/`).
7. **Hover.** Проверено: все 10 `:hover`-правил в CSS сайта уже внутри `@media (hover:hover)` — оставь так; не добавляй `:hover` вне этого блока и JS-обработчики `onMouseEnter` для показа UI (на тач-экране «залипают»).
8. **Порог тапа/скролла.** Для любых своих жестов (свайп, drag, framer-motion `drag`): начало жеста после смещения **≥ 10 px** (`dragDirectionLock`, `dragElastic: 0.1`, `dragMomentum: false`), отмена, если жест начался вертикальным, а ты слушаешь горизонтальный. Tap = смещение < 10 px **и** длительность < 300 мс.
9. **Обработчики прокрутки.** `scroll` — только `{passive:true}` и только через `requestAnimationFrame`-дросселирование; не читать `offsetHeight/getBoundingClientRect` после записи стилей в том же обработчике (layout thrashing). `IntersectionObserver` вместо измерений в `scroll` (там, где он уже есть, оставь).
10. **Viewport:** `width=device-width, initial-scale=1, viewport-fit=cover` — корректно, менять не нужно. Не добавляй `user-scalable=no` (в приложении зум уже выключен, в браузере это вопрос доступности).

**Приёмка:** на телефоне со включёнными «Параметрами разработчика → Профилирование GPU» или на слабом устройстве: быстрая прокрутка ленты/чата не вызывает обновления страницы, не закрывает шторки, не открывает контекстное меню; обновление срабатывает только от осознанного протягивания от самого верха; DevTools → Performance: во время прокрутки нет «Long task», нет предупреждений «[Violation] Added non-passive event listener to a scroll-blocking event» (Console → Verbose).

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

export function appNotify(o: { id: string; channel: 'messages' | 'ai' | 'subs' | 'player' | 'money' | 'security' | 'system'; title: string; body?: string; url?: string; onlyWhenBackground?: boolean }) {
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

## P1 — вибрация (haptic) в приложении 2.7.0
`VvvionApp.haptic(type)` даёт короткую системную вибрацию-отклик. Работает только в приложении, в браузере `window.VvvionApp` нет, поэтому вызов безопасен через `?.`. Приложение учитывает системную настройку «Виброотклик» и не чаще одного раза в 40 мс (лишние вызовы просто игнорируются). Разрешение `VIBRATE` не нужно.

| type | Когда | Ощущение |
|---|---|---|
| `selection` | смена выбора: пункт списка, вкладка, слайдер по шагам | самый лёгкий тик |
| `light` | обычное нажатие: кнопка, чекбокс, переключатель | лёгкий тик |
| `medium` | заметное действие: отправка сообщения, лайк | средний клик |
| `heavy` | долгое нажатие, удаление, начало перетаскивания | сильный |
| `success` | операция удалась: файл загружен, оплата прошла, ответ ИИ получен | «подтверждение» (на Android 11+ системное, раньше обычный клик) |
| `warning` | предупреждение: подписка скоро закончится, лимит почти исчерпан | двойной короткий |
| `error` | ошибка: не отправилось, неверный пароль, сеть пропала | «отказ» (на Android 11+ системное, раньше двойной сильный) |

Хелпер (одна строка, безопасна в браузере и на сервере при SSR):
```ts
// src/lib/haptic.ts
export type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';
export const haptic = (t: HapticType = 'light') => (typeof window !== 'undefined' ? (window as any).VvvionApp?.haptic?.(t) : undefined);
```
Где вызывать:
- отправка сообщения (чат с ИИ и личные): `haptic('medium')` при нажатии «Отправить»;
- лайк/реакция: `haptic('light')`; снять лайк: `haptic('selection')`;
- переключатели в настройках, чекбоксы: `haptic('light')`; выбор модели/вкладки/пункта меню: `haptic('selection')`;
- ответ модели завершён (если вкладка активна): `haptic('success')`; ошибка отправки/запроса: `haptic('error')`;
- удаление, долгое нажатие на сообщении: `haptic('heavy')`;
- play/pause, следующий/предыдущий трек: `haptic('light')`;
- покупка вублей/оплата прошла: `haptic('success')`, отказ: `haptic('error')`.
Не вызывай `haptic` в цикле, на прокрутке и по таймеру: частая вибрация раздражает и расходует батарею.

---

## P2 — загрузка файлов (приложение 2.7.0)
Приложение теперь само скачивает файлы в системную папку «Загрузки» через системный загрузчик (с уведомлением и прогрессом, по тапу файл открывается). Что должен делать сайт, чтобы это работало:
- Для обычных файлов (МегаДиск и т. д.) оставь нормальную ссылку `<a href="/api/..." download>` или ответ сервера с заголовком `Content-Disposition: attachment; filename="..."`. Для русских имён добавляй и `filename*=UTF-8''%D0%...` (RFC 5987), например: `attachment; filename="file.pdf"; filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82.pdf`.
- Файл должен отдаваться GET-запросом по обычной ссылке, а доступ проверяться сессионной cookie: приложение передаёт загрузчику cookie WebView и User-Agent. Заголовок `Authorization`, который сайт добавляет вручную через `fetch`, загрузчик передать не может: для скачивания используй cookie-сессию.
- Файлы, которые сайт собирает в браузере (`URL.createObjectURL(blob)` и `data:`), приложение тоже сохраняет: достаточно обычного `<a href={blobUrl} download="имя.ext">` и `a.click()` (в том числе способа из FileSaver.js). Лимит 200 МБ; для больших файлов отдавай с сервера обычной ссылкой.
- Не открывай скачиваемые файлы через `window.open(url)`: используй ссылку с `download` или `Content-Disposition: attachment`.

---

## P2 — ярлыки на иконке приложения (приложение 2.7.0)
Долгое нажатие на иконку показывает 4 ярлыка. Они открывают страницы внутри уже запущенного приложения, музыка не прерывается:
| Ярлык | Адрес |
|---|---|
| Новый чат | `https://vvvion.space/?new=1` |
| Сообщения | `https://vvvion.space/c/messages` |
| Плеер | `https://vvvion.space/c/play` |
| МегаДиск | `https://vvvion.space/c/disk` |

Сделай так, чтобы `/?new=1` открывал пустой новый чат (параметр `new` надо принять в `validateSearch` главного маршрута и затем убрать из адреса). Если эти адреса когда-нибудь поменяются, сообщи мне: список ярлыков зашит в приложение и обновляется только новой сборкой.

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
**Переменные окружения:** `FIREBASE_SERVICE_ACCOUNT_JSON` (содержимое JSON ключа сервисного аккаунта в base64) и `FIREBASE_PROJECT_ID=space-vvvion-app`. Если переменной нет, отправка тихо отключается (в лог — одна строка без секретов), сайт при этом работает.

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

export type PushKind = 'messages' | 'ai' | 'subs' | 'money' | 'security' | 'system';
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
- Все значения в `data` — строки. Поля: `id` (стабильный, для замены/дедупа), `channel` (`messages`/`ai`/`subs`/`player`/`money`/`security`/`system`), `title`, `body`, `url` (**только путь** на сайте вроде `/chat/abc` — приложение откроет только vvvion.space).
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

## P1 — каталог уведомлений (что слать, когда, куда вести)
Принцип: **одно место правды** — реестр событий на сервере (`notifyUser(userId, eventKey, vars)`), он сам выбирает канал, текст на языке пользователя, `id` для замены/дедупа, URL и проверяет настройки пользователя и «тихие часы». Клиентский `appNotify()` остаётся для случаев «приложение живо, но свёрнуто» (ответ ИИ, сообщение), а всё, что должно дойти при закрытом приложении, идёт через FCM.

Реальные адреса разделов сайта: чат — `/?chat=<id>`, комната/группа — `/?room=<id>`, круг: `/c/messages`, `/c/feed`, `/c/play`, `/c/services`, `/c/disk` (Мегадиск — `/disk`), `/c/bank`, `/c/shop`. Проверь по роутеру: `rg -n "createFileRoute|createRoute|validateSearch" src/`.

| Канал | Ключ события (`id`) | Когда | Заголовок / текст (ru) | Куда ведёт | Кто шлёт |
|---|---|---|---|---|---|
| `ai` | `ai:<chatId>:<msgId>` | ответ модели готов, пользователь не смотрит | «<Модель>» / «Ответ готов» | `/?chat=<id>` | клиент + сервер |
| `ai` | `ai-fail:<chatId>:<msgId>` | модель не ответила / ошибка провайдера / кончились вубли | «Не удалось получить ответ» / «Попробуйте ещё раз или выберите другую модель» | `/?chat=<id>` | клиент + сервер |
| `ai` | `img:<jobId>` | картинка сгенерирована | «Картинка готова» | чат | сервер |
| `messages` | `msg:<dialogId>` | новое личное сообщение (замена, а не стопка) | имя / «Новое сообщение» (или текст, если включён предпросмотр) | `/c/messages` (диалог) | сервер |
| `messages` | `room:<roomId>` | сообщение в группе; упоминание `@имя` — приоритетнее и отдельным `id` `mention:<roomId>:<msgId>` | название группы / «Новое сообщение» | `/?room=<id>` | сервер |
| `messages` | `invite:<id>` | пригласили в группу / запрос в друзья | «Вас пригласили в группу «…»» | `/c/messages` | сервер |
| `messages` | `feed:<postId>` | новая запись у тех, на кого подписан (дайджест раз в день, не каждый пост) | «Новое в ленте» | `/c/feed` | сервер (cron) |
| `subs` | `sub:premium:3d` / `:1d` / `:expired` | за 3 дня, за 1 день, в день окончания | «Премиум» / «Закончится через 3 дня» | `/c/shop` | сервер (cron, `notifyOnce`) |
| `subs` | `sub:mega:3d` / `:1d` / `:expired` | то же для Мегадиска | «MegaDisk» / «…» | `/disk` | сервер (cron) |
| `subs` | `disk-quota:80` / `:100` | занято 80 % и 100 % места на диске | «Диск почти заполнен» / «Освободите место или расширьте диск в магазине» | `/c/disk` | сервер |
| `subs` | `vpn:3d` / `vpn-traffic:90` | VPN заканчивается / трафик 90 % | «VPN» / «…» | `/c/services` | сервер |
| `money` | `vubli-in:<transferId>` | вам перевели вубли | «Вам перевели 120 вублей» / «От <имя>» | `/c/bank` | сервер |
| `money` | `pay-ok:<paymentId>` | платёж зачислен (после вебхука, **не** по редиректу) | «Оплата прошла» / «Зачислено 500 вублей» | `/c/bank` | сервер |
| `money` | `pay-fail:<paymentId>` / `pay-expired:<paymentId>` | платёж отклонён / счёт истёк | «Оплата не прошла» | `/c/bank` | сервер |
| `money` | `shop:<orderId>` | покупка в магазине (подписка, место на диске, персонаж) | «Покупка оформлена» | `/c/shop` | сервер |
| `security` | `login:<sessionId>` | вход с нового устройства/IP | «Новый вход в аккаунт» / «Android · <город>. Это были не вы? Смените пароль» | `/settings` (безопасность) | сервер |
| `security` | `pwd-changed:<ts>` / `email-changed:<ts>` | сменили пароль/почту | «Пароль изменён» | `/settings` | сервер |
| `security` | `login-fail-burst` | ≥ 5 неверных паролей за 10 минут | «Попытки входа в ваш аккаунт» | `/settings` | сервер |
| `system` | `app-update:<ver>` | вышла новая версия приложения (дополнительно к встроенному обновлению) | «Доступно обновление» | страница обновления | сервер |
| `system` | `release:<ver>` | выпуск из журнала «Что менялось» (только если пользователь включил «Новости проекта») | заголовок выпуска | `/about` | сервер (при публикации) |
| `system` | `maint:<id>` | плановые работы / сбой модели, о котором стоит знать | «Технические работы» | — | сервер (вручную из админки) |
| `downloads` | `dl-ready:<id>` / `dl-expiring:<id>` | загрузчик ролика: файл готов / исчезнет через минуту (живёт 5 минут); архив папки диска готов | «Файл готов к скачиванию» | `/c/services` / `/c/disk` | сервер (клиент, если приложение живо) |
| `system` (только админам) | `adm:*` | падение сервера/провайдера модели, всплеск ошибок, вебхук оплаты не прошёл, жалоба/обращение | «Админка: …» | `/admin` | сервер |

### Реестр на сервере (шаблон)
```ts
type Channel = 'messages' | 'ai' | 'subs' | 'player' | 'money' | 'security' | 'system';
interface EventDef { channel: Channel; pref: PrefKey; ttlSec: number; collapse?: boolean;
  text: (v: any, lang: 'ru'|'en') => { title: string; body: string }; url: (v: any) => string; }
export const EVENTS: Record<string, EventDef> = { /* 'sub:premium:3d': {...}, 'vubli-in': {...}, ... */ };

export async function notifyUser(userId: string, key: string, id: string, vars: any, opts?: { onlyOnce?: boolean }) {
  const def = EVENTS[key]; if (!def) return;
  const prefs = await getPrefs(userId);                                  // см. ниже
  if (!prefs[def.pref] || inQuietHours(prefs, def.channel)) return;      // security — никогда не глушится
  if (opts?.onlyOnce && !(await insertIgnore('push_log', { user_id: userId, kind: key, ref_id: id }))) return;
  const lang = prefs.lang ?? 'ru';
  const t = def.text(vars, lang);
  await sendPush(userId, def.channel, { id: `${key}:${id}`, title: t.title, body: prefs.preview || def.channel !== 'messages' ? t.body : 'Новое сообщение', url: def.url(vars) });
}
```
### Настройки пользователя (UI в профиле, блок «Уведомления в приложении»)
Переключатели: «Ответы ИИ», «Сообщения и группы», «Подписки и место на диске», «Вубли и платежи», «Безопасность аккаунта» (включён и **не отключается**), «Новости проекта» (по умолчанию выкл), «Показывать текст сообщений» (по умолчанию выкл), «Тихие часы» (по умолчанию 23:00–08:00, не касается `security`). Таблица `notification_prefs(user_id, ai, messages, subs, money, security, system, preview, quiet_from, quiet_to, lang)`; `PUT /api/push/settings` уже предусмотрен выше.

### Правила
- Не больше одного push на один `id` и не чаще 1 раза в 10 с на диалог; группируй («3 новых сообщения»).
- В `body` нет паролей, кодов, номеров карт, суммы можно, чужой личный текст — только при включённом предпросмотре.
- `ttl` для `messages`/`ai` — 1 час, для `subs` — 24 часа, `security` — 24 часа, `high` priority только для `messages`/`security`/`money`.
- Сообщение нужно отправлять только тогда, когда клиент не видит событие сам (нет живого соединения или `fg` не задан) — иначе двойной сигнал вместе с звуком сайта.
- Каждое событие — отдельный тест: событие → строка в `push_log` → вызов `sendPush` с ожидаемым `channel/url`.

**Приёмка:** для 5 любых событий из таблицы приходит push на закрытое приложение, в нужном канале (проверь в Android → Настройки приложения → Уведомления, должны быть: Сообщения, Чат с ИИ, Подписки, Плеер, Загрузки, Вубли и платежи, Безопасность аккаунта, Новости проекта); тап ведёт на нужный раздел; отключение категории в профиле останавливает её; `security` не отключается.

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
Проект Firebase уже создан: **`space-vvvion-app`**, Android-приложение `space.vvvion.app`. Файл `google-services.json` у меня, приложение с push вышло как 2.6.0, текущая версия — **2.8.0**.

Что нужно для сервера:
1. Firebase Console → ⚙ **Project settings → Service accounts → Generate new private key**. Скачается JSON (внутри `private_key`, это секрет).
2. Положи его **только** в переменные окружения сервера, в файлы и репозиторий не клади, мне и в чат не отправляй:
   - `FIREBASE_PROJECT_ID=space-vvvion-app`
   - `FIREBASE_SERVICE_ACCOUNT_JSON=<содержимое файла в base64>` (`base64 -w0 key.json`).
3. В Google Cloud Console проекта `space-vvvion-app` должен быть включён **Firebase Cloud Messaging API** (в новых проектах он включён по умолчанию; если отправка отвечает 403/`SENDER_ID_MISMATCH`/`API has not been used`, включи его в «APIs & Services»).
4. Отдай Cursor этот файл как задачу и выкати сайт. Секрет `FIREBASE_SERVICE_ACCOUNT_JSON` должен быть задан на сервере **до** выката.
5. Установи приложение 2.8.0 поверх старого (подпись та же, обновится без удаления), зайди в аккаунт.

### Как идёт токен (для понимания)
1. Приложение при запуске просит у Firebase токен устройства и отдаёт его странице: `VvvionApp.getPushToken()` и событие `vvvion-app-push-token`.
2. Сайт после входа шлёт `POST /api/push/register` с этим токеном. Сервер привязывает его к пользователю из сессии.
3. Когда нужно уведомить, сервер шлёт на токен data-сообщение через FCM HTTP v1 (`https://fcm.googleapis.com/v1/projects/space-vvvion-app/messages:send`, авторизация ключом сервисного аккаунта). Приложение само рисует уведомление в нужном канале.

Push не работает на телефонах без Google Play Services (например, новые Huawei). Приложение на них не падает: музыка, локальные уведомления и всё остальное работают как обычно, просто токена нет (`getPushToken()` возвращает `''`).

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

**Скорость и касания (2.8.0)**
18. Открыть поле ввода → клавиатура: сверху нет светлой полосы; закрыть → нет прыжков.
19. Лента/чат: быстрый скролл не обновляет страницу, не закрывает шторки, не открывает меню долгого нажатия.
20. Потянуть вниз от самого верха медленно и намеренно → обновление один раз (не два).
21. Стрим длинного ответа на слабом телефоне: текст идёт плавно, шапка и поле ввода не дёргаются.
22. Системно выключить анимации (Для разработчиков → Масштаб анимации = выкл.) → фон «Туман», орбы и свечение круга не двигаются.
23. Пройти все категории уведомлений в Android → Настройки приложения → Уведомления: 8 каналов.

---

## P1 — «О проекте», FAQ и юридические страницы
Сейчас на сайте есть `/about` (описание и журнал выпусков). Страниц с условиями **нет** (`/terms`, `/privacy`, `/legal`, `/faq`, `/offer` отвечают 404). Для магазинов приложений (Google Play, RuStore) и для приёма платежей они обязательны. Сделай роуты и ссылки в подвале, на экране регистрации (чекбокс согласия) и в профиле.

> **Важно.** Тексты ниже — **черновики на основе того, что делает сервис по данным сайта**. Они не заменяют юриста. Всё, что в квадратных скобках `[...]`, нужно подставить/подтвердить владельцем (реквизиты, сроки, провайдеры). Cursor: не придумывай факты в скобках — оставь поля настраиваемыми (`site-config`) и выведи их на страницах.

Роуты и SEO:
```
/about            — «О проекте» (есть) + блок «Приложение для Android» (скачать, как установить, как обновлять)
/faq              — вопросы и ответы (JSON-LD FAQPage)
/legal            — оглавление
/legal/terms      — Пользовательское соглашение
/legal/privacy    — Политика конфиденциальности
/legal/offer      — Публичная оферта (вубли, подписки, магазин, возвраты)
/legal/rules      — Правила использования ИИ и контента, жалобы
/legal/cookies    — Cookie и локальное хранилище
/legal/delete     — Как удалить аккаунт и данные (нужно Google Play при регистрации в приложении)
```
Все страницы — доступны без входа, индексируются, в `<title>` `…| vvvion.space`, `canonical`, `hreflang` как у остальных. Дата редакции вверху (`Редакция от [дата]`), история версий внизу. Ссылки в приложении открываются в самом приложении (домен тот же).

### О проекте (текст для `/about` и карточки в магазине)
> **vvvion.space** — чат с ИИ и «круг» рядом с ним. Здесь спрашивают нейросети, пишут друзьям, читают книги, смотрят ролики, держат файлы и пользуются внутренними вублями. Сервис для людей **старше 18 лет**.
> **Чат с ИИ:** выбор встроенной модели или подключение собственного ключа; текст, картинки, поиск по открытым страницам, ход мысли, уточняющие вопросы; MCP-серверы по ссылке https; персонажи.
> **Круг:** сообщения и группы, лента, погода, новости, курсы валют, VPN, Читальня (EPUB, FB2, TXT и PDF до 25 МБ), Смотрельня (YouTube, Rutube, VK), загрузчик роликов (файл живёт 5 минут), плеер с музыкой.
> **Диск и Мегадиск:** картинки и голосовые из чата, папки, ссылки на просмотр, скачивание архивом.
> **Банк и магазин:** вубли — внутренняя «мелочь» сервиса: карта, переводы другу или по номеру. Вубли нельзя вывести или обменять на рубли. В магазине — подписка, место на диске, персонажи.
> **Приложение для Android:** музыка играет в фоне, уведомления в шторке, push, быстрый запуск разделов с иконки, офлайн-экран.

### FAQ (`/faq`, группы и вопросы — готовый текст; `[...]` — проверить)
**Общее**
- *Что такое vvvion.space?* — Чат с ИИ и круг сервисов рядом: сообщения, лента, диск, плеер, читальня, банк и магазин. Подробнее — на странице «О проекте».
- *Это бесплатно?* — Базовые функции доступны бесплатно в пределах лимитов [уточни лимиты]. Подписка, дополнительное место на диске и персонажи покупаются в магазине.
- *Кому можно пользоваться?* — Сервис для людей **старше 18 лет**. Регистрируясь, вы подтверждаете возраст.
- *Какие устройства поддерживаются?* — Любой современный браузер и приложение для Android 7.0 и новее.

**Аккаунт**
- *Как создать аккаунт / войти?* — Кнопка входа в шапке; нужна почта и пароль [уточни: есть ли вход через сторонние сервисы]. При регистрации и входе проверяется, что вы не бот.
- *Забыл пароль.* — [уточни, есть ли восстановление; если нет — написать на [email поддержки]].
- *Как удалить аккаунт?* — Профиль → «Удалить аккаунт» или письмо на [email]; подробнее — «Как удалить аккаунт и данные».
- *Как отключить уведомления?* — Профиль → «Уведомления в приложении», либо Android → Настройки → Приложения → VVVion Space → Уведомления.

**Чат с ИИ**
- *Какие модели доступны?* — Список в селекторе над полем ввода; состав может меняться. Свой ключ подключается в настройках.
- *Почему ответы иногда неточные?* — ИИ может ошибаться. Проверяйте важные факты, не используйте ответы как медицинскую, юридическую или финансовую консультацию.
- *Хранятся ли мои диалоги?* — Да, в вашем аккаунте, чтобы вы видели историю. Можно удалить диалог или все диалоги сразу; удаление и из браузера, и из аккаунта.
- *Что такое «ход мысли» и «уточняющие вопросы»?* — Включаются в меню «+» у поля ввода: модель показывает рассуждение / задаёт вопросы с вариантами ответа.
- *Что такое MCP?* — Подключение внешних инструментов по ссылке https (до четырёх серверов). Подключайте только серверы, которым доверяете.

**Вубли, магазин, платежи**
- *Что такое вубли?* — Внутренняя единица сервиса. Их можно переводить другу или по номеру карты, тратить на функции. **Вывести вубли или обменять на рубли нельзя.**
- *Как пополнить?* — Раздел «Банк» → пополнить, оплата через платёжного провайдера [название]. Данные карты сервис не хранит [подтверди].
- *Платёж прошёл, а вубли не пришли.* — Зачисление идёт после подтверждения провайдером, обычно до [N] минут. Если нет — напишите на [email] с номером платежа.
- *Возврат.* — См. «Публичную оферту», раздел о возвратах [условия].

**Диск и Мегадиск**
- *Что хранится на диске?* — Картинки и голосовые из чата и файлы, которые вы загрузили. Папку можно поделиться ссылкой для просмотра или скачать архивом.
- *Сколько места?* — [объём] бесплатно, больше — в магазине (Мегадиск).
- *Что будет, когда подписка закончится?* — Файлы не удаляются сразу: [срок хранения после окончания], до этого можно продлить.

**Приложение для Android**
- *Музыка останавливается в фоне?* — Нет: приложение держит плеер как фоновую службу с кнопками в шторке. Если телефон агрессивно «экономит батарею» (Xiaomi, Huawei, Samsung) — разрешите приложению работать в фоне.
- *Как обновить приложение?* — Приложение само предложит обновление; устанавливается поверх старой версии без потери данных.
- *Почему нет уведомлений?* — Разрешите их при запросе (Android 13+) и проверьте категории в настройках приложения.
- *Зачем приложению микрофон?* — Для голосового ввода и голосовых сообщений; включается только по вашему нажатию.
- *Как скачивать файлы?* — Обычные ссылки скачиваются через системные «Загрузки» с уведомлением о прогрессе; файлы сохраняются в папку «Загрузки».

**Безопасность и приватность**
- *Кто видит мои сообщения?* — Только вы и собеседники. Администрация не читает личные сообщения, кроме случаев, предусмотренных правилами и законом [подтверди].
- *Куда уходят мои запросы к ИИ?* — Провайдерам выбранной модели для генерации ответа; см. «Политику конфиденциальности».
- *Как сообщить о нарушении или уязвимости?* — [email] / форма на «Правилах».

JSON-LD: собери `FAQPage` из этих пар (`mainEntity: [{ '@type':'Question', name, acceptedAnswer:{ '@type':'Answer', text } }]`).

### Пользовательское соглашение — черновик (`/legal/terms`)
1. **Стороны.** Сервис «vvvion.space» (далее — Сервис) предоставляет [ФИО/ИП/самозанятый, ИНН/ОГРНИП, адрес/контакт] (далее — Администрация). Пользователь — лицо, использующее Сервис.
2. **Возраст.** Сервис предназначен для лиц **старше 18 лет**. Регистрируясь, Пользователь подтверждает возраст и дееспособность.
3. **Аккаунт.** Пользователь отвечает за сохранность пароля и действия под своим аккаунтом, сообщает об утечке доступа на [email]. Один человек — один аккаунт [подтверди].
4. **Что даёт Сервис.** Чат с моделями ИИ третьих сторон, обмен сообщениями, лента, диск, плеер, читальня, смотрельня, загрузчик, банк (внутренние вубли), магазин. Состав, лимиты и модели могут меняться; Администрация вправе добавлять и убирать функции.
5. **ИИ.** Ответы генерируются автоматически, могут быть неточными или вымышленными, не являются профессиональной консультацией. Пользователь сам оценивает и проверяет ответы.
6. **Контент пользователя.** Принадлежит Пользователю. Он даёт Сервису ограниченное право хранить, обрабатывать и передавать его провайдерам ИИ в объёме, нужном для работы функций. Запрещено загружать и отправлять контент, нарушающий закон или права третьих лиц (см. «Правила использования»).
7. **Вубли.** Внутренняя расчётная единица Сервиса. Не являются электронными деньгами или платёжным средством, **не подлежат выводу и обмену на денежные средства**; порядок пополнения, расходования, возврата — в Публичной оферте.
8. **Запрещено:** автоматизированный сбор данных, обход ограничений и лимитов, нагрузка на инфраструктуру, перепродажа доступа, выдача себя за другое лицо, распространение вредоносного ПО, использование Сервиса для противоправных целей.
9. **Загрузка файлов и музыки.** Пользователь гарантирует, что имеет право на загружаемые материалы (включая музыку, книги, видео-ссылки). Администрация удаляет материалы по обоснованной жалобе правообладателя (`/legal/rules`).
10. **Модерация и блокировка.** При нарушении соглашения или закона Администрация вправе ограничить или удалить аккаунт и контент [порядок уведомления].
11. **Доступность.** Сервис предоставляется «как есть»; возможны перерывы, сбои у провайдеров ИИ и сторонних сервисов. Администрация не гарантирует бесперебойность и сохранность данных; Пользователь сам делает копии важного.
12. **Ответственность.** В пределах, допускаемых законом, Администрация не отвечает за косвенные убытки, за содержание ответов ИИ, за действия других пользователей и сторонних сервисов (YouTube, Rutube, VK, провайдеры ИИ, платёжные системы).
13. **Изменения.** Администрация может менять соглашение; новая редакция вступает в силу с публикации, о существенных изменениях уведомляет в Сервисе.
14. **Право и споры.** Применяется право [Российской Федерации/иное]; претензионный порядок: [срок] дней, адрес [email]. Подсудность — по закону.
15. **Контакты:** [email поддержки], [почтовый адрес при необходимости].

### Политика конфиденциальности — черновик (`/legal/privacy`; ориентир — 152-ФЗ и GDPR-принципы)
1. **Оператор:** [наименование, ИНН, адрес, email для запросов]. Политика действует для сайта vvvion.space и приложения «VVVion Space» (Android, `space.vvvion.app`).
2. **Какие данные обрабатываются**
   - *Аккаунт:* почта, отображаемое имя, хеш пароля, настройки, язык, тема, выбранная модель.
   - *Контент:* диалоги с ИИ, личные и групповые сообщения, лента, файлы и голосовые на диске, плейлисты, прогресс чтения.
   - *Платежи:* история операций с вублями и покупок; данные банковской карты обрабатывает платёжный провайдер [название], Сервис карту не хранит [подтверди].
   - *Технические:* IP-адрес, User-Agent, журнал запросов и ошибок, статистика использования токенов, cookies сессии, токен push-уведомлений (FCM), платформа и версия приложения.
   - *Проверка на бота:* отправляются данные, нужные для проверки (human-check).
   - *Разрешения приложения:* интернет, микрофон (по нажатию), уведомления, фоновая служба плеера, запись файлов в «Загрузки» (Android ≤ 9). Геолокацию, контакты и фото-галерею приложение само не читает [подтверди]; файлы выбираются вами через системный выбор.
3. **Цели:** предоставление функций, безопасность и защита от злоупотреблений, платежи и возвраты, поддержка, улучшение сервиса, уведомления (push) по вашим настройкам, исполнение закона.
4. **Передача третьим лицам:** провайдерам моделей ИИ (текст запроса и вложения — для генерации ответа; список: [провайдеры]); Google Firebase Cloud Messaging (доставка push; токен устройства); платёжному провайдеру; хостинг-провайдеру [название]; шрифты Google Fonts при загрузке страницы [рекомендация: разместить шрифты на своём домене]; встроенные плееры YouTube/Rutube/VK подключают их собственные cookies при воспроизведении. Данные не продаются [подтверди].
5. **Правовые основания:** согласие, исполнение договора, законный интерес в безопасности, требования закона.
6. **Хранение:** пока существует аккаунт и [срок] после удаления; журналы — [N дней]; платёжные записи — по требованиям закона. Диалоги и файлы удаляются пользователем самостоятельно, из аккаунта и из хранилища.
7. **Хранение за пределами РФ / трансграничная передача:** [подтверди, где серверы; указать для провайдеров ИИ и Google].
8. **Права пользователя:** доступ, исправление, удаление, ограничение обработки, отзыв согласия, выгрузка данных, жалоба в надзорный орган. Запросы — на [email], срок ответа [30] дней. Удаление аккаунта — `/legal/delete`.
9. **Безопасность:** шифрование соединения (HTTPS), хеширование паролей, разделение доступа, журналирование админ-действий.
10. **Cookies и локальное хранилище:** сессия, тема, язык, фон чата, настройки; аналитика [есть/нет]. Подробнее `/legal/cookies`.
11. **Дети:** Сервис для лиц 18+, данные несовершеннолетних сознательно не собираются; если стало известно — удаляются.
12. **Изменения и контакты:** редакция от [дата], уведомление о существенных изменениях в Сервисе; [email].

### Публичная оферта (вубли, подписки, магазин) — черновик (`/legal/offer`)
1. Предмет: возмездное предоставление расширенных возможностей Сервиса — подписка (Премиум), место на диске (Мегадиск), персонажи, пополнение баланса вублей.
2. Вубли: внутренняя единица; пополнение через провайдера [название] по курсу [1 ₽ = N вублей]; вубли расходуются на функции Сервиса; **вывод и обмен на деньги невозможны**; переводы между пользователями безвозвратны, комиссия [есть/нет].
3. Акцепт: нажатие «Оплатить»/«Купить». Оплата считается совершённой после подтверждения провайдером.
4. Цены и сроки подписок указаны в магазине и могут меняться; уже оплаченный период не пересчитывается. [Автопродление: нет/да — указать, как отключить.]
5. Возврат: цифровая услуга; возврат неиспользованной части или при технической невозможности оказания услуги — по заявлению на [email] в течение [N] дней [условия]. Закон о защите прав потребителей применяется в части, не противоречащей характеру услуги.
6. Окончание подписки: функции возвращаются к бесплатному уровню; файлы сверх лимита хранятся [N] дней, затем удаляются; напоминания — за 3 и 1 день (push/уведомления).
7. Налоги и чеки: [самозанятый/ИП — порядок выдачи чека].
8. Реквизиты: [наименование, ИНН, банк, контакты].

### Правила использования ИИ и контента — черновик (`/legal/rules`)
- Нельзя: просить и распространять незаконный контент (экстремизм, детская эксплуатация, инструкции по насилию, мошенничество, вредоносный код для атак), нарушать чужие авторские права и персональные данные, выдавать сгенерированное за официальную позицию организаций, обходить лимиты.
- Ответственность за запросы и использование ответов — на пользователе. Не вводите пароли, данные карт и чужие персональные данные.
- Музыка/книги/видео: загружайте только то, на что есть права. Жалоба правообладателя на [email] с указанием материала, подтверждением прав и контактами; рассмотрение — до [N] рабочих дней; неоднократные нарушения ведут к блокировке.
- Жалоба на пользователя или сообщение: кнопка «Пожаловаться» [реализовать] или [email]; нарушители могут быть ограничены без возврата вублей.
- Сообщить об уязвимости: [email безопасности], ответственное раскрытие, без публикации до исправления.

### Cookie и локальное хранилище — черновик (`/legal/cookies`)
Таблица: имя / назначение / срок / обязательное ли. Минимум: *сессия* (вход, обязательное), `yaronetic.theme` (тема), `yaronetic.paper` (фон чата), язык, human-check (проверка на бота), настройки уведомлений. Сторонние: YouTube/Rutube/VK-плееры (при просмотре), Google Fonts (запрос шрифтов). Если есть аналитика — баннер согласия (для нужных юрисдикций) и ссылка «Изменить выбор».

### Как удалить аккаунт и данные (`/legal/delete`)
Шаги в профиле («Удалить аккаунт») и письмом на [email] с адреса аккаунта; что удаляется (аккаунт, диалоги, сообщения, файлы диска, токены push), что остаётся по закону (платёжные записи) и сроки (`[до 30 дней]`). Нужна и для Google Play (Data safety → «Удаление данных»), если аккаунт создаётся в приложении: укажи эту ссылку в Play Console.

### Куда ещё вставить
- Подвал сайта: `О проекте · FAQ · Соглашение · Конфиденциальность · Оферта · Правила · Cookies · Контакты`.
- Экран регистрации: чекбокс «Мне есть 18 лет, я принимаю Соглашение и Политику» (ссылки открываются в новой вкладке/приложении); без галочки кнопка неактивна; факт согласия + версия + время — в БД.
- Магазин/банк: ссылка на Оферту рядом с кнопкой оплаты.
- Google Play (если будешь публиковать): URL политики конфиденциальности = `/legal/privacy`, Data safety заполняется по списку данных выше, удаление данных = `/legal/delete`, рейтинг 18+. Учти ограничения Google Play на самообновляемые приложения (`REQUEST_INSTALL_PACKAGES`).
