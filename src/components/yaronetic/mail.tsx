import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { PersonFace } from "@/components/yaronetic/person-face";
import {
  listDirectory,
  listInbox,
  listThread,
  sendMessage,
  type Conversation,
  type MailMessage,
  type Person,
} from "@/lib/social/mail";

export function Mail() {
  const [people, setPeople] = useState<Person[]>([]);
  const [inbox, setInbox] = useState<Conversation[]>([]);
  const [peer, setPeer] = useState<Person | null>(null);
  const [thread, setThread] = useState<MailMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const [directory, conversations] = await Promise.all([listDirectory(), listInbox()]);
      setPeople(directory);
      setInbox(conversations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Сообщения недоступны");
    }
  }, []);

  const openThread = useCallback(async (person: Person) => {
    setPeer(person);
    setThread(null);
    try {
      const rows = await listThread({ data: person.id });
      setThread(rows);
      setError(null);
    } catch (err) {
      setThread([]);
      setError(err instanceof Error ? err.message : "Переписка недоступна");
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (!peer) return;
    const timer = window.setInterval(() => {
      void listThread({ data: peer.id })
        .then((rows) => setThread(rows))
        .catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [peer]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!peer || busy) return;
    if (!body) {
      toast("Напишите сообщение");
      return;
    }
    setBusy(true);
    const optimistic: MailMessage = {
      id: `local-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    setThread((current) => [...(current ?? []), optimistic]);
    setDraft("");
    try {
      await sendMessage({ data: { to: peer.id, body } });
      const rows = await listThread({ data: peer.id });
      setThread(rows);
      void loadLists();
    } catch (err) {
      setThread((current) => current?.filter((item) => item.id !== optimistic.id) ?? []);
      setDraft(body);
      toast.error(err instanceof Error ? err.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  }

  if (peer) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button
            type="button"
            className="press inline-flex size-11 items-center justify-center rounded-2xl text-muted"
            aria-label="К списку"
            onClick={() => {
              setPeer(null);
              setThread(null);
              void loadLists();
            }}
          >
            <ArrowLeft className="size-4" />
          </button>
          <p className="truncate text-sm font-medium">{peer.name}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {thread === null ? (
            <PageLoader compact />
          ) : thread.length === 0 ? (
            <p className="text-sm text-muted">Напишите первое сообщение — оно уйдёт этому человеку.</p>
          ) : (
            thread.map((item) => (
              <p
                key={item.id}
                className={
                  item.mine
                    ? "ml-8 rounded-2xl bg-subtle px-3 py-2 text-sm"
                    : "mr-8 rounded-2xl border border-line bg-bg px-3 py-2 text-sm"
                }
              >
                {item.body}
              </p>
            ))
          )}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
        <form className="border-t border-line p-3" onSubmit={(event) => void submit(event)}>
          <textarea
            value={draft}
            rows={2}
            maxLength={1000}
            placeholder={`Сообщение для ${peer.name}`}
            className="field min-h-16 w-full resize-none py-2 text-sm"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(event);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs tabular-nums text-faint">{draft.trim().length}/1000</span>
            <button
              type="submit"
              className="press h-11 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
              disabled={busy}
            >
              Отправить
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      <p className="px-1 text-xs text-faint">Кому написать</p>
      {people.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted">
          Пока в круге только вы. Когда кто-то зарегистрируется по логину и паролю, ему можно будет отправить сообщение.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className="press flex h-11 w-full items-center rounded-2xl px-2 text-left text-sm hover:bg-subtle"
                onClick={() => void openThread(person)}
              >
                <PersonFace name={person.name} image={person.image} size={32} userId={person.id} />
                <span className="truncate">{person.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {inbox.length > 0 ? (
        <>
          <p className="mt-4 px-1 text-xs text-faint">Переписки</p>
          <ul className="mt-2 space-y-1">
            {inbox.map((item) => (
              <li key={item.peerId}>
                <button
                  type="button"
                  className="press flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-left hover:bg-subtle"
                  onClick={() => void openThread({ id: item.peerId, name: item.peerName, image: item.peerImage })}
                >
                  <PersonFace name={item.peerName} image={item.peerImage} size={32} userId={item.peerId} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.peerName}</span>
                    <span className="block truncate text-xs text-faint">{item.preview}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
