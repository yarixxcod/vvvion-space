export type WeatherHour = { label: string; temp: number; code: number };
export type WeatherDay = { label: string; max: number; min: number; code: number };

export type WeatherCard = {
  city: string;
  place: string;
  temp: number;
  feels: number;
  code: number;
  desc: string;
  wind: number;
  humidity: number;
  precip: number;
  hours: WeatherHour[];
  days: WeatherDay[];
  advice: string;
};

export type WeatherKind = "sun" | "partly" | "cloud" | "rain" | "snow" | "storm" | "fog";

const PHRASE: Record<number, string> = {
  113: "Ясно",
  116: "Переменная облачность",
  119: "Облачно",
  122: "Пасмурно",
  143: "Дымка",
  149: "Дымка",
  176: "Местами дождь",
  179: "Местами снег",
  182: "Местами мокрый снег",
  185: "Ледяная морось",
  200: "Гроза",
  227: "Позёмок",
  230: "Метель",
  248: "Туман",
  260: "Ледяной туман",
  263: "Местами морось",
  266: "Морось",
  281: "Ледяная морось",
  284: "Сильная ледяная морось",
  293: "Местами небольшой дождь",
  296: "Небольшой дождь",
  299: "Временами умеренный дождь",
  302: "Умеренный дождь",
  305: "Временами сильный дождь",
  308: "Сильный дождь",
  311: "Небольшой ледяной дождь",
  314: "Сильный ледяной дождь",
  317: "Небольшой мокрый снег",
  320: "Сильный мокрый снег",
  323: "Местами небольшой снег",
  326: "Небольшой снег",
  329: "Местами умеренный снег",
  332: "Умеренный снег",
  335: "Местами сильный снег",
  338: "Сильный снег",
  350: "Ледяная крупа",
  353: "Небольшой ливень",
  356: "Ливень",
  359: "Сильный ливень",
  362: "Небольшой дождь со снегом",
  365: "Дождь со снегом",
  368: "Небольшой снег",
  371: "Сильный снегопад",
  374: "Небольшая ледяная крупа",
  377: "Ледяная крупа",
  386: "Местами гроза с дождём",
  389: "Гроза с дождём",
  392: "Местами гроза со снегом",
  395: "Гроза со снегом",
};

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function weatherKind(code: number): WeatherKind {
  if ([200, 386, 389, 392, 395].includes(code)) return "storm";
  if ([179, 182, 185, 227, 230, 281, 284, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(code)) {
    return "snow";
  }
  if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359].includes(code)) return "rain";
  if ([143, 149, 248, 260].includes(code)) return "fog";
  if (code === 113) return "sun";
  if (code === 116) return "partly";
  return "cloud";
}

export function describeWeather(code: number): string {
  return PHRASE[code] ?? "Облачно";
}

export function localWear(input: { temp: number; feels: number; wind: number; precip: number; code: number }): string {
  const t = input.feels <= input.temp - 3 ? input.feels : input.temp;
  const kind = weatherKind(input.code);
  let base = "Лёгкая куртка или свитер, который легко снять.";
  if (t <= -15) base = "Очень холодно: пуховик, шапка, шарф, перчатки и тёплая обувь.";
  else if (t <= -5) base = "Мороз: зимнее пальто, шапка и закрытая обувь. Шарф не будет лишним.";
  else if (t <= 3) base = "Холодно: тёплая куртка и слой под ней. Шапка пригодится, если долго на улице.";
  else if (t <= 10) base = "Прохладно: куртка или плотный свитер. К вечеру станет свежее.";
  else if (t <= 17) base = "Мягко: лёгкая куртка или свитер, который легко снять.";
  else if (t <= 24) base = "Тепло: хватит рубашки, футболки или тонкого свитера.";
  else base = "Жарко: лёгкая одежда. Если долго на солнце, прикройте голову.";
  const extras: string[] = [];
  if (kind === "rain" || input.precip >= 0.3) extras.push("Возьмите зонт или непромокаемый верх.");
  if (kind === "snow") extras.push("На ногах лучше обувь, которая не скользит.");
  if (kind === "storm") extras.push("Гроза: лучше не оставаться на открытом месте и взять куртку с капюшоном.");
  if (kind === "fog") extras.push("Видимость ниже обычной — светлая куртка заметнее в дымке.");
  if (input.wind >= 28) extras.push("Ветер сильный: закрытый верх лучше тонкого шарфа одного.");
  if (input.feels <= input.temp - 4 && t > 3) extras.push("На коже холоднее, чем на термометре. Одевайтесь по ощущению.");
  return [base, ...extras].join(" ");
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-80, Math.min(60, Math.round(n)));
}

function textOf(value: unknown): string {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return "";
  const raw = (value[0] as { value?: unknown }).value;
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

function codeOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 122;
}

function hourLabel(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const hour = Math.floor(n / 100);
  if (hour < 0 || hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:00`;
}

function dayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return iso;
  return `${Number(match[3])} ${month}`;
}

export function parseWttr(payload: unknown, city: string): Omit<WeatherCard, "advice"> {
  if (!payload || typeof payload !== "object") throw new Error("Город не нашёлся");
  const root = payload as {
    current_condition?: unknown[];
    nearest_area?: unknown[];
    weather?: unknown[];
  };
  const current = root.current_condition?.[0];
  if (!current || typeof current !== "object") throw new Error("Город не нашёлся");
  const now = current as Record<string, unknown>;
  const area = root.nearest_area?.[0];
  const place = area && typeof area === "object" ? textOf((area as { areaName?: unknown }).areaName) : "";
  const region = area && typeof area === "object" ? textOf((area as { region?: unknown }).region) : "";
  const country = area && typeof area === "object" ? textOf((area as { country?: unknown }).country) : "";
  const where = [region || place, country].filter(Boolean).join(", ");
  const code = codeOf(now.weatherCode);
  const days = (Array.isArray(root.weather) ? root.weather : []).slice(0, 3).flatMap((day) => {
    if (!day || typeof day !== "object") return [];
    const row = day as Record<string, unknown>;
    const date = typeof row.date === "string" ? row.date : "";
    const hourly = Array.isArray(row.hourly) ? row.hourly : [];
    const noon = hourly[4] && typeof hourly[4] === "object" ? (hourly[4] as Record<string, unknown>) : null;
    return [
      {
        label: dayLabel(date),
        max: num(row.maxtempC),
        min: num(row.mintempC),
        code: codeOf(noon?.weatherCode ?? code),
      },
    ];
  });
  const todayHours = Array.isArray(root.weather) && root.weather[0] && typeof root.weather[0] === "object"
    ? ((root.weather[0] as { hourly?: unknown[] }).hourly ?? [])
    : [];
  const hours = todayHours.flatMap((slot) => {
    if (!slot || typeof slot !== "object") return [];
    const row = slot as Record<string, unknown>;
    const label = hourLabel(row.time);
    if (!label) return [];
    return [{ label, temp: num(row.tempC), code: codeOf(row.weatherCode) }];
  });
  return {
    city,
    place: where || city,
    temp: num(now.temp_C),
    feels: num(now.FeelsLikeC, num(now.temp_C)),
    code,
    desc: describeWeather(code),
    wind: Math.max(0, num(now.windspeedKmph)),
    humidity: Math.max(0, Math.min(100, num(now.humidity))),
    precip: Math.max(0, Math.round((Number(now.precipMM) || 0) * 10) / 10),
    hours,
    days,
  };
}
