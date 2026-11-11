import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Phone-only back control. Closes the covering screen in place, without a load. */
export function BackButton({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      className={cn("press -ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-2xl text-fg md:hidden", className)}
      aria-label={label}
      onClick={onClick}
    >
      <ChevronLeft className="size-6" strokeWidth={1.75} />
    </button>
  );
}
