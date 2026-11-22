import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseMemoryInput, type MemoryResponse } from "@/lib/ai/memory-doc";

export const loadMemoryProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MemoryResponse> => {
    const { readMemoryProfile } = await import("@/lib/ai/memory-store.server");
    return readMemoryProfile(context.userId);
  });

export const saveMemoryProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseMemoryInput(input))
  .handler(async ({ context, data }): Promise<MemoryResponse> => {
    const { writeMemoryProfile } = await import("@/lib/ai/memory-store.server");
    return writeMemoryProfile(context.userId, data);
  });
