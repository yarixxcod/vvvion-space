import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertActive, assertAdmin } from "@/lib/social/access";
import type { SaveFact } from "./store";
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Некорректный запрос памяти");
  return input as Record<string, unknown>;
}
function id(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{3,100}$/.test(value))
    throw new Error("Запись или диалог не найдены");
  return value;
}
export const getMemoryWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((v: unknown) => {
    const r = v && typeof v === "object" ? record(v) : {};
    return { chatKey: r.chatKey ? id(r.chatKey) : "" };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const service = await import("./service.server");
    try {
      return await service.workspace(context.userId, data.chatKey);
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
export const updateMemorySettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((v: unknown) => {
    const r = record(v);
    if (typeof r.enabled !== "boolean" || typeof r.automatic !== "boolean")
      throw new Error("Некорректные настройки");
    return { enabled: r.enabled, automatic: r.automatic, consent: r.consent === true };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const service = await import("./service.server");
    const { setPrefs } = await import("./store");
    try {
      await service.mutate(context.userId, (sql) => setPrefs(sql, context.userId, data));
      return await service.workspace(context.userId);
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
export const saveUserMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((v: unknown): SaveFact => {
    const r = record(v);
    if (r.id && (!Number.isInteger(r.version) || Number(r.version) < 1))
      throw new Error("Обновите список записей");
    return {
      id: r.id ? id(r.id) : undefined,
      version: r.version as number | undefined,
      content: r.content,
      category: r.category,
      confirmSensitive: r.confirmSensitive === true,
      activate: r.activate === true,
      expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : null,
    };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const service = await import("./service.server");
    const { saveFact } = await import("./store");
    try {
      const result = await service.mutate(context.userId, (sql) =>
        saveFact(sql, context.userId, data),
      );
      return { ...(await service.workspace(context.userId)), duplicate: result.duplicate };
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
export const deleteUserMemory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((v: unknown) => {
    const r = record(v);
    if (!Number.isInteger(r.version) || Number(r.version) < 1)
      throw new Error("Обновите список записей");
    return { id: id(r.id), version: Number(r.version) };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const service = await import("./service.server");
    const { removeFact } = await import("./store");
    try {
      await service.mutate(context.userId, (sql) =>
        removeFact(sql, context.userId, data.id, data.version),
      );
      return await service.workspace(context.userId);
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
export const clearUserMemories = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((v: unknown) => {
    if (record(v).confirm !== "CLEAR_MEMORY") throw new Error("Подтвердите очистку памяти");
    return true;
  })
  .handler(async ({ context }) => {
    await assertActive(context.userId);
    const service = await import("./service.server");
    const { clearFacts } = await import("./store");
    try {
      await service.mutate(context.userId, (sql) => clearFacts(sql, context.userId));
      return await service.workspace(context.userId);
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
export const exportUserMemories = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertActive(context.userId);
    const service = await import("./service.server");
    try {
      service.requireMemory(context.userId);
      const s = await service.workspace(context.userId);
      return {
        format: "vvvion-memory",
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: s.prefs,
        memories: s.entries,
      };
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
export const setMemoryChatPolicy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((v: unknown) => {
    const r = record(v);
    if (typeof r.disabled !== "boolean") throw new Error("Некорректный режим");
    return { chatKey: id(r.chatKey), disabled: r.disabled };
  })
  .handler(async ({ context, data }) => {
    await assertActive(context.userId);
    const service = await import("./service.server");
    const { setChatPolicy } = await import("./store");
    try {
      await service.mutate(context.userId, (sql) =>
        setChatPolicy(sql, context.userId, data.chatKey, data.disabled),
      );
      return await service.workspace(context.userId, data.chatKey);
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
export const getMemoryAdminStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const service = await import("./service.server");
    try {
      return await service.memoryAdminStats();
    } catch (e) {
      return service.publicMemoryError(e);
    }
  });
