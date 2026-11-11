import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/disk")({
  beforeLoad: () => {
    throw redirect({ to: "/", search: { place: "disk" } });
  },
});
