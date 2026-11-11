/** Hide raw browser errors such as "Failed to fetch". */
export function loadError(message: string, fallback = "Не удалось загрузить. Проверьте соединение.") {
  const text = message.trim();
  if (!text || /failed to fetch|networkerror|load failed|failed to load/i.test(text)) return fallback;
  return text;
}
