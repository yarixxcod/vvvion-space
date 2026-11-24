/** Short pauses inside a phrase are kept; silence alone never becomes a request. */
export function voiceBoundary(now: number, started: number, lastSpeech: number, voicedMs: number) {
  if (now - started >= 30_000) return voicedMs >= 240 ? "send" : "discard";
  if (voicedMs >= 240 && now - lastSpeech >= 1100) return "send";
  if (voicedMs < 240 && now - started >= 8000) return "discard";
  return "wait";
}

export function voiceText(raw: string) {
  return raw
    .replace(/\[\[like\]\]/g, "")
    .replace(/\[\[sticker:[^\]]*\]\]/g, "")
    .replace(/```[\s\S]*?```/g, " Код оставлен в чате. ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2400);
}
export const VOICE_PROMPT =
  "Сейчас идёт голосовой звонок. Отвечай естественно, короткими фразами, обычно 1–3 предложения. Не используй Markdown, таблицы, ссылки и служебные метки в устном ответе. Если нужен код или длинный материал, оставь его в чате и кратко объясни голосом. Не заявляй об успешном действии до подтверждения инструмента. Сохраняй выбранную роль и контекст беседы.";
