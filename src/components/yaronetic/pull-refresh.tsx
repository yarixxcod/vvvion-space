import { type ReactNode } from "react";

/** Scrolling must never remount the app or discard an in-progress draft. */
export function PullRefresh({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh w-full flex-col">{children}</div>;
}
