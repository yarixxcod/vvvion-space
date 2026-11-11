import { openDb } from "@/lib/ai/db";
import type { ParsedBook, ShelfBook } from "@/lib/books/types";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
  });
}

export async function listBooks(ownerId: string): Promise<ShelfBook[]> {
  const db = await openDb();
  try {
    const rows = (await request(db.transaction("books").objectStore("books").getAll())) as ShelfBook[];
    return rows.filter((row) => row.ownerId === ownerId).sort((a, b) => b.openedAt - a.openedAt);
  } finally {
    db.close();
  }
}

export async function saveParsedBook(ownerId: string, fileName: string, bytes: Uint8Array, book: ParsedBook): Promise<ShelfBook> {
  const row: ShelfBook = {
    id: crypto.randomUUID(),
    ownerId,
    title: book.title,
    author: book.author,
    language: book.language,
    format: book.format,
    cover: book.cover,
    fileName,
    words: book.words,
    chapters: Math.max(book.chapters.length, book.format === "pdf" ? 1 : 0),
    addedAt: Date.now(),
    openedAt: Date.now(),
    chapter: 0,
    ratio: 0,
  };
  const db = await openDb();
  try {
    const tx = db.transaction(["books", "bookFiles"], "readwrite");
    tx.objectStore("books").put(row);
    tx.objectStore("bookFiles").put({ id: row.id, bytes: bytes.slice() });
    await txDone(tx);
    return row;
  } finally {
    db.close();
  }
}

export async function loadBookBytes(id: string): Promise<Uint8Array> {
  const db = await openDb();
  try {
    const row = (await request(db.transaction("bookFiles").objectStore("bookFiles").get(id))) as { bytes?: ArrayBuffer | Uint8Array } | undefined;
    if (!row?.bytes) throw new Error("Файл книги не найден");
    return row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes);
  } finally {
    db.close();
  }
}

export async function touchBook(id: string, patch: Partial<Pick<ShelfBook, "chapter" | "ratio" | "openedAt">>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result as ShelfBook | undefined;
        if (current) store.put({ ...current, ...patch });
      };
      getReq.onerror = () => reject(getReq.error ?? new Error("IndexedDB"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB"));
    });
  } finally {
    db.close();
  }
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(["books", "bookFiles"], "readwrite");
    tx.objectStore("books").delete(id);
    tx.objectStore("bookFiles").delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB"));
  });
}
