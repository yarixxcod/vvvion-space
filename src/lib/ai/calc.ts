const LENGTH: Record<string, number> = {
  мм: 0.001,
  см: 0.01,
  м: 1,
  метр: 1,
  метра: 1,
  метров: 1,
  км: 1000,
  километр: 1000,
  километра: 1000,
  миля: 1609.344,
  мили: 1609.344,
  миль: 1609.344,
  фут: 0.3048,
  фута: 0.3048,
  футов: 0.3048,
};

const MASS: Record<string, number> = {
  мг: 0.000001,
  г: 0.001,
  грамм: 0.001,
  грамма: 0.001,
  кг: 1,
  килограмм: 1,
  килограмма: 1,
  т: 1000,
  тонна: 1000,
  тонны: 1000,
  фунт: 0.45359237,
  фунта: 0.45359237,
};

const TIME: Record<string, number> = {
  с: 1,
  сек: 1,
  секунда: 1,
  секунды: 1,
  мин: 60,
  минута: 60,
  минуты: 60,
  минут: 60,
  ч: 3600,
  час: 3600,
  часа: 3600,
  часов: 3600,
  день: 86400,
  дня: 86400,
  дней: 86400,
};

function unit(table: Record<string, number>, name: string) {
  return table[name.replace(/[.\s]/g, "").toLowerCase()];
}

function temperature(value: number, from: string, to: string): number | null {
  const a = from.replace("°", "").toLowerCase();
  const b = to.replace("°", "").toLowerCase();
  const celsius = a === "c" || a === "ц" || a.startsWith("цельс");
  const fahrenheit = a === "f" || a.startsWith("фар");
  const toC = b === "c" || b === "ц" || b.startsWith("цельс");
  const toF = b === "f" || b.startsWith("фар");
  if (celsius && toF) return (value * 9) / 5 + 32;
  if (fahrenheit && toC) return ((value - 32) * 5) / 9;
  if ((celsius && toC) || (fahrenheit && toF)) return value;
  return null;
}

function convert(input: string): number | null {
  const match = input
    .trim()
    .toLowerCase()
    .match(/^(-?\d+(?:[.,]\d+)?)\s*([^\d]+?)\s+(?:в|to|in)\s+([^\d]+)$/i);
  if (!match) return null;
  const value = Number(match[1]?.replace(",", "."));
  const from = (match[2] || "").trim();
  const to = (match[3] || "").trim();
  if (!Number.isFinite(value)) return null;
  const temp = temperature(value, from, to);
  if (temp != null) return temp;
  for (const table of [LENGTH, MASS, TIME]) {
    const a = unit(table, from);
    const b = unit(table, to);
    if (a && b) return (value * a) / b;
  }
  return null;
}

function prepare(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−|–/g, "-")
    .replace(/(\d+(?:\.\d+)?)%\s*(?:от|of)\s*/g, "($1/100)*")
    .replace(/(\d+(?:\.\d+)?)%/g, "($1/100)")
    .replace(/\s+/g, "");
}

/** Exact arithmetic. Returns null when the text is not a single expression. */
export function evaluate(input: string): number | null {
  const converted = convert(input);
  if (converted != null && Number.isFinite(converted)) return converted;
  const src = prepare(input);
  if (!src || src.length > 160 || !/^[\d.+\-*/^()a-z]+$/.test(src)) return null;
  let i = 0;
  function parseExpr(): number | null {
    let left = parseTerm();
    if (left == null) return null;
    while (src[i] === "+" || src[i] === "-") {
      const op = src[i];
      i += 1;
      const right = parseTerm();
      if (right == null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parsePower();
    if (left == null) return null;
    while (src[i] === "*" || src[i] === "/") {
      const op = src[i];
      i += 1;
      const right = parsePower();
      if (right == null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function parsePower(): number | null {
    const left = parseUnary();
    if (left == null) return null;
    if (src[i] !== "^") return left;
    i += 1;
    const right = parseUnary();
    if (right == null) return null;
    return left ** right;
  }
  function parseUnary(): number | null {
    if (src[i] === "-") {
      i += 1;
      const value = parseUnary();
      return value == null ? null : -value;
    }
    if (src[i] === "+") {
      i += 1;
      return parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): number | null {
    if (src[i] === "(") {
      i += 1;
      const value = parseExpr();
      if (src[i] !== ")") return null;
      i += 1;
      return value;
    }
    const name = /^[a-z]+/.exec(src.slice(i))?.[0];
    if (name === "pi") {
      i += 2;
      return Math.PI;
    }
    if (name === "e") {
      i += 1;
      return Math.E;
    }
    if (name && ["sqrt", "abs", "round", "floor", "ceil"].includes(name)) {
      i += name.length;
      if (src[i] !== "(") return null;
      i += 1;
      const value = parseExpr();
      if (value == null || src[i] !== ")") return null;
      i += 1;
      if (name === "sqrt") return value < 0 ? null : Math.sqrt(value);
      if (name === "abs") return Math.abs(value);
      if (name === "round") return Math.round(value);
      if (name === "floor") return Math.floor(value);
      return Math.ceil(value);
    }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (!num) return null;
    i += num[0].length;
    return Number(num[0]);
  }
  const value = parseExpr();
  if (value == null || i !== src.length || !Number.isFinite(value)) return null;
  return value;
}

export function formatCalc(value: number) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const digits = abs !== 0 && (abs >= 1e10 || abs < 1e-6) ? 8 : 10;
  const text = value.toLocaleString("ru-RU", { maximumFractionDigits: digits, useGrouping: abs >= 10000 });
  return text;
}

/** If the whole message is one sum, return the exact line. Otherwise null. */
export function solvedLine(text: string): string | null {
  const stripped = text.trim().replace(/^(посчитай|сколько будет|calculate|compute)\s+/i, "");
  if (!stripped || stripped.length > 120 || stripped.includes("\n")) return null;
  const value = evaluate(stripped);
  if (value == null) return null;
  return `${stripped} = ${formatCalc(value)}`;
}

export function clockLine(now = new Date()) {
  const date = now.toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "локальный";
  return `Сейчас у человека: ${date}, пояс ${zone}. На вопросы про сегодня, завтра и сроки опирайся на эту дату.`;
}

const ASK_NOTE = `Иногда для хорошего ответа не хватает важной детали, которую нельзя разумно предположить. Тогда вместо длинных догадок задай уточняющий вопрос карточкой. Правила:
1) Задавай вопрос только если без ответа результат заметно ухудшится. На простые и однозначные запросы отвечай сразу.
2) Не больше одной карточки за ответ, не больше 3 шагов, 2–6 коротких вариантов в шаге. Не спрашивай то, что пользователь уже сообщил.
3) Карточка — это блок кода с языком vvvion-question и корректным JSON (без комментариев и без Markdown внутри строк):
\`\`\`vvvion-question
{"v":1,"steps":[{"id":"kind","title":"Короткий вопрос?","type":"single","options":[{"id":"a","label":"Вариант А"},{"id":"b","label":"Вариант Б","hint":"подпись"}],"allowCustom":true}]}
\`\`\`
type: "single" — один вариант, "multi" — несколько (добавь min/max), "text" — только свободный ответ. id — латиница, строчные, до 32 символов.
4) Перед карточкой — одна короткая фраза (до 15 слов). После карточки НИЧЕГО не пиши и остановись: жди ответа.
5) Ответ придёт обычным сообщением пользователя. Продолжай с учётом ответа и не задавай тот же вопрос снова. Если пользователь пишет «Пропускаю вопрос», выбери разумные значения сам и сразу дай результат.`;

export function pluginNote(
  flags: { calc: boolean; clock: boolean; brief: boolean; translate: boolean; ask?: boolean },
  userText: string,
) {
  const lines: string[] = [];
  if (flags.ask) lines.push(ASK_NOTE);
  if (flags.clock) lines.push(clockLine());
  if (flags.calc) {
    const solved = solvedLine(userText);
    if (solved) lines.push(`Калькулятор уже посчитал, используй это число и не пересчитывай: ${solved}.`);
    lines.push("Точный счёт пиши отдельным блоком ```calc, по одному выражению на строку. Рядом не подставляй свой пересчёт.");
  }
  if (flags.brief) lines.push("Отвечай коротко: два–четыре предложения, без вступления и без пересказа вопроса.");
  if (flags.translate) {
    lines.push(
      "Если сообщение не на русском, сначала одна строка с переводом на русский, затем ответ. Если просят перевести с русского — дай английский и ничего лишнего.",
    );
  }
  return lines.join("\n");
}
