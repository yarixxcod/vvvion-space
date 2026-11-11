import { useEffect, useState } from "react";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { listShelf } from "@/lib/books/shelf";
import { loadTags } from "@/lib/music/load";
import { isMusicFile, musicBits } from "@/lib/music/tags";
import { listScreen } from "@/lib/screen/service";
import { getDisk } from "@/lib/social/disk.fn";
import type { DiskFile } from "@/lib/social/disk";
import { listPosts } from "@/lib/social/feed";
import { listMegaFiles } from "@/lib/social/mega";
import { megaFileUrl } from "@/lib/social/mega-upload";
import { BackButton } from "@/components/yaronetic/back-button";

type Tab = "book" | "video" | "disk" | "mega" | "post";
type MegaPick = { id: string; name: string; mime: string; bytes: number };

export function SourcePicker({
  open,
  onClose,
  onBook,
  onVideo,
  onDisk,
  onMega,
  onPost,
}: {
  open: boolean;
  onClose: () => void;
  onBook: (id: string, title: string) => void;
  onVideo: (id: string, title: string) => void;
  onDisk: (file: DiskFile) => void;
  onMega?: (file: MegaPick) => void;
  onPost?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("book");
  const [books, setBooks] = useState<{ id: string; title: string; author: string }[] | null>(null);
  const [videos, setVideos] = useState<{ id: string; title: string }[] | null>(null);
  const [files, setFiles] = useState<DiskFile[] | null>(null);
  const [mega, setMega] = useState<MegaPick[] | null>(null);
  const [posts, setPosts] = useState<{ id: string; author: string; body: string }[] | null>(null);
  const showMega = Boolean(onMega);
  const showPost = Boolean(onPost);

  useEffect(() => {
    if (!open) return;
    if (tab === "book" && !books) {
      void listShelf({ data: { q: "" } })
        .then((rows) => setBooks(rows.map((row) => ({ id: row.id, title: row.title, author: row.author }))))
        .catch(() => setBooks([]));
    }
    if (tab === "video" && !videos) {
      void listScreen()
        .then((rows) => setVideos(rows.map((row) => ({ id: row.id, title: row.title }))))
        .catch(() => setVideos([]));
    }
    if (tab === "disk" && !files) {
      void getDisk()
        .then((disk) => setFiles(disk.files))
        .catch(() => setFiles([]));
    }
    if (tab === "mega" && showMega && !mega) {
      void listMegaFiles()
        .then((rows) => setMega(rows))
        .catch(() => setMega([]));
    }
    if (tab === "post" && showPost && !posts) {
      void listPosts()
        .then((rows) => setPosts(rows.map((row) => ({ id: row.id, author: row.author, body: row.body.replace(/\s+/g, " ").trim() }))))
        .catch(() => setPosts([]));
    }
  }, [books, files, mega, open, posts, showMega, showPost, tab, videos]);

  if (!open) return null;
  const tabs = [
    ["book", "Читальня"],
    showPost ? ["post", "Лента"] : null,
    ["video", "Видео"],
    ["disk", "Диск"],
    showMega ? ["mega", "Мега"] : null,
  ].filter((item): item is [Tab, string] => item !== null);
  const empty =
    (tab === "book" && books && !books.length) ||
    (tab === "post" && posts && !posts.length) ||
    (tab === "video" && videos && !videos.length) ||
    (tab === "disk" && files && !files.length) ||
    (tab === "mega" && mega && !mega.length);
  const waiting =
    (tab === "book" && !books) ||
    (tab === "post" && !posts) ||
    (tab === "video" && !videos) ||
    (tab === "disk" && !files) ||
    (tab === "mega" && !mega);

  return (
    <div className="border-t border-line bg-elev px-2 py-2">
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "press h-8 shrink-0 rounded-lg bg-bg px-2.5 text-xs" : "press h-8 shrink-0 rounded-lg px-2.5 text-xs text-muted"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <BackButton onClick={onClose} label="Назад" />
        <button type="button" className="press ml-auto hidden h-8 shrink-0 px-2 text-xs text-muted md:inline-flex" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {tab === "book"
          ? (books ?? []).map((row) => (
              <li key={row.id}>
                <button type="button" className="press block w-full rounded-xl px-2 py-2 text-left text-sm hover:bg-subtle" onClick={() => onBook(row.id, row.title)}>
                  {row.title}
                  {row.author ? <span className="mt-0.5 block text-xs text-faint">{row.author}</span> : null}
                </button>
              </li>
            ))
          : null}
        {tab === "post"
          ? (posts ?? []).map((row) => (
              <li key={row.id}>
                <button type="button" className="press block w-full rounded-xl px-2 py-2 text-left text-sm hover:bg-subtle" onClick={() => onPost?.(row.id)}>
                  <span className="block truncate">{row.body || "Запись"}</span>
                  <span className="mt-0.5 block text-xs text-faint">{row.author}</span>
                </button>
              </li>
            ))
          : null}
        {tab === "video"
          ? (videos ?? []).map((row) => (
              <li key={row.id}>
                <button type="button" className="press block w-full rounded-xl px-2 py-2 text-left text-sm hover:bg-subtle" onClick={() => onVideo(row.id, row.title)}>
                  {row.title}
                </button>
              </li>
            ))
          : null}
        {tab === "disk"
          ? (files ?? []).map((row) => (
              <li key={row.id}>
                <button type="button" className="press block w-full rounded-xl px-2 py-2 text-left text-sm hover:bg-subtle" onClick={() => onDisk(row)}>
                  {row.name}
                  <span className="mt-0.5 block text-xs text-faint">{row.kind === "audio" ? "Голос" : "Картинка"}</span>
                </button>
              </li>
            ))
          : null}
        {tab === "mega"
          ? (mega ?? []).map((row) => (
              <li key={row.id}>
                <button type="button" className="press block w-full rounded-xl px-2 py-2 text-left text-sm hover:bg-subtle" onClick={() => onMega?.(row)}>
                  <MegaLabel row={row} />
                </button>
              </li>
            ))
          : null}
        {empty ? <li className="px-2 py-2 text-xs text-faint">Пока пусто</li> : null}
        {waiting ? <li className="px-2 py-2"><PageLoader compact /></li> : null}
      </ul>
    </div>
  );
}

function MegaLabel({ row }: { row: MegaPick }) {
  const [title, setTitle] = useState(row.name.replace(/\.[^.]+$/, ""));
  const [sub, setSub] = useState(isMusicFile(row.name, row.mime) ? "Музыка" : "Файл");

  useEffect(() => {
    if (!isMusicFile(row.name, row.mime)) return;
    let dead = false;
    void loadTags(megaFileUrl(row.id, "view"), row.name)
      .then((tags) => {
        if (dead) return;
        if (tags.title) setTitle(tags.title);
        const bits = musicBits(tags, row.bytes);
        setSub([tags.artist, bits].filter(Boolean).join(" · ") || "Музыка");
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [row]);

  return (
    <>
      <span className="block truncate">{title}</span>
      <span className="mt-0.5 block text-xs text-faint">{sub}</span>
    </>
  );
}
