import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

const ID = /^[A-Za-z0-9_-]{8,80}$/;

export const Route = createFileRoute("/messages/$id")({
  beforeLoad: ({ params }) => {
    if (!ID.test(params.id)) throw notFound();
    throw redirect({ to: "/", search: { place: "chat", room: params.id } });
  },
});
