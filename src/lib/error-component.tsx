import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">{errorMessage(error)}</p>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-fg">
      <title>Страница не найдена — vvvion.space</title>
      <div className="max-w-sm">
        <h1 className="font-serif text-4xl tracking-tight">Страница не найдена</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">Такого адреса нет или ссылка уже не действует.</p>
        <a href="/" className="press mt-5 inline-flex h-11 items-center rounded-2xl bg-accent px-4 text-sm font-medium text-accent-fg">
          На главную
        </a>
      </div>
    </main>
  );
}
