import * as sqlStore from "./sql-store.ts";
import * as s3Store from "./s3-store.server.ts";
export type { SaveFact } from "./sql-store.ts";
export const DEFAULT_PREFS = sqlStore.DEFAULT_PREFS;
export type MemorySql = sqlStore.MemorySql | s3Store.S3Session;
function isS3(session: MemorySql): session is s3Store.S3Session { return "kind" in session && session.kind === "s3-memory"; }
export function prefs(session: MemorySql, ...args: Parameters<typeof sqlStore.prefs> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.prefs> {
  return isS3(session) ? s3Store.prefs(session, ...args) : sqlStore.prefs(session, ...args);
}
export function listFacts(session: MemorySql, ...args: Parameters<typeof sqlStore.listFacts> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.listFacts> {
  return isS3(session) ? s3Store.listFacts(session, ...args) : sqlStore.listFacts(session, ...args);
}
export function chatDisabled(session: MemorySql, ...args: Parameters<typeof sqlStore.chatDisabled> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.chatDisabled> {
  return isS3(session) ? s3Store.chatDisabled(session, ...args) : sqlStore.chatDisabled(session, ...args);
}
export function setPrefs(session: MemorySql, ...args: Parameters<typeof sqlStore.setPrefs> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.setPrefs> {
  return isS3(session) ? s3Store.setPrefs(session, ...args) : sqlStore.setPrefs(session, ...args);
}
export function saveFact(session: MemorySql, ...args: Parameters<typeof sqlStore.saveFact> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.saveFact> {
  return isS3(session) ? s3Store.saveFact(session, ...args) : sqlStore.saveFact(session, ...args);
}
export function removeFact(session: MemorySql, ...args: Parameters<typeof sqlStore.removeFact> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.removeFact> {
  return isS3(session) ? s3Store.removeFact(session, ...args) : sqlStore.removeFact(session, ...args);
}
export function clearFacts(session: MemorySql, ...args: Parameters<typeof sqlStore.clearFacts> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.clearFacts> {
  return isS3(session) ? s3Store.clearFacts(session, ...args) : sqlStore.clearFacts(session, ...args);
}
export function setChatPolicy(session: MemorySql, ...args: Parameters<typeof sqlStore.setChatPolicy> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.setChatPolicy> {
  return isS3(session) ? s3Store.setChatPolicy(session, ...args) : sqlStore.setChatPolicy(session, ...args);
}
export function captureFacts(session: MemorySql, ...args: Parameters<typeof sqlStore.captureFacts> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.captureFacts> {
  return isS3(session) ? s3Store.captureFacts(session, ...args) : sqlStore.captureFacts(session, ...args);
}
export function retrieveFacts(session: MemorySql, ...args: Parameters<typeof sqlStore.retrieveFacts> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.retrieveFacts> {
  return isS3(session) ? s3Store.retrieveFacts(session, ...args) : sqlStore.retrieveFacts(session, ...args);
}
export function event(session: MemorySql, ...args: Parameters<typeof sqlStore.event> extends [unknown, ...infer A] ? A : never): ReturnType<typeof sqlStore.event> {
  return isS3(session) ? s3Store.event(session, ...args) : sqlStore.event(session, ...args);
}
