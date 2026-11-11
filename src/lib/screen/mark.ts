const SCREEN = /⟦screen:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})⟧/gi;
const BOOK = /⟦book:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})⟧/gi;
const POST = /⟦post:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})⟧/gi;
const MEGA = /⟦mega:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})⟧/gi;

export function screenMark(id: string): string {
  return `⟦screen:${id}⟧`;
}

export function bookMark(id: string): string {
  return `⟦book:${id}⟧`;
}

export function postMark(id: string): string {
  return `⟦post:${id}⟧`;
}

export function megaMark(id: string): string {
  return `⟦mega:${id}⟧`;
}

function take(body: string, pattern: RegExp): { text: string; ids: string[] } {
  const ids: string[] = [];
  const text = body.replace(pattern, (_full, id: string) => {
    ids.push(id);
    return "";
  });
  return { text, ids };
}

export function splitScreen(body: string): { text: string; ids: string[] } {
  const next = take(body, SCREEN);
  return { text: tidy(next.text), ids: next.ids };
}

export function splitChat(body: string): { text: string; screen: string[]; books: string[]; posts: string[]; mega: string[] } {
  const screen = take(body, SCREEN);
  const books = take(screen.text, BOOK);
  const posts = take(books.text, POST);
  const mega = take(posts.text, MEGA);
  return { text: tidy(mega.text), screen: screen.ids, books: books.ids, posts: posts.ids, mega: mega.ids };
}

function tidy(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

