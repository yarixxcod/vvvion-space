export const AGENT_GUIDE = `Режим файлового агента включён пользователем. Сайт и проект сохраняй одним вызовом save_files: папка и все файлы сразу. Не останавливайся после папки и не пиши код вместо вызова. Оригиналы не удаляй и не перезаписывай. Если не хватает одного факта, задай один короткий вопрос.`;

type Call = { id: string; name: string; args: string };
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;

export function plainAgentReply(text: string): { answer?: string; call?: Call } | null {
  const clean = text
    .trim()
    .replace(/^```(?:json|tool_call|tool)?\s*\n?([\s\S]*?)\n?```$/, "$1")
    .trim();
  const direct = readAgentJson(clean);
  if (direct) return direct;
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) return readAgentJson(clean.slice(start, end + 1));
  return null;
}

function readAgentJson(clean: string): { answer?: string; call?: Call } | null {
  try {
    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.answer === "string" && !row.tool && !row.name && !row.function) return { answer: row.answer };
    const call = callFromRecord(row);
    return call ? { call } : null;
  } catch {
    /* Invalid protocol is repaired by the next turn, never executed. */
  }
  return null;
}

function callFromRecord(row: Record<string, unknown>): Call | null {
  const nested =
    row.function && typeof row.function === "object" && !Array.isArray(row.function)
      ? (row.function as Record<string, unknown>)
      : null;
  const nameRaw =
    typeof row.tool === "string"
      ? row.tool
      : typeof row.name === "string"
        ? row.name
        : typeof nested?.name === "string"
          ? nested.name
          : "";
  const name = nameRaw.trim();
  if (!TOOL_NAME.test(name)) return null;
  const nestedArgs = nested ? "arguments" in nested || "input" in nested : false;
  const hasArgs = "arguments" in row || "args" in row || "input" in row || "tool" in row || "function" in row || nestedArgs;
  if (!hasArgs) return null;
  const argsSource = row.arguments ?? row.args ?? nested?.arguments ?? nested?.input ?? row.input ?? {};
  let args = "{}";
  if (typeof argsSource === "string") args = argsSource || "{}";
  else if (argsSource && typeof argsSource === "object" && !Array.isArray(argsSource)) {
    try {
      args = JSON.stringify(argsSource);
    } catch {
      return null;
    }
  } else if (argsSource !== undefined && typeof argsSource !== "object") return null;
  const limit = name === "save_files" ? 450_000 : /^(save_my_text|write_my_file|edit_my_file)$/.test(name) ? 125_000 : 8_000;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 80) : `json_${crypto.randomUUID()}`;
  return { id, name: name.slice(0, 80), args: args.length > limit ? "{\"_error\":" : args || "{}" };
}

function qwenCall(body: string): Call | null {
  const found = /<function=([A-Za-z][A-Za-z0-9_.:-]{0,79})>/i.exec(body);
  const name = found?.[1];
  if (!name) return null;
  const args: Record<string, string> = {};
  for (const match of body.matchAll(/<parameter=([A-Za-z0-9_]+)>\s*([\s\S]*?)\s*<\/parameter>/gi)) {
    const key = match[1];
    if (key) args[key] = match[2] ?? "";
  }
  return callFromRecord({ name, arguments: args });
}

function callFromBlock(body: string): Call | null {
  const xml = qwenCall(body);
  if (xml) return xml;
  return plainAgentReply(body)?.call ?? null;
}

/** Tool calls that smaller and Chinese models write into the message instead of tool_calls. */
export function embeddedToolCalls(text: string): Call[] {
  const calls: Call[] = [];
  const take = (body: string) => {
    const call = callFromBlock(body);
    if (call && calls.length < 6) calls.push(call);
  };
  for (const block of text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi)) take(block[1] ?? "");
  if (calls.length) return calls;
  for (const fence of text.matchAll(/```(?:json|tool_call|tool)?\s*([\s\S]*?)```/gi)) take(fence[1] ?? "");
  if (calls.length) return calls;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
    const whole = plainAgentReply(trimmed);
    if (whole?.call) return [whole.call];
  }
  return [];
}

export function toolCallsFromMessage(message: unknown): Call[] {
  if (!message || typeof message !== "object") return [];
  const row = message as Record<string, unknown>;
  const raw: unknown[] = [];
  if (Array.isArray(row.tool_calls)) raw.push(...row.tool_calls);
  if (row.function_call && typeof row.function_call === "object") raw.push(row.function_call);
  if (Array.isArray(row.content)) {
    for (const part of row.content) {
      if (!part || typeof part !== "object") continue;
      const item = part as Record<string, unknown>;
      if (item.type === "tool_use" || item.type === "function_call" || item.functionCall) raw.push(item.functionCall ?? item);
    }
  }
  const calls: Call[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const call = callFromRecord(item as Record<string, unknown>);
    if (call) calls.push(call);
    if (calls.length >= 6) break;
  }
  return calls;
}

export function parseToolArguments(value: string): Record<string, unknown> | null {
  try {
    const args = JSON.parse(value);
    return args && typeof args === "object" && !Array.isArray(args) ? args : null;
  } catch {
    return null;
  }
}

type AgentWire = {
  role: string;
  content: string | import("./types").ChatPart[] | null;
  tool_calls?: unknown;
  tool_call_id?: string;
};
type AgentUsage = import("./types").Usage;
type AgentResult = { text: string; reason: string; usage?: AgentUsage };

/** Bounded execution shared by native tools and the JSON adapter used by smaller models. */
export async function runAgentLoop(options: {
  wire: AgentWire[];
  payload: Record<string, unknown>;
  send: (
    payload: Record<string, unknown>,
  ) => Promise<{ failed: boolean; response: Response; plainTools?: boolean; secret?: string }>;
  invoke: (name: string, args: unknown) => Promise<string>;
  split: (body: Record<string, unknown>) => { text: string; reason: string };
  calls: (body: Record<string, unknown>) => Call[];
  usage: (body: unknown) => AgentUsage | undefined;
  signal: AbortSignal;
  writeRequested?: boolean;
  filesRequested?: boolean;
  hasChanges: () => boolean;
  hasFiles?: () => boolean;
  onStep?: (secret?: string) => void;
  onProgress?: (step: { id: string; tool: string; label: string; detail?: string; status: "running" | "done" | "error" }) => void;
  forcePlain?: () => void;
  afterTools?: () => void;
}): Promise<AgentResult | null> {
  const { wire, signal } = options;
  let repaired = 0;
  let lastToolError = "";
  let releaseAnswer = false;
  let repeatedResults = 0;
  const receipts = new Map<string, string>();
  const failures = new Map<string, number>();
  const usage: AgentUsage = {};
  const note = (id: string, label: string, status: "running" | "done" | "error", tool = "plan", detail?: string) => {
    options.onProgress?.({ id, tool, label, detail, status });
  };
  const salvage = async (text: string): Promise<string | null> => {
    if (!options.filesRequested || options.hasFiles?.()) return null;
    const files = filesFromAnswer(text);
    if (!files.length) return null;
    const folder = folderTitle(files);
    const detail = files.map((file) => file.path).join(", ");
    note("salvage", `Сохраняю проект «${folder}»`, "running", "save_files", detail);
    let raw = "";
    try {
      signal.throwIfAborted();
      raw = await options.invoke("save_files", { folder, files });
    } catch {
      note("salvage", `Сохраняю проект «${folder}»`, "error", "save_files", detail);
      return null;
    }
    let saved = 0;
    let errorText = "";
    try {
      const parsed = JSON.parse(raw) as { error?: string; files?: Array<{ saved?: boolean; error?: string }> };
      if (typeof parsed.error === "string") errorText = parsed.error;
      saved = parsed.files?.filter((file) => file.saved).length ?? 0;
      if (!errorText) errorText = parsed.files?.find((file) => file.error)?.error || "";
    } catch {
      errorText = "Не сохранилось";
    }
    note("salvage", `Сохраняю проект «${folder}»`, saved ? "done" : "error", "save_files", detail);
    if (!saved || errorText) {
      lastToolError = (errorText || "Не сохранилось").slice(0, 300);
      return null;
    }
    lastToolError = "";
    return `Сайт сохранён на диске, папка «${folder}».`;
  };
  for (let round = 0; round < 24; round++) {
    signal.throwIfAborted();
    note("plan", round === 0 ? "Думаю над задачей" : "Продолжаю сборку", "running");
    // Keep identifiers and receipts while limiting repeated document text in smaller contexts.
    const oldTools = wire
      .map((item, index) => (item.role === "tool" ? index : -1))
      .filter((index) => index >= 0)
      .slice(0, -2);
    for (const index of oldTools) {
      const item = wire[index];
      if (typeof item.content !== "string" || item.content.length <= 1600) continue;
      try {
        const result = JSON.parse(item.content);
        if (typeof result.text === "string" && result.text.length > 800) {
          result.text = result.text.slice(0, 800);
          result.context_compacted = true;
          result.note =
            "Старая часть текста сокращена для контекста. При необходимости перечитай её по id и offset.";
          item.content = JSON.stringify(result);
        }
      } catch {
        /* External tool result formats remain unchanged. */
      }
    }
    const sent: Record<string, unknown> = {
      ...options.payload,
      messages: wire,
      // A forced tool call cannot be the final answer. Once the files exist, or the tool says to stop, let the model speak or ask.
      ...((options.payload.tool_choice === "required" &&
        (releaseAnswer ||
          (options.hasChanges() && (!options.filesRequested || options.hasFiles?.()))))
        ? { tool_choice: "auto" }
        : {}),
    };
    if (round > 0 && sent.reasoning_effort === "medium") sent.reasoning_effort = "low";
    const attempt = await options.send(sent);
    if (attempt.failed) { lastToolError = "Провайдеры не смогли продолжить выполнение"; break; }
    options.onStep?.(attempt.secret);
    const parsed = (await attempt.response.json()) as Record<string, unknown>;
    const spent = options.usage(parsed.usage);
    for (const key of [
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "reasoning_tokens",
    ] as const)
      if (spent?.[key]) usage[key] = (usage[key] ?? 0) + spent[key];
    const parts = options.split(parsed);
    const finish = finishReason(parsed);
    let calls = options.calls(parsed);
    // Never execute a hypothetical tool call from hidden reasoning.
    if (!calls.length) calls = embeddedToolCalls(parts.text);
    if (!calls.length && attempt.plainTools) {
      const reply = plainAgentReply(parts.text);
      if (reply?.call) calls = [reply.call];
      else if (reply?.answer !== undefined) parts.text = reply.answer;
      else {
        const missing = Boolean(options.filesRequested) && !(options.hasFiles?.() ?? true);
        const saved = missing ? await salvage(parts.text) : null;
        if (saved) return { text: saved, reason: "", usage };
        if (repaired >= 3) parts.text = parts.text.trim();
        else {
          repaired += 1;
          note("plan", "Собираю файлы", "running");
          wire.push({ role: "assistant", content: parts.text.slice(0, 1500) });
          wire.push({
            role: "user",
            content: finish === "length" || !parts.text.trim().endsWith("}")
              ? "Вызов не поместился. Раздели содержимое на несколько файлов меньшего размера и вызови save_files заново, одним JSON."
              : 'Исправь формат: один JSON {"tool":"имя доступного инструмента","arguments":{...}} для следующего действия исходной задачи либо {"answer":"итог"}. Используй схему выбранного инструмента. Код в answer не сохраняется.',
          });
          continue;
        }
      }
    }
    const filesMissing = Boolean(options.filesRequested) && !(options.hasFiles?.() ?? true);
    if (!calls.length) {
      const needWrite = Boolean(options.writeRequested) && !options.hasChanges();
      const asking = parts.text.trim().endsWith("?") && parts.text.trim().length < 600;
      const blocked = /достигнут предел|квот|подписк/i.test(lastToolError);
      if ((needWrite || filesMissing) && !asking && !blocked) {
        const saved = filesMissing ? await salvage(parts.text) : null;
        if (saved) return { text: saved, reason: "", usage };
        if (repaired < 3) {
          repaired += 1;
          if (!attempt.plainTools) options.forcePlain?.();
          note("plan", "Собираю файлы", "running");
          wire.push({ role: "assistant", content: parts.text.slice(0, 1500) });
          wire.push({
            role: "user",
            content: filesMissing
              ? 'Файлы исходной задачи ещё не сохранены. Вызови save_files с нужными именами и полным содержимым. Для правки существующего файла сначала read_my_file, затем edit_my_file с version. Не меняй тип задачи и не пиши код в answer.'
              : 'Изменение ещё не подтверждено. Продолжи исходную задачу через подходящий инструмент (создать папку, записать или изменить файл). Верни один JSON вызова по его схеме либо {"answer":"один короткий вопрос?"}. Не создавай посторонних файлов.',
          });
          continue;
        }
      }
      if (filesMissing && !asking) {
        const kept = parts.text.trim();
        const hint = options.hasChanges()
          ? "Папка есть, файлы не записались. Напишите «продолжай» — сохраню сайт целиком."
          : "Файлы на диск не легли. Напишите «продолжай» — соберу проект ещё раз.";
        parts.text = kept.length > 80 && !/не легли|не записались/i.test(kept)
          ? `${kept}\n\n${lastToolError ? `${lastToolError}\n\n` : ""}${hint}`
          : `${lastToolError ? `${lastToolError} ` : ""}${hint}`;
      } else if (needWrite && !asking)
        parts.text = `Изменения на дисках не выполнялись. ${lastToolError || "Модель не вызвала запись. Напишите «продолжай»."}`;
      else if (lastToolError && !asking) parts.text += `\n\nНе выполнено: ${lastToolError}`;
      if (parts.text.trim() || parts.reason.trim()) return { ...parts, usage };
      break;
    }
    // Record actual execution, then keep exactly that history when the provider changes.
    const batch = calls.slice(0, 6).map((call) => ({ ...call, id: `step_${round}_${crypto.randomUUID()}` }));
    wire.push({
      role: "assistant",
      content: parts.text || "",
      tool_calls: batch.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.args },
      })),
    });
    const runCall = async (call: Call) => {
      signal.throwIfAborted();
      const args = parseToolArguments(call.args);
      const info = stepInfo(call.name, args);
      options.onProgress?.({ id: call.id, tool: call.name, label: info.label, detail: info.detail, status: "running" });
      const cut = !call.args.trim().endsWith("}") || finish === "length";
      const fingerprint = `${call.name}:${args ? JSON.stringify(args) : call.args}`;
      let text: string;
      if (receipts.has(fingerprint)) { text = receipts.get(fingerprint)!; repeatedResults++; }
      else if ((failures.get(fingerprint) ?? 0) >= 2) {
        releaseAnswer = true;
        text = JSON.stringify({ error: "Одинаковый вызов уже дважды завершился ошибкой. Измени аргументы или сообщи о препятствии пользователю." });
      } else {
        try {
          text = args
            ? await options.invoke(call.name, args)
            : JSON.stringify({ error: cut
                ? "Вызов не поместился. Раздели содержимое на несколько файлов меньшего размера и вызови save_files заново."
                : "Некорректный JSON arguments. Передай объект аргументов, не массив." });
        } catch {
          signal.throwIfAborted();
          text = JSON.stringify({ error: "Инструмент временно недоступен. Результат не подтверждён." });
        }
      }
      let failed = false;
      try {
        const result = JSON.parse(text);
        const partialError = Array.isArray(result.files) ? result.files.find((file: { error?: string }) => file.error)?.error : undefined;
        if (typeof result.error === "string" || typeof partialError === "string") {
          failed = true;
          failures.set(fingerprint, (failures.get(fingerprint) ?? 0) + 1);
          lastToolError = (result.error || partialError).slice(0, 300);
          if (/достигнут предел|сообщите пользователю|квот|подписк/i.test(lastToolError))
            releaseAnswer = true;
        } else if (result.saved || result.created || (Array.isArray(result.files) && result.files.some((item: { saved?: boolean }) => item?.saved))) lastToolError = "";
      } catch {
        /* External tool replies may be non-JSON. */
      }
      if (!failed && /^(save_my_text|save_files|create_my_folder|write_my_file|edit_my_file|generate_image)$/.test(call.name)) receipts.set(fingerprint, text);
      options.onProgress?.({ id: call.id, tool: call.name, label: info.label, detail: info.detail, status: failed ? "error" : "done" });
      return text;
    };
    const writes = (name: string) => /^(save_my_text|save_files|create_my_folder|write_my_file|edit_my_file|generate_image)$/.test(name);
    const texts: string[] = [];
    for (let index = 0; index < batch.length; ) {
      if (writes(batch[index].name)) {
        texts.push(await runCall(batch[index]));
        index += 1;
        continue;
      }
      const group: Call[] = [];
      while (index < batch.length && !writes(batch[index].name)) {
        group.push(batch[index]);
        index += 1;
      }
      texts.push(...(await Promise.all(group.map((call) => runCall(call)))));
    }
    for (let index = 0; index < batch.length; index += 1)
      wire.push({ role: "tool", tool_call_id: batch[index].id, content: texts[index] });
    options.afterTools?.();
    if (repeatedResults >= 4) break;
    if (repeatedResults >= 2) wire.push({ role: "user", content: "Успешный вызов уже выполнен, результат сохранён в истории. Не повторяй его. Выполни только недостающие действия исходной задачи или дай итог со ссылками из результатов." });
  }
  if (options.hasChanges())
    return {
      text:
        options.filesRequested && !(options.hasFiles?.() ?? false)
          ? `Папка есть, файлы не записались. ${lastToolError || "Напишите «продолжай» — сохраню сайт целиком."}`
          : `Сохранённые файлы уже на диске. ${lastToolError ? `Не завершено: ${lastToolError}. ` : "Лимит шагов достигнут. "}Напишите «продолжай», чтобы закончить задачу.`,
      reason: "",
      usage,
    };
  if (options.filesRequested && !(options.hasFiles?.() ?? false))
    return {
      text: `Файлы на диск не легли. ${lastToolError || "Напишите «продолжай» — соберу проект ещё раз."}`,
      reason: "",
      usage,
    };
  if (options.writeRequested)
    return {
      text: "Изменения на дисках не выполнялись: модель не завершила задачу за отведённые шаги. Попробуйте разбить её на части.",
      reason: "",
      usage,
    };
  return null;
}

function stepInfo(name: string, args: Record<string, unknown> | null): { label: string; detail?: string } {
  const text = (value: unknown, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  if (name === "web_search") {
    const query = text(args?.query);
    return { label: query ? `Ищу «${query}»` : "Ищу в интернете" };
  }
  if (name === "fetch_url") {
    let host = "";
    try { host = new URL(text(args?.url, 500)).hostname; } catch { host = ""; }
    return { label: host ? `Читаю ${host}` : "Читаю страницу" };
  }
  if (name === "generate_image") return { label: "Рисую", detail: text(args?.prompt) || undefined };
  if (name === "create_my_folder") {
    const folder = text(args?.name, 60);
    return { label: folder ? `Создаю папку «${folder}»` : "Создаю папку" };
  }
  if (name === "save_files") {
    const folder = text(args?.folder, 60);
    const names = Array.isArray(args?.files)
      ? args.files.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const path = text((item as { path?: unknown; name?: unknown }).path || (item as { name?: unknown }).name, 40);
          return path ? [path.split("/").pop() || path] : [];
        }).slice(0, 4)
      : [];
    return { label: folder ? `Сохраняю проект «${folder}»` : "Сохраняю файлы", detail: names.length ? names.join(", ") : undefined };
  }
  if (name === "save_my_text" || name === "write_my_file") {
    const file = text(args?.name, 60);
    return { label: file ? `Сохраняю ${file}` : "Сохраняю файл" };
  }
  if (name === "read_my_file" || name === "my_files") {
    const query = text(args?.query || args?.name, 60);
    return { label: query ? `Читаю «${query}»` : "Читаю файлы" };
  }
  if (name === "my_folders") return { label: "Смотрю папки" };
  return { label: name };
}

/** Pull a deliverable site out of a prose answer when a weak model did not call a tool. */
export function filesFromAnswer(text: string): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  const used = new Set<string>();
  const take = (path: string, body: string) => {
    const clean = body.replace(/\s+$/, "");
    if (clean.length < 40 || used.has(path) || files.length >= 8) return;
    used.add(path);
    files.push({ path, text: clean.slice(0, 80_000) });
  };
  for (const match of text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    const info = (match[1] || "").trim();
    const body = match[2] || "";
    if (/^\s*\{/.test(body) && /"tool"\s*:/.test(body)) continue;
    const named = /([\w.-]+\.(?:html|htm|css|scss|js|mjs|jsx|ts|tsx|json|md|svg|py|txt))$/i.exec(info);
    if (named?.[1]) {
      take(named[1], body);
      continue;
    }
    const lang = info.split(/\s+/)[0]?.toLowerCase() || "";
    if (lang === "html" || /<!doctype|<html[\s>]/i.test(body)) take(used.has("index.html") ? `page${files.length}.html` : "index.html", body);
    else if (lang === "css") take(used.has("styles.css") ? `styles${files.length}.css` : "styles.css", body);
    else if (lang === "javascript" || lang === "js") take(used.has("script.js") ? `script${files.length}.js` : "script.js", body);
    else if (lang === "markdown" || lang === "md") take("README.md", body);
    else if (lang === "svg") take("image.svg", body);
    else if (lang === "json") take("data.json", body);
    else if (lang === "python" || lang === "py") take("main.py", body);
    else if (lang === "typescript" || lang === "ts") take("main.ts", body);
    else if (lang === "tsx") take("App.tsx", body);
  }
  if (!files.length) {
    const doc = /<!doctype html[\s\S]{80,}/i.exec(text) || /<html[\s\S]{80,}/i.exec(text);
    if (doc) take("index.html", doc[0]);
  }
  const weight = files.reduce((sum, file) => sum + file.text.length, 0);
  const html = files.some((file) => /\.html?$/i.test(file.path) && /<!doctype|<html[\s>]/i.test(file.text));
  if (html || weight >= 400 || (files.length >= 2 && weight >= 120)) return files;
  return [];
}

function folderTitle(files: { path: string; text: string }[]): string {
  const html = files.find((file) => /\.html?$/i.test(file.path));
  const title = html ? /<title>([^<]{1,40})<\/title>/i.exec(html.text)?.[1]?.trim() : "";
  const clean = (title || "Сайт").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 40);
  return clean || "Сайт";
}

function finishReason(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  const reason =
    first && typeof first === "object" ? (first as { finish_reason?: unknown }).finish_reason : "";
  return typeof reason === "string" ? reason : "";
}
