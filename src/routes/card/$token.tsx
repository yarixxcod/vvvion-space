import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { HumanCheck } from "@/components/yaronetic/human-check";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { claimCheckinLink } from "@/lib/social/checkin";

export const Route = createFileRoute("/card/$token")({
  head: () => ({
    meta: [
      { title: "Карта — vvvion.space" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CardWindow,
});

function CardWindow() {
  const { token } = Route.useParams();
  const [proof, setProof] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function take() {
    if (busy) return;
    if (!proof) {
      setNote("Сначала подтвердите, что это вы.");
      return;
    }
    setBusy(true);
    try {
      const result = await claimCheckinLink({ data: { token, proof } });
      setProof("");
      setResetKey((value) => value + 1);
      if (result.status === "granted") setNote(`100 вублей на карте. Сейчас ${result.balance ?? 0}.`);
      else if (result.status === "opened") setNote("Карта открыта. На ней первая тысяча вублей. Следующие 100 можно будет забрать завтра.");
      else if (result.status === "early") setNote("Дневные 100 уже забраны. Зайдите завтра.");
      else setNote("Ссылка не действует или время вышло. Попросите новую в боте.");
    } catch (err) {
      setProof("");
      setResetKey((value) => value + 1);
      setNote(err instanceof Error ? err.message : "Не получилось забрать.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 py-10 text-fg">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-elev p-6">
        <Wordmark large />
        <h1 className="mt-4 font-serif text-3xl tracking-tight">Дневные 100</h1>
        <p className="mt-2 text-sm text-muted">Подтвердите, что это вы, и вубли лягут на карту.</p>
        <div className="mt-4">
          <HumanCheck resetKey={resetKey} onPayload={setProof} />
        </div>
        <button
          type="button"
          disabled={busy}
          className="press mt-4 h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
          onClick={() => void take()}
        >
          {busy ? "Секунду" : "Забрать 100"}
        </button>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </div>
    </main>
  );
}
