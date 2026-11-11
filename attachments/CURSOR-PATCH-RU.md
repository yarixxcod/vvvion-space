# Задача для Cursor: UI/UX-фиксы vvvion.space

## Контекст
Стек по продакшен-бандлу: React + TanStack Router (SSR), Tailwind v4 (утилиты в JSX, `@theme`, `@layer`), токены — CSS-переменные в `:root` и `html.light`. Шрифты: Google Fonts `Outfit`, `Instrument Serif`, `Syne`, `IBM Plex Mono`. Ключевые классы: `.field`, `.press`, `.snap-row`, `.prose-y`, `text-faint`, `text-muted`, `bg-elev`, `border-line`.

## Правила
- Логику, API, роуты и состояние НЕ менять. Только стили, разметка и мелкие UI-фолбэки.
- Сохранить обе темы (`:root` = тёмная, `html.light` = светлая).
- Один коммит на задачу: `ui: <номер> <кратко>`.
- После каждой задачи запустить `build` и `lint`, затем показать diff.
- Если селектор не находится grep'ом, остановиться и сообщить, ничего не выдумывать.
- Пункты с пометкой 🔍 сначала исследовать и написать причину, потом чинить.

## Глобальный CSS (вставить в главный stylesheet, после `@theme`/`:root`)
```css
/* 1. Кириллица: латиница остаётся брендовой, кириллица берётся из Onest/Playfair */
@theme{
  --font-sans:"Outfit","Onest",ui-sans-serif,system-ui,sans-serif;
  --font-serif:"Instrument Serif","Playfair Display",Georgia,serif;
}
/* 2. Токены контраста */
:root{ --faint:#9a958c; --line-strong:#63636c; }
html.light{ --faint:#69645d; --line-strong:#8f887d; }

/* 3. Нативный select: пункты видны */
select option{ background:var(--elev); color:var(--fg); }

/* 4. Поля: видимая граница и фокус */
.field{ border-color:var(--line-strong); }
.field:focus,.field:focus-visible{
  border-color:var(--accent);
  box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 35%,transparent);
}

/* 5. Тап-цели на тач-экранах */
@media (pointer:coarse){ .press{ min-height:44px; min-width:44px; } }

/* 6. Неактивные кнопки не выглядят сломанными */
button:disabled{ opacity:1; background:transparent;
  border:1px solid var(--line-strong); color:var(--faint); }

/* 7. Горизонтальные ряды: без скроллбара, с затуханием у края */
.snap-row{ overflow-x:auto; scroll-snap-type:x proximity;
  scrollbar-width:none; mask-image:linear-gradient(90deg,#000 88%,transparent); }
.snap-row::-webkit-scrollbar{ display:none; }

/* 8. Текст ответа крупнее на широких экранах */
@media (min-width:1440px){ .prose-y{ font-size:1.0625rem; line-height:1.65; } }
```

---

## Задачи (по приоритету)

### 1. Шрифты с кириллицей
**Цель:** русский текст рисуется в Onest и Playfair Display, а не в системном шрифте или Georgia.
**Где:** grep `fonts.googleapis.com/css2` (link в root/head), `--font-sans`, `--font-serif`.
**Сделать:**
- Заменить URL шрифтов на:
`https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Outfit:wght@400;500;600&family=Syne:wght@700;800&family=Onest:wght@400;500;600&family=Playfair+Display:wght@400;500&display=swap`
(веса Outfit 340 и 420 в коде не используются, их убрать).
- Перед link добавить:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```
- Стеки шрифтов взять из глобального блока (п. 1).
**Приёмка:** DevTools → Computed → Rendered Fonts на «Погода» и «Профиль» показывает Playfair Display, на русском тексте в чате — Onest. Если смешение Outfit с Onest в одной строке заметно (например, «RolePlay · Привет»), предложить вариант B: `--font-sans:"Onest",…` целиком.

### 2. Меню языка
**Где:** grep `bg-transparent text-sm outline-none` в компоненте языка (`Қазақша`, `РУ`).
**Сделать:** правило `select option{…}` из глобального блока.
**Приёмка:** в выпадашке на Chrome Linux/Windows видны все три подписи: РУ, EN, ҚАЗ.

### 3. Мелкий и бледный текст
**Где:** grep `text-[10px]` (5 мест), `text-[11px]` (47 мест), `text-xs text-faint` (около 153).
**Сделать:**
- `text-[10px]` и `text-[11px]` заменить на `text-xs` (12px).
- Поясняющие подсказки под полями и блоками (настройки, админка, банк, погода) перевести с `text-xs text-faint` на `text-[13px] text-muted`.
- Метки времени и счётчики оставить `text-xs text-faint`.
- Токены `--faint` взять из глобального блока.
**Приёмка:** grep `text-[10px]` и `text-[11px]` возвращает 0. Контраст `--faint`: в тёмной теме 6,56:1 на `--bg` и 5,70:1 на `--subtle`, в светлой 5,24:1 на `--bg`. Оба значения ≥ 4,5.

### 4. Поля и фокус
**Где:** `.field` в CSS (сейчас `outline:none`), grep `outline-none` в JSX (6 мест).
**Сделать:** блок 4 из глобального CSS. Для `outline-none` без `.field` добавить `focus-visible:ring-2 focus-visible:ring-[var(--accent)]`.
**Приёмка:** на любом поле при Tab видно кольцо. Контраст рамки 3,29:1 в тёмной теме и 3,14:1 в светлой, оба ≥ 3:1.

### 5. Панель «Круга» и вкладки
**Где:** grep `md:w-[min(100%,52rem)]` (aside), ряд вкладок «Сообщения / Лента / … / Админ», карусель «Утро».
**Сделать:**
- aside: добавить `xl:w-[calc(100%-18.5rem)]` (ширина сайдбара `w-[min(100%,18.5rem)]`).
- Ряд вкладок и карусели: класс `snap-row`, у элементов `shrink-0 snap-start`.
**Приёмка:** на 1920px видны все 9 вкладок, «Админ» не обрезан. На 400px нет системного скроллбара под вкладками и каруселью, у края видно затухание.

### 6. Мобильная шапка и настройки
**Где:** верхняя панель чата (кнопки: сайдбар, лого, «+», «Поделиться», «Круг», язык, тема, шестерёнка).
**Сделать:** кнопкам «Поделиться», язык и тема добавить `hidden sm:inline-flex`, а сами пункты продублировать внутри модалки настроек.
🔍 На 400px кнопка «Настройки» не открыла модалку. Сначала найти причину: z-index, перекрытие, обработчик, `sm:`-классы модалки `sm:w-[min(32rem,calc(100vw-3rem))]`. Потом починить.
**Приёмка:** на 400px в шапке не больше 4 кнопок, все ≥ 44×44. Настройки открываются в браузере и в Android WebView.

### 7. Превью роликов (Смотрельня)
**Где:** grep `aspect-video w-full object-cover` в library-компоненте, где рядом `Jt[e.provider]`.
🔍 Сначала DevTools → Network: что отдаёт `thumb` (404, 403 от хотлинка, пустой ответ)? CSP `img-src https:` картинки разрешает. Причину записать в коммит.
**Сделать:**
```jsx
const [bad, setBad] = useState(false);
{e.thumb && !bad ? (
  <img src={e.thumb} alt="" loading="lazy" referrerPolicy="no-referrer"
       onError={() => setBad(true)}
       className="aspect-video w-full bg-subtle object-cover" />
) : (
  <span className="grid aspect-video w-full place-items-center bg-subtle font-serif text-3xl text-muted">
    {Jt[e.provider]}
  </span>
)}
```
Отдельно: добавить `loading="lazy"` всем `<img>` в ленте, на диске, в новостях и библиотеке. Сейчас в бандле таких 0.
**Приёмка:** битая ссылка показывает плашку с буквой провайдера, а не чёрный блок.

### 8. Пустые формулы в ответе
**Где:** место рендера KaTeX (`katex`, `math-display`, `$$`).
**Сделать:** если тело формулы без букв, цифр и `\`, выводить исходный текст:
```js
if (!/[A-Za-z0-9\\]/.test(tex)) return <span>{raw}</span>;
```
**Приёмка:** текст «формулы в $...$, а выключные в $$...$$.» выводится как есть, без «…» по центру и одинокой точки. Настоящие формулы (`$x^2$`) по-прежнему рендерятся.

### 9. Админка
**Где:** `type:"file"` в админке (иконка модели), журнал, статистика.
**Сделать:**
- Вместо голого file input:
```html
<label class="press inline-flex h-11 items-center gap-2 rounded-2xl border border-line bg-elev px-3 text-sm">
  Выбрать иконку <input type="file" accept="image/*" class="sr-only" />
</label>
```
- Журнал: строки таблицей «Кто · Модель · Время · Статус · Запрос» без рамки у каждой строки. Статус «ошибка» показать плашкой `rounded-full px-2 text-xs` с `text-danger`.
- Статистика: подпись колонок «запросы · токены».
- Моно-поля (ключ, эндпоинт): `text-sm`.
**Приёмка:** нет английского «Choose File». В журнале на экране 1080px помещается ≥ 20 строк.

### 10. Локализация и единицы
**Где:** магазин (`Купить`, `Открыть за`, `Продлить за`), погода (`Almaty, Kazakhstan`), профиль (`type:"date"`).
**Сделать:**
- Цены: `{price} вуб.` или иконка монеты везде, где выводится цена.
- Погода: подпись под городом брать на языке интерфейса или убрать.
- Дата рождения: вместо `input type=date` текстовое поле с маской `ДД.ММ.ГГГГ` или три select'а. Формат хранения не менять.
**Приёмка:** у каждой цены есть единица, нет `mm/dd/yyyy`, нет английских подписей в RU-интерфейсе.

### 11. Мелочи
- Индикатор задержки «298 ms» убрать в `title` иконки сигнала.
- Иконкам скрепки, микрофона и «Сеть» добавить `aria-label` и `title`.
- «Звук уведомлений: Вкл» сделать switch с `role="switch"` и `aria-checked`.
- В магазине кнопки «Купить» у персонажей сделать вторичными (`border border-line-strong bg-transparent`). Акцентной оставить только Premium.
- В списке друзей показывать имя или @ник вместо e-mail.
- `/about`: `max-w-2xl` → `max-w-3xl`, `text-sm` → `text-base` у абзацев.
- Плитки «VPN» и «Загрузчик» на дашборде «Сервисов» дорисовать в стиле остальных иллюстраций.

### 12. 🔍 Отступ слева от ответа на мобильном
На 400px текст ответа ИИ начинается примерно с x=68px, около 58px пустоты. В бандле источник не найден. Найти в DevTools элемент с этим padding или margin, написать, откуда он, и убрать его на `<640px` (`sm:` префиксом).
**Приёмка:** на 400px текст ответа идёт от 16px до 16px по краям.

### 13. Производительность (если просто)
- `circle-*.js` (366 КБ) сейчас стоит в `modulepreload` на главной. Грузить его лениво, при первом открытии «Круга».
- KaTeX и highlight.js вынести в отдельные lazy-чанки.
- Проверить состав бандла через `npx vite-bundle-visualizer`.
**Приёмка:** JS главной меньше 383 КБ gzip, «Круг» открывается без ошибок.

## Общая приёмка
- Прогнать 400px, 768px и 1920px в обеих темах.
- Lighthouse Accessibility ≥ 95.
- Нет визуальных регрессий в чате, «Круге», админке и магазине.
- Показать итоговый diff по коммитам.
