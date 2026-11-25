import assert from "node:assert/strict";
import test from "node:test";
import { runCalendarTool, type ToolApi, type ToolEvent } from "./tools.ts";

function memory(): { api: ToolApi; events: ToolEvent[] } {
  const events: ToolEvent[] = [{ id: "mine1234", title: "Своё", startsAt: "2026-11-25T10:00:00.000Z", endsAt: "2026-11-25T11:00:00.000Z", tz: "Asia/Almaty" }];
  const api: ToolApi = {
    list: async (userId) => (userId === "me" ? events : []),
    search: async (userId) => (userId === "me" ? events : []),
    create: async (userId, input) => {
      if (userId !== "me") return { error: "NOT_FOUND" };
      const made = { id: "new12345", title: String(input.title), startsAt: String(input.starts_at), endsAt: String(input.ends_at || input.starts_at), tz: "Asia/Almaty" };
      events.push(made);
      return made;
    },
    update: async () => ({ error: "NOT_FOUND" }),
    remove: async (userId, input) => {
      if (userId !== "me" || input.id !== "mine1234") return { error: "NOT_FOUND" };
      events.splice(0, events.length);
      return { ok: true };
    },
    free: async () => [],
  };
  return { api, events };
}

test("delete without confirm does not touch data, a foreign id stays hidden", async () => {
  const { api, events } = memory();
  const preview = JSON.parse(await runCalendarTool("me", "calendar_delete", { id: "mine1234" }, api));
  assert.equal(preview.needs_confirm, true);
  assert.equal(events.length, 1);
  const gone = JSON.parse(await runCalendarTool("me", "calendar_delete", { id: "mine1234", confirm: true }, api));
  assert.equal(gone.ok, true);
  assert.equal(events.length, 0);
  const foreign = JSON.parse(await runCalendarTool("other", "calendar_delete", { id: "mine1234", confirm: true }, api));
  assert.equal(foreign.error, "NOT_FOUND");
  const wide = JSON.parse(await runCalendarTool("me", "calendar_update", { id: "mine1234", scope: "all" }, api));
  assert.equal(wide.needs_confirm, true);
});
