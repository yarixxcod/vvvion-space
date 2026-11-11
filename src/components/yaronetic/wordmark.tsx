import { cn } from "@/lib/utils";

export function Wordmark({ large = false, className }: { large?: boolean; className?: string }) {
  return (
    <p className={cn("wordmark", large && "wordmark-lg", className)}>
      <span>VVVION</span>
      <span className="wordmark-bang">!</span>
      <span className="wordmark-space">SPACE</span>
    </p>
  );
}
