import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { SharePage } from "@/components/yaronetic/share-page";
import { readPublicDisk } from "@/lib/social/disk.fn";
import { readPublicMega, type PublicMega, type PublicMegaEntry } from "@/lib/social/mega";
import { mediaKind, type ShareEntry, type SharePageData } from "@/lib/share-view";

const ROBOTS = "noindex, nofollow, noarchive, nosnippet, noimageindex";
const FOLDER = /^[A-Za-z0-9_-]{8,80}$/;

export const Route = createFileRoute("/d/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    f: typeof search.f === "string" && FOLDER.test(search.f) ? search.f : undefined,
  }),
  loaderDeps: ({ search }) => ({ f: search.f }),
  loader: async ({ params, deps }) => {
    const folder = deps.f ?? null;
    const mega = await readPublicMega({ data: { token: params.token, folder } });
    if (mega) return fromMega(mega, params.token);
    const disk = await readPublicDisk({ data: { token: params.token, folder } });
    if (disk) return disk;
    throw notFound();
  },
  headers: () => ({
    "X-Robots-Tag": ROBOTS,
    "Cache-Control": "private, no-store",
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.title ? `${loaderData.title}` : "Общий доступ" },
      { name: "robots", content: ROBOTS },
      { name: "googlebot", content: ROBOTS },
    ],
  }),
  component: Page,
  notFoundComponent: MissingLink,
});

function fromMega(row: PublicMega, token: string): SharePageData {
  const map = (entry: PublicMegaEntry): ShareEntry => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    mime: entry.mime,
    bytes: entry.bytes,
    media: entry.kind === "folder" ? "file" : mediaKind(entry.name, entry.mime),
    view: entry.kind === "file" ? `/api/d/${token}/${entry.id}?view=1` : "",
    download: entry.kind === "file" ? `/api/d/${token}/${entry.id}?dl=1` : "",
  });
  return {
    title: row.title,
    rootId: row.rootId,
    folderId: row.folderId,
    crumbs: row.crumbs,
    file: row.file ? map(row.file) : null,
    entries: row.entries.map(map),
  };
}

function Page() {
  const { token } = Route.useParams();
  return <SharePage token={token} data={Route.useLoaderData()} />;
}

function MissingLink() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <h1 className="font-serif text-4xl tracking-tight">Ссылка не действует</h1>
        <p className="mt-3 max-w-sm text-sm text-muted">Этого уже нет, или адрес неполный.</p>
        <Link to="/" className="press mt-6 inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-fg">
          На сайт
        </Link>
      </div>
    </div>
  );
}
