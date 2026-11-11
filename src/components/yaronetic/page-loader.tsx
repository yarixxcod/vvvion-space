import { cn } from "@/lib/utils";

export function LoaderMark({ className }: { className?: string }) {
  return (
    <span className={cn("vv-loader", className)} role="status">
      <span className="sr-only">…</span>
      <i />
      <i />
      <i />
    </span>
  );
}

export function PageLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid place-items-center py-3" : "grid min-h-32 place-items-center py-10"}>
      <LoaderMark className={compact ? "vv-loader-sm" : undefined} />
    </div>
  );
}
