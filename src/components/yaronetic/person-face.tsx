import { useEffect, useState } from "react";
import { listFaceMarks } from "@/lib/social/premium";

type Marks = { admins: Set<string>; premiums: Set<string> };

let markCache: Marks | null = null;
let markLoad: Promise<void> | null = null;
const markSubs = new Set<(next: Marks) => void>();

function publish(next: Marks) {
  markCache = next;
  for (const fn of markSubs) fn(next);
}

function loadMarks() {
  if (markCache || markLoad) return;
  markLoad = listFaceMarks()
    .then((row) => publish({ admins: new Set(row.admins), premiums: new Set(row.premiums) }))
    .catch(() => publish({ admins: new Set(), premiums: new Set() }))
    .finally(() => {
      markLoad = null;
    });
}

export function refreshFaceMarks() {
  markCache = null;
  markLoad = null;
  loadMarks();
}

function useFaceMarks(userId?: string | null) {
  const [marks, setMarks] = useState<Marks>(() => markCache ?? { admins: new Set(), premiums: new Set() });
  useEffect(() => {
    const pull = (next: Marks) => setMarks(next);
    markSubs.add(pull);
    if (markCache) setMarks(markCache);
    else loadMarks();
    return () => {
      markSubs.delete(pull);
    };
  }, []);
  return {
    admin: Boolean(userId && marks.admins.has(userId)),
    premium: Boolean(userId && marks.premiums.has(userId)),
  };
}

export function PersonFace({
  name,
  image,
  size = 36,
  userId,
}: {
  name: string;
  image?: string | null;
  size?: number;
  userId?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const { admin, premium } = useFaceMarks(userId);
  const letter = (name.trim()[0] || "?").toUpperCase();
  const face =
    !image || failed ? (
      <span className="person-letter" style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.46)) }} aria-hidden="true">
        {letter}
      </span>
    ) : (
      <img src={image} alt="" className="person-photo" style={{ width: size, height: size }} onError={() => setFailed(true)} />
    );
  if (!admin && !premium) return face;
  const tiny = size < 26;
  const mark = Math.max(11, Math.round(size * 0.42));
  const title = admin && premium ? "Администратор, Premium" : admin ? "Администратор" : "Premium";
  return (
    <span
      className={admin ? (premium ? "person-admin person-premium" : "person-admin") : "person-premium"}
      style={{
        width: size,
        height: size,
        boxShadow: tiny ? (admin ? "0 0 0 1.5px #ffe08a, 0 0 0 2.5px #b8860b" : "0 0 0 1.5px #f3eeff, 0 0 0 2.5px #6e5ad6") : undefined,
      }}
      title={title}
    >
      {face}
      {admin && !tiny ? (
        <span className="person-admin-check" style={{ width: mark, height: mark }} aria-label="Администратор">
          <svg viewBox="0 0 16 16" width={Math.max(8, mark - 6)} height={Math.max(8, mark - 6)} aria-hidden="true">
            <path d="M3.2 8.2 6.3 11.2 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
      {premium && !tiny ? (
        <span className="person-premium-gem" style={{ width: mark, height: mark }} aria-label="Premium">
          <svg viewBox="0 0 16 16" width={Math.max(8, mark - 6)} height={Math.max(8, mark - 6)} aria-hidden="true">
            <path d="M8 1.6 13.2 6.4 8 14.4 2.8 6.4Z" fill="currentColor" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}
