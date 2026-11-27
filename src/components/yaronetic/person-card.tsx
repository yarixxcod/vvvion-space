import { openAccountPanel } from "@/lib/account-panel";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BackButton } from "@/components/yaronetic/back-button";
import { CatalogArt } from "@/components/yaronetic/catalog-art";
import { PersonFace } from "@/components/yaronetic/person-face";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { pushBackLayer } from "@/lib/app-back";
import { readPublicPerson, type PublicPerson } from "@/lib/social/person-card";
import { ReportDialog } from "@/components/yaronetic/report-dialog";

let opener: ((id: string) => void) | null = null;

export function openPersonCard(userId: string) {
  opener?.(userId);
}

export function PersonCardHost() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    opener = (next) => setId(next);
    return () => {
      opener = null;
    };
  }, []);
  if (!id) return null;
  return <PersonSheet userId={id} onClose={() => setId(null)} />;
}

function PersonSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const me = useCurrentUser();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [person, setPerson] = useState<PublicPerson | null>(null);
  const [error, setError] = useState("");
  const [report, setReport] = useState(false);
  useEffect(() => setNode(document.body), []);
  useEffect(() => pushBackLayer(onClose), [onClose]);
  useEffect(() => {
    let dead = false;
    setPerson(null);
    setError("");
    void readPublicPerson({ data: { id: userId } })
      .then((row) => {
        if (!dead) setPerson(row);
      })
      .catch((err: unknown) => {
        if (!dead) setError(err instanceof Error ? err.message : "Профиль не открылся");
      });
    return () => {
      dead = true;
    };
  }, [userId]);

  if (!node) return null;
  const place = [person?.city, person?.country].filter(Boolean).join(", ");
  const born = person?.birthDate ? formatBirth(person.birthDate) : "";
  const mine = Boolean(me?.id && me.id === userId);
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/55 sm:items-center" role="presentation" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-elev px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)] sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-label={person?.name || "Профиль"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <div className="flex items-center justify-between">
          <BackButton onClick={onClose} label="Назад" />
          <p className="flex-1 text-center text-xs tracking-wide text-faint uppercase">Профиль</p>
          <button type="button" aria-label="Закрыть профиль" className="press hidden min-h-10 rounded-xl px-3 text-xs md:block" onClick={onClose}>Закрыть</button>
          {mine ? <button type="button" aria-label="Настройки аккаунта" className="press size-11 rounded-xl border border-line text-xl" onClick={() => { onClose(); openAccountPanel("settings"); }}>⋯</button> : <button type="button" aria-label="Закрыть профиль" className="press size-11 rounded-xl border border-line" onClick={onClose}>×</button>}
        </div>
        {error ? <p className="py-10 text-center text-sm text-danger">{error}</p> : null}
        {!error && !person ? <p className="py-10 text-center text-sm text-muted">Открываем профиль…</p> : null}
        {person ? (
          <div className="pb-2">
            <div className="flex flex-col items-center pt-2 text-center">
              <PersonFace name={person.name} image={person.image} userId={person.id} size={112} pressable={false} />
              <h2 className="mt-3 font-serif text-3xl tracking-tight">{person.name}</h2>
              {person.handle ? <p className="mt-1 text-sm text-muted">@{person.handle}</p> : null}
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {person.admin ? <span className="rounded-full border border-line bg-subtle px-2.5 py-1 text-xs">Администратор</span> : null}
                {person.premium ? <span className="rounded-full border border-line bg-subtle px-2.5 py-1 text-xs">Premium</span> : null}
              </div>
              {place || born ? (
                <p className="mt-3 text-sm text-muted">
                  {place}
                  {place && born ? " · " : ""}
                  {born ? `день рождения ${born}` : ""}
                </p>
              ) : (
                <p className="mt-3 text-sm text-faint">О себе пока ничего не написано</p>
              )}
              <p className="mt-1 text-xs text-faint">В VVVion с {formatBirth(person.joinedAt.slice(0, 10))}</p>
            </div>
            {mine ? <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" className="press min-h-11 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg" onClick={() => { onClose(); openAccountPanel("profile"); }}>Редактировать</button><button type="button" className="press min-h-11 rounded-xl border border-line px-3 text-sm" onClick={() => { onClose(); openAccountPanel("settings"); }}>Настройки</button></div> : <button type="button" className="press mt-5 min-h-11 w-full rounded-xl border border-line px-3 text-sm" onClick={() => setReport(true)}>Пожаловаться</button>}
            <section className="mt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-serif text-xl">Подарки</h3>
                <span className="text-xs text-muted">{person.gifts.reduce((sum, gift) => sum + gift.count, 0)}</span>
              </div>
              {person.gifts.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-line px-3 py-6 text-center text-sm text-faint">Подарков пока нет</p>
              ) : (
                <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {person.gifts.map((gift) => (
                    <li key={gift.sku} className="w-28 shrink-0 rounded-2xl border border-line bg-bg p-2 text-center">
                      <CatalogArt kind="gifts" id={gift.sku.replace(/^gift:/, "")} className="aspect-square w-full rounded-xl" sizes="96px" />
                      <p className="mt-2 truncate text-xs font-medium">{gift.title}</p>
                      {gift.count > 1 ? <p className="text-[11px] text-muted">×{gift.count}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
              {mine ? <p className="mt-2 text-xs text-faint">Управление подарками и продажа — в разделе «Редактировать».</p> : null}
            </section>
          </div>
        ) : null}
        {report ? <ReportDialog targetType="user" targetId={userId} onClose={() => setReport(false)} /> : null}
      </div>
    </div>,
    node,
  );
}

function formatBirth(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}
