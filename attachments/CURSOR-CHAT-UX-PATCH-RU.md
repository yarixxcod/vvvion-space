# VVVion Space — чат на телефоне: исправления + интерактивные вопросы (как в ChatGPT) — задача для Cursor

## Правила для Cursor
- Сначала найди код по строкам-подсказкам `rg` (в проде код минифицирован, имена вроде `Bk`, `Hk`, `Ok` ничего не значат — ищи по строкам из таблицы «Архитектура чата»), прочитай и только потом меняй.
- Не выдумывай. Если подсказка не находится, остановись и напиши, что именно не нашёл. Пункты с пометкой **[проверить]** сначала исследуй и напиши вывод, потом чини.
- Обе темы сохранить: `:root` — тёмная (`--bg:#0c0c0e`), `html.light` — светлая. Токены брать из CSS-переменных (`--bg --elev --subtle --fg --muted --faint --line --accent --accent-fg`), цвета руками не вбивать.
- Логику авторизации, банка, диска, переписки между людьми не трогать. Меняем только чат с моделями.
- Один пункт — один коммит: `chat-ux: P0-1 …`. После каждого — `build`, `lint`, критерии приёмки.
- Секреты не логировать и не коммитить. Ни один тест не должен ходить в настоящие модели: SSE мокается (пример в разделе «Тесты»).
- Любой JSON от модели считать недоверенным вводом: валидировать, обрезать, рендерить только как текст.

## Метки доказательств
| Метка | Что значит |
|---|---|
| **Измерено** | Снято в Chrome (Playwright, тестовый аккаунт B) на 390×844 / 360×780 / 1440×900, DPR 3 для мобильных. |
| **По коду** | Прочитано в продакшен-бандле (`/assets/routes-*.js`, `transcript-*.js`, `model-face-*.js`, `styles-*.css`). |
| **Предположение** | Выведено косвенно, нужно подтвердить. |
| **Не проверено** | Не удалось проверить в этой сессии. |

Сравнение с ChatGPT / Claude / Gemini — по моим знаниям об этих приложениях, а не по прямому тесту на устройстве в этой сессии.

---

## 1. Итог осмотра

**Оценка «насколько похоже на флагманы»: 5 из 10.** Тема, шрифт 16 px, анимация появления, блок «Ход мысли», кнопка «К последнему», копирование кода, превью HTML, формулы KaTeX, карточки шагов `<Sequence>` — уже на уровне хороших клиентов. Но на телефоне чат выглядит как веб-страница, а не как приложение: узкая колонка ответа из-за аватара, заголовки без стилей, высокая нижняя панель, мелкие кнопки, нет подсказки о горизонтальном скролле таблиц и кода, ответ на «2+2?» занимает пять абзацев.

Тестовая модель: **DeepSeek-4.1** (`deepseek-v4.1-flash:free`), 6 промптов в тестовом аккаунте B (список чатов в конце).

### Главные находки (с цифрами)
| # | Находка | Доказательство | Приоритет |
|---|---|---|---|
| 1 | Короткий вопрос получает 400+ слов: на «Привет! Ответь одним коротким предложением.» и на «Скажи «ок».» пришло по 5 абзацев. В рассуждениях модели есть ссылка на «правило канала: всегда развёрнуто, не менее 400 слов». | **Измерено** (ответы) + **Предположение** (причина — скрытая серверная инструкция; код `/api/chat` я не видел) | P0 |
| 2 | Заголовки `#`–`####` в ответе выглядят как обычный текст: 16 px, вес 400. В `styles-*.css` нет правил `.prose-y h1..h6`, а preflight Tailwind ставит `font-size:inherit; font-weight:inherit`. | **Измерено** (16px/25.6px у `h1,h2,h3`) + **По коду** | P0 |
| 3 | Колонка текста ассистента — 306 из 390 px (78%): слева аватар 40 px + gap 12 px. На 360 px — 276 из 360 (77%). | **Измерено** | P0 |
| 4 | Нижняя панель (строка модели + поле + 4 иконки + «Отправить») занимает **181 px** (21% экрана 844). С клавиатурой (viewport 481 px) на сообщения остаётся **237 px = 49%**; на 360×780 с клавиатурой — 200 из 444 px = 45%. | **Измерено** | P0 |
| 5 | Автоследование за стримом теряется. В двух длинных чатах `scrollTop` стоял на 9860 / 8565, пока `scrollHeight` рос с 10.4k до 16.6k и с 22k до 31k. В чистом новом чате следование сработало (макс. отставание 122 px, в конце 0). Флаг «прилип к низу» ставится в `onScroll` по расстоянию < 80 px — быстрый рост контента может сбросить его гонкой. | **Измерено** (оба факта) + **Предположение** (причина — гонка, не доказана) | P0 |
| 6 | Если отправить сообщение, пока список прокручен вверх, список вниз не едет: после отправки `scrollTop` 966 при `scrollHeight` 3429. | **Измерено** | P0 |
| 7 | Таблица шире окна в 1.8 раза (542 px в окне 304 px), блок кода — в 4 раза (1215 px в окне 304 px); подсказки о скролле нет, «Перенос» по умолчанию выключен. | **Измерено** | P1 |
| 8 | Тап-цели меньше 44 px: кнопки действий под сообщениями 32×32, «Ход мысли» 88×32, кнопки в шапке блока кода 32 px, панель инструментов 38–40 px, чип модели 156×36, переключатель рассуждений 36×36, бейдж обновления 20×20, элемент «Язык» 67×20. | **Измерено** | P1 |
| 9 | Шапка на 360 px: кнопки наезжают на логотип «V» (виден обрезанный треугольник). | **Измерено** (скриншот `before-04…`) | P1 |
| 10 | Выбор модели — выпадающий список 160×226 px со строками по 36 px, без описаний. | **Измерено** | P1 |
| 11 | Под каждым сообщением пользователя постоянно висит строка «время + 3 иконки», под каждым ответом — ещё одна. Удаление через `window.confirm()` (системный диалог в WebView смотрится чужеродно). | **Измерено** + **По коду** | P1 |
| 12 | Сдвиги вёрстки: CLS 0.12–0.14 за сессию из 3 ответов на мобильном (одиночные до 0.09); на десктопе 0.31 (одиночный 0.21). Причину не локализовал. | **Измерено**; причина **Не проверено** | P2 |
| 13 | У шрифта нет кириллицы: computed `font-family` = `Outfit, ui-sans-serif, system-ui…`, Outfit кириллицу не покрывает, русский текст набирается системным шрифтом (на разных телефонах по-разному). В прошлом аудите (`audit/CURSOR-PATCH-RU.md`) это уже предлагали. | **Измерено** (computed style) | P2 |
| 14 | Контраст `--faint` на светлой теме: `#7d7870` на `#f4f2ee` = 3.92:1 (< 4.5 для мелкого текста). Тёмная тема в норме: `#8a877f` на `#0c0c0e` = 5.45:1. | **Измерено** (расчёт) | P2 |
| 15 | Пустое состояние: 12 карточек подсказок по 82–98 px — более 1000 px прокрутки вместо 3–4 чипов. | **Измерено** | P2 |

### Что уже хорошо (не ломать)
- Текст 16 px / межстрочный 1.6 (25.6 px) — комфортно; в поле ввода тоже 16 px (iOS не зумит).
- Нижняя панель использует `padding-bottom: max(.75rem, env(safe-area-inset-bottom))`; корень на `100dvh` (`.h-dvh`, `min-h-dvh`). Горизонтального переполнения страницы нет (`scrollWidth = 390`).
- Появление сообщения: `opacity 0→1`, `y 8→0`, 0.28 с, с учётом `prefers-reduced-motion`.
- Рассуждения модели показываются вживую в раскрывающемся блоке «Ход мысли», есть индикатор «Думаю…/Соединяю…».
- Обрыв сети и перезагрузка страницы во время ответа: клиент ждёт дописывания на сервере («Ответ допишется сам. Экран можно выключить.»).
- Ошибок в консоли от самого сайта нет (только CSP-ошибка расширения `grok.com`; на десктопе один `403` на неизвестный ресурс — **Не проверено**, что это).

### Файлы в этой папке
Скриншоты «до»: `before-01-mobile390-table-code.jpg`, `before-02-mobile390-scrolled-up.jpg`, `before-03-mobile390-keyboard.jpg`, `before-04-mobile360-keyboard-header-overlap.jpg`, `before-05-mobile390-empty.jpg`, `before-06-mobile390-streaming-reasoning.jpg`, `before-07-desktop1440.jpg`. Макет карточки вопроса: `mockup-question.png`.

---

## 2. Архитектура чата (что реально есть в коде)

Все имена минифицированы, поэтому — **строки для поиска**.

| Что | Файл бандла | Чем искать в исходниках |
|---|---|---|
| Страница чата, отправка `xt(text, opts)`, сбор запроса к `/api/chat`, поле `track`, лимиты | `routes-*.js` | `Ответ ещё пишется в другом диалоге`, `mode:"stop"`, `Модель ничего не ответила`, `Без аккаунта можно задать только 3 вопроса` |
| Разбор SSE `Xa()`/`Za()` | `routes-*.js` | `event:` + `onDelta`, `onReason`, `onSources` |
| История → запрос `go()` (последние 32 сообщения, до 24 000 символов на сообщение) | `routes-*.js` | `slice(-32)`, `reasoning.slice(0,6e3)` |
| Список сообщений `Bk` (скролл, «К последнему», `window.confirm` на удаление) | `transcript-*.js` | `К последнему`, `Удалить этот ответ?` |
| Сообщение пользователя `Vk`, ассистента `Hk` (аватар 40 px, «Ход мысли», источники, действия) | `transcript-*.js` | `Ход мысли`, `Ответ дописывается сам`, `Остановлено` |
| Markdown `Ok` → `kk` → `react-markdown` + `remark-gfm` + свой плагин формул `@@MATH` | `transcript-*.js` | `prose-y`, `remarkPlugins`, `@@MATH` |
| Живой стрим: перерисовка текста раз в 80 мс | `transcript-*.js` | `setInterval(...,80)` рядом с `prose-y` |
| Блок кода `Sk` (номера строк, «Перенос», «Копировать», превью HTML в iframe `sandbox`) | `transcript-*.js` | `code-frame`, `Просмотр HTML` |
| Таблица: обёртка `overflow-x-auto` в карте компонентов `Ck` | `transcript-*.js` | `my-3 overflow-x-auto rounded-xl` |
| **Прецедент №1:** язык ```` ```calc ```` превращается в карточку `jk` внутри `Ck.code` | `transcript-*.js` | `i===\`calc\``, `calc-card` |
| **Прецедент №2:** теги `<Sequence>/<Step>` парсятся `dk()` в карточки шагов `Ak` | `transcript-*.js` | `step-list`, `step-card` |
| **Прецедент №3:** подсказка модели собирается на клиенте `m({clock,calc,brief,translate}, text)` и уходит в запрос полем `toolNote` | `model-face-*.js`; вызов `toolNote:xe(...)` в `routes-*.js` | `Точный счёт пиши отдельным блоком`, `toolNote` |
| Настройки → плагины (calc/clock/brief/translate) | `routes-*.js` | `onPlugin`, `Тема, фон, поиск и плагины` |
| Стили | `styles-*.css` (Tailwind v4 + свой слой) | `.prose-y`, `.code-frame`, `.step-card`, `.caret:after` |

### Транспорт (измерено на живом запросе)
`POST /api/chat`, ответ `text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`. Наблюдавшиеся события:
```
event: reason   data: {"text":"…"}      // рассуждения
event: delta    data: {"text":"…"}      // текст ответа (в одном ответе 34 дельты по ~40–110 символов)
event: done     data: {}
```
В коде клиента (`Za`) обрабатываются ещё: `usage`, `limit {remainingPct}`, `meta {truncated}`, `error {message}`, `image {url}`, `sources [...]`. События про вызов инструментов **нет** — поэтому основной путь для интерактивных вопросов ниже сделан через текстовый блок, а нативные tool calls вынесены в отдельный опциональный пункт «нужна проверка сервера».

Тело запроса (ключи): `kind, baseUrl, apiKey, extraHeaders, chatPath, model, imageModel, systemPrompt, toolNote, temperature, maxTokens, mode, webSearch, searchEngine, reasoning, track{chatId,messageId}, messages[{role,content,reasoning?}]`.
Модель сообщения на клиенте: `{id, role, content, createdAt, model, modelLabel, providerName, reasoning, usage, error, stopped, truncated, imageUrl, sources, files, image, web, calc, clock, brief, translate}`. Хранится в IndexedDB и, для залогиненного, отправляется на сервер через `/_serverFn/917fe18e…` (сохранение чата). Остановка: `POST /api/chat {mode:"stop", chatId}`.

---

## 3. Исправления чата на телефоне

Порядок: P0 (ломает впечатление) → P1 (заметно) → P2 (полировка).

### P0-1. Длина ответа соразмерна вопросу
**Что не так.** «2+2?» → 5 абзацев про «правила канала»; «Скажи «ок».» → 5 абзацев. Рассуждения модели ссылаются на инструкцию «всегда развёрнуто, не менее 400 слов, кроме технических команд». В клиентском `systemPrompt` такого правила нет, значит, оно добавляется на сервере (**Предположение**). В бандле уже есть неиспользуемый короткий промпт `ao`: «Длина соразмерна вопросу: коротко, если вопрос короткий; развёрнуто — только когда просят объяснить, сравнить, написать код…».

**Как чинить.**
1. В обработчике `/api/chat` найти место, где к системному промпту добавляется требование длины: `rg -n "400|развёрнут|verbos|overbos" server/ src/ app/ api/`. **[проверить]** Напиши, где оно и зачем. Если это сделано намеренно (например, ради «глубины» ответов) — не удалять, а сделать настройкой.
2. Заменить на правило из `ao`:
```
Длина соразмерна вопросу: коротко, если вопрос короткий; развёрнуто — только когда просят объяснить, сравнить, написать код, таблицу или план. Без вступлений, повторов и лишних списков.
```
3. Опционально: тумблер «Кратко / Подробно» в Настройках рядом с плагином `brief` (он уже есть: «Отвечай коротко: два–четыре предложения»).

**Приёмка.** «2+2?» → одна строка. «Скажи «ок».» → «Ок.». «Объясни event loop» → развёрнутый ответ.

### P0-2. Иерархия заголовков в ответе
**Что не так.** У `.prose-y h1…h6` нет стилей; computed — 16 px / 400.
**Файл:** `styles-*.css`, рядом с `.prose-y p, .prose-y ul…`.
```css
/* заголовки в ответе модели */
.prose-y h1,.prose-y h2,.prose-y h3,.prose-y h4{
  font-weight:600; letter-spacing:-.01em; line-height:1.3;
  margin:1.4rem 0 .5rem; text-wrap:balance; color:var(--fg);
}
.prose-y h1{font-size:1.375rem}
.prose-y h2{font-size:1.1875rem}
.prose-y h3{font-size:1.0625rem}
.prose-y h4{font-size:1rem;color:var(--muted)}
.prose-y>h1:first-child,.prose-y>h2:first-child,.prose-y>h3:first-child{margin-top:0}
.prose-y hr{border:0;border-top:1px solid var(--line);margin:1.25rem 0}
.prose-y strong{font-weight:600}
.prose-y li>p{margin:0}
.prose-y ul{list-style:disc} .prose-y ol{list-style:decimal}
.prose-y li::marker{color:var(--faint)}
```
**Приёмка.** Ответ с `#`, `##`, `###` показывает три разных размера, на 360 px ничего не вылезает; `h1` не больше 22 px.

### P0-3. Колонка ассистента на всю ширину
**Что не так.** `Hk` рисует `flex gap-3` → аватар 40 px + зазор 12 px. Текст начинается с x=68, ширина 306 px.
**Как чинить.** На экранах < 768 px аватар уменьшить до 24 px и поставить в строку мета-данных (имя · модель · время), а текст пустить на всю ширину:
```tsx
// Hk: было <div className="flex gap-3"> <Face size={40}/> <div className="min-w-0 flex-1">…</div></div>
<div className="flex flex-col gap-1.5 md:flex-row md:gap-3">
  <div className="flex items-center gap-2 md:block">
    <Face name={…} mood={…} size={isMobile ? 24 : 40} variant={face} />
    <div className="flex min-w-0 items-center gap-2 text-xs text-faint md:hidden">
      <span>{message.providerName || 'vvvion.space'}</span>
      {label ? <span className="max-w-[10rem] truncate">{label}</span> : null}
      <span className="tabular-nums">{time}</span>
    </div>
  </div>
  <div className="min-w-0 flex-1">
    {/* на md+ мета-строка остаётся над текстом как сейчас */}
    …контент…
  </div>
</div>
```
`isMobile` — через `matchMedia('(max-width: 767px)')` (в коде страницы уже есть такой слушатель; вынести в хук `useIsMobile`).
**Приёмка.** На 390 px ширина `.prose-y` = 358 px (было 306), на 360 px = 328 (было 276). Таблицы и код тоже шире. На десктопе ничего не изменилось.

### P0-4. Нижняя панель: одна строка, клавиатура не съедает экран
**Что не так.** 181 px постоянно: строка «аватар + модель + рассуждения + пинг» (~36 px) + поле 44 px + строка из 4 иконок и кнопки (~44 px) + отступы. С клавиатурой на сообщения остаётся 49% (390) / 45% (360).
**Цель** — как в ChatGPT/Claude: одна строка и «+» для всего остального.
```
┌──────────────────────────────────────────────┐
│ [+]  Напишите сообщение…              [🎤|➤] │  ← 1 строка, 52 px, растёт до 6 строк
└──────────────────────────────────────────────┘
 чипы режимов (если включены):  [🌐 Сеть ✕] [🖼 Картинка ✕]
```
- Кнопка «+» открывает bottom sheet: «Файл», «Картинка», «Поиск в сети», «Ход мысли», «Модель: DeepSeek-4.1 ›». Все пункты ≥ 52 px высотой.
- Чип модели переезжает в шапку чата (тап → sheet выбора модели, см. P1-4).
- «Отправить» превращается в круглую кнопку-стрелку 44×44 внутри поля (вместо 118×44 с подписью); при пустом поле на её месте микрофон.
- Пинг («28 ms») убрать с мобильной панели — в шапку/настройки.
- **Быстрый минимум** без перестройки (если время поджимает) — CSS: при открытой клавиатуре прятать модельную строку и ряд инструментов:
```css
@media (pointer:coarse) and (max-height:560px){
  [data-composer-model-row], [data-composer-tools-row]{display:none}
}
#composer{max-height:min(200px,30dvh)}
```
(Повесить `data-*` на соответствующие контейнеры; кнопку «Отправить» вынести из ряда инструментов, иначе она исчезнет вместе с ним.) При `windowSoftInputMode=adjustResize` высота окна уменьшается, поэтому медиазапрос по `max-height` сработает. **Не проверено на реальном IME** — клавиатуру я моделировал уменьшением viewport.
**Приёмка.** 390×844 без клавиатуры: панель ≤ 76 px (поле в одну строку). С клавиатурой (viewport 481): область сообщений ≥ 65% высоты. Safe-area сохранён (`env(safe-area-inset-bottom)`).

### P0-5. Автоследование за стримом без гонок
**Что не так.** `Bk` хранит флаг `f.current` («прилипли к низу») и обновляет его в `onScroll` по расстоянию до низа < 80 px. Если контент вырос больше чем на 80 px раньше, чем пришло scroll-событие, флаг сбрасывается, стрим «уезжает» и появляется «К последнему». Это согласуется с замерами в двух длинных чатах (**Предположение** — точную причину не доказывал).
**Как чинить.** Флаг менять только от жестов пользователя, а рост контента ловить `ResizeObserver`:
```tsx
function useStickToBottom(scrollerRef: RefObject<HTMLElement>, contentRef: RefObject<HTMLElement>) {
  const stick = useRef(true);
  const userActive = useRef(false);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current, content = contentRef.current;
    if (!el || !content) return;
    let timer = 0;
    const down = () => { userActive.current = true; window.clearTimeout(timer); };
    const up = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { userActive.current = false; }, 700); }; // инерция после отпускания
    const onScroll = () => {
      if (!userActive.current) return;                 // игнорируем программные скроллы и рост контента
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stick.current = dist < 24;
      setShowJump(!stick.current);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('wheel', down, { passive: true });
    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('keydown', down);
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', up, { passive: true });
    el.addEventListener('wheel', up, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(content);
    return () => { ro.disconnect(); window.clearTimeout(timer); /* removeEventListener для всех */ };
  }, []);

  const jump = (smooth = true) => {
    const el = scrollerRef.current; if (!el) return;
    stick.current = true; setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
  };
  return { jump, showJump, forceStick: () => { stick.current = true; setShowJump(false); } };
}
```
Подключить в `Bk`: `ref` на внутренний контейнер `mx-auto flex w-full max-w-3xl…`, вместо `useEffect(...,[e])` и функции `b()`. `scroll-behavior: smooth` на самом скролл-контейнере не ставить (стрим будет «плавать»).
**Отдельно: при отправке всегда прыгать вниз.** В `xt` после `J(D)` (добавили сообщение и пустой ответ) вызвать `forceStick()` + `jump(false)`. Сейчас, если список прокручен вверх, отправка оставляет его на месте (измерено: `scrollTop` 966 при `scrollHeight` 3429).
**Приёмка.** Автотест Playwright (мок SSE по 10 дельт в 50 мс): отставание от низа ≤ 24 px весь стрим; ручной скролл вверх во время стрима оставляет список на месте и показывает «К последнему»; тап на «К последнему» возвращает вниз и снова включает следование; отправка из прокрученного состояния прокручивает вниз.

### P1-1. Таблицы и код: видно, что есть прокрутка
**Что не так.** Таблица 542 px в окне 304 px, код 1215 px в окне 304 px — край просто обрезан. «Перенос» по умолчанию выключен.
```css
/* обёртка таблицы и блока кода: тени-подсказки по краям */
.scroll-x{
  overflow-x:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain;
  background:
    linear-gradient(to right,var(--bg) 30%,transparent) left/28px 100% no-repeat local,
    linear-gradient(to left, var(--bg) 30%,transparent) right/28px 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%,rgb(0 0 0/.5),transparent) left/12px 100% no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%,rgb(0 0 0/.5),transparent) right/12px 100% no-repeat scroll;
}
.prose-y th,.prose-y td{min-width:7rem}
@media (max-width:640px){ .prose-y th,.prose-y td{font-size:.8125rem;padding:.4rem .55rem} }
```
- В карте `Ck` у `table`: добавить `scroll-x` в `className` обёртки (`my-3 overflow-x-auto rounded-xl border border-line`), сама таблица `w-max min-w-full`.
- В `Sk` (блок кода): начальное значение «Перенос» = `matchMedia('(max-width: 640px)').matches` (номера строк при переносе уже скрываются); кнопки в шапке блока — высота 40 px (см. P1-3).
**Приёмка.** На 390 px у широкой таблицы виден градиент справа; после прокрутки — слева. Код на телефоне переносится по умолчанию; переключатель «В строку» работает.

### P1-2. Действия под сообщениями
**Что не так.** Под каждым сообщением пользователя — «время + копировать + изменить + удалить» (32×32), под каждым ответом — «копировать + заново + удалить». На длинной переписке это шум и мелкие цели.
**Как чинить (как у флагманов).**
- Сообщение пользователя: действия скрыты; длинный тап (500 мс) или тап по пузырю открывает bottom sheet «Копировать / Изменить / Удалить». Время — мелким серым при тапе.
- Ответ ассистента: полная строка действий только у **последнего** ответа; у остальных — только «⋯» (sheet).
- Кнопки в строке 40×40 (иконка 20 px визуально), между ними 4 px.
- Удаление — без `window.confirm`: убрать сообщение сразу и показать snackbar «Удалено · Отменить» на 5 с (в коде сейчас `window.confirm("Удалить этот ответ?")` и `window.confirm("Удалить это сообщение? Ответ на него тоже исчезнет.")`).
- Копирование — иконка меняется на галочку на 1.2 с (у блока кода это уже есть — переиспользовать).
**Приёмка.** На экране с 6 сообщениями видна одна полная строка действий; удаление отменяется; в чате нет вызовов `window.confirm`.

### P1-3. Размеры тап-целей
Правило: визуальный размер можно оставить, но зона нажатия ≥ 44×44.
```css
.hit{position:relative}
.hit::after{content:"";position:absolute;inset:-6px}   /* 32 → 44 */
@media (pointer:coarse){
  .press{min-height:44px;min-width:44px}
  .code-frame .press{min-height:40px}
}
```
Применить к: кнопки действий под сообщениями (32), «Ход мысли» (88×32), кнопки шапки кода (32), панель инструментов (38–40), переключатель рассуждений (36), чип модели (высота 36), бейдж непрочитанного (20×20), строка «Язык» (67×20 есть в DOM на мобильном — **[проверить]**, что это за элемент: на скриншоте он не виден).
**Приёмка.** Скрипт из раздела тестов не находит видимых интерактивных элементов с зоной нажатия < 44 px в чате на 390 и 360.

### P1-4. Выбор модели — нормальный bottom sheet
**Что не так.** Выпадающий listbox 160×226 px, 6 строк по 36 px, поверх текста, без описаний.
**Как чинить.** < 768 px: sheet на всю ширину (`rounded-t-3xl bg-elev`, `pb-[max(.75rem,env(safe-area-inset-bottom))]`), строки 56 px: иконка модели, название, подпись (быстрая / умная / бесплатная / с картинками — из конфигурации модели; если поля нет — добавить опциональное `hint`), галочка у текущей, `role="listbox"` + `aria-selected`, закрытие свайпом вниз / тапом по подложке / Esc. На десктопе оставить как есть.
**Приёмка.** Все строки ≥ 52 px; выбранная модель отмечена; sheet закрывается свайпом.

### P1-5. Шапка на 360 px
**Что не так.** На 360 px кнопки «+» и «поделиться» наезжают на логотип «V» (виден обрезанный треугольник); на 390 px вместо названия чата — «Нов…».
**Как чинить.** < 400 px: скрыть вордмарк `V` (или оставить иконку 24 px без текста), название чата `min-w-0 truncate` в `flex-1`, кнопки `shrink-0`. Блок «Язык» (флаг + «РУ» + стрелка) на мобильном перенести в Настройки.
**Приёмка.** На 320, 360, 390 px ничего не перекрывается; название чата усекается с «…» и не вытесняет кнопки.

### P1-6. Один стрим на весь аккаунт
**По коду.** Строка `Ответ ещё пишется в другом диалоге`: пока идёт ответ, в другом чате отправить нельзя.
**Как чинить.** Либо разрешить параллельные ответы (у каждого чата свой `AbortController`), либо вместо тоста показывать понятную плашку «Идёт ответ в чате «…» · Перейти · Остановить». Прямым тестом не проверял.

### P1-7. Кириллический шрифт
**Измерено:** computed `font-family: Outfit, ui-sans-serif, system-ui…`; кириллицу Outfit не покрывает.
```css
@theme{
  --font-sans:"Outfit","Onest",ui-sans-serif,system-ui,sans-serif;
}
```
Подключить `Onest` (400/500/600, subset cyrillic+latin) — через тот же Google Fonts (CSP уже разрешает `fonts.googleapis.com` и `fonts.gstatic.com`) или самохостом в `/fonts` + `font-display:swap`. Для тела ответа можно использовать только `Onest`, а `Outfit` оставить для заголовков/UI.
**Приёмка.** На Android и в Chrome русский текст рисуется одним и тем же шрифтом.

### P2-1. Сдвиги вёрстки (CLS 0.12–0.14 на мобильном)
**[проверить]** Запусти в чате:
```js
new PerformanceObserver(l=>l.getEntries().forEach(e=>e.sources?.forEach(s=>console.log(e.value.toFixed(3), s.node)))).observe({type:'layout-shift',buffered:true})
```
Подозреваемые (**Предположение**): раскрытие/сворачивание блока «Ход мысли», подсветка кода после первой отрисовки, KaTeX, подмена шрифта. Цель: CLS за сессию ≤ 0.05.

### P2-2. Производительность стрима
**По коду.** Во время стрима весь текст ответа заново разбирается `react-markdown` каждые 80 мс (`kk` мемоизирован по полному тексту, поэтому любое изменение пересобирает весь документ, плюс highlight.js для блоков кода). На ответах в 16 000 px затраты растут квадратично.
**Как чинить.** Резать текст на верхнеуровневые блоки (разделитель — пустая строка вне ``` и вне таблицы), завершённые блоки рендерить `memo` по строке, перерисовывать только последний. Визуал не менять. **Не измерял в профайлере** — перед работой сними Performance-профиль на реальном телефоне.

### P2-3. Пустое состояние
12 карточек подсказок по 82–98 px заменить 3–4 чипами в горизонтальной прокрутке (класс `snap-row` уже есть) или карточками 2×2. Хорошее место для примера с уточняющим вопросом (раздел 4).

### P2-4. Светлая тема: контраст
`html.light{ --faint:#6b665f }` (≥ 4.6:1 на `#f4f2ee`) — для времени, подписей, «Остановлено».

### P2-5. Тактильность и анимации
- `navigator.vibrate?.(8)` на выбор варианта и отправку (`pointer:coarse`), не вызывать при `prefers-reduced-motion`. **Не проверено**, что `vibrate` работает в WebView приложения; запасной путь — JS-мост `Android.haptic()` → `performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)`.
- Нажатие: `scale(.98)` 120 мс у карточек вопросов и подсказок (класс `.press` уже есть — `transition: scale .15s`).
- Появление карточки вопроса — тот же `opacity/y`, что у сообщений.

### Не из UX, но увидел
В теле `/api/chat` клиент передаёт `baseUrl`, `apiKey`, `chatPath`, `extraHeaders`. Для `kind:"builtin"` сервер обязан игнорировать эти поля (иначе клиент может направить запрос на произвольный адрес). Кода сервера я не видел — **[проверить]**.

---

## 4. Интерактивные вопросы (как в ChatGPT)

### 4.1. Что строим
Когда модели не хватает данных, она вместо текстового «а какой вариант вам нужен?» выдаёт **карточку-вопрос**: заголовок, 2–6 вариантов-кнопок, «Свой вариант», при необходимости несколько шагов. Пользователь тапает вариант (или пишет свой) — ответ уходит **обычным сообщением пользователя** тем же каналом `/api/chat`, и модель продолжает. После ответа карточка остаётся в истории в «отвеченном» виде и в режиме «только чтение» в шаринге `/s/:id`.

### 4.2. Почему именно так (под реальную архитектуру)
1. Сообщение — это строка `content` в Markdown. Уже есть два прецедента «особого блока в тексте»: ```` ```calc ```` (`Ck.code → jk`) и `<Sequence>/<Step>` (`dk → Ak`). Блок ```` ```vvvion-question ```` — третий такой же.
2. Транспорт — SSE с `delta/reason/…`; серверных tool-событий я не видел (серверный код недоступен — **Не проверено**). Значит, **основной путь — текстовый блок**: он работает с любой моделью, включая бесплатные без tool calling, и не требует менять протокол.
3. Подсказка для модели собирается на клиенте функцией `m()` (`model-face-*.js`) и уходит как `toolNote`. Добавляем флаг `ask` рядом с `calc/clock/brief/translate` — со своим тумблером в Настройках → плагины.
4. Ответ пользователя — обычное сообщение: его уже умеют сохранять (IndexedDB + serverFn), показывать в шаринге, редактировать и перегенерировать.
5. `go()` (история → запрос) передаёт модели только `role/content/reasoning`, поэтому лишние поля вроде `answerTo` на модель не повлияют.

### 4.3. Формат блока
Модель пишет короткую фразу и **один** блок, затем останавливается и ждёт ответа:

````text
Чтобы подобрать стек, уточню пару деталей.

```vvvion-question
{
  "v": 1,
  "steps": [
    {
      "id": "kind",
      "title": "Что вы делаете?",
      "subtitle": "Выберите один вариант или напишите свой",
      "type": "single",
      "options": [
        { "id": "web",  "label": "Веб-сайт", "hint": "лендинг, блог, магазин" },
        { "id": "app",  "label": "Мобильное приложение" },
        { "id": "api",  "label": "Бэкенд / API" }
      ],
      "allowCustom": true,
      "customPlaceholder": "Свой вариант…"
    },
    {
      "id": "priority",
      "title": "Что важно?",
      "subtitle": "Можно выбрать несколько",
      "type": "multi",
      "min": 1,
      "max": 3,
      "options": [
        { "id": "fast",    "label": "Быстрый запуск" },
        { "id": "cheap",   "label": "Низкая стоимость хостинга" },
        { "id": "offline", "label": "Работает офлайн" }
      ]
    }
  ]
}
```
````

`type`: `single` (один вариант), `multi` (несколько), `text` (только свободный ответ).

### 4.4. Типы (TypeScript)
Файл: `src/features/chat/question/types.ts` (путь условный — положи рядом с типом сообщения чата).

```ts
export const Q_LANG = 'vvvion-question' as const;

export type QOption = { id: string; label: string; hint?: string };

export type QStep = {
  id: string;
  title: string;
  subtitle?: string;
  type: 'single' | 'multi' | 'text';
  options?: QOption[];          // нет у type:'text'
  allowCustom?: boolean;        // кнопка «Свой вариант»
  customPlaceholder?: string;
  min?: number;                 // для multi, по умолчанию 1
  max?: number;                 // для multi
  optional?: boolean;           // шаг можно пропустить
};

export type QBlock = { v: 1; steps: QStep[] };

export type QStepAnswer = {
  stepId: string;
  picked: string[];             // id вариантов
  labels: string[];             // подписи вариантов на момент ответа (для истории)
  custom?: string;              // свой текст
  skipped?: boolean;
};

export type QAnswer = { qid: string; steps: QStepAnswer[]; skippedAll?: boolean };

// расширение сообщения пользователя (хранится в IndexedDB и в чате на сервере)
export type UserMessageExtra = {
  answerTo?: { messageId: string; qid: string };
  answers?: QAnswer;
};
```

### 4.5. Парсер и санитайзер (недоверенный JSON)
Файл: `src/features/chat/question/parse.ts`.

```ts
import { Q_LANG, type QAnswer, type QBlock, type QStep, type QOption } from './types';

export const LIMITS = {
  steps: 4, options: 8, label: 60, hint: 100, title: 140, subtitle: 140,
  custom: 300, json: 6000, answerText: 1000,
} as const;

const ID_RE = /^[a-z0-9_-]{1,32}$/i;
const clip = (s: unknown, n: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '';

export function parseQuestionBlock(raw: string): QBlock | null {
  if (raw.length > LIMITS.json) return null;
  let j: any;
  try { j = JSON.parse(raw); }
  catch { try { j = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch { return null; } } // запятая перед скобкой
  if (!j || j.v !== 1 || !Array.isArray(j.steps) || j.steps.length === 0) return null;

  const seen = new Set<string>();
  const steps: QStep[] = [];
  for (const s of j.steps.slice(0, LIMITS.steps)) {
    const id = ID_RE.test(s?.id) && !seen.has(s.id) ? s.id : `s${steps.length + 1}`;
    seen.add(id);
    const type = s?.type === 'multi' || s?.type === 'text' ? s.type : 'single';
    const title = clip(s?.title, LIMITS.title);
    if (!title) return null;
    let options: QOption[] | undefined;
    if (type !== 'text') {
      const oids = new Set<string>();
      options = (Array.isArray(s.options) ? s.options : []).slice(0, LIMITS.options).flatMap((o: any, i: number) => {
        const label = clip(o?.label, LIMITS.label);
        if (!label) return [];
        const oid = ID_RE.test(o?.id) && !oids.has(o.id) ? o.id : `o${i + 1}`;
        oids.add(oid);
        return [{ id: oid, label, hint: clip(o?.hint, LIMITS.hint) || undefined }];
      });
      if (options.length < 2) return null;                 // вопрос с одним вариантом бессмыслен
    }
    const max = type === 'multi' ? Math.min(Math.max(Number(s.max) || options!.length, 1), options!.length) : undefined;
    const min = type === 'multi' ? Math.min(Math.max(Number(s.min) || 1, 0), max!) : undefined;
    steps.push({
      id, title, subtitle: clip(s?.subtitle, LIMITS.subtitle) || undefined, type, options,
      allowCustom: type === 'text' ? true : !!s?.allowCustom,
      customPlaceholder: clip(s?.customPlaceholder, 60) || 'Свой вариант…',
      min, max, optional: !!s?.optional,
    });
  }
  return { v: 1, steps };
}

/** Стабильный id блока: короткий хэш от нормализованного JSON. */
export function questionId(block: QBlock): string {
  const s = JSON.stringify(block);
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Текст, который уходит модели как обычное сообщение пользователя. */
export function formatAnswerText(block: QBlock, a: QAnswer): string {
  if (a.skippedAll) return 'Пропускаю вопрос — выбери разумные значения сам и продолжай.';
  const one = block.steps.length === 1 && a.steps[0]?.labels.length === 1 && !a.steps[0].custom;
  if (one) return a.steps[0].labels[0].slice(0, LIMITS.answerText);   // один вопрос, один вариант — просто сам вариант
  return a.steps.map((st, i) => {
    const step = block.steps[i];
    if (st.skipped) return `• ${step.title} — пропущено`;
    const parts = [...st.labels, ...(st.custom ? [`своё: «${st.custom}»`] : [])];
    return `• ${step.title} — ${parts.join('; ')}`;
  }).join('\n').slice(0, LIMITS.answerText);
}

export { Q_LANG };
```

Все строки рендерятся **как текст** React-ом (без `dangerouslySetInnerHTML`, без Markdown, без ссылок). Угловые скобки вычищаются на всякий случай.

### 4.6. Подсказка модели (плагин `ask`)
Файл: исходник функции `m(e, t)` из `model-face-*.js`, которая собирает `toolNote`. Добавить флаг `ask` рядом с `brief` и `translate`:

```ts
if (flags.ask) notes.push(ASK_NOTE);

const ASK_NOTE = `Иногда для хорошего ответа не хватает важной детали, которую нельзя разумно предположить. Тогда вместо длинных догадок задай уточняющий вопрос карточкой. Правила:
1) Задавай вопрос только если без ответа результат заметно ухудшится. На простые и однозначные запросы отвечай сразу.
2) Не больше одной карточки за ответ, не больше 3 шагов, 2–6 коротких вариантов в шаге. Не спрашивай то, что пользователь уже сообщил.
3) Карточка — это блок кода с языком vvvion-question и корректным JSON (без комментариев и без Markdown внутри строк):
\`\`\`vvvion-question
{"v":1,"steps":[{"id":"kind","title":"Короткий вопрос?","type":"single","options":[{"id":"a","label":"Вариант А"},{"id":"b","label":"Вариант Б","hint":"подпись"}],"allowCustom":true}]}
\`\`\`
type: "single" — один вариант, "multi" — несколько (добавь min/max), "text" — только свободный ответ. id — латиница, строчные, до 32 символов.
4) Перед карточкой — одна короткая фраза (до 15 слов). После карточки НИЧЕГО не пиши и остановись: жди ответа.
5) Ответ придёт обычным сообщением пользователя, например «Мобильное приложение» или список «• вопрос — ответ». Продолжай с учётом ответа и не задавай тот же вопрос снова. Если пользователь пишет «Пропускаю вопрос», выбери разумные значения сам и сразу дай результат.`;
```

Подключение флага:
- `routes-*.js`, вызов `toolNote: xe({calc,clock,brief,translate}, n)` → добавить `ask`.
- Настройки → плагины (`onPlugin`, список `calc/clock/brief/translate`) → новый тумблер «Уточняющие вопросы» (по умолчанию **включён**, хранение — там же, где остальные плагины).
- **[проверить]** Принимает ли серверная часть `/api/chat` поле `toolNote` для `kind:"builtin"` (в запросе поле есть, что с ним делает сервер — я не видел). Если игнорирует — добавить подсказку на сервере в том же месте, где собирается системный промпт, по флагу `ask` из тела запроса.
- **Конфликт с P0-1:** если сервер навязывает «всегда 400+ слов», модель не станет ограничиваться фразой и карточкой. Сначала P0-1.
- Модели в рассуждающем режиме иногда ломают JSON; тогда парсер отдаёт блок как обычный код (ничего не теряется).

### 4.7. Рендер: ветка в `Ck.code`
`transcript-*.js` → `Ck(e,t)` → `code({className, children})`. Сейчас порядок: `calc` → HTML-превью → ASCII-арт → обычный код. Добавить ветку **до** `calc`:
```tsx
if (lang === Q_LANG) return <QuestionBlock raw={codeText} live={live} />;
```
```tsx
// QuestionBlock.tsx — решает, что показать
function QuestionBlock({ raw, live }: { raw: string; live: boolean }) {
  const ctx = useContext(QuestionCtx);            // messageId, answers, canAnswer, onAnswer
  const block = useMemo(() => parseQuestionBlock(raw), [raw]);
  if (!block) {
    // стрим ещё идёт: JSON не дописан — заготовка, а не «сырой» JSON
    if (live) return <QuestionSkeleton />;
    // стрим закончился, а JSON битый — показываем как обычный код (ничего не теряем)
    return <CodeFrame code={raw} lang="json" />;
  }
  const qid = questionId(block);
  const answered = ctx?.answers.get(`${ctx.messageId}:${qid}`);
  return (
    <QuestionCard
      block={block} qid={qid} live={live}
      answered={answered}
      canAnswer={!!ctx?.canAnswer && !answered}
      onSubmit={(a) => ctx!.onAnswer(ctx!.messageId, qid, a, formatAnswerText(block, a))}
    />
  );
}
```
Если в одном ответе несколько блоков `vvvion-question`, интерактивной делать только **первый** (счётчик в контексте), остальные — как обычный код.

Состояния карточки:
| Состояние | Условие | Вид |
|---|---|---|
| `skeleton` | блок ещё стримится (`live`), JSON не дописан | серая заготовка «Готовлю вопрос…», без мерцания при `prefers-reduced-motion` |
| `waiting` | JSON готов, но стрим ещё идёт (модель дописывает хвост) | карточка видна, кнопки неактивны, подпись «дописываю ответ…» |
| `idle` | JSON готов, ответа нет, это последнее сообщение, стрим завершён | варианты активны |
| `answered` | следующим сообщением пользователя есть `answerTo` на этот `messageId:qid` | компактная сводка: вопрос + выбранные чипы, без кнопок |
| `stale` | после карточки пользователь написал обычное сообщение или карточка не в последнем ответе | карточка серая, «Вопрос пропущен», варианты не нажимаются |
| `readonly` | шаринг `/s/:id` | как `answered`/`stale`, без действий |

### 4.8. Контекст и «отвечено» без дополнительного хранилища
«Отвечено» **выводится из истории**, поэтому в шаринге и после перезагрузки всё работает само.

В `Bk` (список сообщений) перед `map`:
```tsx
const answers = useMemo(() => {
  const m = new Map<string, QAnswer>();
  for (const msg of messages) if (msg.role === 'user' && msg.answerTo && msg.answers)
    m.set(`${msg.answerTo.messageId}:${msg.answerTo.qid}`, msg.answers);
  return m;
}, [messages]);
const lastAssistantIdx = messages.findLastIndex((x) => x.role === 'assistant');
```
В `Hk` оборачиваем контент ответа:
```tsx
<QuestionCtx.Provider value={{
  messageId: message.id,
  answers,
  canAnswer: !readonly && !streaming && index === lastAssistantIdx && index === messages.length - 1,
  onAnswer,                       // см. ниже
}}>
  <Ok text={message.content} live={pending} />
</QuestionCtx.Provider>
```
Страница чата (`Co` в `routes-*.js`) передаёт в `Bk` проп `onAnswer`:
```tsx
const onAnswer = useCallback((messageId: string, qid: string, a: QAnswer, text: string) => {
  xt(text, { answerTo: { messageId, qid }, answers: a });
}, [xt]);
```
И в `xt` при создании сообщения пользователя (`v = t?.reuseUser ?? { id: crypto.randomUUID(), role: 'user', content: n, createdAt: _, … }`) добавить:
```ts
answerTo: t?.answerTo, answers: t?.answers,
```
Остальное — как для обычного сообщения: появляется пустой ответ ассистента, идёт тот же SSE, `track`, IndexedDB, сохранение на сервере. **Модель продолжает в реальном времени сразу после тапа.**

Проверки совместимости (**[проверить]**):
- Валидатор серверного сохранения чата (`/_serverFn/917fe18e…`, в клиенте `qa({data:chat})`) не должен отбрасывать новые поля `answerTo`, `answers` у сообщений. Если схема строгая — добавить поля.
- Регенерация (`Ct`) и редактирование сообщения пользователя уже режут историю после точки правки: если сообщение с ответом удалено или изменено, а карточка снова последняя — она «оживает».
- Гость (без аккаунта, лимит 3 вопроса): ответ карточкой считается сообщением и списывает лимит — учесть в тексте лимита.

### 4.9. Компонент карточки (скелет)
Файл: `src/features/chat/question/QuestionCard.tsx`. Классы — из токенов сайта.

```tsx
import { useEffect, useRef, useState } from 'react';
import type { QAnswer, QBlock, QStep, QStepAnswer } from './types';

type Draft = { picked: string[]; custom: string; customOpen: boolean };
const EMPTY: Draft = { picked: [], custom: '', customOpen: false };
const buzz = () => {
  if (matchMedia('(pointer:coarse)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(8);
};

export function QuestionCard(p: {
  block: QBlock; qid: string; live: boolean;
  answered?: QAnswer; canAnswer: boolean; onSubmit: (a: QAnswer) => void;
}) {
  const { block, answered } = p;
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const step = block.steps[i];
  const total = block.steps.length;
  const d = draft[step.id] ?? EMPTY;
  const rootRef = useRef<HTMLDivElement>(null);
  const disabled = !p.canAnswer;

  // карточка стала активной — аккуратно показать её целиком
  useEffect(() => { if (p.canAnswer) rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [p.canAnswer]);

  if (answered) return <AnsweredSummary block={block} answered={answered} />;

  const patch = (next: Partial<Draft>) => setDraft((x) => ({ ...x, [step.id]: { ...(x[step.id] ?? EMPTY), ...next } }));
  const valid = (s: QStep, dd: Draft) => {
    if (s.optional) return true;
    const n = dd.picked.length + (dd.custom.trim() ? 1 : 0);
    return s.type === 'text' ? !!dd.custom.trim() : n >= (s.min ?? 1);
  };
  const toAnswer = (s: QStep, dd: Draft): QStepAnswer => ({
    stepId: s.id, picked: dd.picked,
    labels: dd.picked.map((id) => s.options!.find((o) => o.id === id)!.label),
    custom: dd.custom.trim() || undefined,
    skipped: !dd.picked.length && !dd.custom.trim(),
  });
  const finish = (all: Record<string, Draft>) =>
    p.onSubmit({ qid: p.qid, steps: block.steps.map((s) => toAnswer(s, all[s.id] ?? EMPTY)) });

  function toggle(id: string) {
    if (disabled) return; buzz();
    if (step.type === 'single') {
      const next = { ...draft, [step.id]: { ...d, picked: [id], custom: '', customOpen: false } };
      setDraft(next);
      if (total === 1 && !step.allowCustom) setTimeout(() => finish(next), 140);   // быстрый ответ одним тапом
      return;
    }
    const picked = d.picked.includes(id) ? d.picked.filter((x) => x !== id) : [...d.picked, id].slice(0, step.max ?? 99);
    patch({ picked });
  }
  const next = () => (i < total - 1 ? setI(i + 1) : finish({ ...draft, [step.id]: d }));

  return (
    <div ref={rootRef} role="group" aria-label={step.title} aria-busy={p.live}
         className={`my-3 rounded-[1.25rem] border border-line bg-elev p-3.5 ${disabled ? 'opacity-70' : ''}`}>
      <div className="mb-2.5 flex items-center gap-2 text-xs text-faint">
        <span>{total > 1 ? `Вопрос ${i + 1} из ${total}` : 'Уточнение'}</span>
        {p.live && <span aria-live="polite">· дописываю ответ…</span>}
        {total > 1 && (
          <span className="ml-auto flex gap-1" aria-hidden>
            {block.steps.map((_, k) => <i key={k} className={`h-1 w-4 rounded-full ${k <= i ? 'bg-accent' : 'bg-line'}`} />)}
          </span>
        )}
      </div>
      <p className="text-[1.0625rem] font-medium leading-6">{step.title}</p>
      {step.subtitle && <p className="mt-1 text-sm leading-5 text-muted">{step.subtitle}</p>}

      <div role={step.type === 'multi' ? 'group' : 'radiogroup'} className="mt-3 flex flex-col gap-2">
        {step.options?.map((o, k) => {
          const on = d.picked.includes(o.id);
          return (
            <button key={o.id} type="button" disabled={disabled}
              role={step.type === 'multi' ? 'checkbox' : 'radio'} aria-checked={on}
              onClick={() => toggle(o.id)}
              className={`press flex min-h-[52px] items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-base
                ${on ? 'border-accent bg-accent/15 shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_25%,transparent)]' : 'border-line bg-bg'}`}>
              <span className={`grid size-6 flex-none place-items-center rounded-lg border text-xs
                ${on ? 'border-accent bg-accent text-accent-fg' : 'border-line text-faint'}`}>{on ? '✓' : k + 1}</span>
              <span className="min-w-0">
                {o.label}
                {o.hint && <small className="block text-[13px] leading-[18px] text-faint">{o.hint}</small>}
              </span>
            </button>
          );
        })}

        {step.allowCustom && (
          d.customOpen || step.type === 'text'
            ? <input
                autoFocus={step.type !== 'text'} disabled={disabled}
                value={d.custom} maxLength={300}
                onChange={(e) => patch({ custom: e.target.value, ...(step.type === 'single' ? { picked: [] } : {}) })}
                onKeyDown={(e) => { if (e.key === 'Enter' && valid(step, d)) next(); }}
                placeholder={step.customPlaceholder}
                enterKeyHint={i < total - 1 ? 'next' : 'send'}
                className="h-[52px] rounded-2xl border border-line bg-bg px-3.5 text-base outline-none focus:border-accent" />
            : <button type="button" disabled={disabled} onClick={() => patch({ customOpen: true })}
                className="press min-h-[52px] rounded-2xl border border-dashed border-line px-3.5 text-left text-base text-faint">✎ Свой вариант…</button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        {i > 0
          ? <button type="button" onClick={() => setI(i - 1)} className="press min-h-12 flex-1 rounded-2xl border border-line text-muted">Назад</button>
          : <button type="button" disabled={disabled} onClick={() => p.onSubmit({ qid: p.qid, steps: [], skippedAll: true })}
              className="press min-h-12 flex-1 rounded-2xl border border-line text-muted">Пропустить</button>}
        <button type="button" disabled={disabled || !valid(step, d)} onClick={next}
          className="press min-h-12 flex-[2] rounded-2xl bg-accent font-medium text-accent-fg disabled:opacity-40">
          {i < total - 1 ? 'Дальше' : step.type === 'multi' && d.picked.length ? `Отправить (${d.picked.length})` : 'Отправить'}
        </button>
      </div>
    </div>
  );
}
```
Что ещё сделать (в скелет не поместилось):
- `AnsweredSummary`: заголовок «Уточнение · ✓ отвечено», по каждому вопросу — название и чипы выбранного (`rounded-full`, обводка `accent/50`), своё значение курсивом; без кнопок.
- `QuestionSkeleton`: три серые полосы-кнопки высотой 52 px, `animate-pulse`, при `prefers-reduced-motion` без анимации; `aria-busy`.
- `stale`: тот же вид, что `AnsweredSummary`, с подписью «Вопрос пропущен» и серым цветом.
- Клавиатура: у вариантов нативные `<button>` — Tab/Shift+Tab, Space/Enter выбирают; на десктопе цифры `1–9` выбирают вариант (`keydown` на карточке, пока она в фокусе); `Esc` — «Пропустить».
- Поле «Свой вариант» (16 px, чтобы iOS не зумил) не должно закрываться клавиатурой: после фокуса `scrollIntoView({block:'nearest'})` через 250 мс.
- В светлой теме все цвета из токенов; проверить контраст `text-faint` (см. P2-4).

### 4.10. Стрим «в реальном времени»
1. Модель пишет фразу — она стримится как обычный текст.
2. Дошли до открывающего ```` ```vvvion-question ```` — вместо кода показывается скелет (в `Ck.code` `live=true`, JSON ещё не парсится).
3. Закрывающий ```` ``` ```` пришёл → JSON парсится → скелет заменяется карточкой (анимация `opacity/y`, как у сообщений). Стрим ещё может идти → состояние `waiting` (кнопки неактивны, обычно доли секунды).
4. Стрим завершился (`done`) → карточка `idle`. Тап → `xt(...)` → новое сообщение пользователя, новый ответ ассистента, тот же SSE.
5. **Экономия токенов (опционально, P2):** клиент сам останавливает генерацию, как только закрылся блок карточки: `POST /api/chat {mode:"stop", chatId}` (функция `So`) + `abort()`. Включать только если модель продолжает писать после карточки; по умолчанию не включать.

### 4.11. Нативные tool calls (опциональный P2, **нужна проверка сервера**)
Для моделей с настоящим tool calling текстовый блок можно заменить вызовом инструмента `ask_user`. Я не видел серверного кода `/api/chat` и не знаю, пробрасывает ли он `tools`, поэтому не рассчитывай на это без проверки. Если пробрасывает:
```json
{
  "type": "function",
  "function": {
    "name": "ask_user",
    "description": "Задать пользователю уточняющий вопрос карточкой и дождаться ответа. Использовать только когда без ответа результат заметно ухудшится.",
    "parameters": {
      "type": "object",
      "properties": {
        "steps": { "type": "array", "maxItems": 3, "items": { "type": "object", "required": ["id","title","type"], "properties": {
          "id": {"type":"string"}, "title": {"type":"string"}, "subtitle": {"type":"string"},
          "type": {"enum": ["single","multi","text"]},
          "options": {"type":"array","minItems":2,"maxItems":6,"items":{"type":"object","required":["id","label"],"properties":{"id":{"type":"string"},"label":{"type":"string"},"hint":{"type":"string"}}}},
          "allowCustom": {"type":"boolean"}, "min": {"type":"integer"}, "max": {"type":"integer"}
        }}}
      },
      "required": ["steps"]
    }
  }
}
```
Самое простое встраивание **без изменения клиента**: сервер, получив из стрима `tool_calls` с `ask_user`, копит аргументы, валидирует теми же лимитами и **шлёт обычную дельту** с текстом ```` ```vvvion-question\n{…}\n``` ````, затем `done`. История хранит это как обычный текст ответа ассистента, ответ пользователя приходит обычным сообщением. Сообщение роли `tool` не нужно — ход заканчивается на карточке. Для моделей без tools остаётся текстовый путь из 4.3–4.6.

### 4.12. Валидация, лимиты, безопасность
| Что | Правило |
|---|---|
| Размер блока | JSON ≤ 6000 символов, иначе блок показывается как код |
| Шаги | ≤ 4 (лишние отбрасываются) |
| Варианты | 2…8 в шаге (меньше 2 — блок невалиден), `label` ≤ 60, `hint` ≤ 100, `title` ≤ 140 |
| Карточек в ответе | интерактивна **первая**; остальные блоки рендерятся как обычный код |
| Свой текст | ≤ 300 символов (`maxLength`); всё сообщение ответа ≤ 1000 символов |
| Рендер | только текст React; никаких `dangerouslySetInnerHTML`, ссылок, Markdown, картинок в карточке |
| Откуда берём | карточки рендерятся только из сообщений `role:"assistant"`. Сообщение пользователя с таким блоком — всегда простой текст |
| Инъекции | если ответ строится по результатам поиска в сети (`webSearch`), страница может подсунуть модели «карточку» с вводящими в заблуждение вариантами. Ущерб ограничен: тап отправляет только текст в этот же чат. Не добавлять в карточку других действий, кроме «отправить текст» |
| Двойной тап | после отправки карточка сразу блокируется (`canAnswer=false`, пока `streaming`); замок `K.current` в `xt` не даёт отправить параллельно |
| Лимит гостя | ответ считается сообщением (см. 4.8) |
| Битый/обрезанный JSON | если в сообщении `truncated` или JSON не парсится — карточка не показывается, блок остаётся видимым как код; в консоль `console.warn('[vvvion-question] invalid')` без содержимого |

### 4.13. Тесты
**Юнит (vitest) — `parse.test.ts`:**
- валидный блок → `QBlock`; одинаковые `id` переименовываются; `id` с `<` заменяется на `sN`;
- `options.length < 2` → `null`; `steps: []` → `null`; `v: 2` → `null`;
- запятая перед `}` → парсится; битый JSON → `null`; > 6000 символов → `null`;
- строки с `<img src=x onerror=alert(1)>` и `javascript:` очищены от `<>` и рендерятся текстом (в тесте компонента в DOM нет `img`/`a`);
- `formatAnswerText`: один вопрос/один вариант → просто подпись; несколько шагов → `• вопрос — ответ`; `skippedAll` → фраза-пропуск;
- `questionId` стабилен для одного и того же JSON и меняется при изменении варианта.

**Компонент (Testing Library) — `QuestionCard.test.tsx`:**
- single + 1 шаг без custom: тап по варианту → `onSubmit` через ≤ 200 мс;
- multi: `min/max` соблюдаются, «Отправить» неактивна при `n < min`;
- «Свой вариант»: раскрывается поле, пустое → кнопка неактивна; `Enter` отправляет;
- многошаговая: «Дальше»/«Назад» сохраняют выбор; в конце один вызов `onSubmit` со всеми шагами;
- `canAnswer=false` → все кнопки `disabled`; `answered` → нет кнопок, видны выбранные чипы;
- клавиатура: Tab/Space выбирают, цифры 1–9 (десктоп), Esc → пропуск.

**E2E (Playwright, без реальных моделей — мок SSE):**
```ts
await page.route('**/api/chat', async (route) => {
  const body = route.request().postDataJSON();
  if (body.mode === 'stop') return route.fulfill({ status: 200, body: '{}' });
  const last = body.messages.at(-1).content as string;
  const sse = (ev: string, data: unknown) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  const text = last.includes('Мобильное приложение')
    ? 'Тогда советую PWA или Capacitor…'
    : 'Уточню.\n\n```vvvion-question\n{"v":1,"steps":[{"id":"kind","title":"Что вы делаете?","type":"single","options":[{"id":"web","label":"Веб-сайт"},{"id":"app","label":"Мобильное приложение"}],"allowCustom":true}]}\n```';
  const chunks = text.match(/.{1,12}/gs)!.map((c) => sse('delta', { text: c })).join('') + sse('done', {});
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' }, body: chunks });
});
```
Сценарии: (1) карточка появляется и неактивна, пока стрим идёт, потом активна; (2) тап по «Мобильное приложение» → в чате сообщение пользователя «Мобильное приложение», пришёл второй ответ, карточка стала «отвечено»; (3) перезагрузка страницы — карточка осталась «отвечено»; (4) открытие `/s/:id` — карточка без кнопок; (5) если вместо ответа через карточку пользователь пишет в поле — карточка становится «пропущено»; (6) на 360×780 при высоте окна 444 (клавиатура) карточка помещается со скроллом списка, кнопки ≥ 48 px.

**Общий тест тап-целей** (на 390 и 360):
```ts
const small = await page.evaluate(() => [...document.querySelectorAll('button,a,[role=button],input,textarea,select')]
  .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.tagName).slice(0, 24), w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 }; })
  .filter((o) => o.vis && (o.w < 44 || o.h < 44)));
expect(small).toEqual([]);   // если используешь расширенную зону ::after, считай hit-area отдельно
```

### 4.14. Приёмка раздела «Интерактивные вопросы»
- Промпт «Помоги выбрать стек для приложения» (плагин включён) → в большинстве случаев модель выдаёт карточку; на «2+2?» — нет.
- Карточка не показывает «сырой» JSON ни на одном этапе стрима.
- Одношаговую single-карточку можно ответить одним тапом; multi и многошаговые — через «Дальше/Отправить».
- Ответ уходит одним сообщением, модель продолжает без повторного вопроса.
- После перезагрузки, на другом устройстве (залогиненный) и в шаринге карточка «отвечено» с выбранными чипами.
- На 360×780 карточка с 6 вариантами помещается при открытой клавиатуре (список прокручивается), все цели ≥ 48 px.
- Битый JSON → остаётся блок кода, чат не ломается, в консоли нет исключений.

---

## 5. Визуальные элементы (мобильные макеты)

PNG-макет карточки в стиле сайта: `mockup-question.png` (три состояния рядом: «ожидает ответа», «выбрано», «отвечено»).

### 5.1. Список сообщений: было → стало (390 px)
```
БЫЛО                                       СТАЛО
┌────────────────────────────┐             ┌────────────────────────────┐
│ ☰ V ＋ ⤴ [Круг!] [РУ▾] ⚙ │ ← 63px      │ ☰  Название чата…   ⤴  ⚙  │ ← 56px
├────────────────────────────┤             ├────────────────────────────┤
│  ┌──────────────────────┐  │             │  ┌──────────────────────┐  │
│  │ Вопрос пользователя  │  │             │  │ Вопрос пользователя  │  │
│  └──────────────────────┘  │             │  └──────────────────────┘  │
│        07:48 ⧉ ✎ 🗑        │ ← 32px      │  (действия — долгий тап)   │
│ (◕‿◕)  vvvion.space DeepSeek│             │ (◕‿◕)24 vvvion · DeepSeek  │
│  ┌────────────────────┐    │             │ Текст ответа на всю ширину │
│  │  Текст ответа 306px│    │             │ 358 px, без левой колонки  │
│  │  Заголовок = текст │    │             │ ## Заголовок крупнее       │
│  └────────────────────┘    │             │ ┌──── таблица ──────┐ ▶    │ ← тень-подсказка
│      ⧉ ↻ 🗑                │             │ └───────────────────┘      │
├────────────────────────────┤             │      ⧉  ↻  ⋯  (40px)       │ ← только у последнего
│ (◕‿◕)[DeepSeek▾][🧠]  28ms │ ← 36px      ├────────────────────────────┤
│ ┌────────────────────────┐ │             │ ┌────────────────────────┐ │
│ │ Напишите сообщение     │ │ ← 44px      │ │＋ Напишите сообщение 🎤➤│ │ ← 52px, одна строка
│ │ 📎 🎤 🖼 🌐 [↑Отправить]│ │ ← 44px      │ └────────────────────────┘ │
│ └────────────────────────┘ │             └────────────────────────────┘
└────────────────────────────┘   181px внизу                  ≈ 76px внизу
```

### 5.2. Нижняя панель с клавиатурой (viewport 481 px)
```
БЫЛО (237 px на сообщения = 49%)         СТАЛО (≥ 310 px = 65%+)
┌───────────────────────┐                ┌───────────────────────┐
│ шапка 63              │                │ шапка 56              │
│ сообщения 237         │                │ сообщения 330         │
├───────────────────────┤                ├───────────────────────┤
│ модель/пинг   36      │                │ ＋ Напишите…    🎤 ➤  │ 52
│ поле          44      │                └───────────────────────┘
│ инструменты   44+     │                (инструменты и модель — в «＋»)
└───────────────────────┘
```

### 5.3. Карточка вопроса — три состояния
```
1) ожидает ответа                      2) выбрано (multi)
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ Вопрос 1 из 2          ▬ ▭   │       │ Вопрос 2 из 2          ▬ ▬   │
│ Что вы делаете?              │       │ Что важно?                   │
│ Выберите один или свой       │       │ Можно выбрать несколько      │
│ ┌──────────────────────────┐ │       │ ╔══════════════════════════╗ │
│ │ 1  Веб-сайт              │ │       │ ║ ✓  Быстрый запуск        ║ │ ← accent
│ │    лендинг, блог…        │ │       │ ╚══════════════════════════╝ │
│ └──────────────────────────┘ │       │ ┌──────────────────────────┐ │
│ ┌──────────────────────────┐ │       │ │ ☐  Низкая стоимость      │ │
│ │ 2  Мобильное приложение  │ │       │ └──────────────────────────┘ │
│ └──────────────────────────┘ │       │ ╔══════════════════════════╗ │
│ ┌──────────────────────────┐ │       │ ║ ✓  Работает офлайн       ║ │
│ │ 3  Бэкенд / API          │ │       │ ╚══════════════════════════╝ │
│ └──────────────────────────┘ │       │ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ │
│ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ │       │ ╎ ✎ Свой вариант…         ╎ │
│ ╎ ✎ Свой вариант…          ╎ │       │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │
│ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │       │ [ Назад ] [Отправить (2)]    │
│ [Пропустить]  [ Дальше ░░ ]  │       └──────────────────────────────┘
└──────────────────────────────┘

3) отвечено (остаётся в истории)
┌──────────────────────────────┐
│ Уточнение · ✓ отвечено       │
│ Что вы делаете?              │
│  (Мобильное приложение)      │
│ Что важно?                   │
│  (Быстрый запуск) (Офлайн)   │
└──────────────────────────────┘
             ┌─────────────────────────────────┐
             │ • Что вы делаете? — Мобильное…  │ ← сообщение пользователя
             └─────────────────────────────────┘
 Тогда советую PWA или Capacitor… (модель продолжила)
```

---

## 6. Чек-лист проверки на телефоне
Проверять в приложении (WebView) и в Chrome на Android; iOS Safari — отдельно (**не проверено** в этой сессии).

**Раскладка и текст**
- [ ] Ответ занимает всю ширину, аватар маленький в строке мета-данных.
- [ ] `#`, `##`, `###` визуально различаются; списки и цитаты читаются.
- [ ] Шапка на 360 px ничего не перекрывает.
- [ ] Короткий вопрос («2+2?») получает короткий ответ.

**Ввод и клавиатура**
- [ ] Нижняя панель в одну строку; «+» открывает файл/картинку/сеть/модель.
- [ ] Клавиатура открыта: видно ≥ 65% экрана сообщений, поле не прыгает, шапка не белеет (`#0c0c0e`).
- [ ] Многострочный ввод растёт до ~6 строк и дальше скроллится внутри поля.
- [ ] Safe-area: кнопки не залезают под жестовую полосу.

**Стрим и скролл**
- [ ] Длинный ответ: экран следует за текстом без рывков; свайп вверх останавливает следование, появляется «К последнему».
- [ ] Отправка из прокрученного состояния прыгает вниз.
- [ ] Перезагрузка во время ответа: ответ дописывается, список не «залипает» вверху.

**Код и таблицы**
- [ ] Широкая таблица: видна тень справа, листается пальцем, не мешает вертикальному скроллу.
- [ ] Код на телефоне переносится по умолчанию; «Копировать» даёт галочку.

**Действия и модель**
- [ ] Действия — только у последнего ответа; остальные — через «⋯» или долгий тап.
- [ ] Удаление отменяется snackbar'ом, системного `confirm` нет.
- [ ] Выбор модели — sheet со строками ≥ 52 px.
- [ ] Все кнопки нажимаются большим пальцем с первого раза (зона ≥ 44 px).

**Интерактивные вопросы**
- [ ] Промпт «Помоги выбрать стек для приложения» → карточка; «2+2?» → без карточки.
- [ ] Во время стрима нет «сырого» JSON; карточка появляется плавно.
- [ ] single одним тапом отправляется; multi/шаги — «Дальше/Отправить».
- [ ] «Свой вариант»: поле 16 px, клавиатура не закрывает карточку.
- [ ] После ответа: сообщение пользователя в чате, модель продолжает, карточка «отвечено».
- [ ] Перезагрузка и `/s/:id`: карточка «отвечено», без кнопок.
- [ ] Обычное сообщение вместо ответа → карточка «вопрос пропущен».
- [ ] Плагин «Уточняющие вопросы» выключен → карточек нет.

---

## 7. Рекомендуемый порядок работ
1. **P0-1** длина ответа (проверить сервер) → **P0-2** CSS заголовков → **P0-3** колонка → **P0-5** автоскролл (с тестом).
2. **P0-4** нижняя панель (сначала быстрый CSS-минимум, потом полная перестройка).
3. Раздел 4: парсер + тесты → `QuestionCard` → ветка в `Ck.code` → плагин `ask` и подсказка → `onAnswer`/`xt` → персистентность/шаринг → E2E.
4. P1-1…P1-7, затем P2.

## 8. Что не удалось проверить
- Реальную клавиатуру Android/iOS (имитировал уменьшением высоты viewport; `adjustResize` в WebView даёт ту же высоту, но не ту же анимацию).
- iOS Safari (safe-area, `100dvh`), вибрацию в WebView, жест долгого тапа.
- Серверную часть `/api/chat`: откуда берётся требование «400+ слов», принимает ли сервер `toolNote`, поддерживает ли `tools`.
- Источник `403` на десктопе, причину CLS, производительность стрима в профайлере.
- Прямое сравнение с приложениями ChatGPT/Claude/Gemini — только по знаниям о них.
- Элемент «Язык» 67×20 (есть в DOM на мобильном, на скриншоте не виден).

## 9. Тестовые данные
Использовался только тестовый аккаунт B (`qa_test_b_1109@example.com`; пароль в `audit-func3/account-b.txt`, здесь не приводится). В нём созданы тестовые чаты («Привет! Ответь одним коротким предложением.», «Скажи «ок».», «Сделай пример ответа для проверки оформления…», «2+2?», «Объясни подробно, как работает event loop…», «Напиши подробное сравнение REST и GraphQL…»; из-за повторных прогонов часть могла создаться дважды). Аккаунт и чаты не удалял.
