import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { Mark } from "@/components/yaronetic/mark";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { Transcript } from "@/components/yaronetic/transcript";
import { readSharedChat } from "@/lib/ai/share";

const ROBOTS = "noindex, nofollow, noarchive, nosnippet, noimageindex";

export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }) => {
    const row = await readSharedChat({ data: params.token });
    if (!row) throw notFound();
    return row;
  },
  headers: () => ({
    "X-Robots-Tag": ROBOTS,
    "Cache-Control": "private, no-store",
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.title ? `${loaderData.title} · копия диалога` : "Копия диалога" },
      { name: "robots", content: ROBOTS },
      { name: "googlebot", content: ROBOTS },
    ],
  }),
  component: SharePage,
});

function SharePage() {
  const data = Route.useLoaderData();
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <div className="ambient" aria-hidden="true">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="grain" />
      </div>
      <header className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3">
        <Mark size={36} />
        <div className="min-w-0">
          <Wordmark large />
          <p className="mt-1 truncate text-sm text-muted">{data?.title ?? "Диалог"}</p>
        </div>
        <Link
          to="/"
          className="press ml-auto inline-flex h-11 shrink-0 items-center rounded-2xl border border-line bg-elev px-3 text-sm"
        >
          К чату
        </Link>
      </header>
      {data ? (
        <Transcript messages={data.messages} streaming={false} readonly onRegenerate={() => undefined} onResend={() => undefined} />
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h1 className="font-serif text-3xl">Ссылка не действует</h1>
          <p className="mt-2 max-w-sm text-sm text-muted">Этой копии нет. Возможно, её уже сняли или адрес неполный.</p>
        </div>
      )}
    </div>
  );
}
