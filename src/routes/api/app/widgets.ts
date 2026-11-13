import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { json, readWalletBalance, requireUser } from "@/lib/pay/topup.server";

export const Route = createFileRoute("/api/app/widgets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request);
        if (typeof user !== "string") return json(user.status, user.body);
        const sql = await getSql();
        const rows = await sql<{ city: string }>`
          select city from weather_cities where user_id = ${user} order by added_at desc limit 8
        `;
        return json(200, { balance: await readWalletBalance(user), weatherCities: rows.map((row) => row.city) });
      },
    },
  },
});
