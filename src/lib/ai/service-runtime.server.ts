import { getSql } from "@/lib/db";
import { publicFetch } from "@/lib/security/net-guard";
import { isServiceModel, servicePurpose } from "./service-model";
/** Internal-only request adapter. Provider credentials never enter public model lists. */
export async function callServiceModel(name: string, input: Record<string, unknown>) {
  if (!isServiceModel(name)) throw Error("Нужна служебная модель");
  const sql = await getSql();
  const providers = await sql<{
    base_url: string;
    api_key: string;
    model_id: string;
  }>`select p.base_url,p.api_key,p.model_id from catalog_providers p join catalog_models m on m.name=p.model_name where m.name=${name} order by p.slot asc`;
  const purpose = servicePurpose(name),
    endpoint =
      purpose === "embedding" ? "embeddings" : purpose === "rerank" ? "rerank" : "chat/completions";
  for (const provider of providers) {
    if (!provider.api_key) continue;
    try {
      const response = await publicFetch(
        provider.base_url.replace(/\/+$/, "") + "/" + endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + provider.api_key,
          },
          body: JSON.stringify({ ...input, model: provider.model_id }),
          signal: AbortSignal.timeout(15000),
        },
        { hops: 0, timeoutMs: 15000 },
      );
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      return (await response.json()) as Record<string, unknown>;
    } catch {
      /* The next configured provider has lower priority. */
    }
  }
  throw Error("Служебная модель не ответила. Проверьте адрес, имя модели и ключ провайдеров");
}
export async function probeServiceModel(data: string) {
  const purpose = servicePurpose(data);
  const result = await callServiceModel(
    data,
    purpose === "embedding"
      ? { input: ["Тест служебной модели"] }
      : purpose === "rerank"
        ? {
            query: "Connect",
            documents: ["Connect — защищённое подключение", "Погода сегодня"],
            top_n: 1,
          }
        : { messages: [{ role: "user", content: "Ответь одним словом: OK" }], max_tokens: 16 },
  );
  if (
    purpose === "embedding" &&
    (!Array.isArray(result.data) ||
      !Array.isArray((result.data[0] as { embedding?: unknown })?.embedding))
  )
    throw Error("Провайдер не вернул вектор эмбеддинга");
  if (purpose === "internal" && !Array.isArray(result.choices))
    throw Error("Провайдер не вернул текстовый ответ");
  if (purpose === "rerank" && !Array.isArray(result.results) && !Array.isArray(result.data))
    throw Error("Провайдер не вернул результат ранжирования");
  return { ok: true };
}
