import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Reader } from "@/components/yaronetic/library";
import { Mark } from "@/components/yaronetic/mark";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { readSharedBook } from "@/lib/books/shelf";
import type { ShelfBook } from "@/lib/books/types";

const ROBOTS = "noindex, nofollow, noarchive, nosnippet, noimageindex";

export const Route = createFileRoute("/b/$token")({
  loader: async ({ params }) => {
    const row = await readSharedBook({ data: params.token });
    if (!row) throw notFound();
    return row;
  },
  headers: () => ({
    "X-Robots-Tag": ROBOTS,
    "Cache-Control": "private, no-store",
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.title ? `${loaderData.title} · книга` : "Книга" },
      { name: "robots", content: ROBOTS },
      { name: "googlebot", content: ROBOTS },
    ],
  }),
  component: BookLinkPage,
});

function BookLinkPage() {
  const data = Route.useLoaderData();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  if (!data) {
    return (
      <div className="relative flex h-dvh flex-col overflow-hidden">
        <div className="ambient" aria-hidden="true">
          <div className="orb orb-a" />
          <div className="orb orb-b" />
          <div className="grain" />
        </div>
        <header className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3">
          <Mark size={36} />
          <Wordmark large />
          <Link to="/" className="press ml-auto inline-flex h-11 shrink-0 items-center rounded-2xl border border-line bg-elev px-3 text-sm">
            К чату
          </Link>
        </header>
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h1 className="font-serif text-3xl">Ссылка не действует</h1>
          <p className="mt-2 max-w-sm text-sm text-muted">Этой книги нет. Возможно, её убрали с полки или адрес неполный.</p>
        </div>
      </div>
    );
  }
  const book: ShelfBook = {
    id: data.id,
    ownerId: "",
    title: data.title,
    author: data.author,
    language: data.language,
    format: data.format,
    cover: data.cover,
    fileName: data.fileName,
    words: data.words,
    chapters: data.chapters,
    addedAt: Date.now(),
    openedAt: Date.now(),
    chapter: 0,
    ratio: 0,
  };
  return (
    <div className="h-dvh">
      <Reader
        book={book}
        linkToken={token}
        closeLabel="К чату"
        onClose={() => void navigate({ to: "/" })}
        onProgress={() => undefined}
      />
    </div>
  );
}
