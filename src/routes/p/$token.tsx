import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { PersonFace } from "@/components/yaronetic/person-face";
import { PostAttachments } from "@/components/yaronetic/post-media";
import { ScreenClip } from "@/components/yaronetic/screen-clip";
import { splitChat } from "@/lib/screen/mark";
import { Mark } from "@/components/yaronetic/mark";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { readSharedPost } from "@/lib/social/feed";

const ROBOTS = "noindex, nofollow, noarchive, nosnippet, noimageindex";

export const Route = createFileRoute("/p/$token")({
  loader: async ({ params }) => {
    const row = await readSharedPost({ data: params.token });
    if (!row) throw notFound();
    return row;
  },
  headers: () => ({
    "X-Robots-Tag": ROBOTS,
    "Cache-Control": "private, no-store",
  }),
  head: ({ loaderData }) => {
    const title = splitChat(loaderData?.body ?? "").text.slice(0, 72) || (loaderData?.body ? "Запись" : "Запись");
    return {
      meta: [
        { title: loaderData ? `${title} · запись` : "Запись" },
        { name: "robots", content: ROBOTS },
        { name: "googlebot", content: ROBOTS },
      ],
    };
  },
  component: PostLinkPage,
});

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function SharedBody({ body }: { body: string }) {
  const clip = splitChat(body);
  return (
    <>
      {clip.text ? <p className="mt-4 whitespace-pre-wrap text-pretty">{clip.text}</p> : null}
      {clip.screen.map((id) => (
        <ScreenClip key={id} id={id} />
      ))}
      {clip.mega.length ? <p className="mt-3 text-sm text-muted">Файл с Мегадиска открывается в ленте, когда вы вошли.</p> : null}
    </>
  );
}

function PostLinkPage() {
  const data = Route.useLoaderData();
  const { token } = Route.useParams();
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="ambient" aria-hidden="true">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="grain" />
      </div>
      <header className="relative z-10 flex items-center gap-3 border-b border-line px-4 py-3">
        <Mark size={36} />
        <div className="min-w-0">
          <Wordmark large />
          <p className="mt-1 truncate text-sm text-muted">Запись</p>
        </div>
        <Link to="/" className="press ml-auto inline-flex h-11 shrink-0 items-center rounded-2xl border border-line bg-elev px-3 text-sm">
          К чату
        </Link>
      </header>
      {data ? (
        <main className="relative z-10 mx-auto w-full max-w-xl flex-1 px-4 py-6">
          <article className="rounded-3xl border border-line bg-elev p-4 shadow-[var(--shadow)]">
            <div className="flex items-center gap-3">
              <PersonFace name={data.author} image={data.authorImage} size={44} userId={data.authorId} />
              <div className="min-w-0">
                <p className="truncate font-medium">{data.author}</p>
                <time className="text-xs tabular-nums text-faint">{when(data.createdAt)}</time>
              </div>
            </div>
            {data.body ? <SharedBody body={data.body} /> : null}
            <PostAttachments files={data.files} urlFor={(file) => `/api/post-share/${token}/${file.id}`} />
          </article>
        </main>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h1 className="font-serif text-3xl">Ссылка не действует</h1>
          <p className="mt-2 max-w-sm text-sm text-muted">Этой записи нет. Возможно, её уже удалили или адрес неполный.</p>
        </div>
      )}
    </div>
  );
}
