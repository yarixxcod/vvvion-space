# VVVion Space — Магазин + пополнение вублей через CryptoBot + ИИ pay-as-you-go: задача для Claude

Один файл вместо трёх: `shop-ux/CURSOR-SHOP-RU.md` (аудит и план магазина), `pay-oxapay/CURSOR-OXAPAY-VUBLI-RU.md` (**снят, OxaPay не одобрил заявку**) и сайтовая часть мостов `v2/CURSOR-APP-BRIDGE-RU.md` / `v2/CURSOR-APP-2.9.1-RU.md`. Везде, где раньше были OxaPay и Bibinto, теперь **только CryptoBot (Crypto Pay API)**. Bibinto из проекта убрать полностью.

## Правила для Claude
- **Сначала читай, потом меняй.** Бандлы минифицированы, имена функций случайные. Код ищи по строкам из таблиц (`rg -n "Сначала подтвердите почту" src/`, `rg -n "window.confirm"`, `rg -n "Забрать 100"`, `rg -n "vvNest|pushBackLayer|__vvvionHandleBack"`). Не нашёл подсказку — остановись и напиши, что именно не нашёл. Пункты **[проверить]** сначала исследуй, потом чини. Названия таблиц/колонок в SQL ниже (`wallet`, `wallet_ledger`) — **предложения**: найди реальные (`rg -n "balance|ledger|wallet|вубл" src/ server/ db/`) и адаптируй под свою ORM/миграции.
- **Не ломай существующее.** Работают и должны продолжать работать: `/?place=shop`, `/?place=bank`, остальные вкладки Круга, deep links `/messages`, `/c/…`, `/r/…`, текущие покупки (Premium, VPN, Мегадиск, +запросы, +диск, персонажи) и «Забрать 100», переводы, кредит. Старые серверные функции магазина оставь как обёртки над новым единым входом, пока клиент их зовёт. Все новые фичи — за флагами (раздел 2.3), по умолчанию **выключены**.
- **Обратная совместимость с приложением Android 2.9.1** (`window.VvvionApp`, UA `vvvionApp/2.9`): все вызовы моста только как `window.VvvionApp?.метод?.()` или через `VvvionApp.has('…')`; в браузере `VvvionApp` нет. Новые методы моста, которых в 2.9.1 нет (`openExternal`, событие `vvvion-app-resume`), использовать **только** с запасным путём (раздел 12). Слои «Назад» — только через существующий `pushBackLayer` / хук `vvNest`, второй стек не изобретать; `__vvvionHandleBack` и `__vvvionBackOwned` не трогать.
- **Секреты.** Токен Crypto Pay — **только** в переменных окружения сервера (`CRYPTOPAY_TOKEN`), не в коде, не в репозитории, не в клиентском бандле (`VITE_*`/`NEXT_PUBLIC_*` для него запрещены), не в логах, не в ответах API, не в `.env.example` (там пустое значение), не в тестах (тесты мокают HTTP). Путь вебхука с секретом тоже не логируй (маскируй `…/webhooks/cryptopay/***`). Ключи платёжек нельзя класть в `description`/`payload` счёта.
- **Деньги: сервер — единственный источник правды.** Курс, число вублей, цену товара, срок сервер берёт из своих таблиц. Клиент присылает **только** сумму в рублях (целое) или `sku`, плюс `idempotencyKey`. Количество вублей клиент никогда не присылает. Начисление — только по подтверждённому провайдером счёту (подпись вебхука или серверный `getInvoices`), никогда по `returnUrl`/клиентскому «я оплатил».
- **Курс фиксируется при создании счёта** и хранится в записи платежа (`vubli_*`, `rate_x1000`, `rate_version`). При вебхуке/сверке **ничего не пересчитывается**: начисляется ровно то, что записано в строке.
- **Атомарность.** Любое начисление/списание — одна транзакция БД, с блокировкой строки (`SELECT … FOR UPDATE`) и условием `balance >= amount` для списаний. Отрицательный баланс невозможен (существующий «Кредит в минус» не трогать, держать отдельно).
- **Миграции обратимы:** у каждой есть `down`; новые виды операций журнала — `text` + `CHECK`, **не** `ENUM` (значения enum из Postgres не удалить). Перед миграцией кошелька — бэкап/дамп и dry-run на копии.
- **Тесты обязательны** (раздел 11): юнит на таблицу курса и подпись, интеграционные на вебхук (дубль, подделка, гонка), параллельные покупки, testnet-прогон. Без зелёных тестов PR не считается готовым.
- Одна задача — один коммит: `shop: <номер> <кратко>` или `pay: <номер> <кратко>`. После каждой — `build`, `lint`, тесты, критерии приёмки. Тёмная и светлая темы обязательны. Цвета только из токенов (`--bg --elev --subtle --fg --muted --faint --line --line-strong --accent --accent-fg`); сиреневый Premium `#6e5ad6` уже есть — новых цветов не вводить.
- **Не меняй цены и экономику сам.** Все цены товаров (раздел 8), тарифы ИИ (раздел 9) и таблица курса (раздел 3) — **предложения владельца**, вынесены в один серверный конфиг и правятся без релиза кода. Текущий прайс (по API) не менять, пока владелец не подтвердит.
- **Нельзя:** списывать вубли «по фронту»; доверять сумме/вублям из тела запроса; логировать токены, подписи целиком, полные вебхуки с PII; отдавать клиенту себестоимость моделей; делать запросы к боевому Crypto Pay в автотестах; включать `transfer`/`createCheck` (выплаты) — они нам не нужны и в настройках приложения CryptoBot остаются выключенными.
- Каждый пункт помечен **«сайт»** (делаешь ты, Claude), **«сервер»** (тоже ты) или **«приложение»** (код APK делает Гик; ты делаешь сайтовую половину и пишешь, что ждёшь от приложения). Всё про `VvvionApp` — под `isApp()` / `window.VvvionApp?.`.

### Метки достоверности
| Метка | Что значит |
|---|---|
| **[проверено]** | Сверено с документацией Crypto Pay (`help.cr.bot`, статья «Crypto Pay API», версия API 1.5.3 от 28.10.2026) на 11.11.2026 или с кодом APK 2.9.1. |
| **[не проверено]** | Не подтверждено документацией/кодом — **проверь на testnet или по свежей доке до того, как на это опираться**. Список в разделе 14. |
| **Предложение** | Решение/цифра владельца или моя рекомендация, правится конфигом. |
| **Измерено / По API / По коду** | Как в `CURSOR-SHOP-RU.md` (тестовый аккаунт B, 390×844 и 1440×900, ответы серверных функций магазина, боевые бандлы от 11.11.2026). |

---

## 1. Контекст и цель

**Что строим.**
1. **Пополнение вублей за деньги через CryptoBot** (крипта: USDT, TON, BTC, ETH, LTC, TRX, USDC…). Счёт выставляется **в рублях** (`currency_type=fiat`, `fiat=RUB`) — покупатель платит любой поддерживаемой криптой, пересчёт по курсу делает CryptoBot. Одобрения мерчанта не требуется: приложение создаётся прямо в боте `@CryptoBot`.
2. **Перестройка Магазина** (структура, единая карточка, лист покупки вместо `window.confirm`, цены видны всегда, «Пополнить» и «Не хватает N вуб»).
3. **Новые платные товары** (раздел 8).
4. **ИИ pay-as-you-go сверх лимита** за **купленные** вубли (раздел 9).

**Курс.** База: **1 ₽ = 10 вублей**. Курс **плавающий в пределах ±4 %** в зависимости от суммы пополнения: чем крупнее платёж, тем больше вублей за рубль (раздел 3). Владелец сам правит таблицу.

**Зачем одной связкой.** Пополнение — первое, чего не хватает магазину (**S-3**: «Купить вубли» в боевом сайте нет вообще). Без него остальное не продаёт.

## 2. Решения владельца (по умолчанию уже приняты — не жди ответа, делай так)

### 2.1 Что решено
| Вопрос | Решение по умолчанию | Где менять |
|---|---|---|
| Платёжка | **CryptoBot / Crypto Pay API**, mainnet; testnet для разработки | `CRYPTOPAY_NETWORK` |
| База курса | 1 ₽ = 10 вуб; ±4 % по таблице из раздела 3 | `config/vubliRate.ts` (серверная таблица) |
| Валюта счёта | RUB; KZT — опция P2, выключена | `PAY_CURRENCIES` |
| Мин./макс. платёж | 50 ₽ … 50 000 ₽ за счёт; ≤ 100 000 ₽ в сутки на пользователя | конфиг |
| Подтверждённая почта | для пополнения **нужна** (как для покупок) | флаг `TOPUP_REQUIRE_VERIFIED` |
| Бакеты вублей | **Вариант A** из `CURSOR-SHOP-RU.md` 8.1: `purchased` (за деньги) и `earned` (заработанные и бонусные). Внедряется отдельным шагом за флагом `WALLET_SPLIT`; пока он выключен, всё идёт в единый баланс | `WALLET_SPLIT` |
| Бонусная часть при курсе > 10 | идёт в `earned` (не «купленное»), PAYG её не тратит | функция `creditTopup` |
| Оплата ИИ сверх лимита | только с `purchased` (раздел 9) | флаг `AI_PAYG` |
| Возвраты | вубли не возвращаются (внутренняя единица), крипто-платежи необратимы; ручная корректировка админом — `kind='adjust'` | оферта |

### 2.2 Что владелец ещё должен сделать (не ты)
1. **Положить токен приложения CryptoBot в Vercel**: Project → Settings → Environment Variables → `CRYPTOPAY_TOKEN` (Production **и** отдельно, при желании, Preview) → Redeploy. **Токен в чат, код и репозиторий не кладём никогда.** Если токен уже где-то засветился (чат, скриншот, коммит), его нужно перевыпустить в `@CryptoBot` → Crypto Pay → My Apps → приложение → настройки (**[не проверено]**: точное название пункта перевыпуска токена в меню бота).
2. Создать **второе** приложение в `@CryptoTestnetBot` (testnet) и положить его токен в Preview/локальный `.env.local` как `CRYPTOPAY_TOKEN` с `CRYPTOPAY_NETWORK=testnet`. Токены mainnet и testnet не смешивать.
3. Придумать и положить `CRYPTOPAY_WEBHOOK_SECRET` (случайные 32+ байта, `openssl rand -hex 32`) — это сегмент пути вебхука.
4. В `@CryptoBot` → Crypto Pay → My Apps → приложение → **Webhooks → Enable Webhooks** → URL `https://vvvion.space/api/webhooks/cryptopay/<CRYPTOPAY_WEBHOOK_SECRET>` **[проверено]** (так включаются вебхуки). Для testnet — то же в `@CryptoTestnetBot` и с URL превью-деплоя/туннеля.
5. В настройках приложения оставить **выключенными** `Transfers` (выплаты) и не создавать чеки; allowlist IP (если он есть в настройках приложения) включать не обязательно: у обычных serverless-функций Vercel исходящие IP не фиксированы (**[не проверено]** для вашего тарифа) — защита токена держится на том, что он не покидает env.

### 2.3 Переменные окружения и флаги
```
CRYPTOPAY_TOKEN=               # секрет, только сервер
CRYPTOPAY_NETWORK=mainnet      # mainnet | testnet — определяет базовый URL
CRYPTOPAY_WEBHOOK_SECRET=      # секретный сегмент пути вебхука
CRYPTOPAY_ENABLED=false        # аварийный выключатель: false → POST /api/vubli/topup отвечает 503, вебхук и сверка продолжают работать
PAY_CURRENCIES=RUB             # RUB[,KZT]  (KZT — опция, раздел 3.6)
TOPUP_MIN_RUB=50
TOPUP_MAX_RUB=50000
TOPUP_DAILY_MAX_RUB=100000
TOPUP_REQUIRE_VERIFIED=true
CRON_SECRET=                   # Vercel Cron шлёт его как Authorization: Bearer … (проверь по текущей документации Vercel) [не проверено]
# флаги функций (серверные и клиентские, по умолчанию off):
PAY_TOPUP=false  SHOP_V2=false  WALLET_SPLIT=false  AI_PAYG=false
```
Базовый URL: `mainnet` → `https://pay.crypt.bot/api/`, `testnet` → `https://testnet-pay.crypt.bot/api/` **[проверено]**. Заголовок: `Crypto-Pay-API-Token: <token>` **[проверено]**. Если `CRYPTOPAY_TOKEN` пуст, а флаг включён, сервер на старте пишет в лог (без значения) «CRYPTOPAY_TOKEN не задан» и отвечает 503 на создание счёта.

---

## 3. Курс вублей: таблица по объёму (серверный конфиг)

### 3.1 Принцип
- База: `10 вуб / ₽`. Вокруг неё **ступенчатая таблица из 5 уровней**: малый платёж платит чуть больше за вубль (−4 % вублей, покрывает комиссию и издержки мелких платежей), крупный получает бонус (до +4 %).
- Ступень определяется **суммой одного платежа** в рублях и применяется ко **всему** платежу (не к «части сверх порога»). Ступенчатость простая и понятная на экране: «от 5 000 ₽ — +4 % бонус».
- **Предложение владельца, не факт.** Цифры ниже — разумные значения по умолчанию. Владелец меняет таблицу в одном месте, без правок логики; изменение заводит новую `rate_version`, старые платежи (уже созданные счета) начисляются по тому курсу, что записан в их строке.

### 3.2 Таблица по умолчанию
| Уровень (`id`) | Сумма платежа, ₽ | Курс, вуб за 1 ₽ | Отклонение от базы | Подпись в UI |
|---|---|---:|---:|---|
| `xs` | 50 – 99 | **9,6** | −4 % | «малый платёж −4 %» |
| `s` | 100 – 499 | 9,8 | −2 % | «малый платёж −2 %» |
| `m` | 500 – 1 999 | **10,0** | 0 % | (без подписи) |
| `l` | 2 000 – 4 999 | 10,2 | +2 % | «+2 % бонус» |
| `xl` | от 5 000 | **10,4** | +4 % | «+4 % бонус» |

Примеры (расчёт: `floor(₽ × курс)`):
| Платёж | Получите | Из них «купленные» (`purchased`) | Бонус (`earned`) |
|---:|---:|---:|---:|
| 50 ₽ | 480 | 480 | 0 |
| 100 ₽ | 980 | 980 | 0 |
| 500 ₽ | 5 000 | 5 000 | 0 |
| 1 000 ₽ | 10 000 | 10 000 | 0 |
| 2 500 ₽ | 25 500 | 25 000 | 500 |
| 5 000 ₽ | 52 000 | 50 000 | 2 000 |
| 10 000 ₽ | 104 000 | 100 000 | 4 000 |

Правило бакетов: `base = ₽ × 10`; `purchased = min(total, base)`; `bonus = total − purchased` (≥ 0). Для малых платежей (курс < 10) всё `total` идёт в `purchased`. Пока флаг `WALLET_SPLIT` выключен, `purchased + bonus` складываются в единый баланс.

### 3.3 Что это значит для владельца (**посмотри на цифры**)
Комиссия CryptoBot по моим сведениям 3 % при обороте до $10 тыс. в месяц — **[не проверено]**, на странице API-доки её нет; подтверди в `@CryptoBot` (Crypto Pay → тарифы/FAQ). При 3 %:
| Уровень | Вублей за 1 ₽ | Нетто с рубля после комиссии, ₽/вуб |
|---|---:|---:|
| `xs` | 9,6 | 0,1010 |
| `s` | 9,8 | 0,0990 |
| `m` | 10,0 | 0,0970 |
| `l` | 10,2 | 0,0951 |
| `xl` | 10,4 | 0,0933 |
Нетто за вубль падает с ростом бонуса: крупный платёж отдаёт ~7 % «стоимости вубля» на комиссию и бонус. Ставь тарифы ИИ (раздел 9) с запасом и помни, что бесплатный кран («Забрать 100», ≈ 3 000 вуб/мес) и приглашения (1 000 вуб) обесценивают вубль независимо от курса. Владелец может сузить ±4 % до ±2 % или убрать бонус на `xl`, не трогая логику.

### 3.4 Код (единственный источник курса, чистые функции, сервер)
```ts
// server/config/vubliRate.ts
export const RATE_VERSION = '2026-11-v1';           // менять при любой правке таблицы
export const BASE_VUB_PER_RUB = 10;
export type Tier = { id: 'xs'|'s'|'m'|'l'|'xl'; fromRub: number; perRubX1000: number; label: string | null };
export const TIERS: readonly Tier[] = [             // по возрастанию fromRub
  { id: 'xs', fromRub: 0,    perRubX1000: 9600,  label: 'малый платёж −4 %' },
  { id: 's',  fromRub: 100,  perRubX1000: 9800,  label: 'малый платёж −2 %' },
  { id: 'm',  fromRub: 500,  perRubX1000: 10000, label: null },
  { id: 'l',  fromRub: 2000, perRubX1000: 10200, label: '+2 % бонус' },
  { id: 'xl', fromRub: 5000, perRubX1000: 10400, label: '+4 % бонус' },
];
export const PRESETS_RUB = [50, 100, 300, 500, 1000, 2500, 5000, 10000] as const;   // быстрые кнопки

export function tierFor(rub: number): Tier {
  let t = TIERS[0]; for (const x of TIERS) if (rub >= x.fromRub) t = x; return t;
}
export function quote(rub: number) {
  if (!Number.isInteger(rub) || rub < cfg.minRub || rub > cfg.maxRub) throw new TopupError('amount_out_of_range');
  const t = tierFor(rub);
  const total = Math.floor((rub * t.perRubX1000) / 1000);     // целые вубли, округление вниз в пользу сервиса
  const base = rub * BASE_VUB_PER_RUB;
  const purchased = Math.min(total, base);
  return { rub, tierId: t.id, perRubX1000: t.perRubX1000, rateVersion: RATE_VERSION,
           vubliTotal: total, vubliPurchased: purchased, vubliBonus: total - purchased,
           bonusPct: Math.round((t.perRubX1000 / 10000 - 1) * 1000) / 10, label: t.label };
}
/** минимальный платёж в ₽, чтобы получить не меньше needVub вублей (для «Не хватает N вуб»); total монотонна по rub */
export function minRubForVub(needVub: number): number {
  let lo = cfg.minRub, hi = cfg.maxRub;
  if (quote(hi).vubliTotal < needVub) return hi;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (quote(mid).vubliTotal >= needVub) hi = mid; else lo = mid + 1; }
  return lo;
}
```
Свойства, которые покрыть тестами: `vubliTotal` монотонно не убывает по `rub` (в том числе на границах 99→100, 499→500, 1999→2000, 4999→5000); `purchased + bonus === total`; `purchased ≤ rub × 10`; `quote` не принимает дроби, `NaN`, отрицательные, выход за мин/макс.

### 3.5 Приём «до следующего уровня»
В UI показывать подсказку: «Ещё 120 ₽ до курса 10,0 (без наценки)». Расчёт на клиенте по `tiers` из `GET /api/vubli/packages`, но итог всегда подтверждает сервер.

### 3.6 Опция KZT (P2, выключена)
CryptoBot умеет счета в `KZT` (в списке фиатных валют **[проверено]**). Чтобы включить: в конфиге добавить `rubPerUnit`/`vubPerUnit` для KZT (**владелец задаёт сам и обновляет вручную**; автокурс можно вывести из `getExchangeRates` (USDT→KZT и USDT→RUB), но это **[не проверено]** и не нужно для MVP), те же ступени пересчитать в тенге, `fiat='KZT'` в `createInvoice`, в записи платежа хранить `fiat` и сумму в этой валюте. Поле `rub` в таблице ниже тогда называется `fiat_amount`. Пока `PAY_CURRENCIES=RUB`, KZT на сервере отклоняется.

---

## 4. База данных (миграции с `down`; имена адаптируй под проект)

### 4.1 Платежи пополнения
```sql
-- up
CREATE TABLE vubli_topups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  provider           text NOT NULL DEFAULT 'cryptobot',
  network            text NOT NULL CHECK (network IN ('mainnet','testnet')),
  provider_invoice_id bigint,                          -- invoice_id из Crypto Pay; NULL, пока счёт не создан у провайдера
  provider_hash      text,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','expired','failed','manual_review','canceled')),
  fiat               text NOT NULL DEFAULT 'RUB',
  fiat_amount        numeric(14,2) NOT NULL CHECK (fiat_amount > 0),   -- «rub» в тексте раздела 3
  tier_id            text NOT NULL,
  rate_x1000         int  NOT NULL,                   -- 9600…10400 на момент создания
  rate_version       text NOT NULL,
  vubli_total        bigint NOT NULL CHECK (vubli_total > 0),
  vubli_purchased    bigint NOT NULL CHECK (vubli_purchased >= 0),
  vubli_bonus        bigint NOT NULL CHECK (vubli_bonus >= 0),
  CHECK (vubli_purchased + vubli_bonus = vubli_total),
  return_to          text NOT NULL DEFAULT 'shop' CHECK (return_to IN ('shop','bank')),
  invoice_url        text,                            -- bot_invoice_url
  mini_app_url       text,                            -- mini_app_invoice_url
  web_app_url        text,                            -- web_app_invoice_url
  expires_at         timestamptz NOT NULL,
  paid_at            timestamptz,
  paid_asset         text, paid_amount text, paid_usd_rate text,
  fee_asset          text, fee_amount  text,           -- для бухгалтерии (комиссия CryptoBot), не показывать клиенту
  idem_key           text NOT NULL,
  last_checked_at    timestamptz,                      -- последняя серверная сверка через getInvoices
  provider_payload   jsonb,                            -- урезанный ответ провайдера (без токена; без PII)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, network, provider_invoice_id),      -- NULL допустимы (несколько «ещё не созданных»)
  UNIQUE (user_id, idem_key)
);
CREATE INDEX vubli_topups_user ON vubli_topups (user_id, created_at DESC);
CREATE INDEX vubli_topups_pending ON vubli_topups (expires_at) WHERE status = 'pending';

-- журнал входящих вебхуков (только метаданные: для разборов, не для логики)
CREATE TABLE payment_webhook_log (
  id bigserial PRIMARY KEY, provider text NOT NULL, network text NOT NULL,
  provider_invoice_id bigint, update_id bigint, update_type text,
  signature_ok boolean NOT NULL, outcome text NOT NULL,     -- 'credited'|'duplicate'|'ignored'|'unknown_invoice'|'mismatch'|'bad_signature'|'stale_verified'
  created_at timestamptz NOT NULL DEFAULT now()
);

-- down
DROP TABLE payment_webhook_log; DROP TABLE vubli_topups;
```
Заметки: `UNIQUE (provider, network, provider_invoice_id)` — главная защита от двойного начисления одного счёта; `provider_invoice_id` в Crypto Pay — число **[проверено]** (`invoice_id (Number)`). `network` в ключе нужен, чтобы testnet-счета не пересеклись с mainnet, если базу делят. Сырые вебхуки целиком не храни (в `payload` счёта нет секретов, но не накапливай лишнее).

### 4.2 Журнал кошелька (из `CURSOR-SHOP-RU.md` 8.5, с видами операций пополнения)
```sql
-- up (если журнала ещё нет; если есть — добавь недостающие колонки/виды, ничего не удаляя)
CREATE TABLE wallet_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  kind        text NOT NULL CHECK (kind IN (
    'topup_cryptobot','topup_bonus','faucet','referral','achievement','game','transfer_in','transfer_out',
    'shop_premium','shop_vpn','shop_mega','shop_boost','shop_disk','shop_persona','shop_other',
    'ai_hold','ai_settle','ai_release','ai_refund','loan','loan_repay','adjust')),
  bucket      text NOT NULL CHECK (bucket IN ('purchased','earned','held','balance')),  -- 'balance' — пока флаг WALLET_SPLIT выключен
  amount      bigint NOT NULL,                      -- со знаком
  balance_after bigint,                              -- или purchased_after/earned_after при WALLET_SPLIT
  ref_type    text, ref_id text,                    -- 'topup' / vubli_topups.id ; 'sku' / код ; 'ai_hold' / uuid
  idem_key    text NOT NULL,                        -- для пополнения: 'cryptobot:<network>:<invoice_id>' (+':bonus')
  rate_version text,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, idem_key)                  -- одна операция — один раз
);
CREATE INDEX wallet_ledger_user ON wallet_ledger (user_id, created_at DESC);
-- down: DROP TABLE wallet_ledger;  (только если таблицу создавала эта миграция)
```
Старые записи банка (`note` свободным текстом) мигрировать в `kind` по `note` (`Прилавок`→`shop_other`, `Premium`→`shop_premium`, `VPN`, `Мегадиск`, `Кредит`, `Достижение`, `Змейка`/`Сапёр`→`game`, «От/Для {имя}»→`transfer_in/out`, остальное → `adjust`) — отдельным обратимым скриптом, `note` оставить как есть для показа.

### 4.3 Разделение кошелька (шаг за флагом `WALLET_SPLIT`, **после** того как пополнение уже работает)
```sql
ALTER TABLE wallet ADD COLUMN purchased bigint NOT NULL DEFAULT 0,
                   ADD COLUMN earned    bigint NOT NULL DEFAULT 0,
                   ADD COLUMN held      bigint NOT NULL DEFAULT 0;
ALTER TABLE wallet ADD CONSTRAINT wallet_nonneg CHECK (purchased >= 0 AND earned >= 0 AND held >= 0);
-- backfill: весь старый баланс → earned (происхождение неизвестно); balance := purchased + earned (поддерживать триггером или вычислять)
-- down: DROP CONSTRAINT wallet_nonneg; DROP COLUMN held, earned, purchased;
```
Порядок списания при покупке в магазине: сначала `earned`, потом `purchased` (так «купленное» сохраняется для PAYG). Переводы друзьям у получателя приходят в `earned`; путь `earned → purchased` закрыт. «Кредит в минус» — отдельное поле (`credit_debt`), в бакеты отрицательных значений не писать. Старый API баланса (`balance`) продолжает возвращать сумму — клиент 2.9.1 и текущий сайт не должны сломаться.

### 4.4 Функция начисления (одна для вебхука, polling-сверки и cron)
```ts
// server/pay/creditTopup.ts — вызывается ТОЛЬКО внутри транзакции с уже заблокированной строкой vubli_topups
export async function creditTopup(tx: Tx, row: TopupRow, inv: CryptoInvoice) {
  const key = `cryptobot:${row.network}:${row.provider_invoice_id}`;
  const split = flags.WALLET_SPLIT;
  // 1) основная часть
  await ledgerCredit(tx, { userId: row.user_id, kind: 'topup_cryptobot', bucket: split ? 'purchased' : 'balance',
    amount: row.vubli_purchased, idemKey: key, refType: 'topup', refId: row.id, rateVersion: row.rate_version });
  // 2) бонус (если есть)
  if (row.vubli_bonus > 0)
    await ledgerCredit(tx, { userId: row.user_id, kind: 'topup_bonus', bucket: split ? 'earned' : 'balance',
      amount: row.vubli_bonus, idemKey: key + ':bonus', refType: 'topup', refId: row.id, rateVersion: row.rate_version });
  await tx.exec(`UPDATE vubli_topups SET status='paid', paid_at=$2, paid_asset=$3, paid_amount=$4, paid_usd_rate=$5,
                 fee_asset=$6, fee_amount=$7, updated_at=now() WHERE id=$1`,
    [row.id, inv.paid_at ?? new Date(), inv.paid_asset, inv.paid_amount, inv.paid_usd_rate, inv.fee_asset, String(inv.fee_amount ?? '')]);
}
// ledgerCredit: INSERT … ON CONFLICT (user_id, kind, idem_key) DO NOTHING RETURNING id;
//   если строка вставилась → UPDATE wallet SET balance|purchased|earned = … + amount; если конфликт → ничего (повторное начисление невозможно).
```

---

## 5. Сервер: Crypto Pay

### 5.1 Тонкий клиент провайдера (`server/pay/cryptopay.ts`)
```ts
const BASE = process.env.CRYPTOPAY_NETWORK === 'testnet' ? 'https://testnet-pay.crypt.bot/api/' : 'https://pay.crypt.bot/api/';
async function call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 8000): Promise<T> {
  const token = process.env.CRYPTOPAY_TOKEN; if (!token) throw new PayError('not_configured');
  const res = await fetch(BASE + method, {
    method: 'POST',
    headers: { 'Crypto-Pay-API-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.ok !== true) throw new PayError('provider_error', { status: res.status, code: json?.error?.name ?? json?.error }); // токен и тело запроса в ошибку НЕ класть
  return json.result as T;
}
export const createInvoice = (p: CreateInvoiceParams) => call<CryptoInvoice>('createInvoice', p);
export const getInvoices   = async (ids: number[]) => {
  const r = await call<CryptoInvoice[] | { items: CryptoInvoice[] }>('getInvoices', { invoice_ids: ids.join(','), count: Math.min(ids.length, 1000) });
  return Array.isArray(r) ? r : r.items;   // форма ответа getInvoices: в документации «array of Invoice»; встречается вариант {items:[…]} — [не проверено], поддержаны оба
};
export const deleteInvoice = (id: number) => call<true>('deleteInvoice', { invoice_id: id });
```
Что **[проверено]** по документации: методы принимают GET и POST; параметры можно передавать query-строкой, `application/json`, `x-www-form-urlencoded` или `multipart`; ответ всегда `{ok: boolean, result|error}`; всё по HTTPS в UTF-8; суммы — строкой («125.50»), для денег использовать десятичную арифметику (Big.js/decimal.js), не `float`. `getMe` — проверка токена (используй в health-check админа, не на каждый запрос).

### 5.2 `createInvoice` — параметры для вубля
| Параметр | Значение | Статус |
|---|---|---|
| `currency_type` | `'fiat'` | проверено |
| `fiat` | `'RUB'` (`'KZT'` — опция) | проверено |
| `amount` | **строка**, например `'250.00'` (из `fiat_amount`, не из клиента) | проверено |
| `accepted_assets` | `'USDT,TON,BTC,ETH,LTC,TRX,USDC'` (в конфиге; по умолчанию — все; для testnet в доке ещё `JET`) | проверено |
| `description` | `«VVVion: 5 200 вублей»` (до 1024 символов; **видит покупатель**, без user id и почты) | проверено |
| `payload` | `String(topupId)` (до 4 КБ; **без** PII, только id нашей строки) | проверено |
| `expires_in` | `1800` секунд (30 мин; допустимо 1…2 678 400) | проверено |
| `paid_btn_name` / `paid_btn_url` | `'callback'` («Return») / `https://vvvion.space/?place=<return_to>&topup=<id>` (`https`/`http`) | проверено; но **возврат по ссылке не считается оплатой** |
| `allow_comments` | `false` | проверено |
| `allow_anonymous` | не задавать (по умолчанию `true`) | проверено |
| `hidden_message` | необязательно: «Вубли начислятся автоматически, это занимает до минуты» | проверено |
| `swap_to`, `swap_excluded_assets` | **не использовать** (авто-конвертация нам не нужна) | проверено |

В ответе (`Invoice`) нужны: `invoice_id` (Number), `hash`, `status` (`active|paid|expired`), `bot_invoice_url`, `mini_app_invoice_url`, `web_app_invoice_url`, `expiration_date`, `payload` **[проверено]**. `pay_url` устарел — **не использовать**. Заметка: поле `fee` и `usd_rate` в вебхуке тоже deprecated, использовать `fee_amount`/`fee_asset`/`paid_usd_rate` **[проверено]**.

### 5.3 `POST /api/vubli/topup` — создать счёт (**сервер**)
Вход: `{ rub: number /*целое*/, returnTo?: 'shop'|'bank', idempotencyKey: string(uuid) }`. Выход: `{ id, status:'pending', rub, vubli:{total,purchased,bonus}, tier:{id,label,bonusPct}, expiresAt, urls:{ bot, miniApp, web } }`.
Алгоритм:
1. Сессия обязательна (401). `CRYPTOPAY_ENABLED && PAY_TOPUP` иначе 503 `{code:'topup_disabled'}`.
2. `TOPUP_REQUIRE_VERIFIED` → 403 `{code:'email_not_verified'}` (клиент показывает «Подтвердить почту»).
3. Лимиты (раздел 10): ≤ 10 созданий за час, ≤ 3 активных `pending`, сумма за сутки ≤ `TOPUP_DAILY_MAX_RUB` → 429 `{code:'rate_limited'|'daily_cap'}`.
4. `quote(rub)` (раздел 3.4); иначе 400 `{code:'amount_out_of_range'}`.
5. **Идемпотентность:** по `(user_id, idem_key)` вернуть существующую строку без нового счёта. Если у пользователя уже есть активный `pending` с тем же `rub` и с `expires_at` > now()+5 мин — вернуть его же (не плодить счета).
6. В **одной короткой транзакции** вставить строку `pending` (с `rate_x1000`, `vubli_*`, `tier_id`, `rate_version`, `expires_at = now()+30 min`), закоммитить **до** вызова провайдера.
7. Вызвать `createInvoice` (таймаут 8 с). Успех → `UPDATE … SET provider_invoice_id, provider_hash, invoice_url, mini_app_url, web_app_url`. Сбой/таймаут → `status='failed'`, ответ 502 `{code:'provider_unavailable'}`. Если счёт мог создаться у провайдера, а ответ потерялся, он **осиротеет**: у него есть `payload=<id строки>`, сверка (5.6) найдёт его и, если он вдруг оплачен, начислит (см. 5.5, п. 5).
8. Вернуть клиенту ссылки. **Ничего секретного** (токен, hash внутренних записей) не возвращать.

### 5.4 `POST /api/webhooks/cryptopay/<CRYPTOPAY_WEBHOOK_SECRET>` — вебхук (**сервер**)
Что **[проверено]** по документации: Crypto Pay шлёт HTTPS POST с JSON `{update_id, update_type, request_date (ISO 8601), payload: Invoice}`; поддерживается `update_type = 'invoice_paid'`; подпись — заголовок `crypto-pay-api-signature` = hex HMAC-SHA-256 по **всему нераспарсенному телу** с ключом `SHA256(token)`; повторы: до 17 попыток за 3 дня (интервалы от 10 секунд до 8 часов); если на все попытки нет ответа, **вебхуки приложения автоматически отключаются** и владелец получает уведомление; сама документация советует секретный путь в URL.

Поэтому:
- **Всегда быстро отвечай 200**, кроме двух случаев: неверный путь (404) и неверная подпись (401). На «неизвестный счёт», «не наш `update_type`», «дубль» — 200 (иначе провайдер будет ретраить и в итоге отключит вебхуки).
- 5xx — только при временных сбоях нашей БД (пусть ретраит).
- Тяжёлое (письмо, push, перерасчёт аналитики) — **после** коммита, в фоне (`waitUntil` из `@vercel/functions` или очередь; **[не проверено]** точное имя API в вашей версии Vercel — сверь по документации), чтобы ответ ушёл за < 1–2 с.
```ts
// server/routes/webhooks.cryptopay.ts   (путь: /api/webhooks/cryptopay/:secret)
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(rawBody: string, header: string | null, token: string): boolean {
  if (!header) return false;
  const key  = createHash('sha256').update(token).digest();                 // ключ = SHA256(token), бинарный
  const calc = createHmac('sha256', key).update(rawBody, 'utf8').digest();  // HMAC по СЫРОМУ телу
  const got  = Buffer.from(header.trim(), 'hex');
  return got.length === calc.length && timingSafeEqual(got, calc);          // сравнение за постоянное время
}

export async function POST(req: Request, { params }: { params: { secret: string } }) {
  const expect = process.env.CRYPTOPAY_WEBHOOK_SECRET ?? '';
  if (!expect || !safeEq(params.secret, expect)) return new Response(null, { status: 404 });
  const raw = await req.text();                                             // ДО любого JSON.parse; не использовать JSON.stringify(parsed) для подписи
  const sigOk = verifySignature(raw, req.headers.get('crypto-pay-api-signature'), process.env.CRYPTOPAY_TOKEN!);
  if (!sigOk) { await wlog({ signature_ok: false, outcome: 'bad_signature' }); return new Response(null, { status: 401 }); }
  let upd: CryptoPayUpdate; try { upd = JSON.parse(raw); } catch { return new Response(null, { status: 200 }); }
  if (upd.update_type !== 'invoice_paid' || upd.payload?.status !== 'paid') return ok();   // игнор остального, но 200
  let inv = upd.payload;
  const stale = Math.abs(Date.now() - Date.parse(upd.request_date)) > 10 * 60_000;     // «старый» (или без даты) → телу не верим
  if (stale || Number.isNaN(Date.parse(upd.request_date))) {
    const [fresh] = await getInvoices([inv.invoice_id]).catch(() => []);              // факт — только из ответа провайдера
    if (!fresh) return new Response(null, { status: 503 });                            // временный сбой → пусть ретраит
    inv = fresh;
  }
  const outcome = await settleInvoiceFromProvider(inv, { source: stale ? 'webhook_stale' : 'webhook' });   // outcome 'credited' пишем как 'stale_verified' в wlog
  await wlog({ signature_ok: true, update_id: upd.update_id, provider_invoice_id: upd.payload.invoice_id, outcome });
  return ok();   // 200 и пустое тело
}
```
Свежесть `request_date`: документация советует «дополнительно проверить `request_date`, чтобы не использовать устаревшие данные» **[проверено]**, но при повторах (до 3 суток) неизвестно, обновляется ли `request_date` при каждой попытке **[не проверено]**. Поэтому **не отбрасывай** «старые» вебхуки молча (потеряешь реальную оплату). Правило: если `|now − request_date| > 10 мин`, **не доверяй телу**: возьми факт из `getInvoices([invoice_id])` и начисляй только если провайдер сам ответил `status:'paid'` (`outcome='stale_verified'`). Для свежих вебхуков достаточно подписи.

### 5.5 Единая процедура `settleInvoiceFromProvider` (вебхук, polling, cron вызывают её)
```ts
export async function settleInvoiceFromProvider(inv: CryptoInvoice, ctx: Ctx): Promise<Outcome> {
  const network = process.env.CRYPTOPAY_NETWORK as Network;
  return db.tx(async (tx) => {
    // 1) найти и ЗАБЛОКИРОВАТЬ строку
    let row = await tx.one(`SELECT * FROM vubli_topups WHERE provider='cryptobot' AND network=$1 AND provider_invoice_id=$2 FOR UPDATE`, [network, inv.invoice_id]);
    if (!row && isUuid(inv.payload)) {     // осиротевший счёт: связываем по payload (id нашей строки); не-UUID в WHERE нельзя — Postgres бросит ошибку → 5xx → ретраи и отключение вебхуков
      row = await tx.one(`SELECT * FROM vubli_topups WHERE id=$1 AND network=$2 FOR UPDATE`, [inv.payload, network]);
      if (row && !row.provider_invoice_id) await tx.exec(`UPDATE vubli_topups SET provider_invoice_id=$2, provider_hash=$3 WHERE id=$1`, [row.id, inv.invoice_id, inv.hash]);
    }
    if (!row) return 'unknown_invoice';                          // 200, алерт владельцу (счёт не из нашей базы)
    if (row.status === 'paid') return 'duplicate';               // идемпотентность
    // 2) статус и сверка суммы/валюты (деньги пришли — но то ли мы выставляли?)
    if (inv.status === 'expired') { await tx.exec(`UPDATE vubli_topups SET status='expired', updated_at=now() WHERE id=$1 AND status='pending'`, [row.id]); return 'ignored'; }
    if (inv.status !== 'paid') return 'ignored';
    const sameCur = inv.currency_type === 'fiat' && inv.fiat === row.fiat;
    const sameAmt = new Decimal(inv.amount).equals(new Decimal(row.fiat_amount));
    if (!sameCur || !sameAmt) { await tx.exec(`UPDATE vubli_topups SET status='manual_review', provider_payload=$2 WHERE id=$1`, [row.id, redact(inv)]); await alertOwner('topup mismatch', row.id); return 'mismatch'; }
    // 3) начислить по СОХРАНЁННОМУ курсу (ничего не пересчитываем)
    await creditTopup(tx, row, inv);
    return 'credited';
  }).then(async (o) => { if (o === 'credited') queueAfterCommit(() => notifyTopup(inv)); return o; });
}
```
Заметки:
- Статусы `failed`/`expired`/`canceled` у нас **не блокируют** начисление, если провайдер подтвердил `paid` и сумма совпала: деньги получены — вубли выданы.
- `expired` у провайдера и `paid` у нас (повторная доставка) — просто `duplicate`.
- Блокировка строки (`FOR UPDATE`) + `UNIQUE (user_id, kind, idem_key)` в журнале — двойная защита от гонки «вебхук и polling пришли одновременно».
- Не принимай количество вублей, `user_id` или сумму из тела вебхука: берёшь только `invoice_id`/`payload` → строку из своей БД.

### 5.6 Статус и сверка
**`GET /api/vubli/topup/:id`** (сессия; только своя запись, чужая → 404): `{ id, status, rub, vubli:{total,purchased,bonus}, expiresAt, paidAt?, balance? }`. Если `status='pending'`, провайдер уже создан и `last_checked_at` старше 5 с — сделать **одну** серверную сверку: `getInvoices([id])` → `settleInvoiceFromProvider` (так пользователь получает вубли быстро, даже если вебхук задерживается). Защита от шторма: сверка не чаще раза в 5 с на строку (`UPDATE … WHERE last_checked_at < now()-interval '5 s' RETURNING`), ответ по-прежнему из БД.

**`GET /api/vubli/topups`** (последние 20 своих платежей для Банка): `{items:[{id,status,rub,vubliTotal,createdAt}]}`.

**Cron `GET /api/cron/cryptopay-reconcile`** (**сервер**, раз в 5 минут; защита `Authorization: Bearer ${CRON_SECRET}`, иначе 401): 
1. Выбрать `status='pending' AND provider_invoice_id IS NOT NULL AND created_at > now()-interval '3 days'` порциями ≤ 100 → `getInvoices(ids)` → для каждой `settleInvoiceFromProvider`.
2. `pending` с `expires_at < now()-interval '10 min'`, которые провайдер вернул как `expired` → `expired`; которые провайдер не вернул вовсе — оставить `pending` и отметить в логе (**не** помечать `failed`).
3. Строки `pending` **без** `provider_invoice_id` старше 15 минут → `failed` (счёт не создавался; если он всё же есть у провайдера — п. 5 процедуры 5.5 подхватит оплату по `payload`).
4. Раз в сутки: `getInvoices({status:'paid', count:100})` за последние сутки и сверка с БД — любой `paid`, которого нет в `vubli_topups` как `paid`, → `settle…` или алерт (ловит потерянные вебхуки/осиротевшие счета).
5. Алерт владельцу (лог + письмо/уведомление админу), если: подпись не прошла > 5 раз за час, есть `manual_review`, есть `paid` у провайдера без записи у нас, вебхуки отключены (признак: в 24 ч нет ни одного вебхука при наличии `pending`-оплат, которые закрыла только сверка).
Cron на Vercel: расписание в `vercel.json` (`{"crons":[{"path":"/api/cron/cryptopay-reconcile","schedule":"*/5 * * * *"}]}`). **[не проверено]**: на бесплатном тарифе Vercel частота cron-задач ограничена (раньше — раз в сутки); если так, опирайся на (а) серверную сверку внутри `GET /api/vubli/topup/:id` и (б) внешний планировщик, дергающий тот же эндпоинт с `CRON_SECRET`.

### 5.7 Отмена и истечение
Счёт истекает у провайдера сам через `expires_in`. Кнопка «Отменить счёт» в UI — необязательна: если делаешь, `POST /api/vubli/topup/:id/cancel` → `status='canceled'` и `deleteInvoice(invoice_id)` **[проверено: метод есть]**; если оплата всё же пришла — раздел 5.5 (начислить).

### 5.8 Публичный каталог курса: `GET /api/vubli/packages`
Без сессии допустимо (там нет персональных данных). Ответ:
```json
{ "baseVubPerRub": 10, "currency": "RUB", "rateVersion": "2026-11-v1", "minRub": 50, "maxRub": 50000,
  "tiers": [ {"id":"xs","fromRub":0,"vubPerRub":9.6,"bonusPct":-4,"label":"малый платёж −4 %"}, … ],
  "presets": [ {"rub":50,"vubli":480,"bonusPct":-4,"label":"малый платёж −4 %"}, … {"rub":5000,"vubli":52000,"bonusPct":4,"label":"+4 % бонус","popular":true} ] }
```
и `GET /api/vubli/quote?rub=1234` | `?needVub=310` → `quote(...)` / `{rub: minRubForVub(310), …quote}`. Это нужно для «Не хватает N вуб · Пополнить». Клиент **не считает** курс сам, кроме предпросмотра по `tiers`; финал — ответ сервера.

---

## 6. Клиент: поток пополнения (**сайт**, за флагом `PAY_TOPUP`)

### 6.1 Где живёт кнопка
- **Шапка Магазина**: закреплённая пилюля баланса «190 вуб · ≈ 19 ₽» + кнопка **«Пополнить»** (раздел 7.3).
- **Банк** (`/?place=bank`): блок «Пополнить вубли» рядом с балансом + «История пополнений» (`GET /api/vubli/topups`).
- **Любая карточка товара** с нехваткой: «Не хватает 310 вуб · Пополнить» → открывает лист с предзаполненным платежом `minRubForVub(shortfall)` (через `GET /api/vubli/quote?needVub=`).
- **Лимит ИИ исчерпан** (раздел 9): «Нужно ≈ 3 вуб · Пополнить».
Один компонент `TopupSheet` на всех, открывается через `openTopup({ minVub?, returnTo, onPaid? })`. После успеха `onPaid` возвращает пользователя туда, откуда он пришёл (например, в лист покупки того же товара).

### 6.2 Лист «Пополнить вубли» (`TopupSheet`)
Через `BottomSheet`/портал (как в чат-2 §2), слой «Назад» — `pushBackLayer(close)` и `Esc`; фокус на первом пресете; на ПК — модалка шириной 440.
```
Пополнить вубли                                  ✕
Баланс: 190 вуб

[ 50 ₽ ]   [ 100 ₽ ]  [ 300 ₽ ]  [ 500 ₽ ]       ← сетка 2 колонки (мобильный) / 4 (ПК), tap ≥ 44
 480 вуб    980 вуб    2 940 вуб   5 000 вуб
 −4 %       −2 %                                    ← «малый платёж», приглушённо (--faint)
[ 1 000 ₽ ] [ 2 500 ₽ ] [ 5 000 ₽ ★ ] [ 10 000 ₽ ]
 10 000     25 500      52 000        104 000
            +2 % бонус  +4 % бонус    +4 % бонус     ← акцентным цветом

Своя сумма: [ 1 234 ] ₽        → вы получите 12 340 вуб
Ещё 766 ₽ до курса +2 %                              ← подсказка следующей ступени

Оплата криптовалютой через CryptoBot (USDT, TON, BTC и др.). Счёт выставляется в рублях.
Вубли — внутренняя единица сервиса: не обмениваются на деньги и не возвращаются.   [Оферта]

[ Оплатить через CryptoBot ]            ← primary, h-11, disabled при ошибке суммы / запросе
```
- Подписи ступеней — из `label` ответа `GET /api/vubli/packages`. Отрицательную ступень показывать **спокойно** («малый платёж −4 %», цвет `--faint`), не красным; положительную — «+4 % бонус» акцентным цветом. Не писать «скидка»/«штраф».
- Поле суммы: `inputMode="numeric"`, только цифры, `min/max` из `packages`; вне диапазона — «От 50 до 50 000 ₽».
- Цены товаров остаются в вублях, «≈ ₽» везде по базе 10 вуб/₽ (`fmtRub`), с пометкой в оферте: «≈ — ориентировочно, фактический курс пополнения зависит от суммы».

### 6.3 Шаги и состояния
| Состояние | Что видит пользователь |
|---|---|
| `choose` | выбор суммы (6.2) |
| `creating` | кнопка со спиннером; повторные клики заблокированы; `idempotencyKey = crypto.randomUUID()` генерируется **один раз** на показ листа и переиспользуется при повторе |
| `invoice` | «Счёт на 250 ₽ создан. Оплатите в CryptoBot и вернитесь сюда.» + большая кнопка **«Открыть CryptoBot»**, ссылки «Открыть в Mini App» и «Оплатить в браузере» (для тех, у кого нет Telegram), таймер «Действует ещё 28:41», статус «Ждём оплату…» |
| `confirming` | вернулись на вкладку: «Проверяем оплату…» (спиннер) |
| `paid` | экран «Готово: +5 200 вуб», новый баланс, хаптик `success`, кнопки «Продолжить покупки» / «Закрыть» (если был `onPaid` — выполнить) |
| `expired` | «Счёт истёк. Платёж не списан.» + «Создать новый» |
| `error` | `topup_disabled` → «Пополнение временно недоступно»; `email_not_verified` → «Подтвердите почту» (кнопка-действие); `rate_limited`/`daily_cap` → «Слишком много попыток, попробуйте позже»; `provider_unavailable` → «CryptoBot сейчас не отвечает, попробуйте через минуту» |
Успех показывать **только** когда `GET /api/vubli/topup/:id` вернул `status:'paid'`. Ни `?topup=` в URL, ни возврат из Telegram сами по себе оплатой не считаются.

### 6.4 Открытие счёта и возврат (в браузере и в приложении)
```tsx
// src/features/topup/openInvoice.ts
export function openInvoice(url: string) {
  const app = (window as any).VvvionApp;
  if (app?.has?.('openExternal')) return app.openExternal(url);    // нового метода в 2.9.1 нет — пригодится в 2.9.2 (раздел 12)
  if (app?.isApp) { window.location.assign(url); return; }          // APK 2.9.1: навигация на чужой https уходит в ACTION_VIEW, страница остаётся на месте
  window.open(url, '_blank', 'noopener,noreferrer');                // браузер; вызывать ТОЛЬКО из обработчика клика (иначе блокировщик всплывающих окон)
}
```
- В состоянии `invoice` кнопка «Открыть CryptoBot» — это обычная ссылка `<a href={urls.bot} target="_blank" rel="noopener noreferrer">`: клик пользователя = жест, popup-блокер молчит, на телефоне ссылка `t.me/CryptoBot?start=…` открывает приложение Telegram. **Не** вызывай `window.open` после `await fetch` без жеста: браузер его заблокирует. Поэтому поток двухшаговый: сначала создаём счёт, затем пользователь жмёт «Открыть CryptoBot».
- **Определи, что вернулись:** слушай `visibilitychange` (→ `visible`), `focus`, `pageshow`, и (если приложение 2.9.2+) событие `vvvion-app-resume`; на любое из них сразу опрашивай статус. Параллельно — таймер опроса: каждые 3 с первые 60 с, затем каждые 10 с до `expiresAt`; после терминального статуса — остановить. Опрос должен пережить сворачивание: при старте экрана Банка/Магазина проверяй `localStorage['vv_topup_pending']` (id последнего `pending`) и, если он есть и не истёк, мягко покажи «Платёж обрабатывается…» и опроси статус.
- Параметр `?topup=<id>` в URL (из кнопки возврата CryptoBot `paid_btn_url`, (кнопка возврата `paid_btn_name`/`paid_btn_url` **[проверено]**; сам параметр `topup` — наш)) открывает Магазин/Банк на листе со статусом этого платежа и тоже просто запускает опрос. Он **не** маркер успеха. Учти: возврат по ссылке `https://vvvion.space/…` из Telegram откроется в браузере или (после починки `assetlinks.json`) в приложении — на это не рассчитывай, главный механизм — опрос.
- Не забудь `aria-live="polite"` на строке статуса.

### 6.5 Клиентские мелочи
- После `paid`: инвалидируй запросы баланса и каталога (`ownedUntil`, `insufficient`), кнопки меняются без перезагрузки.
- Любые тексты — в `ru/en/kk` (хотя бы `ru` ключами i18n; остальное — S-P2-3).
- Не показывай клиенту `provider_invoice_id`, `fee_*`, `rate_x1000`.
- `idempotencyKey` для `POST /api/vubli/topup` — на показ листа, **не** на каждое нажатие.

---

## 7. Магазин: логика и дизайн (сжатый план из `CURSOR-SHOP-RU.md`)

### 7.1 Что сейчас (измерено, по API, по коду; 390×844 и 1440×900, аккаунт B)
Маршрут `/?place=shop`: 5 серверных функций (Premium, VPN, Мегадиск, баланс, персонажи) грузятся параллельно; ошибка → «Магазин сейчас закрыт». Экран: шапка «‹ Магазин» → «На карте 190 вублей» → Premium → VPN → Мегадиск → «+100 Сутки подлиннее» → «+100 Место на диске» → плитка «Персонажи» (17). Колонка 720 px (карточки 696), на ПК пустота по бокам.
Цены (по API, 11.11.2026): Premium 2 500 вуб (30 дн.: лимит ×2, +500 МБ, все персонажи, сиреневая рамка); VPN 2 000 (30 дн., 100 ГБ, 3 локации); Мегадиск 1 500 (30 дн., 2 ГБ); «Сутки подлиннее» 1 000 (+100 запросов на 24 ч); «Место на диске» 1 000 (+100 МБ навсегда); персонажи 500…1 500 (все 17 = 12 900).
Как вубли берутся: «Забрать 100» раз в сутки (≈ 3 000 вуб/мес = 300 ₽/мес бесплатно), приглашения 1 000 вуб, достижения, игры, переводы, «Кредит». **Купить вубли за деньги сейчас нельзя.**

### 7.2 Проблемы (S-N) и приоритет
| № | Проблема | Приор. |
|---|---|---|
| S-1 | У неподтверждённой почты вместо цены серая кнопка «Сначала подтвердите почту», без ссылки «подтвердить» | P0 |
| S-2 | Покупка подтверждается `window.confirm` (7 мест); в APK это серое стоковое окно | P0 |
| S-3 | Нет «Пополнить вубли» ни в магазине, ни в банке | P0 |
| S-4 | Нет состояния «не хватает N вуб»; ошибка приходит тостом после нажатия | P0 |
| S-15 | Серверная идемпотентность и атомарность покупок не подтверждены **[проверить]** | P0 |
| S-5 | Лимит ИИ не продаётся в момент нужды (только тост) | P0 (с PAYG) |
| S-6 | Цены противоречат: +100 МБ навсегда ≈ 14× дороже за МБ, чем Мегадиск 2 ГБ/мес; 17 персонажей = 1 290 ₽, Premium (250 ₽) открывает все | P1 |
| S-7/S-8 | Плоская структура без разделов; персонажи — плоский список из 17 без превью, две стрелки «назад» подряд | P1 |
| S-9 | ПК: узкая колонка 720, нет сетки | P1 |
| S-10/S-11 | Устаревшие подписи («Прилавок», «лавка банка»); журнал без `kind` | P1 |
| S-12, S-13, S-14 | i18n магазина; hover/focus; Premium продаётся двумя разными компонентами | P2 |

### 7.3 Структура (IA)
Горизонтальные чипы разделов (`role="tablist"`, snap-x): **Главное · Подписки · ИИ · Хранилище · Оформление · Подарки**.
- **Главное**: «Рекомендуем» (Premium, если нет; «Продлить», если скоро кончится), «Ваши покупки» (что действует до какого числа), «Пополнить вубли», «Бесплатные вубли» (ссылка в Банк: «Забрать 100», «Пригласить»).
- **Подписки**: Premium (позже Premium Plus), VPN, Мегадиск.
- **ИИ**: «Ответы сверх лимита» (PAYG-переключатель и потолок), пакеты ответов, картинки, персонажи (17).
- **Хранилище**: диск навсегда (лестница), докупка к Мегадиску.
- **Оформление**: рамки, значки/цвет ника, фон чата, «лица» ассистента, звуки, стикеры.
- **Подарки**: «Подарить Premium», подарочный код, промокод.
Шапка (sticky): `💰 190 вуб · ≈ 19 ₽   [ Пополнить ]`. Deep link `/?place=shop` не ломать; раздел — `?place=shop&s=ai` через `replaceState` (как вкладки Круга). Колонка на ПК 960 вместо 720, сетка `grid-cols-[repeat(auto-fill,minmax(260px,1fr))]`.

Макет мобильный 390:
```
‹  Магазин                              (○)
┌──────────────────────────────────────────┐
│ 💰 190 вуб · ≈ 19 ₽        [ Пополнить ] │  sticky
└──────────────────────────────────────────┘
 Главное  Подписки  ИИ  Хранилище  Оформление  Подарки
┌──────────────────────────────────────────┐
│ РЕКОМЕНДУЕМ                              │
│ VVVION PREMIUM · 30 дней      2 500 вуб  │
│ Лимит ×2 · +500 МБ · все персонажи       │
│ экономит 12 900 вуб на персонажах        │
│ [ Открыть за 2 500 вуб ]                 │
└──────────────────────────────────────────┘
 ВАШИ ПОКУПКИ        (пусто → «Пока ничего»)
 ИИ-ответы сверх лимита      [ выкл ⬤ ]  потолок 300/мес
 ┌ Пакет +100 ответов ┐ ┌ Картинки ×10 ┐   2 колонки для расходников
```

### 7.4 Единая карточка `ShopCard` (вместо шести ad-hoc блоков)
Состояния: `default`, `owned` («Куплен»), `viaPremium` («В Premium»), `activeUntil` («Действует до 11 дек.»), `lockedEmail` («Подтвердить почту» — **кнопка-действие**, цена остаётся видна), `insufficient` («Не хватает 310 вуб · Пополнить»), `loading`, `error`.
```tsx
export const fmtVub = (n: number) => n.toLocaleString('ru-RU') + ' вуб';
export const fmtRub = (n: number) => '≈ ' + Math.round(n / 10).toLocaleString('ru-RU') + ' ₽';   // база 10 вуб/₽ (ориентир)
export function PriceLine({ vub }: { vub: number }) {
  return <p className="font-serif text-lg tabular-nums">{fmtVub(vub)} <span className="text-xs text-faint">{fmtRub(vub)}</span></p>;
}
function ShopCtaButton({ item, balance, verified }: Props) {
  const short = Math.max(0, item.price - balance.total);
  if (!verified) return <button className="press h-11 w-full rounded-2xl border border-line-strong text-sm" onClick={sendVerification}>Подтвердить почту</button>;
  if (short)     return <button className="press h-11 w-full rounded-2xl border border-line-strong text-sm" onClick={() => openTopup({ minVub: short, returnTo: 'shop', onPaid: () => openPurchase(item) })}>Не хватает {short} вуб · Пополнить</button>;
  return <button className="press h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg" disabled={busy} onClick={() => openPurchase(item)}>Купить за {item.price} вуб</button>;
}
```
`sendVerification` — существующий механизм верификации почты `better-auth` (`sendVerificationEmail`) **[проверить]** как он вызван в проекте.

### 7.5 `PurchaseSheet` вместо `window.confirm`
Один компонент через `BottomSheet`: заголовок «Подтвердить покупку», название и результат («Подписка продлится на 30 дней до 11 дек.»), строки «Баланс сейчас 3 200 → после 700», кнопки «Купить за 2 500 вуб» / «Отмена». Фокус на «Отмена», `Esc` и системная «Назад» (`pushBackLayer`) закрывают. После успеха — экран «Готово» с тем, что делать дальше («Ссылка VPN — в Сервисах») и `haptic('success')`. Ошибки по `code`: `insufficient_vubli` → «Не хватает N вуб» + «Пополнить»; `email_not_verified`; `idempotency_conflict`; «Сервер занят».
```tsx
async function confirmPurchase(p: { sku: string; title: string; price: number; result: string }) {
  const key = purchaseKeyRef.current ??= crypto.randomUUID();    // один ключ на одно подтверждение
  setBusy(true);
  try { const r = await buy({ data: { sku: p.sku, idempotencyKey: key } }); setDone(r); hapticSafe('success'); }
  catch (e) { setError(humanize(e)); hapticSafe('error'); }
  finally { setBusy(false); }
}
const hapticSafe = (t: string) => (window as any).VvvionApp?.haptic?.(t);
```

### 7.6 Серверный вход покупок
`POST /api/shop/purchase` `{sku, idempotencyKey}` — единый вход (старые 6 серверных функций остаются обёртками). `GET /api/shop/catalog` → `sku, kind, title, price, durationDays, ownedUntil, viaPremium, requiresVerified, section`. Цена, срок и тип — **только** из каталога на сервере по `sku`. Ошибки `{code,message}`: `insufficient_vubli` (402), `email_not_verified` (403), `idempotency_conflict` (409), `limit_reached` (429), `payg_cap_reached` (402), `model_unavailable` (503).
```ts
await tx.exec(`UPDATE wallet SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1`, [price, userId]);   // без «прочитал → проверил → записал»
// при WALLET_SPLIT: сначала earned, затем purchased, обе проверки в одном UPDATE с CHECK-ограничениями
// затем INSERT в wallet_ledger (kind='shop_*', idem_key) ON CONFLICT DO NOTHING; выдача товара — в той же транзакции
```

### 7.7 План работ P0 → P2 с критериями приёмки
**Подготовка (W-0):** найди ORM/миграции, реальные таблицы кошелька, серверные функции магазина, место, где считается баланс; напиши в PR-описании, что нашёл. Включи флаги только локально.

**P0 (в таком порядке)**
| № | Что | Критерии приёмки |
|---|---|---|
| **W-1** | Журнал кошелька + `kind` (4.2), `creditTopup`/`ledgerCredit` | миграция up/down прогоняется на копии; повторный `ledgerCredit` с тем же `idem_key` не меняет баланс |
| **S-P0-4** | Идемпотентность и атомарность текущих покупок (7.6) | 20 параллельных запросов на покупку при балансе на одну → ровно 1 успех, баланс ≥ 0; повтор с тем же ключом → тот же ответ без нового списания |
| **P-1** | Клиент провайдера, `/api/vubli/packages`, `/quote`, конфиг курса (3, 5.1, 5.8) | юнит-тесты таблицы курса зелёные; без токена `POST /topup` → 503 |
| **P-2** | `POST /api/vubli/topup`, вебхук, `settle…`, статус, cron (5.3–5.7) | раздел 11, тесты 1–10; поддельный вебхук не начисляет; дубль не начисляет; testnet-платёж начисляет ровно `vubli_total` один раз |
| **P-3** | `TopupSheet` и поток возврата (6) за флагом `PAY_TOPUP` | оплата на testnet из браузера и из APK 2.9.1 (на устройстве — Гик), «Готово» только по `paid` |
| **S-P0-1** | Цена всегда видна, «Подтвердить почту» вместо серой заглушки (`rg -n "Сначала подтвердите почту"`: 3 места в магазине, 1 в Premium настроек) | у неподтверждённого аккаунта видны цены; кнопка ведёт к подтверждению; после подтверждения возвращает на тот же товар |
| **S-P0-2** | Пилюля баланса и «Пополнить», состояние «Не хватает N вуб · Пополнить» | при балансе 190 любая позиция дороже показывает «Не хватает …»; после пополнения кнопка меняется без перезагрузки |
| **S-P0-3** | `PurchaseSheet` вместо `window.confirm` (`rg -n "window.confirm" src/`: Premium, VPN, Мегадиск, +запросы, +диск, персонаж; Настройки: Premium) | в магазине и настройках нет `window.confirm`; «баланс до → после»; `Esc`/«Назад» закрывают без списания; фокус на «Отмена» |

**P1**
| № | Что | Приёмка |
|---|---|---|
| **S-P1-1** | Разделы + `ShopCard` (7.3–7.4); `?place=shop&s=<section>`; колонка 960 на ≥ 1024 | разделы переключаются, URL восстанавливает раздел; на 1440 — сетка 2–3 колонки; tap ≥ 44 (мобильный), ≥ 40 (ПК) |
| **S-P1-2** | Персонажи: лист с превью и примером ответа, «Все 17 навсегда» (предложение 7 000 вуб вместо 12 900), сегменты «Все / Куплены / В Premium»; убрать вторую стрелку «назад» (подэкран через `pushBackLayer`/`vvNest`, не `useState`) | одна стрелка «назад»; «Назад» из подэкрана ведёт в магазин, а не из Круга |
| **S-P1-3** | Выровнять цены (раздел 8.1) — **только после решения владельца**; подписи «Прилавок/лавка банка» → «Магазин»; журнал показывает «Магазин · …» по `kind`; старые записи мигрированы | нигде нет слов «Прилавок»/«лавка банка» |
| **S-P1-4** | «Ваши покупки / Действует до» в «Главное»; баннер за 3 дня до конца подписки | сводка совпадает с сервером |
| **W-2** | Разделение кошелька `purchased/earned` (4.3) за `WALLET_SPLIT` | переводы друзьям не создают `purchased`; старый API баланса возвращает сумму; бэкап и откат проверены |

**P2**: новые товары (раздел 8) по приоритету 8.1 → 8.3; промокоды и подарки (8.4); i18n магазина (S-12); один `PremiumCard` в магазине и настройках (S-14); hover/focus-кольцо 2 px (S-13), `aria-live="polite"` на баланс, `aria-busy` на кнопках; авто-продление из баланса (опция); KZT (3.6); `prefers-reduced-motion` / `html.vv-reduce-motion` в листах.

### 7.8 Сквозной дизайн-патч
Подпись раздела `МАГАЗИН 12 px caps` оставить; заголовки карточек 16/24 `font-medium`; цена `font-serif text-lg tabular-nums` справа в строке; описания `text-xs` → `text-[13px] text-muted`; Premium-карточка с сиреневой шапкой (`color-mix(in oklab,#6e5ad6 22%, var(--elev))`), строкой «Экономит …» и 4 пунктами «что внутри» — один компонент для магазина и настроек; вместо текстового «+100» иконки lucide (`HardDrive`, `Zap`, `Sparkles`, `Coins` для «Пополнить»).

---

## 8. Новые платные товары (**предложения** владельца; цены — примеры, подгони под себестоимость)

Принцип: то, что стоит реальных денег (ИИ, VPN-трафик, диск), продаём по цене с запасом; то, что почти ничего не стоит (оформление, значки, стикеры), — чистая маржа и лучший первый товар новичка. Все цены — в одной серверной таблице каталога (`sku → price`), включаются флагом `SHOP_V2` по одному товару (`enabled`).

### 8.1 Лестница цен (S-6)
| Единица | Сейчас | Предложение |
|---|---|---|
| Диск навсегда | 100 МБ = 1 000 вуб | 100 МБ — 400; 500 МБ — 1 500; 1 ГБ — 2 500 |
| Диск в месяц | Мегадиск 2 ГБ = 1 500 | оставить; докупка «+1 ГБ на 30 дней» = 600 |
| Ответы ИИ | +100 ответов / 24 ч = 1 000 | основной механикой станет PAYG (раздел 9); пакет оставить как «дорогой запасной путь» или удешевить до ~300 |
| Персонажи | 500–1 500 за штуку | оставить, добавить «Все 17 навсегда» ≈ 7 000 (−46 %) и подпись «Premium покрывает» |

### 8.2 Высокий приоритет
| Позиция | Цена, вуб (≈ ₽) | Что это |
|---|---:|---|
| **Ответы сверх лимита (PAYG)** | по тарифу, 1–100/ответ | раздел 9; убирает тупик «лимит кончился» |
| **Premium Plus** | 6 000 (600 ₽) / 30 дн. | лимит ×4, умные модели N ответов/день, 5 ГБ диска, VPN в комплекте, значок (цена обязана покрывать VPN и ИИ) |
| **Premium на 12 мес.** | 24 000 (2 400 ₽) | −20 % к 12×2 500, деньги вперёд |
| **Диск навсегда (лестница)** | 400 / 1 500 / 2 500 | замена одной позиции |
| **Рамка аватара** | 400 за цвет; 4 цвета — 1 200 | как сиреневая у Premium, но для всех; золотая только у админа |
| **Значок/цвет ника в Круге** | 500 | косметика профиля |

### 8.3 Средний приоритет
Наборы стикеров 300–500 (позже «создать свой» 800); фоны чата 400 / «лица» ассистента 300 / пак звуков 200; картинки ИИ ×10 за 300–600 (по себестоимости); озвучка ответов 1 вуб/ответ или 200 за 7 дней; поиск в сети+ 2 вуб/запрос; VPN +100 ГБ трафика 800; VPN на 90 дней 5 100 (−15 %); Мегадиск +1 ГБ на 30 дн. 600; подъём записи в Ленте на 24 ч 200; закрепить запись на 7 дн. 500; «Все 17 персонажей навсегда» 7 000; аренда персонажа на 7 дн. 150. **Идеи на потом (нужна проверка продукта):** лимит файла в чате 200 МБ → 1 ГБ на 30 дней (~600); «большая группа» (**[проверить]** есть ли лимит участников); скины и «второй шанс» в играх; платные функции Читальни — после метрик.

### 8.4 Подарки и промокоды
- **Подарок Premium** (2 500): одноразовый код/ссылка, получатель активирует; вубли дарящему не возвращаются. Приложение: `VvvionApp.share({title,text,url})` под `has('share')`.
- **Промокод:** `promo_codes(code, kind, value, max_uses, used_count, expires_at)`; ввод в «Главное»; активация — транзакция, один код на пользователя.
- **Первое пополнение:** бонус «+20 % вублей, один раз на аккаунт» — **необязательный** поверх таблицы курса (раздел 3), по умолчанию выключен; если включить — бонус идёт в `earned` и пишется как `topup_bonus`.

### 8.5 Что чинить в чужих местах
Подписи в Настройках («Они продаются в **лавке банка**») → «в Магазине»; журнал банка — вместо «Прилавок» «Магазин · Premium» по `kind`.

---

## 9. ИИ pay-as-you-go сверх лимита — списание **только с купленных** вублей (`AI_PAYG`)

### 9.1 Вывод и условия
**Да, можно**, данные для этого есть: события SSE `usage` (`prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `total_tokens`), `limit`, `GET /api/chat` → `{limited, remaining, used}`.
1. **Дневной лимит должен быть включён** админом («Запросов в сутки»/«Токенов в сутки»). У тестового аккаунта он не задан (`limited:false`) — без лимита «сверх лимита» не наступает. Лимит, судя по форме админки, общий для всех **[проверить]**.
2. **PAYG тратит только `purchased`** (вариант A, `WALLET_SPLIT` включён). Иначе бесплатный кран (≈ 3 000 вуб/мес) и приглашения оплачивают счета провайдера. Бонусная часть пополнения (`topup_bonus`) идёт в `earned` и в PAYG не участвует. Пока `WALLET_SPLIT` выключен, PAYG **не включать** (`AI_PAYG` требует `WALLET_SPLIT`).
3. **Список платных моделей и цен — из админки** (таблица тарифов). По именам похоже, что платные GPT-5.2 и Gemini 3.6-flash — **это догадка**, реальные цены знает владелец.

### 9.2 Цена (формула; числа — примеры, реальные цены провайдеров мне неизвестны)
```
cost_rub  = (in_tok · c_in + (out_tok + reasoning_tok) · c_out) / 1_000_000
price_vub ≥ cost_rub / ( 0.1 · (1 − φ) · (1 − m) )          // f = 0, т.к. тратятся только купленные вубли
reserve_vub = ceil( ((est_in · c_in + max_tokens · c_out)/1e6) / (0.1·(1−φ)·(1−m)) )
```
`φ` — комиссия CryptoBot (**подставь реальную**, 3 % — **[не проверено]**), `m` — целевая маржа, `0.1` ₽ за вубль — консервативная база: фактически мелкие пополнения дают меньше вублей за рубль (дороже), а бонус крупных идёт в `earned`, так что `purchased` всегда стоит нам не меньше 0,1 ₽ **до комиссии**. Округляй вверх, минимум 1 вуб. Пример при `φ=5 %`, `m=60 %` (**пример**): «лёгкая» модель ≈ 1 вуб/ответ; «средняя» ≈ 8; «топ» ≈ 37; «топ + 2 000 токенов мыслей» ≈ 100. Тарифы — таблицей/конфигом с `rate_version`, показывать «≈ N вуб за ответ» **до** отправки и фактическую сумму «−3 вуб» после ответа.

### 9.3 UX (за флагом)
| Состояние | Что показывается |
|---|---|
| Лимит почти (≤ 25 %) | тост как сейчас + «Пополнить запас» |
| **Лимит исчерпан, PAYG выкл.** | карточка `LimitCard` в ленте: «Дневной лимит закончился», «Откроется в 00:00 (через 4 ч 12 мин)», «Продолжить за ≈ 3 вуб за ответ», «Автооплата сверх лимита…», «Premium: лимит ×2», «Подождать» |
| PAYG вкл., хватает | сообщение уходит как обычно; в подвале «−3 вуб · осталось 1 240»; чип у поля ввода «Сверх лимита · ≈3 вуб» |
| Не хватает купленных | «Нужно ≈ 3 вуб, у вас 1» + «Пополнить» (открывает `TopupSheet` с `minVub`) + «Подождать» |
| Потолок месяца | «Достигнут потолок 300 вуб/мес. Изменить потолок» |
| Ошибка модели | «Ответ не получен — вубли не списаны» (автовозврат) |
| Гость | как сейчас: 3 вопроса, вход |
Настройка «Автооплата сверх лимита» (Настройки → ИИ и Магазин → ИИ): выкл. по умолчанию; потолок в месяц [100 | 300 | 1000 | свой]; «не больше X вуб за ответ»; «списывается с купленных вублей»; «потрачено в этом месяце 120 из 300». Включение — явный тап + текст о потолке.
```tsx
export function LimitCard({ quote, balance, onContinue, onSettings, onTopup }: Props) {
  const enough = balance.purchased >= quote.perAnswerVub;
  return (
    <div role="alert" className="mx-auto my-3 w-full max-w-3xl rounded-3xl border border-line bg-elev p-4">
      <h3 className="text-sm font-medium">Дневной лимит закончился</h3>
      <p className="mt-1 text-[13px] text-muted">Откроется в {quote.resetAtLocal} ({quote.resetIn}).</p>
      <button className="press mt-3 h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg" onClick={enough ? onContinue : onTopup}>
        {enough ? `Продолжить за ≈ ${quote.perAnswerVub} вуб за ответ` : `Нужно ≈ ${quote.perAnswerVub} вуб · Пополнить`}
      </button>
      <button className="press mt-2 h-10 w-full rounded-xl border border-line text-sm" onClick={onSettings}>Автооплата сверх лимита…</button>
    </div>
  );
}
```

### 9.4 Сервер: резерв → списание по факту → возврат
Таблицы: `wallet.held` и `ai_holds(id, user_id, idem_key, chat_id, message_id, model, tier, rate_version, reserve_vub, charged_vub, status held|settled|released, usage jsonb, error, created_at, settled_at, UNIQUE(user_id, idem_key))`; `ai_payg_settings(user_id, enabled=false, monthly_cap_vub=300, per_answer_cap_vub=100, daily_cap_vub=200)`; `ai_rates(model, rate_version, tier, in_per_m_rub, out_per_m_rub, margin, fee, min_vub, image_vub, web_vub, tts_vub, enabled)` — себестоимость **не отдавать клиенту**. Виды журнала `ai_hold|ai_settle|ai_release|ai_refund`.
Эндпоинты: `GET /api/ai/billing` → `{limit:{limited,remaining,resetAt}, payg:{enabled,monthlyCap,spentMonth,perAnswerCap}, wallet:{purchased,earned}, quotes:[{model,tier,perAnswerVub}]}`; `POST /api/ai/payg/settings` (только подтверждённая почта); `POST /api/chat` (существующий) принимает `Idempotency-Key`. Ошибки: `limit_reached` (429), `insufficient_vubli` (402), `payg_cap_reached` (402), `model_unavailable` (503). SSE `limit` расширить `payg?:{enabled,perAnswerVub}`, добавить событие `billing {chargedVub, wallet}`.
```ts
// /api/chat — после проверки сессии, бана, rate-limit; PAYG только если дневной лимит уже исчерпан
if (!lim.exceeded) return streamNormally();
const s = await paygSettings(user);
if (!s.enabled && !body.paygOnce) return json(429, { code: 'limit_reached', resetAt, payg: { available: true, perAnswerVub: quote } });
const q = quoteReserve(model, estIn(req), clamp(maxTokens, PAYG_MAX_OUT));          // по max_tokens, сервер сам
if (q.reserve > s.perAnswerCap) return json(402, { code: 'payg_cap_reached' });
const hold = await tx(async t => {
  const ex = await t.one`SELECT * FROM ai_holds WHERE user_id=${u} AND idem_key=${idem}`; if (ex) return ex;        // повтор → тот же холд
  const spent = await t.one`SELECT coalesce(sum(charged_vub),0) FROM ai_holds WHERE user_id=${u} AND status='settled' AND settled_at >= date_trunc('month', now())`;
  if (spent + q.reserve > s.monthlyCap) throw code('payg_cap_reached');
  const r = await t`UPDATE wallet SET purchased = purchased - ${q.reserve}, held = held + ${q.reserve} WHERE user_id=${u} AND purchased >= ${q.reserve} RETURNING purchased`;
  if (r.count === 0) throw code('insufficient_vubli');
  /* INSERT ai_holds(status='held'); INSERT wallet_ledger(kind='ai_hold', amount=-reserve) */
});
try { const usage = await streamAndCollectUsage(); await settle(hold, Math.max(1, priceFromUsage(model, usage)), usage); sse('billing', {...}); }
catch (e) { noTokensDelivered(e) ? await release(hold, 'model_error') : await settle(hold, estimateFromChars(delivered), null); }
// settle: held -= reserve; purchased += reserve - actual; ledger ai_settle(-actual), ai_release(+reserve-actual); status='settled'
// release: held -= reserve; purchased += reserve; ledger ai_release(+reserve); status='released'
```
**Правила:** суммы целые (при дробности — милливубли `bigint`); списание только `UPDATE … WHERE purchased >= x`; `UNIQUE(user_id, idem_key)`; всё в транзакции; **cron-подметальщик** раз в минуту: `status='held' AND created_at < now() - interval '10 min'` → `release`. Ошибка модели — автовозврат полностью; обрыв после начала — списание за отданное; ручной возврат админа — `kind='adjust'`.

---

## 10. Защита от злоупотреблений

| Угроза | Мера |
|---|---|
| Подделка вебхука («оплачено») | секретный сегмент пути + HMAC-SHA-256 по сырому телу с `SHA256(token)`, сравнение через `timingSafeEqual`; без подписи — 401 и ничего не начисляется |
| Двойное начисление (повтор вебхука, гонка вебхук + polling + cron) | `FOR UPDATE` на строке + `UNIQUE(provider,network,provider_invoice_id)` + `UNIQUE(user_id,kind,idem_key)` в журнале |
| Клиент подменяет сумму/вубли | клиент шлёт только целые рубли; вубли и ступень считает сервер из таблицы; в записи фиксируются `rate_version` и `vubli_*` |
| Счёт «не на ту сумму» | при `paid` сверяются `fiat` и `amount`; расхождение → `manual_review` + алерт, вубли не начисляются автоматически |
| Утечка токена | только env; не логировать; не отдавать; `CRYPTOPAY_ENABLED=false` и перевыпуск токена при подозрении; секретный путь вебхука тоже в env |
| Спам счетами | ≤ 10 созданий/час и ≤ 3 активных на пользователя; дневной потолок суммы; создание счёта только с сессией (гости не могут); ALTCHA при регистрации уже есть; дополнительно лимит по хэшу IP |
| Бонус-арбитраж («купи крупно, продай вубли») | бонусная часть уходит в `earned`; переводы друзьям у получателя — `earned`; обратный путь `earned → purchased` запрещён |
| Бесплатные вубли оплачивают ИИ | PAYG только с `purchased` (раздел 9) |
| Ферма приглашений | приглашение засчитывается после подтверждения почты и N действий; лимит приглашений в сутки |
| Платёж пришёл после истечения | у провайдера истёкший счёт оплатить нельзя; если он всё же `paid` с совпавшей суммой — начислить и пометить в журнале |
| Отключение вебхуков провайдером | всегда отвечать 200 (кроме 404/401), сверка по cron и по polling как страховка, алерт при тишине |
| Возвраты и споры | крипто-платёж необратим; возврата вублей нет; ручная корректировка `kind='adjust'` с записью причины и админа |
| Утечка тарифов себестоимости ИИ | не отдавать `in_per_m_rub/out_per_m_rub` клиенту |
Логи: писать `topup_id`, `invoice_id`, исход; **не** писать токен, подпись целиком, секретный путь, IP в открытом виде.

---

## 11. План тестов

### 11.1 Автотесты (без реального провайдера; HTTP-клиент мокается)
1. **Курс:** границы 99/100, 499/500, 1999/2000, 4999/5000; монотонность `vubliTotal` по рублям (перебор 50…50 000); `purchased + bonus = total`; нецелое/`NaN`/ниже минимума/выше максимума → ошибка; `minRubForVub`.
2. **Подпись:** валидная принимается; изменённый на 1 байт body — нет; повторная сериализация JSON с другими пробелами — нет (подтверждает, что считаем по сырому телу); пустой/нехексовый/короткий заголовок — нет; сравнение не бросает на разных длинах.
3. **Вебхук:** неверный путь → 404; неверная подпись → 401 и баланс не изменился; не-`invoice_paid` → 200, без изменений; неизвестный `invoice_id` → 200 + `unknown_invoice`; валидный → начислено ровно `vubli_*`, статус `paid`; **повторная доставка → баланс не изменился**; два одновременных вебхука на один счёт (`Promise.all`) → одно начисление; расхождение суммы/валюты → `manual_review`, начисления нет; «старый» `request_date` → вызов `getInvoices` и решение по ответу провайдера.
4. **Создание счёта:** без сессии 401; без верифицированной почты 403; сумма вне диапазона 400; повтор с тем же `idempotencyKey` → тот же счёт, `createInvoice` вызван один раз; активный `pending` на ту же сумму переиспользуется; сбой провайдера → `failed`, 502; лимиты по часу/суткам; `createInvoice` вызван с `currency_type=fiat`, `fiat=RUB`, `amount` строкой, `payload=<id>`.
5. **Сверка:** polling `GET /topup/:id` начисляет, если провайдер вернул `paid`, а вебхука не было; cron переводит просроченные в `expired`; осиротевший счёт (нет `provider_invoice_id`, есть `payload`) подхватывается.
6. **Покупки:** 20 параллельных запросов на покупку при балансе на одну → ровно 1 успех, баланс ≥ 0; повтор с тем же ключом без нового списания.
7. **Кошелёк:** `WALLET_SPLIT`: порядок списания `earned` → `purchased`; перевод друзьям даёт получателю `earned`; PAYG при нулевом `purchased` → `insufficient_vubli`; холд → settle/release.
8. **Совместимость:** старый API баланса возвращает сумму; старые серверные функции магазина отвечают как раньше; `/?place=shop`, `/?place=bank` открываются без новых параметров.
9. **UI:** `TopupSheet` — пресеты и подпись ступеней, ввод своей суммы, «до следующего уровня», состояния `choose/creating/invoice/confirming/paid/expired/error`; «Готово» только по `paid`; `Esc`/«Назад» закрывают; `aria-live`.

### 11.2 Ручной прогон на testnet (**сайт**; делает владелец вместе с тобой)
Подготовка: приложение в `@CryptoTestnetBot`, `CRYPTOPAY_NETWORK=testnet`, токен — в Preview-окружение; вебхук на URL превью-деплоя (если превью защищены Vercel Authentication, вебхук не дойдёт — использовать туннель или отключить защиту для пути `/api/webhooks/*` **[не проверено]**). Testnet-монеты берутся в `@CryptoTestnetBot`.
1. `getMe` с токеном → `ok:true` (health-check).
2. Пополнить 100 ₽ → счёт создан, `bot_invoice_url` открывается в testnet-боте, оплатить → вебхук пришёл (`payment_webhook_log.outcome='credited'`), баланс +980, `vubli_topups.status='paid'`, в журнале одна запись `topup_cryptobot`.
3. Повторить доставку вебхука (Retry в тестовом клиенте/curl с теми же телом и подписью) → `duplicate`, баланс прежний.
4. Выключить вебхук в настройках приложения, оплатить второй счёт → вубли приходят через polling/cron.
5. Не оплачивать счёт до `expires_in` → `expired`, баланс прежний.
6. Каждую ступень таблицы (50, 100, 500, 2 000, 5 000 ₽) — сравнить `vubli_total` со столбцом таблицы раздела 3.2.
7. Подделка: `curl` на вебхук с неверной подписью → 401, баланс прежний; с неверным путём → 404.
8. **Сверить фактическую форму** ответов `createInvoice`, `getInvoices` (массив или `{items}`), заголовок подписи, формат `request_date`, минимальную сумму счёта в RUB, и зафиксировать это в комментарии к PR (раздел 14).
9. На mainnet перед включением флага: платёж минимальной суммы (50 ₽) самим владельцем, проверка комиссии (`fee_amount`) в записи платежа.

---

## 12. Приложение (делает Гик) — отдельно, **не часть задачи Claude**

Сайт обязан работать на **APK 2.9.1 без изменений** (всё ниже — улучшения; запасные пути в коде сайта уже есть).
| № | Что | Сейчас (APK 2.9.1, по коду) | Зачем |
|---|---|---|---|
| A-1 | **Открытие счёта CryptoBot во внешнем приложении** | `shouldOverrideUrlLoading` отдаёт любой https **вне** `vvvion.space` в `openExternal(ACTION_VIEW)` → навигация `location.assign('https://t.me/CryptoBot?start=…')` уже открывает Telegram; `target=_blank` без `onCreateWindow` грузится в том же WebView и попадает в тот же перехват (**[не проверено]** на устройстве) | убедиться на реальном телефоне: Telegram открывается, страница сайта остаётся на месте; без установленного Telegram — открывается браузер с `t.me`, пользователь выбирает «Оплатить в браузере» (`web_app_invoice_url`) |
| A-2 | `VvvionApp.openExternal(url)` — **новый** метод моста + `features: 'openExternal'` | нет; `openExternal(Uri)` есть только внутри `MainActivity` | чистый путь без побочных эффектов навигации; только `https` (и `tg://`, `intent:` по белому списку), иначе `false`. Сайт уже зовёт его под `has('openExternal')` |
| A-3 | Событие **`vvvion-app-resume`** при `onResume` (через `emitToPage`) | нет; в `onPause()` приложение зовёт `web.onPause()`, пока не играет музыка — JS-таймеры на время открытого Telegram **приостанавливаются**, и `visibilitychange` в WebView на `onResume` **[не проверено]** | сайт сразу опрашивает статус платежа после возврата из Telegram; без события работают `visibilitychange`/`focus`/`pageshow` и таймер после возобновления |
| A-4 | `VvvionApp.haptic('success')` / `haptic('error')` на покупку/пополнение | **есть** (2.7.0+) | ощущение «купил/пополнил» |
| A-5 | `VvvionApp.share({title,text,url})` | **есть** (2.9.0) | «Подарить Premium», приглашения |
| A-6 | Страховка для старых `window.confirm/alert/prompt` | `WebChromeClient.onJsConfirm/onJsAlert` выводить тем же `VvDialog` 2.9.1, а не стоковым | пока сайт не заменил все `confirm`; именно эти окна «серые как Android 4» |
| A-7 | `assetlinks.json` починить | сейчас в ожидании у владельца | чтобы возврат из CryptoBot по ссылке `https://vvvion.space/?place=bank&topup=<id>` открывался в приложении; **не на этом строится оплата** |
| A-8 | Политика Google Play | APK ставится по ссылке — ограничений Play нет | **Если когда-нибудь выкладывать в Google Play:** продажа цифровых товаров в приложении за внешние платёжки нарушит платёжную политику Play (нужен Play Billing) — магазин и пополнение в приложении придётся скрыть/вынести в веб (проверить актуальные правила на момент подачи) |
Ничего из A-2/A-3 не требует новых разрешений Android. Claude пишет в PR, что ждёт от приложения, и не блокируется на нём.

---

## 13. Юридическое — кратко (не юридическая консультация; уточни у юриста/бухгалтера)
- **Вубли — внутренняя единица сервиса**, не деньги и не электронные деньги, **не обмениваются на деньги и не возвращаются**. На экране пополнения и в оферте это написано явно; формулировку «без возвратов» согласуй с юристом (у потребителей в РФ/КЗ есть неотменяемые права — не обещай больше, чем безопасно).
- **CryptoBot:** создание приложения и приём платежей не требуют одобрения мерчанта; **верификация (документ/селфи) понадобится владельцу при выводе средств** — по прошлому разбору, **[не проверено]** актуальные правила вывода и лимиты смотри в `@CryptoBot`. Следи, чтобы вебхуки не были отключены (письмо/уведомление от бота).
- **Налоги, статус (ИП/самозанятость), отчётность** — вне этого документа.
- **Автооплата сверх лимита** — только по явному включению, с потолком, видимой суммой «потрачено в этом месяце» и выключением в один тап.
- **Google Play:** см. A-8.

---

## 14. Чек-лист, порядок коммитов, что не проверено

### 14.1 Порядок
`W-0` разведка → `W-1` журнал + `kind` → `S-P0-4` идемпотентность покупок → `P-1` курс + клиент провайдера + `/packages` → `P-2` топап + вебхук + сверка + cron → `P-3` `TopupSheet` → `S-P0-1` цены/почта → `S-P0-2` баланс/«Не хватает» → `S-P0-3` `PurchaseSheet` → (P1) `S-P1-1…4`, `W-2` → (P2) товары, подарки, PAYG (`AI_PAYG` после `W-2`), i18n. Флаги включаются по очереди: `PAY_TOPUP` (после testnet и пробного mainnet-платежа 50 ₽) → `SHOP_V2` → `WALLET_SPLIT` → `AI_PAYG`.

### 14.2 Чек-лист приёмки
**Платежи**
- [ ] `CRYPTOPAY_TOKEN` нигде нет в репозитории, клиентском бандле, логах, ответах API, `.env.example`.
- [ ] Вебхук: неверный путь 404, неверная подпись 401, остальное 200; подпись по сырому телу, `timingSafeEqual`.
- [ ] Один оплаченный счёт начисляет вубли ровно один раз при любом числе вебхуков, polling и cron (в том числе параллельных).
- [ ] Начислено ровно `vubli_*` из строки (курс при создании); пересчёта при оплате нет; `purchased`/`bonus` разнесены.
- [ ] Клиент присылает только целые рубли; `returnUrl`/`?topup=` не начисляют и не показывают успех.
- [ ] Сверка (`GET /topup/:id` и cron) добирает пропущенные вебхуки; `expired` отрабатывает; осиротевшие счета подхватываются; алерты настроены.
- [ ] `CRYPTOPAY_ENABLED=false` останавливает создание счетов, но не вебхук и сверку.
- [ ] Миграции с `down` проверены; виды журнала — `text + CHECK`.
- [ ] testnet-прогон 11.2 выполнен, расхождения с документом зафиксированы в PR.
**Магазин**
- [ ] S-P0-1…3 по критериям из 7.7 (390 и 1440, тёмная и светлая); нет `window.confirm`; цена видна всегда.
- [ ] Тап-цели ≥ 44 (мобильный), контраст ≥ AA, `prefers-reduced-motion` учтён.
- [ ] `/?place=shop` и `/?place=bank` работают как раньше; старый баланс/покупки не сломаны; APK 2.9.1 открывает всё без ошибок (`VvvionApp?.` везде).
**PAYG (за `AI_PAYG`)**
- [ ] Лимит исчерпан → `LimitCard`; три состояния (хватает / не хватает / потолок); холд → settle/release; ошибка модели возвращает вубли; подметальщик снимает висящие холды; `earned` не списывается на PAYG; настройка выключается одним тапом.

### 14.3 Что я не проверил / **[не проверено]** (сверь по свежей доке и на testnet)
1. **Комиссия CryptoBot (3 %)** и условия вывода/KYC — не на странице API-доки.
2. **Минимальная и максимальная сумма фиат-счёта** в RUB — в документе не указаны.
3. **Форма результата `getInvoices`**: массив или `{items:[…]}` (код поддерживает оба).
4. **`request_date` при повторных доставках** (обновляется ли), поведение подписи при нестандартном форматировании тела — поэтому подпись считается по сырому телу, а «старые» вебхуки перепроверяются через `getInvoices`.
5. **Название пункта перевыпуска токена** в меню `@CryptoBot`; работа вебхуков на защищённых превью Vercel.
6. **Cron на бесплатном тарифе Vercel** (частота) и точное имя `waitUntil` в вашей версии платформы; формат заголовка `CRON_SECRET`.
7. **Всё на реальном телефоне**: открытие `t.me`-ссылки из APK 2.9.1 (`location.assign` и `target=_blank`), `visibilitychange` после `WebView.onResume()`.
8. Реальные таблицы кошелька/журнала и ORM проекта — **[проверить]** (раздел 7.7, W-0); серверная идемпотентность текущих покупок — **[проверить]** (S-P0-4).
9. Реальные цены ИИ-провайдеров, маржа, лимит ИИ, платные модели — решает владелец (раздел 9).
**Проверено** по документации Crypto Pay (версия 1.5.3, 28.10.2026): базовые URL mainnet/testnet; заголовок `Crypto-Pay-API-Token`; параметры `createInvoice`; поля `Invoice`; вебхук `invoice_paid`, заголовок и алгоритм подписи; ретраи (17 попыток за 3 дня) и автоотключение вебхуков; `getInvoices`, `deleteInvoice`; список фиатных валют (в т. ч. RUB, KZT). **Проверено по коду APK 2.9.1:** перехват внешних https-ссылок в `openExternal`; `haptic`, `share` есть; `openExternal` и `vvvion-app-resume` в мосте отсутствуют; `web.onPause()` на `onPause`.
