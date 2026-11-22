import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getMemoryWorkspace } from "@/lib/memory/api";
import type { Workspace } from "@/lib/memory/policy";
import { LegacyMemoryPanel } from "./legacy-memory-panel";
import { MemoryWorkspace } from "./memory-workspace";
export function MemoryPanel({ chatId }: { chatId?: string | null }) {
  const user = useCurrentUser();
  const owner = user?.id || "";
  const [data, setData] = useState<{ owner: string; state: Workspace } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    if (!owner) return;
    getMemoryWorkspace({ data: { chatKey: chatId || undefined } })
      .then((state) => {
        if (live) setData({ owner, state });
      })
      .catch(() => {
        if (live) setError("Память временно недоступна. Чат продолжит работать.");
      });
    return () => {
      live = false;
    };
  }, [owner, chatId, retry]);
  if (!owner) return <LegacyMemoryPanel chatId={chatId} />;
  if (error)
    return (
      <section className="mt-4 rounded-2xl border border-line p-4">
        <h3 className="font-medium">Память VVVion</h3>
        <p role="alert" className="mt-2 text-sm text-muted">
          {error}
        </p>
        <button
          className="press mt-2 min-h-11 rounded-xl border border-line px-3 text-sm"
          onClick={() => setRetry((v) => v + 1)}
        >
          Повторить
        </button>
      </section>
    );
  if (!data || data.owner !== owner)
    return (
      <section
        aria-label="Загрузка памяти"
        className="mt-4 animate-pulse space-y-3 rounded-2xl border border-line p-4"
      >
        <div className="h-5 w-40 rounded bg-subtle" />
        <div className="h-12 rounded-xl bg-subtle" />
        <div className="h-20 rounded-xl bg-subtle" />
      </section>
    );
  if (!data.state.available) return <LegacyMemoryPanel chatId={chatId} />;
  return (
    <MemoryWorkspace
      key={owner}
      initial={data.state}
      chatId={chatId}
      onState={(state) => setData({ owner, state })}
    />
  );
}
