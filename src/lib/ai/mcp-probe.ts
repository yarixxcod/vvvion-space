import { createServerFn } from "@tanstack/react-start";

export const probeMcp = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = typeof input === "string" ? input : input && typeof input === "object" ? (input as { url?: unknown }).url : "";
    return typeof raw === "string" ? raw.trim() : "";
  })
  .handler(async ({ data }): Promise<{ tools: string[] }> => {
    const { listPublicTools } = await import("./mcp.server");
    return listPublicTools(data);
  });
