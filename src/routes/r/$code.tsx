import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Wordmark } from "@/components/yaronetic/wordmark";
import { PageLoader } from "@/components/yaronetic/page-loader";

const ROBOTS = "noindex, nofollow, noarchive, nosnippet, noimageindex";
const CODE = /^[a-z0-9]{8}$/;

export const Route = createFileRoute("/r/$code")({
  headers: () => ({
    "X-Robots-Tag": ROBOTS,
    "Cache-Control": "private, no-store",
  }),
  head: () => ({
    meta: [
      { title: "Приглашение · vvvion.space" },
      { name: "robots", content: ROBOTS },
      { name: "googlebot", content: ROBOTS },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  useEffect(() => {
    const clean = code.trim().toLowerCase();
    if (CODE.test(clean)) {
      try {
        localStorage.setItem("vvvion.ref", clean);
      } catch {
        /* private mode */
      }
    }
    void navigate({ to: "/", replace: true });
  }, [code, navigate]);
  return (
    <div className="flex h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark large />
      <PageLoader compact />
    </div>
  );
}
