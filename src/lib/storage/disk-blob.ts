import { createServerOnlyFn } from "@tanstack/react-start";
export const encodeDiskBlob = createServerOnlyFn(async (owner: string, bytes: Uint8Array): Promise<string> => {
  const storage = await import("./s3.server");
  return storage.encodeDiskBlob(owner, bytes);
});
export const decodeDiskBlob = createServerOnlyFn(async (owner: string, data: string): Promise<Buffer> => {
  const storage = await import("./s3.server");
  return storage.decodeDiskBlob(owner, data);
});
export const removeDiskBlob = createServerOnlyFn(async (owner: string, data: string): Promise<void> => {
  const storage = await import("./s3.server");
  return storage.removeDiskBlob(owner, data);
});
