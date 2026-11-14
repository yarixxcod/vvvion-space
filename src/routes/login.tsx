import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/yaronetic/auth-form";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { LangSwitch } from "@/lib/lang";
import { langOf, normalizeLang, type Lang } from "@/lib/i18n";

const COPY = {
  ru: { title: "Вход — vvvion.space", description: "Вход в vvvion.space по почте и паролю. Чат с ИИ и круг." },
  en: { title: "Sign in — vvvion.space", description: "Sign in to vvvion.space with email and a password. AI chat and circle." },
  kk: { title: "Кіру — vvvion.space", description: "vvvion.space-ке пошта мен құпия сөзбен кіру. ЖИ-мен чат және шеңбер." },
} as const;

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { lang?: Lang } => {
    const lang = normalizeLang(search.lang);
    return lang ? { lang } : {};
  },
  head: ({ match }) => {
    const copy = COPY[langOf(match.search.lang)];
    return {
      meta: [
        { title: copy.title },
        { name: "description", content: copy.description },
        { name: "robots", content: "noindex, follow" },
      ],
    };
  },
  component: Login,
});

function Login() {
  return (
    <main className="flex min-h-dvh items-end justify-center bg-bg sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl border border-line bg-elev px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow)] sm:rounded-3xl sm:pb-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3 px-1">
          <Wordmark large />
          <LangSwitch compact />
        </div>
        <AuthForm />
      </div>
    </main>
  );
}
