import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { TICKET_CATEGORIES, labelOf } from "@/lib/social/support-core";
import {
  fileAppeal,
  listMySanctions,
  listMyTickets,
  listNotices,
  openTicket,
  readTicket,
  replyTicket,
  setMyTicket,
} from "@/lib/social/support";

type Ticket = { id: string; category: string; subject: string; status: string; created_at: string; updated_at: string };
type Notice = { id: string; title: string; body: string; created_at: string; read_at: string | null };
type Sanction = { id: string; kind: string; reason: string; until_at: string | null; created_at: string };

const STATUS: Record<string, string> = {
  new: "Новое",
  open: "В работе",
  waiting: "Ожидает вас",
  solved: "Решено",
  closed: "Закрыто",
};

async function filesOf(list: FileList | null) {
  if (!list?.length) return [];
  const out: { mime: string; data: string }[] = [];
  for (const file of [...list].slice(0, 3)) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 190_000) throw new Error("Скриншот: png, jpeg или webp до 190 КБ");
    const data = await file.arrayBuffer();
    let text = "";
    const bytes = new Uint8Array(data);
    for (const byte of bytes) text += String.fromCharCode(byte);
    out.push({ mime: file.type, data: btoa(text) });
  }
  return out;
}

export function SupportCenter({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [category, setCategory] = useState("tech");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    void listMyTickets().then(setRows).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Обращения не открылись"));
    void listNotices().then(setNotices).catch(() => undefined);
    void listMySanctions().then(setSanctions).catch(() => undefined);
  }
  useEffect(load, []);

  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-end justify-center bg-black/55 sm:items-center" onClick={onClose}>
      <section className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-elev p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl" role="dialog" aria-modal="true" aria-label="Поддержка" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">Поддержка</h2>
          <button type="button" className="press size-11 rounded-xl border border-line" aria-label="Закрыть поддержку" onClick={onClose}>×</button>
        </div>
        {notices.length ? (
          <ul className="mt-3 space-y-2">
            {notices.slice(0, 4).map((item) => (
              <li key={item.id} className="rounded-2xl border border-line px-3 py-2 text-sm">
                <p className="font-medium">{item.title}</p>
                <p className="text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {openId ? (
          <TicketThread id={openId} onBack={() => { setOpenId(null); load(); }} />
        ) : (
          <>
            <form
              className="mt-3 rounded-2xl border border-line p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const input = form.elements.namedItem("shots") as HTMLInputElement;
                setBusy(true);
                void filesOf(input.files)
                  .then((images) => openTicket({ data: { category, subject, body, images } }))
                  .then(() => {
                    toast("Обращение создано");
                    setSubject("");
                    setBody("");
                    input.value = "";
                    load();
                  })
                  .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Не отправилось"))
                  .finally(() => setBusy(false));
              }}
            >
              <p className="text-sm font-medium">Новое обращение</p>
              <select className="field mt-2" value={category} onChange={(event) => setCategory(event.target.value)}>
                {TICKET_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <input className="field mt-2" placeholder="Тема" maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} />
              <textarea className="field mt-2 min-h-24" placeholder="Что случилось" maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} />
              <input name="shots" type="file" accept="image/png,image/jpeg,image/webp" multiple className="mt-2 block w-full text-xs text-muted" />
              <button type="submit" disabled={busy} className="press mt-3 h-11 w-full rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40">Отправить</button>
            </form>
            {rows === null ? <PageLoader compact /> : rows.length === 0 ? <p className="mt-4 text-sm text-muted">Обращений пока нет.</p> : (
              <ul className="mt-4 space-y-2">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button type="button" className="press w-full rounded-2xl border border-line px-3 py-2 text-left" onClick={() => setOpenId(row.id)}>
                      <span className="block text-sm font-medium">{row.subject}</span>
                      <span className="mt-0.5 block text-xs text-faint">{labelOf(TICKET_CATEGORIES, row.category)} · {STATUS[row.status] ?? row.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sanctions.length ? (
              <div className="mt-4">
                <p className="text-sm font-medium">Решения по аккаунту</p>
                <ul className="mt-2 space-y-2">
                  {sanctions.map((item) => (
                    <SanctionRow key={item.id} item={item} onSent={load} />
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}

function SanctionRow({ item, onSent }: { item: Sanction; onSent: () => void }) {
  const [text, setText] = useState("");
  return (
    <li className="rounded-2xl border border-line px-3 py-2 text-sm">
      <p>{item.reason}</p>
      <p className="text-xs text-faint">{item.kind}{item.until_at ? ` · до ${item.until_at.slice(0, 10)}` : ""}</p>
      <form className="mt-2 flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        void fileAppeal({ data: { actionId: item.id, body: text } })
          .then(() => { toast("Апелляция отправлена"); setText(""); onSent(); })
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Не отправилось"));
      }}>
        <input className="field" placeholder="Почему решение стоит пересмотреть" value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit" className="press h-11 shrink-0 rounded-xl border border-line px-3 text-xs">Обжаловать</button>
      </form>
    </li>
  );
}

function TicketThread({ id, onBack }: { id: string; onBack: () => void }) {
  const [view, setView] = useState<Awaited<ReturnType<typeof readTicket>> | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let dead = false;
    void readTicket({ data: id })
      .then((next) => {
        if (!dead) setView(next);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Не открылось"));
    return () => {
      dead = true;
    };
  }, [id, rev]);
  if (!view) return <PageLoader compact />;
  const status = view.ticket.status;
  return (
    <div className="mt-3">
      <button type="button" className="press text-sm text-muted" onClick={onBack}>Назад к списку</button>
      <h3 className="mt-2 font-serif text-xl">{view.ticket.subject}</h3>
      <p className="text-xs text-faint">{STATUS[status] ?? status} · {view.ticket.id.slice(0, 8)}</p>
      <ul className="mt-3 space-y-2">
        {view.messages.map((message) => (
          <li key={message.id} className="rounded-2xl border border-line px-3 py-2 text-sm whitespace-pre-wrap">
            {message.body}
            {view.files.filter((file) => file.message_id === message.id).map((file) => (
              <img key={file.id} alt="" className="mt-2 max-h-48 rounded-xl" src={`data:${file.mime};base64,${file.data}`} />
            ))}
          </li>
        ))}
      </ul>
      <form className="mt-3" onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void replyTicket({ data: { id, body: text } })
          .then(() => {
            setText("");
            setRev((n) => n + 1);
          })
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Не отправилось"))
          .finally(() => setBusy(false));
      }}>
        <textarea className="field min-h-20" value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} placeholder="Ответ" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40">Ответить</button>
          <button type="button" className="press h-10 rounded-xl border border-line px-3 text-sm" onClick={() => void setMyTicket({ data: { id, reopen: status === "solved" || status === "closed" } }).then(() => setRev((n) => n + 1))}>
            {status === "solved" || status === "closed" ? "Открыть снова" : "Закрыть"}
          </button>
        </div>
      </form>
    </div>
  );
}
