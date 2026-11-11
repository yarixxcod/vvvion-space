import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { SourcePicker } from "@/components/yaronetic/source-picker";
import { sizeLabel, UploadMeter, type UploadView } from "@/components/yaronetic/upload-meter";
import { ArrowLeft, BookOpen, Check, Library, Mic, Newspaper, Paperclip, Pause, Plus, Send, Smile, X } from "lucide-react";
import { BackButton } from "@/components/yaronetic/back-button";
import { PersonFace } from "@/components/yaronetic/person-face";
import { toast } from "sonner";
import { LoaderMark, PageLoader } from "@/components/yaronetic/page-loader";
import { playSound } from "@/lib/sounds";
import { appBadge, appNotify, cancelAppNotification, isApp, messagePreviewOn } from "@/lib/app-bridge";
import { haptic } from "@/lib/haptic";
import { loadError } from "@/lib/load-error";
import { useCircleNest } from "@/lib/circle-history";
import { useEdgeBack } from "@/lib/gestures/use-edge-back";
import { Holdable } from "@/components/yaronetic/hold-sheet";
import { STICKER_PACKS, isKnownSticker, stickerBody, stickerCode, stickerUrl } from "@/lib/stickers";
import {
  countUnread,
  createGroup,
  leaveRoom,
  listFriends,
  listRequests,
  listRoomMessages,
  listRooms,
  openDm,
  readRoomFile,
  requestFriend,
  respondFriend,
  searchPeople,
  sendRoomMessage,
  sendFromPlace,
  type FileMeta,
  type FoundPerson,
  type Person,
  type RoomMessage,
  type RoomSummary,
} from "@/lib/social/messenger";
import { FileVideo } from "@/components/yaronetic/post-media";
import { MusicCard } from "@/components/yaronetic/music-dock";
import { ScreenClip } from "@/components/yaronetic/screen-clip";
import { HoldHint } from "@/components/yaronetic/hold-hint";
import { getBearerToken } from "@/lib/auth/client";
import { rememberJump } from "@/lib/jump";
import { isMusicFile } from "@/lib/music/tags";
import { splitChat } from "@/lib/screen/mark";
import { readBookCard } from "@/lib/books/shelf";
import { readPostCard } from "@/lib/social/feed";
import { readMegaCard } from "@/lib/social/mega";
import { megaFileUrl } from "@/lib/social/mega-upload";
import { WishCarousel } from "@/components/yaronetic/wishes";
import { cn } from "@/lib/utils";
import { CIRCLE_MAX_BYTES, fetchCircleBlob, uploadCircleFile } from "@/lib/social/circle-upload";

const tones = ["#c4b5e8", "#9dccb6", "#e7c89a", "#e7a19c", "#9bb7d4", "#d7b4c8"];

function tone(id: string) {
  let n = 0;
  for (const char of id) n = (n + char.charCodeAt(0)) % tones.length;
  return tones[n] ?? tones[0];
}

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      resolve(raw.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("Файл не удалось прочитать"));
    reader.readAsDataURL(blob);
  });
}

function circleFileUrl(id: string): string {
  const token = getBearerToken();
  const path = `/api/circle-file/${id}`;
  return token ? `${path}?t=${encodeURIComponent(token)}` : path;
}

function b64Url(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

const fileUrls = new Map<string, string>();

export function useCircleUnread(enabled: boolean) {
  const [n, setN] = useState(0);
  const seen = useRef<number | null>(null);
  const badged = useRef<number | null>(null);
  const roomsSeen = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!enabled) {
      setN(0);
      seen.current = null;
      if (badged.current) appBadge(0);
      badged.current = null;
      roomsSeen.current = new Map();
      return;
    }
    let dead = false;
    const pull = () => {
      if (document.hidden && !isApp()) return;
      void countUnread()
        .then((row) => {
          if (dead) return;
          if (!document.hidden && seen.current != null && row.n > seen.current) playSound("message");
          seen.current = row.n;
          setN(row.n);
          if (badged.current !== row.n) {
            badged.current = row.n;
            appBadge(row.n);
          }
        })
        .catch(() => undefined);
      if (!isApp()) return;
      void listRooms()
        .then((rooms) => {
          if (dead) return;
          const live = new Set(rooms.map((room) => room.id));
          for (const room of rooms) {
            const prev = roomsSeen.current.get(room.id);
            roomsSeen.current.set(room.id, room.unread);
            if (prev == null) continue;
            if (document.hidden && room.unread > prev) {
              const text = (room.preview || "Новое сообщение").slice(0, 120);
              appNotify({
                id: `msg:${room.id}`,
                channel: "messages",
                title: room.title.slice(0, 80) || "Сообщение",
                body: messagePreviewOn() ? text : "Новое сообщение",
                url: `/messages/${room.id}`,
              });
            } else if (room.unread === 0 && prev > 0) {
              cancelAppNotification(`msg:${room.id}`);
            }
          }
          for (const id of roomsSeen.current.keys()) {
            if (!live.has(id)) roomsSeen.current.delete(id);
          }
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 8000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return n;
}

export function Messenger({ openRoom = null }: { openRoom?: string | null }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [friends, setFriends] = useState<Person[]>([]);
  const [requests, setRequests] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundPerson[] | null>(null);
  const [roomId, setRoomId] = useState<string | null>(openRoom);
  const [groupOpen, setGroupOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (openRoom) setRoomId(openRoom);
  }, [openRoom]);

  useEffect(() => {
    if (!roomId) return;
    cancelAppNotification(`msg:${roomId}`);
    const onVis = () => {
      if (!document.hidden) cancelAppNotification(`msg:${roomId}`);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [roomId]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: Boolean(roomId || groupOpen) }));
    return () => {
      window.dispatchEvent(new CustomEvent("vv-circle-nested", { detail: false }));
    };
  }, [roomId, groupOpen]);

  const refreshLists = useCallback(async () => {
    try {
      const [nextRooms, nextFriends, nextRequests] = await Promise.all([
        listRooms(),
        listFriends(),
        listRequests(),
      ]);
      setRooms(nextRooms);
      setFriends(nextFriends);
      setRequests(nextRequests);
      setError(null);
    } catch (err) {
      setError(loadError(err instanceof Error ? err.message : "", "Круг недоступен"));
    }
  }, []);

  useEffect(() => {
    void refreshLists();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshLists();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [refreshLists]);

  const closeRoom = useCallback(() => {
    setRoomId(null);
    void refreshLists();
  }, [refreshLists]);
  useCircleNest(groupOpen, () => setGroupOpen(false));
  useCircleNest(Boolean(roomId), closeRoom);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchPeople({ data: q })
        .then(setFound)
        .catch((err) => {
          setFound([]);
          toast.error(err instanceof Error ? err.message : "Поиск не удался");
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function startWith(person: Person) {
    try {
      const room = await openDm({ data: person.id });
      setQuery("");
      setFound(null);
      setRoomId(room.id);
      void refreshLists();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось открыть диалог");
    }
  }

  const active = rooms.find((room) => room.id === roomId) ?? null;

  return (
    <div className="relative flex h-full min-h-0">
      <div className={cn("flex min-h-0 w-full flex-col xl:w-80 xl:border-r xl:border-line", roomId && "hidden xl:flex")}>
        <div className="flex items-center gap-2 px-3 pt-3">
          <input
            id="circle-people"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя или почта друга"
            className="field"
          />
          <button
            type="button"
            className="press inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted"
            aria-label="Новая группа"
            onClick={() => setGroupOpen(true)}
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {error ? <p className="px-2 py-2 text-sm text-danger">{error}</p> : null}
          {found ? (
            <section className="mb-3">
              <p className="px-2 py-1 text-xs text-faint">Люди</p>
              {found.length === 0 ? (
                <p className="px-2 py-2 text-sm text-muted">Никого не нашли.</p>
              ) : (
                found.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    action={
                      person.relation === "friend"
                        ? "Написать"
                        : person.relation === "pending-out"
                          ? "Ждём"
                          : person.relation === "pending-in"
                            ? "Принять"
                            : "Добавить"
                    }
                    disabled={person.relation === "pending-out"}
                    onClick={() => {
                      if (person.relation === "friend") void startWith(person);
                      else if (person.relation === "pending-in") {
                        void respondFriend({ data: { id: person.id, accept: true } })
                          .then(() => {
                            setFound((current) =>
                              current?.map((item) => (item.id === person.id ? { ...item, relation: "friend" } : item)) ?? null,
                            );
                            return refreshLists();
                          })
                          .catch((err) => toast.error(err instanceof Error ? err.message : "Не удалось"));
                      } else if (person.relation === "none") {
                        void requestFriend({ data: person.id })
                          .then(() => {
                            toast("Заявка отправлена");
                            setFound((current) =>
                              current?.map((item) =>
                                item.id === person.id ? { ...item, relation: "pending-out" } : item,
                              ) ?? null,
                            );
                            void refreshLists();
                          })
                          .catch((err) => toast.error(err instanceof Error ? err.message : "Не удалось"));
                      }
                    }}
                  />
                ))
              )}
            </section>
          ) : null}
          {requests.length > 0 ? (
            <section className="mb-3">
              <p className="px-2 py-1 text-xs text-faint">Заявки в друзья</p>
              {requests.map((person) => (
                <div key={person.id} className="flex items-center gap-1 px-1">
                  <Avatar name={person.name} image={person.image} userId={person.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{person.name}</p>
                  </div>
                  <button
                    type="button"
                    className="press inline-flex size-9 items-center justify-center rounded-xl bg-accent text-accent-fg"
                    aria-label="Принять"
                    onClick={() =>
                      void respondFriend({ data: { id: person.id, accept: true } })
                        .then(() => refreshLists())
                        .catch((err) => toast.error(err instanceof Error ? err.message : "Не удалось"))
                    }
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="press inline-flex size-9 items-center justify-center rounded-xl text-muted"
                    aria-label="Отклонить"
                    onClick={() =>
                      void respondFriend({ data: { id: person.id, accept: false } })
                        .then(() => refreshLists())
                        .catch((err) => toast.error(err instanceof Error ? err.message : "Не удалось"))
                    }
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          <section>
            <p className="px-2 py-1 text-xs text-faint">Диалоги</p>
            {rooms.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted">
                Найдите друга по имени или почте, примите заявку — и можно писать, слать фото, стикеры и голосовые.
              </p>
            ) : (
              rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => {
                    haptic("selection");
                    setRoomId(room.id);
                  }}
                  className={cn(
                    "press flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-left",
                    room.id === roomId ? "bg-subtle" : "hover:bg-subtle",
                  )}
                >
                  <Avatar name={room.title} image={room.image} userId={room.peerId} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{room.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-faint">{when(room.at)}</span>
                    </span>
                    <span className="block truncate text-xs text-faint">{room.preview}</span>
                  </span>
                  {room.unread > 0 ? (
                    <span className="grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-fg">
                      {room.unread > 9 ? "9+" : room.unread}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </section>
          {friends.length > 0 && !found ? (
            <section className="mt-3">
              <p className="px-2 py-1 text-xs text-faint">Друзья</p>
              {friends.map((person) => (
                <PersonRow key={person.id} person={person} action="Написать" onClick={() => void startWith(person)} />
              ))}
            </section>
          ) : null}
        </div>
        <WishCarousel embedded />
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", roomId ? "flex" : "hidden xl:flex")}>
        {roomId && active ? (
          <Thread
            room={active}
            onBack={closeRoom}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="w-full max-w-sm">
              <p className="font-serif text-3xl">Напишите другу</p>
              <div className="mt-4 grid gap-2">
                <button type="button" className="press h-11 rounded-2xl border border-line bg-elev text-sm font-medium" onClick={() => setGroupOpen(true)}>
                  Новая группа
                </button>
                <button
                  type="button"
                  className="press h-11 rounded-2xl border border-line bg-elev text-sm font-medium"
                  onClick={() => window.dispatchEvent(new CustomEvent("vv-circle-tab", { detail: "bank" }))}
                >
                  Пригласить по ссылке
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {groupOpen ? (
        <GroupSheet
          friends={friends}
          onClose={() => setGroupOpen(false)}
          onCreated={(id) => {
            setGroupOpen(false);
            setRoomId(id);
            void refreshLists();
          }}
        />
      ) : null}
    </div>
  );
}

function PersonRow({
  person,
  action,
  disabled,
  onClick,
}: {
  person: { id: string; name: string; image?: string | null };
  action: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl px-2 py-1.5">
      <Avatar name={person.name} image={person.image} userId={person.id} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{person.name}</p>
      </div>
      <button
        type="button"
        disabled={disabled}
        className="press h-9 shrink-0 rounded-xl border border-line px-2.5 text-xs text-muted disabled:opacity-40"
        onClick={onClick}
      >
        {action}
      </button>
    </div>
  );
}

function Avatar({ name, image, userId, size = 36 }: { name: string; image?: string | null; userId?: string | null; size?: number }) {
  return <PersonFace name={name} image={image} size={size} userId={userId} />;
}

function Thread({ room, onBack }: { room: RoomSummary; onBack: () => void }) {
  const [messages, setMessages] = useState<RoomMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadView | null>(null);
  const [fromCircle, setFromCircle] = useState(false);
  const [stickers, setStickers] = useState(false);
  const [pack, setPack] = useState<(typeof STICKER_PACKS)[number]["id"]>("faces");
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const stick = useRef(true);
  const busyRef = useRef(false);
  const heard = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const edge = useEdgeBack(true, onBack);

  const pull = useCallback(async () => {
    const rows = await listRoomMessages({ data: room.id });
    setMessages((current) => {
      const pending = (current ?? []).filter((item) => item.id.startsWith("local-"));
      return pending.length ? [...rows, ...pending] : rows;
    });
  }, [room.id]);

  useEffect(() => {
    let dead = false;
    setMessages(null);
    void pull().catch((err) => {
      if (!dead) {
        setMessages([]);
        toast.error(err instanceof Error ? err.message : "Переписка недоступна");
      }
    });
    const timer = window.setInterval(() => {
      if (document.hidden || busyRef.current) return;
      void pull().catch(() => undefined);
    }, 3000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [pull]);

  useEffect(() => {
    primed.current = false;
    heard.current = new Set();
  }, [room.id]);

  useEffect(() => {
    if (!messages) return;
    if (!primed.current) {
      for (const item of messages) heard.current.add(item.id);
      primed.current = true;
      return;
    }
    for (const item of messages) {
      if (heard.current.has(item.id)) continue;
      heard.current.add(item.id);
      if (!item.mine && !item.id.startsWith("local-")) playSound("message");
    }
  }, [messages]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    const next = [...files];
    for (const file of [...list]) {
      if (next.length >= 8) {
        toast("Не больше 8 файлов");
        break;
      }
      if (file.size > CIRCLE_MAX_BYTES) {
        toast.error("Файл больше 200 МБ");
        continue;
      }
      if (file.size < 1) {
        toast.error("Файл пустой");
        continue;
      }
      next.push(file);
    }
    setFiles(next.slice(0, 8));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function place(source: "book" | "video" | "disk" | "post" | "mega", id: string) {
    setFromCircle(false);
    try {
      await sendFromPlace({ data: { roomId: room.id, source, id } });
      await pull();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не отправилось");
    }
  }

  async function sendAttachments(body: string) {
    if (busyRef.current || files.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    const pending = files;
    const optimisticId = `local-${Date.now()}`;
    const optimistic: RoomMessage = {
      id: optimisticId,
      userId: "me",
      name: "Вы",
      image: null,
      body,
      mine: true,
      createdAt: new Date().toISOString(),
      files: pending.map((file, index) => {
        const id = `local-file-${optimisticId}-${index}`;
        if (!fileUrls.has(id)) fileUrls.set(id, URL.createObjectURL(file));
        return { id, name: file.name, mime: file.type || "application/octet-stream", size: file.size, blob: true };
      }),
    };
    setMessages((current) => [...(current ?? []), optimistic]);
    setDraft("");
    setFiles([]);
    setStickers(false);
    haptic("medium");
    try {
      let messageId = "";
      for (let index = 0; index < pending.length; index += 1) {
        const file = pending[index];
        const name = pending.length > 1 ? `${file.name} · ${index + 1} из ${pending.length}` : file.name;
        const ctrl = new AbortController();
        uploadAbort.current = ctrl;
        setProgress({ name, ratio: 0, loaded: 0, total: file.size, speed: 0 });
        const sent = await uploadCircleFile({
          roomId: room.id,
          file,
          body: index === 0 ? body : "",
          messageId: messageId || undefined,
          onProgress: (tick) => setProgress({ name, ...tick }),
          signal: ctrl.signal,
        });
        messageId = sent.messageId;
      }
      setMessages((current) => (current ?? []).filter((item) => item.id !== optimisticId));
      await pull();
    } catch (err) {
      setMessages((current) => current?.filter((item) => item.id !== optimisticId) ?? []);
      setDraft(body);
      setFiles(pending);
      const message = err instanceof Error ? err.message : "Не удалось отправить";
      if (message === "Загрузка отменена") toast("Загрузка отменена");
      else {
        haptic("error");
        toast.error(message);
      }
    } finally {
      setProgress(null);
      uploadAbort.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function deliver(body: string, sent: { name: string; mime: string; data: string }[], clearDraft: boolean) {
    if (busyRef.current || (!body && sent.length === 0)) return;
    busyRef.current = true;
    setBusy(true);
    const optimisticId = `local-${Date.now()}`;
    const optimistic: RoomMessage = {
      id: optimisticId,
      userId: "me",
      name: "Вы",
      image: null,
      body,
      mine: true,
      createdAt: new Date().toISOString(),
      files: sent.map((file, index) => {
        const id = `local-file-${optimisticId}-${index}`;
        if (!fileUrls.has(id)) fileUrls.set(id, b64Url(file.data, file.mime));
        return {
          id,
          name: file.name,
          mime: file.mime,
          size: Math.round((file.data.length * 3) / 4),
        };
      }),
    };
    setMessages((current) => [...(current ?? []), optimistic]);
    if (clearDraft) {
      setDraft("");
      setFiles([]);
    }
    setStickers(false);
    haptic("medium");
    try {
      await sendRoomMessage({ data: { roomId: room.id, body, files: sent } });
      setMessages((current) => (current ?? []).filter((item) => item.id !== optimisticId));
      await pull();
    } catch (err) {
      setMessages((current) => current?.filter((item) => item.id !== optimisticId) ?? []);
      if (clearDraft) setDraft(body);
      haptic("error");
      toast.error(err instanceof Error ? err.message : "Не удалось отправить");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body && files.length === 0) return;
    if (files.length > 0) void sendAttachments(body);
    else void deliver(body, [], true);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" {...edge} style={edge.style}>
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button
          type="button"
          className="press inline-flex size-11 items-center justify-center rounded-2xl text-muted sm:hidden"
          aria-label="К списку"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </button>
        <Avatar name={room.title} image={room.image} userId={room.peerId} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{room.title}</p>
          <p className="text-xs text-faint">{room.kind === "group" ? "Группа" : "Личный диалог"}</p>
        </div>
        {room.kind === "group" ? (
          <button
            type="button"
            className="press h-9 rounded-xl px-2 text-xs text-muted"
            onClick={() => {
              void leaveRoom({ data: room.id })
                .then(onBack)
                .catch((err) => toast.error(err instanceof Error ? err.message : "Не удалось выйти"));
            }}
          >
            Покинуть
          </button>
        ) : null}
      </header>
      <div
        ref={scroller}
        className="chat-paper min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages === null ? (
          <PageLoader compact />
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted">Напишите первое сообщение, стикер или голосовое.</p>
        ) : (
          messages.map((message) => {
            const code = stickerCode(message.body);
            const sticker = code && isKnownSticker(code) ? code : null;
            const voice = message.files.find((file) => file.mime.startsWith("audio/") && !isMusicFile(file.name, file.mime));
            const rest = message.files.filter((file) => file !== voice);
            const clip = splitChat(message.body);
            const wide =
              clip.screen.length > 0 ||
              clip.books.length > 0 ||
              clip.posts.length > 0 ||
              clip.mega.length > 0 ||
              rest.some((file) => file.mime.startsWith("video/") || isMusicFile(file.name, file.mime));
            return (
              <article key={message.id} className={cn("flex items-end gap-2", message.mine ? "justify-end" : "justify-start")}>
                {message.mine ? null : <PersonFace name={message.name} image={message.image} size={28} userId={message.userId} />}
                {sticker ? (
                  <div className="max-w-[9.5rem]">
                    <img src={stickerUrl(sticker)} alt="" className="size-32 object-contain" />
                    <p className={cn("mt-0.5 text-xs", message.mine ? "text-right text-faint" : "text-faint")}>
                      {when(message.createdAt)}
                      {message.mine && !message.id.startsWith("local-") ? (
                        <span className="ml-1" aria-label={message.read ? "Прочитано" : "Отправлено"}>{message.read ? "✓✓" : "✓"}</span>
                      ) : null}
                    </p>
                  </div>
                ) : (
                  <Holdable
                    text={clip.text}
                    className={cn(
                      "max-w-[min(85%,32rem)] rounded-3xl px-3 py-2 text-base leading-6 shadow-sm",
                      wide && "max-w-[min(85%,32rem)]",
                      message.mine ? "rounded-br-lg bg-accent text-accent-fg" : "rounded-bl-lg border border-line bg-elev text-fg",
                    )}
                  >
                    {!message.mine && room.kind === "group" ? (
                      <p className={cn("mb-0.5 text-xs font-medium", message.mine ? "text-accent-fg/80" : "text-muted")}>{message.name}</p>
                    ) : null}
                    {voice ? <VoiceNote file={voice} mine={message.mine} /> : null}
                    {clip.text && !voice ? <p className="whitespace-pre-wrap break-words">{clip.text}</p> : null}
                    {clip.text && voice ? <p className={cn("mt-1 text-xs leading-relaxed", message.mine ? "text-accent-fg/80" : "text-muted")}>{clip.text}</p> : null}
                    {clip.screen.map((id) => (
                      <ScreenClip key={id} id={id} />
                    ))}
                    {clip.books.map((id) => (
                      <BookCard key={id} id={id} mine={message.mine} />
                    ))}
                    {clip.posts.map((id) => (
                      <PostCard key={id} id={id} mine={message.mine} />
                    ))}
                    {clip.mega.map((id) => (
                      <MegaCard key={id} id={id} mine={message.mine} />
                    ))}
                    {rest.map((file) => (
                      <Attachment key={file.id} file={file} mine={message.mine} />
                    ))}
                    <p className={cn("mt-0.5 text-right text-xs tabular-nums", message.mine ? "text-accent-fg/70" : "text-faint")}>
                      {when(message.createdAt)}
                      {message.mine && !message.id.startsWith("local-") ? (
                        <span className="ml-1" aria-label={message.read ? "Прочитано" : "Отправлено"}>{message.read ? "✓✓" : "✓"}</span>
                      ) : null}
                    </p>
                  </Holdable>
                )}
              </article>
            );
          })
        )}
      </div>
      {stickers ? (
        <StickerDeck
          pack={pack}
          onPack={setPack}
          onPick={(code) => void deliver(stickerBody(code), [], false)}
        />
      ) : null}
      <SourcePicker
        open={fromCircle}
        onClose={() => setFromCircle(false)}
        onBook={(id) => void place("book", id)}
        onVideo={(id) => void place("video", id)}
        onDisk={(file) => void place("disk", file.id)}
        onMega={(file) => void place("mega", file.id)}
        onPost={(id) => void place("post", id)}
      />
      <form className="border-t border-line bg-bg p-2" onSubmit={(event) => void submit(event)}>
        {progress ? (
          <div className="mb-2">
            <div className="flex justify-end">
              <button type="button" className="press h-8 rounded-xl px-2 text-xs text-muted" onClick={() => uploadAbort.current?.abort()}>
                Отменить
              </button>
            </div>
            <UploadMeter view={progress} />
          </div>
        ) : null}
        {files.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1 px-1">
            {files.map((file) => (
              <button
                key={`${file.name}-${file.size}-${file.lastModified}`}
                type="button"
                className="press inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-line px-2 text-xs"
                onClick={() => setFiles((current) => current.filter((item) => item !== file))}
              >
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-faint">{sizeLabel(file.size)}</span>
                <X className="size-3 shrink-0" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            id="circle-file"
            type="file"
            className="hidden"
            accept="*/*"
            multiple
            onChange={(event) => void onPick(event.target.files)}
          />
          <HoldHint text="Файлы. Несколько сразу, каждый до 200 МБ">
          <button
            type="button"
            className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
            aria-label="Приложить файлы"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </button>
          </HoldHint>
          <HoldHint text="Книга, запись, видео и файлы">
          <button
            type="button"
            className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
            aria-label="Выбрать из круга"
            onClick={() => setFromCircle((value) => !value)}
          >
            <Library className="size-4" />
          </button>
          </HoldHint>
          <button
            type="button"
            className={cn("press inline-flex size-11 shrink-0 items-center justify-center rounded-full", stickers ? "text-fg" : "text-muted")}
            aria-label="Стикеры"
            aria-pressed={stickers}
            onClick={() => setStickers((value) => !value)}
          >
            <Smile className="size-5" />
          </button>
          <textarea
            value={draft}
            rows={1}
            maxLength={4000}
            placeholder="Сообщение"
            className="field field-line max-h-32 flex-1 resize-none rounded-3xl text-base"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              const coarse = window.matchMedia("(pointer: coarse)").matches;
              if (event.key === "Enter" && !event.shiftKey && !coarse) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {draft.trim() || files.length > 0 ? (
            <button
              type="submit"
              disabled={busy}
              className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40"
              aria-label="Отправить"
            >
              <Send className="size-4" />
            </button>
          ) : (
            <VoiceHold
              disabled={busy}
              onSend={(file, transcript) => void deliver(transcript, [file], false)}
            />
          )}
        </div>
      </form>
    </div>
  );
}

function Attachment({ file, mine }: { file: FileMeta; mine: boolean }) {
  const [url, setUrl] = useState<string | null>(fileUrls.get(file.id) ?? null);
  const [open, setOpen] = useState(false);
  const local = file.id.startsWith("local-");

  const stream = file.mime.startsWith("video/") && file.blob && !local;

  useEffect(() => {
    if (stream) return;
    if (local || fileUrls.has(file.id)) {
      setUrl(fileUrls.get(file.id) ?? null);
      return;
    }
    if (file.blob) {
      if (file.size > 12_000_000) return;
      let dead = false;
      void fetchCircleBlob(file.id)
        .then((next) => {
          if (dead) {
            URL.revokeObjectURL(next);
            return;
          }
          fileUrls.set(file.id, next);
          setUrl(next);
        })
        .catch(() => undefined);
      return () => {
        dead = true;
      };
    }
    let dead = false;
    void readRoomFile({ data: file.id })
      .then((row) => {
        if (dead) return;
        const next = b64Url(row.data, row.mime);
        fileUrls.set(file.id, next);
        setUrl(next);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [file.id, file.blob, file.size, local, stream]);

  if (isMusicFile(file.name, file.mime)) {
    const src = url || (file.blob && !local ? circleFileUrl(file.id) : null);
    if (!src) return <LoaderMark className="vv-loader-sm mt-1.5" />;
    return <MusicCard name={file.name} src={src} mine={mine} />;
  }

  async function saveLarge() {
    try {
      const next = url || (await fetchCircleBlob(file.id));
      if (!url) {
        fileUrls.set(file.id, next);
        setUrl(next);
      }
      const link = document.createElement("a");
      link.href = next;
      link.download = file.name;
      link.click();
    } catch {
      toast.error("Файл не открывается");
    }
  }

  if (file.mime.startsWith("video/")) {
    const src = url || (stream ? circleFileUrl(file.id) : null);
    if (!src) {
      return <LoaderMark className="vv-loader-sm mt-1.5" />;
    }
    return <FileVideo src={src} name={file.name} />;
  }

  if (file.mime.startsWith("image/") && url) {
    return (
      <>
        <button type="button" className="mt-1.5 block text-left" onClick={() => setOpen(true)}>
          <img src={url} alt={file.name} className="max-h-56 rounded-2xl" />
        </button>
        {open ? (
          <div className="fixed inset-0 z-[80] flex flex-col bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={file.name}>
            <div className="flex items-center justify-between gap-2">
              <BackButton onClick={() => setOpen(false)} label="Назад" className="text-white" />
              <div className="flex gap-2">
              <a href={url} download={file.name} className="press inline-flex h-11 items-center rounded-2xl bg-elev px-3 text-sm">
                Скачать
              </a>
              <button type="button" className="press hidden h-11 items-center rounded-2xl border border-line bg-elev px-3 text-sm md:inline-flex" onClick={() => setOpen(false)}>
                Закрыть
              </button>
              </div>
            </div>
            <button type="button" className="flex min-h-0 flex-1 items-center justify-center" aria-label="Закрыть" onClick={() => setOpen(false)}>
              <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
            </button>
          </div>
        ) : null}
      </>
    );
  }
  if (file.blob && !url) {
    return (
      <button
        type="button"
        className={cn(
          "mt-1.5 flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-left text-xs",
          mine ? "bg-black/10" : "border border-line",
        )}
        onClick={() => void saveLarge()}
      >
        <Paperclip className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <span className="shrink-0 opacity-70">{sizeLabel(file.size)}</span>
      </button>
    );
  }
  return (
    <a
      href={url ?? undefined}
      download={file.name}
      className={cn(
        "mt-1.5 flex items-center gap-2 rounded-2xl px-2 py-2 text-xs",
        mine ? "bg-black/10" : "border border-line",
      )}
    >
      <Paperclip className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{file.name}</span>
      <span className="shrink-0 opacity-70">{sizeLabel(file.size)}</span>
    </a>
  );
}

function chip(mine: boolean) {
  return cn(
    "mt-1.5 flex w-full items-center gap-2 rounded-2xl p-1.5 text-left text-sm",
    mine ? "bg-black/10" : "border border-line",
  );
}

function BookCard({ id, mine }: { id: string; mine: boolean }) {
  const [card, setCard] = useState<{ title: string; author: string; cover: string } | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    void readBookCard({ data: id })
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
  if (card === null) return <p className="mt-1 text-xs opacity-70">Книга не открывается</p>;
  if (!card) return <p className="mt-1 text-xs opacity-70">Книга…</p>;
  return (
    <button type="button" className={chip(mine)} onClick={() => rememberJump({ book: id })}>
      {card.cover ? <img src={card.cover} alt="" className="size-12 shrink-0 rounded-xl object-cover" /> : (
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-black/10">
          <BookOpen className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{card.title}</span>
        <span className="block truncate text-xs opacity-70">{card.author || "Читальня"} · Читать</span>
      </span>
    </button>
  );
}

function PostCard({ id, mine }: { id: string; mine: boolean }) {
  const [card, setCard] = useState<{ author: string; body: string } | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    void readPostCard({ data: id })
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
  if (card === null) return <p className="mt-1 text-xs opacity-70">Запись не открывается</p>;
  if (!card) return <p className="mt-1 text-xs opacity-70">Запись…</p>;
  return (
    <button type="button" className={chip(mine)} onClick={() => rememberJump({ post: id })}>
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-black/10">
        <Newspaper className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{card.body || "Запись"}</span>
        <span className="block truncate text-xs opacity-70">{card.author} · Открыть</span>
      </span>
    </button>
  );
}

function MegaCard({ id, mine }: { id: string; mine: boolean }) {
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
  if (card === null) return <p className="mt-1 text-xs opacity-70">Файл не открывается</p>;
  if (!card) return <p className="mt-1 text-xs opacity-70">Файл…</p>;
  if (isMusicFile(card.name, card.mime)) return <MusicCard name={card.name} src={megaFileUrl(id, "view", true)} mine={mine} />;
  return (
    <a href={megaFileUrl(id, "file", true)} className={chip(mine)}>
      <Paperclip className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{card.name}</span>
        <span className="block truncate text-xs opacity-70">{sizeLabel(card.bytes)}</span>
      </span>
    </a>
  );
}

function VoiceNote({ file, mine }: { file: FileMeta; mine: boolean }) {
  const [url, setUrl] = useState<string | null>(fileUrls.get(file.id) ?? null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const local = file.id.startsWith("local-");

  useEffect(() => {
    if (local || fileUrls.has(file.id)) return;
    let dead = false;
    void readRoomFile({ data: file.id })
      .then((row) => {
        if (dead) return;
        const next = b64Url(row.data, row.mime);
        fileUrls.set(file.id, next);
        setUrl(next);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [file.id, local]);

  function toggle() {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play();
    else node.pause();
  }

  const shown = dur > 0 ? (playing ? at : dur) : 0;
  const clock = `${Math.floor(shown / 60)}:${String(Math.floor(shown % 60)).padStart(2, "0")}`;
  const progress = dur > 0 ? Math.min(1, at / dur) : 0;

  return (
    <div className="flex min-w-[12.5rem] items-center gap-2 py-1">
      <button
        type="button"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          mine ? "bg-accent-fg text-accent" : "bg-accent text-accent-fg",
        )}
        aria-label={playing ? "Пауза" : "Слушать"}
        disabled={!url}
        onClick={toggle}
      >
        {playing ? <Pause className="size-4" /> : <Mic className="size-4" />}
      </button>
      <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-current/20">
        <span className="absolute inset-y-0 left-0 rounded-full bg-current" style={{ width: `${progress * 100}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums opacity-80">{clock}</span>
      {url ? (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setAt(0);
          }}
          onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
          onDurationChange={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDur(value);
          }}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDur(value);
          }}
        />
      ) : null}
    </div>
  );
}

function StickerDeck({
  pack,
  onPack,
  onPick,
}: {
  pack: (typeof STICKER_PACKS)[number]["id"];
  onPack: (id: (typeof STICKER_PACKS)[number]["id"]) => void;
  onPick: (code: string) => void;
}) {
  const current = STICKER_PACKS.find((item) => item.id === pack) ?? STICKER_PACKS[0];
  return (
    <div className="border-t border-line bg-elev">
      <div className="flex gap-1 overflow-x-auto px-2 pt-2">
        {STICKER_PACKS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn("press h-8 shrink-0 rounded-full px-3 text-xs", item.id === current.id ? "bg-subtle text-fg" : "text-muted")}
            onClick={() => onPack(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid max-h-52 grid-cols-5 gap-1 overflow-y-auto px-2 py-2 sm:grid-cols-6">
        {current.codes.map((code) => (
          <button key={code} type="button" className="press grid aspect-square place-items-center rounded-2xl hover:bg-subtle" onClick={() => onPick(code)}>
            <img src={stickerUrl(code)} alt="" className="size-12 object-contain" />
          </button>
        ))}
      </div>
      <p className="px-3 pb-2 text-xs text-faint">Набор OpenMoji, открытая лицензия CC BY-SA.</p>
    </div>
  );
}

function mimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function VoiceHold({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (file: { name: string; mime: string; data: string }, transcript: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "rec" | "work">("idle");
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef(0);

  useEffect(() => {
    return () => {
      window.clearInterval(tickRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
    };
  }, []);

  function release() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function finish(blob: Blob) {
    setPhase("work");
    try {
      if (blob.size < 400) {
        toast("Запись слишком короткая");
        return;
      }
      if (blob.size > 1_200_000) {
        toast.error("Голосовое больше 1,2 МБ");
        return;
      }
      const raw = (blob.type || "audio/webm").split(";")[0] || "audio/webm";
      const type = raw === "video/webm" || raw === "audio/webm" ? "audio/webm" : raw.includes("mp4") ? "audio/mp4" : "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : "webm";
      const data = await blobToBase64(blob);
      let transcript = "";
      try {
        const body = new FormData();
        body.set("file", new File([blob], `voice.${ext}`, { type }));
        const res = await fetch("/api/transcribe", { method: "POST", body, credentials: "same-origin" });
        const json = (await res.json().catch(() => ({}))) as { text?: string };
        if (res.ok && typeof json.text === "string") transcript = json.text.trim().slice(0, 4000);
      } catch {
        transcript = "";
      }
      onSend({ name: `voice.${ext}`, mime: type, data }, transcript);
    } finally {
      setPhase("idle");
      setSeconds(0);
    }
  }

  async function start() {
    if (disabled || phase !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("В этом браузере нет микрофона");
      return;
    }
    const chosen = mimeType();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Нет доступа к микрофону");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, chosen ? { mimeType: chosen } : undefined);
    recRef.current = rec;
    rec.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      release();
      void finish(blob);
    };
    rec.start();
    setPhase("rec");
    setSeconds(0);
    tickRef.current = window.setInterval(() => {
      setSeconds((value) => {
        if (value >= 59) {
          rec.stop();
          window.clearInterval(tickRef.current);
          return value;
        }
        return value + 1;
      });
    }, 1000);
  }

  function stop() {
    window.clearInterval(tickRef.current);
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else {
      release();
      setPhase("idle");
    }
  }

  if (phase === "work") {
    return <span className="grid size-11 shrink-0 place-items-center text-xs text-faint">…</span>;
  }
  if (phase === "rec") {
    return (
      <button
        type="button"
        className="press inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-danger px-3 text-sm text-white"
        onClick={stop}
      >
        <span className="size-2 rounded-full bg-white" />
        {seconds}с
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40"
      aria-label="Голосовое"
      onClick={() => void start()}
    >
      <Mic className="size-4" />
    </button>
  );
}

function GroupSheet({
  friends,
  onClose,
  onCreated,
}: {
  friends: Person[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const edge = useEdgeBack(true, onClose);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const room = await createGroup({ data: { title, members: picked } });
      onCreated(room.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать группу");
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-elev" {...edge} style={edge.style}>
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <BackButton onClick={onClose} label="Назад" />
          <p className="truncate text-sm font-medium">Новая группа</p>
        </div>
        <button type="button" className="press hidden size-11 text-muted md:inline-flex" aria-label="Закрыть" onClick={onClose}>
          <X className="mx-auto size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Название"
          maxLength={48}
          className="field"
        />
        <p className="mt-3 px-1 text-xs text-faint">Кого позвать</p>
        {friends.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted">Сначала добавьте друзей.</p>
        ) : (
          friends.map((person) => {
            const on = picked.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                className="press flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-left hover:bg-subtle"
                onClick={() =>
                  setPicked((current) =>
                    current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id].slice(0, 11),
                  )
                }
              >
                <Avatar name={person.name} image={person.image} userId={person.id} />
                <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
                <span className={cn("size-4 rounded-full border", on ? "border-accent bg-accent" : "border-line")} />
              </button>
            );
          })
        )}
      </div>
      <div className="border-t border-line p-3">
        <button
          type="button"
          disabled={busy || !title.trim() || picked.length === 0}
          className="press h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
          onClick={() => void create()}
        >
          {busy ? "Создаём…" : "Создать"}
        </button>
      </div>
    </div>
  );
}
