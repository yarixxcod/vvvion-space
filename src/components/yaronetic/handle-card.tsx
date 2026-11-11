import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getMyHandle, setMyHandle } from "@/lib/social/handles";

export function HandleCard() {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getMyHandle()
      .then((card) => setHandle(card.handle ?? ""))
      .catch(() => undefined);
  }, []);

  return (
    <form
      className="mt-3 space-y-2 rounded-3xl border border-line bg-elev p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void setMyHandle({ data: { handle } })
          .then((card) => {
            setHandle(card.handle ?? "");
            toast(card.handle ? `Теперь вы @${card.handle}` : "Юзернейм снят");
          })
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Не сохранилось"))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm font-medium">Юзернейм</p>
      <p className="text-xs text-faint">По нему присылают подарки. Латиница, от 3 знаков, с буквы.</p>
      <label className="block text-xs text-faint">
        @username
        <input
          className="field mt-1"
          value={handle}
          maxLength={20}
          placeholder="username"
          onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/^@/, ""))}
        />
      </label>
      <button type="submit" disabled={busy} className="press h-11 w-full rounded-2xl border border-line px-3 text-sm disabled:opacity-40">
        Сохранить юзернейм
      </button>
    </form>
  );
}
