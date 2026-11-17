export type GrabEvent<T> =
  | {
      type: "progress";
      phase: "open" | "fetch" | "save";
      pct: number;
      loaded: number;
      total: number;
    }
  | { type: "done"; files: T[] }
  | { type: "error"; message: string };
/** NDJSON can split UTF-8 and records anywhere, including the final newline. */
export async function readGrabStream<T>(
  body: ReadableStream<Uint8Array>,
  receive: (event: GrabEvent<T>) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const line = (raw: string) => {
    if (raw.trim()) receive(JSON.parse(raw) as GrabEvent<T>);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 1024 * 1024) throw new Error("Слишком большой ответ загрузчика");
      const records = buffer.split("\n");
      buffer = records.pop() || "";
      records.forEach(line);
      if (done) {
        line(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
