import { DB_NAME, PREF_CHAT, PREF_CHAT_OWNER } from "@/lib/ai/defaults";
import type { Chat, Provider } from "@/lib/ai/types";

const VERSION = 3;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    let settled = false;
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("chats")) {
        const chats = db.createObjectStore("chats", { keyPath: "id" });
        chats.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("providers")) {
        db.createObjectStore("providers", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("books")) {
        const books = db.createObjectStore("books", { keyPath: "id" });
        books.createIndex("ownerId", "ownerId");
      }
      if (!db.objectStoreNames.contains("bookFiles")) {
        db.createObjectStore("bookFiles", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      reject(req.error ?? new Error("IndexedDB"));
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("IndexedDB"));
    };
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
  });
}

export async function loadChats(): Promise<Chat[]> {
  const db = await openDb();
  const rows = await request(db.transaction("chats").objectStore("chats").getAll());
  db.close();
  return (rows as Chat[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveChat(chat: Chat): Promise<void> {
  const db = await openDb();
  await request(db.transaction("chats", "readwrite").objectStore("chats").put(chat));
  db.close();
}

export async function deleteChat(id: string): Promise<void> {
  const db = await openDb();
  await request(db.transaction("chats", "readwrite").objectStore("chats").delete(id));
  db.close();
}

export async function loadProviders(): Promise<Provider[]> {
  const db = await openDb();
  const rows = await request(db.transaction("providers").objectStore("providers").getAll());
  db.close();
  return rows as Provider[];
}

export async function saveProviders(providers: Provider[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("providers", "readwrite");
  const store = tx.objectStore("providers");
  await request(store.clear());
  for (const provider of providers) {
    store.put(stripBuiltinKey(provider));
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB"));
  });
  db.close();
}

function stripBuiltinKey(provider: Provider): Provider {
  if (provider.kind !== "builtin") return provider;
  return { ...provider, apiKey: "" };
}

export async function clearChats(): Promise<void> {
  const db = await openDb();
  await request(db.transaction("chats", "readwrite").objectStore("chats").clear());
  db.close();
}

export async function forgetLocalChats(): Promise<void> {
  await clearChats();
  try {
    localStorage.removeItem(PREF_CHAT);
    localStorage.removeItem(PREF_CHAT_OWNER);
  } catch {
    /* private mode */
  }
}

export function wipeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
    req.onblocked = () => resolve();
  });
}
