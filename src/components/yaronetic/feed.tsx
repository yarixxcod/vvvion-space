import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Heart, Library, MessageCircle, Paperclip, Share2, Trash2, X } from "lucide-react";
import { PersonFace } from "@/components/yaronetic/person-face";
import { PostAttachments } from "@/components/yaronetic/post-media";
import { ScreenClip } from "@/components/yaronetic/screen-clip";
import { SourcePicker } from "@/components/yaronetic/source-picker";
import { megaMark, screenMark, splitChat } from "@/lib/screen/mark";
import { MusicCard } from "@/components/yaronetic/music-dock";
import { isMusicFile } from "@/lib/music/tags";
import { readMegaCard } from "@/lib/social/mega";
import { megaFileUrl } from "@/lib/social/mega-upload";
import { UploadMeter, type UploadView } from "@/components/yaronetic/upload-meter";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { getBearerToken } from "@/lib/auth/client";
import { deletePost, listPosts, listThread, sharePost, toggleLike, type FeedPost } from "@/lib/social/feed";
import { clearJump, readJump } from "@/lib/jump";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";
import { loadError } from "@/lib/load-error";
import { useCircleNest } from "@/lib/circle-history";
import { useEdgeBack } from "@/lib/gestures/use-edge-back";
import { HoldSheet } from "@/components/yaronetic/hold-sheet";
import { useLongPress } from "@/lib/gestures/use-long-press";

const MAX_FILES = 4;

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fileUrl(id: string) {
  const token = getBearerToken();
  const path = `/api/post-file/${id}`;
  return token ? `${path}?t=${encodeURIComponent(token)}` : path;
}

function guessMime(file: File): string {
  if (file.type && file.type !== "image/jpg") return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".zip")) return "application/zip";
  return file.type || "";
}

async function shrinkImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать фото");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Не удалось обработать фото");
  if (blob.size > 3_000_000) throw new Error("Фото больше 3 МБ");
  const base = file.name.replace(/\.\w+$/, "") || "фото";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

async function prepareFile(file: File): Promise<File> {
  const mime = guessMime(file);
  if (mime.startsWith("image/") && mime !== "image/gif") return shrinkImage(file);
  const cap = mime.startsWith("video/") ? 12_000_000 : mime.startsWith("image/") ? 3_000_000 : 8_000_000;
  if (file.size > cap) {
    throw new Error(mime.startsWith("video/") ? "Видео больше 12 МБ" : mime.startsWith("image/") ? "Фото больше 3 МБ" : "Файл больше 8 МБ");
  }
  if (file.type === mime) return file;
  return new File([file], file.name, { type: mime });
}

function postForm(
  url: string,
  headers: Headers,
  body: FormData,
  onTick: (loaded: number, total: number) => void,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onTick(event.loaded, event.total);
    };
    xhr.onload = () => {
      let message = "";
      try {
        const parsed = xhr.responseText ? (JSON.parse(xhr.responseText) as { message?: string }) : null;
        message = parsed?.message || "";
      } catch {
        message = "";
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, message });
    };
    xhr.onerror = () => reject(new Error("Не удалось опубликовать"));
    xhr.send(body);
  });
}

export function Feed() {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [thread, setThread] = useState<FeedPost[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meter, setMeter] = useState<UploadView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listPosts();
    setPosts(rows);
    setError(null);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => {
      setPosts([]);
      setError(loadError(err instanceof Error ? err.message : "", "Лента недоступна"));
    });
  }, [refresh]);

  const closeThread = useCallback(() => {
    setOpenId(null);
    setThread(null);
    void refresh();
  }, [refresh]);
  useCircleNest(Boolean(openId), closeThread);
  const edge = useEdgeBack(Boolean(openId), closeThread);
  useEffect(() => {
    if (!openId) return;
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [openId]);

  async function open(id: string) {
    setOpenId(id);
    setThread(null);
    try {
      setThread(await listThread({ data: id }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось открыть ветку");
      setOpenId(null);
    }
  }

  useEffect(() => {
    function take() {
      const jump = readJump();
      if (!jump?.post) return;
      const id = jump.post;
      clearJump();
      setOpenId(id);
      setThread(null);
      void listThread({ data: id })
        .then((rows) => setThread(rows))
        .catch(() => {
          toast.error("Не удалось открыть запись");
          setOpenId(null);
        });
    }
    take();
    window.addEventListener("vvvion-jump", take);
    return () => window.removeEventListener("vvvion-jump", take);
  }, []);

  async function publish(body: string, parentId: string, files: File[]) {
    if (busy) return;
    if (!body.trim() && files.length === 0) return;
    setBusy(true);
    const started = performance.now();
    try {
      if (files.length) {
        const total = files.reduce((sum, file) => sum + file.size, 0);
        setMeter({ name: files.length > 1 ? `${files[0]?.name ?? "Файл"} и ещё ${files.length - 1}` : files[0]?.name || "Файл", ratio: 0, loaded: 0, total, speed: 0 });
      }
      const prepared = await Promise.all(files.map((file) => prepareFile(file)));
      const form = new FormData();
      form.set("body", body.trim());
      if (parentId) form.set("parentId", parentId);
      for (const file of prepared) form.append("file", file, file.name);
      const headers = new Headers();
      const token = getBearerToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await postForm("/api/posts", headers, form, (loaded, total) => {
        if (!prepared.length) return;
        const seconds = Math.max(0.25, (performance.now() - started) / 1000);
        const name = prepared.length > 1 ? `${prepared[0]?.name ?? "Файл"} и ещё ${prepared.length - 1}` : prepared[0]?.name || "Файл";
        setMeter({ name, ratio: total ? loaded / total : 1, loaded, total, speed: loaded / seconds });
      });
      if (!response.ok) throw new Error(response.message || "Не удалось опубликовать");
      haptic("medium");
      if (parentId) {
        setThread(await listThread({ data: parentId }));
        void refresh();
      } else {
        await refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось опубликовать");
      throw err;
    } finally {
      setMeter(null);
      setBusy(false);
    }
  }

  async function share(post: FeedPost) {
    try {
      const { token } = await sharePost({ data: post.id });
      const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
      const url = `${window.location.origin}${prefix}/p/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("Ссылка на запись скопирована");
      } catch {
        toast(url);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать ссылку");
    }
  }

  function like(post: FeedPost, where: "list" | "thread") {
    haptic(post.liked ? "selection" : "light");
    const flip = (item: FeedPost) =>
      item.id === post.id ? { ...item, liked: !item.liked, likes: item.likes + (item.liked ? -1 : 1) } : item;
    if (where === "list") setPosts((current) => current?.map(flip) ?? null);
    else setThread((current) => current?.map(flip) ?? null);
    void toggleLike({ data: post.id }).catch(() => {
      if (where === "list") void refresh();
      else if (openId) void listThread({ data: openId }).then(setThread).catch(() => undefined);
    });
  }

  if (openId) {
    const root = thread?.find((item) => !item.parentId) ?? null;
    const replies = thread?.filter((item) => item.parentId) ?? [];
    return (
      <div className="flex h-full min-h-0 flex-col" {...edge} style={edge.style}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button
            type="button"
            className="press inline-flex h-11 items-center gap-1 rounded-xl px-2 text-sm text-muted"
            onClick={closeThread}
          >
            <ArrowLeft className="size-4" />
            Лента
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {root ? (
            <PostRow post={root} onLike={() => like(root, "thread")} onOpen={() => undefined} onShare={() => void share(root)} />
          ) : (
            <PageLoader compact />
          )}
          <div className="ml-5 border-l border-line pl-3">
            {replies.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                onLike={() => like(post, "thread")}
                onOpen={() => undefined}
                onShare={() => void share(post)}
                onDelete={
                  post.mine
                    ? () => {
                        haptic("heavy");
                        setThread((current) => current?.filter((item) => item.id !== post.id) ?? null);
                        void deletePost({ data: post.id }).catch(() => {
                          if (openId) void listThread({ data: openId }).then(setThread).catch(() => undefined);
                        });
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <Composer placeholder="Ответить в ветку" busy={busy} meter={meter} onSubmit={(body, files) => publish(body, openId, files)} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Composer placeholder="Что нового?" busy={busy} meter={meter} onSubmit={(body, files) => publish(body, "", files)} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {posts === null ? (
          <div className="space-y-3 px-1 py-4" aria-busy="true" aria-label="Загрузка">
            <div className="h-4 w-2/3 animate-pulse rounded bg-subtle" />
            <div className="h-4 w-full animate-pulse rounded bg-subtle" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-subtle" />
          </div>
        ) : error ? (
          <div className="px-1 py-6 text-center">
            <p className="text-sm text-danger">{loadError(error)}</p>
            <button type="button" className="press mt-3 h-11 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg" onClick={() => void refresh()}>
              Повторить
            </button>
          </div>
        ) : posts.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-muted">Пока тихо. Первая запись может быть вашей.</p>
        ) : (
          posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              onLike={() => like(post, "list")}
              onOpen={() => void open(post.id)}
              onShare={() => void share(post)}
              onDelete={
                post.mine
                  ? () => {
                      haptic("heavy");
                      setPosts((current) => current?.filter((item) => item.id !== post.id) ?? null);
                      void deletePost({ data: post.id }).catch(() => void refresh());
                    }
                  : undefined
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function Composer({
  placeholder,
  busy,
  meter,
  onSubmit,
}: {
  placeholder: string;
  busy: boolean;
  meter: UploadView | null;
  onSubmit: (body: string, files: File[]) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fromCircle, setFromCircle] = useState(false);
  const [clips, setClips] = useState<{ id: string; title: string }[]>([]);
  const [megas, setMegas] = useState<{ id: string; name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const next = [...files, ...Array.from(list)];
    if (next.length > MAX_FILES) toast("Можно приложить не больше четырёх файлов");
    setFiles(next.slice(0, MAX_FILES));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const marks = [...clips.map((clip) => screenMark(clip.id)), ...megas.map((file) => megaMark(file.id))].join("\n");
    const room = Math.max(0, 500 - marks.length - (marks ? 1 : 0));
    const body = [value.trim().slice(0, room), marks].filter(Boolean).join("\n");
    if (busy || (!body && files.length === 0)) return;
    try {
      await onSubmit(body, files);
      setValue("");
      setFiles([]);
      setClips([]);
      setMegas([]);
    } catch {
      /* the parent already toasted */
    }
  }

  return (
    <form className="border-b border-line p-3" onSubmit={(event) => void submit(event)}>
      {files.length > 0 ? (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {files.map((file) => (
            <PickedFile key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setFiles((current) => current.filter((item) => item !== file))} />
          ))}
        </div>
      ) : null}
      {meter ? (
        <div className="mb-2">
          <UploadMeter view={meter} />
        </div>
      ) : null}
      <SourcePicker
        open={fromCircle}
        onClose={() => setFromCircle(false)}
        onBook={(_id, title) => {
          setValue((current) => `${current}${current ? "\n" : ""}Читальня: ${title}`.slice(0, 500));
          setFromCircle(false);
        }}
        onVideo={(id, title) => {
          setClips((current) => (current.some((clip) => clip.id === id) ? current : [...current, { id, title }].slice(0, 3)));
          setFromCircle(false);
        }}
        onDisk={(item) => {
          setFromCircle(false);
          void fetch(item.url, { credentials: "same-origin" })
            .then(async (response) => {
              if (!response.ok) throw new Error("Файл не открылся");
              const blob = await response.blob();
              if (blob.size > 12_000_000) throw new Error("Для ленты файл слишком большой");
              const file = new File([blob], item.name, { type: item.mime || blob.type });
              setFiles((current) => [...current, file].slice(0, MAX_FILES));
            })
            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Файл не открылся"));
        }}
        onMega={(file) => {
          setMegas((current) => (current.some((item) => item.id === file.id) ? current : [...current, { id: file.id, name: file.name }].slice(0, 3)));
          setFromCircle(false);
        }}
      />
      {megas.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {megas.map((file) => (
            <button
              key={file.id}
              type="button"
              className="press inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-line px-2 text-xs"
              onClick={() => setMegas((current) => current.filter((item) => item.id !== file.id))}
            >
              <span className="truncate">{file.name}</span>
              <X className="size-3 shrink-0" />
            </button>
          ))}
        </div>
      ) : null}
      {clips.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {clips.map((clip) => (
            <button
              key={clip.id}
              type="button"
              className="press inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-line px-2 text-xs"
              onClick={() => setClips((current) => current.filter((item) => item.id !== clip.id))}
            >
              <span className="truncate">{clip.title}</span>
              <X className="size-3 shrink-0" />
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        id="feed-composer"
        value={value}
        maxLength={500}
        rows={3}
        placeholder={placeholder}
        aria-label={placeholder}
        className="max-h-[40dvh] min-h-[5rem] w-full resize-none rounded-2xl border border-line bg-bg px-3 py-2 text-base leading-6 outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onChange={(event) => setValue(event.target.value)}
      />
      <p className="mt-1 text-right text-xs tabular-nums text-faint" aria-live={value.trim().length >= 450 ? "polite" : "off"}>
        {value.trim().length}/500
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="press inline-flex size-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-line text-muted sm:w-auto sm:px-3"
          aria-label="Приложить фото, видео или файл"
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" />
          <span className="hidden whitespace-nowrap sm:inline">Вложить</span>
        </button>
        <button
          type="button"
          className="press inline-flex size-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-line text-muted sm:w-auto sm:px-3"
          aria-label="Из круга"
          onClick={() => setFromCircle((value) => !value)}
        >
          <Library className="size-4" />
          <span className="hidden whitespace-nowrap sm:inline">Из круга</span>
        </button>
        <button
          type="submit"
          disabled={busy || (!value.trim() && files.length === 0 && clips.length === 0 && megas.length === 0)}
          className="press ml-auto h-11 shrink-0 whitespace-nowrap rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          Опубликовать
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/pdf,text/plain,application/zip,.txt,.zip"
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </form>
  );
}

function PickedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-line bg-subtle">
      {url ? (
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-end p-1 text-xs leading-tight text-muted">{file.name}</span>
      )}
      <button
        type="button"
        className="press absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-bg/90 text-fg"
        aria-label="Убрать вложение"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function PostText({ body }: { body: string }) {
  const clip = splitChat(body);
  return (
    <>
      {clip.text ? <p className="mt-1 max-w-[68ch] whitespace-pre-wrap text-base leading-6 text-pretty">{clip.text}</p> : null}
      {clip.screen.map((id) => (
        <ScreenClip key={id} id={id} />
      ))}
      {clip.mega.map((id) => (
        <FeedMega key={id} id={id} />
      ))}
    </>
  );
}

function FeedMega({ id }: { id: string }) {
  const [card, setCard] = useState<{ name: string; mime: string; bytes: number } | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    void readMegaCard({ data: id })
      .then((row) => {
        if (!dead) setCard(row);
      })
      .catch(() => {
        if (!dead) setCard(null);
      });
    return () => {
      dead = true;
    };
  }, [id]);
  if (card === null) return <p className="mt-1 text-xs text-faint">Файл не открывается</p>;
  if (!card) return <PageLoader compact />;
  if (isMusicFile(card.name, card.mime)) return <MusicCard name={card.name} src={megaFileUrl(id, "view", true)} />;
  return (
    <a href={megaFileUrl(id, "file", true)} className="mt-1.5 flex items-center gap-2 rounded-2xl border border-line px-2 py-2 text-sm">
      <span className="min-w-0 truncate">{card.name}</span>
    </a>
  );
}

function PostRow({
  post,
  onLike,
  onOpen,
  onShare,
  onDelete,
}: {
  post: FeedPost;
  onLike: () => void;
  onOpen: () => void;
  onShare: () => void;
  onDelete?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const hold = useLongPress(() => setMenu(true));
  return (
    <article
      className="feed-post border-b border-line py-3 sm:flex sm:gap-3"
      tabIndex={-1}
      onPointerDown={hold.onPointerDown}
      onPointerMove={hold.onPointerMove}
      onPointerUp={hold.onPointerUp}
      onPointerCancel={hold.onPointerCancel}
      onContextMenu={hold.onContextMenu}
    >
      <div className="mb-2 flex items-center gap-2 sm:hidden">
        <PersonFace name={post.author} image={post.authorImage} size={32} userId={post.authorId} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{post.author}</p>
        <time className="shrink-0 text-xs tabular-nums text-faint">{when(post.createdAt)}</time>
      </div>
      <div className="hidden sm:block">
        <PersonFace name={post.author} image={post.authorImage} size={36} userId={post.authorId} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 hidden items-baseline gap-2 sm:flex">
          <p className="truncate text-sm font-medium">{post.author}</p>
          <time className="shrink-0 text-xs tabular-nums text-faint">{when(post.createdAt)}</time>
        </div>
        {post.body ? <PostText body={post.body} /> : null}
        <PostAttachments files={post.files ?? []} urlFor={(file) => fileUrl(file.id)} onLike={onLike} />
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            className={cn("press inline-flex h-11 items-center gap-1 rounded-lg px-2 text-xs", post.liked ? "text-accent" : "text-faint")}
            aria-label={`Нравится, ${post.likes}`}
            onClick={onLike}
          >
            <Heart className={cn("size-3.5", post.liked && "fill-current")} />
            <span className="tabular-nums">{post.likes}</span>
          </button>
          {!post.parentId ? (
            <button type="button" className="press inline-flex h-11 items-center gap-1 rounded-lg px-2 text-xs text-faint" aria-label={`Ответы, ${post.replies}`} onClick={onOpen}>
              <MessageCircle className="size-3.5" />
              <span className="tabular-nums">{post.replies}</span>
            </button>
          ) : null}
          <button type="button" className="press inline-flex size-11 items-center justify-center rounded-lg text-faint" aria-label="Поделиться записью" onClick={onShare}>
            <Share2 className="size-3.5" />
          </button>
          {post.mine && onDelete ? (
            <button type="button" className="press inline-flex size-8 items-center justify-center rounded-lg text-faint" aria-label="Удалить запись" onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {menu ? (
        <HoldSheet title="Запись" onClose={() => setMenu(false)}>
          <button type="button" className="press flex min-h-12 w-full items-center rounded-2xl px-3 text-left text-base" onClick={() => { setMenu(false); onShare(); }}>
            Поделиться
          </button>
          {onDelete ? (
            <button type="button" className="press flex min-h-12 w-full items-center rounded-2xl px-3 text-left text-base text-danger" onClick={() => { setMenu(false); onDelete(); }}>
              Удалить
            </button>
          ) : null}
        </HoldSheet>
      ) : null}
    </article>
  );
}
