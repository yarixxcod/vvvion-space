import { useEffect, useRef, useState } from "react";
import { playSound } from "@/lib/sounds";
import { appBadge, appNotify, cancelAppNotification, messagePreviewOn, nativeShell } from "@/lib/app-bridge";
import { publicNotifyIcon } from "@/lib/social/push-policy";
import { countUnread, listRooms } from "@/lib/social/messenger";

export function useCircleUnread(enabled: boolean) {
  const [n, setN] = useState(0);
  const seen = useRef<number | null>(null);
  const badged = useRef<number | null>(null);
  const roomsSeen = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!enabled) {
      setN(0);
      seen.current = null;
      if (badged.current) appBadge(0);
      badged.current = null;
      roomsSeen.current = new Map();
      return;
    }
    let dead = false;
    let ticks = 0;
    let roomsAt = -1;
    let roomsN = -1;
    const pull = () => {
      if (document.hidden && !nativeShell()) return;
      const tick = ticks++;
      void countUnread()
        .then((row) => {
          if (dead) return;
          if (!document.hidden && seen.current != null && row.n > seen.current) playSound("message");
          seen.current = row.n;
          setN(row.n);
          if (badged.current !== row.n) {
            badged.current = row.n;
            appBadge(row.n);
          }
          // Native shell only: the per-room list (80 rooms, 8 subqueries each) is re-read when the
          // unread total moved, and at least every 4th tick (~32 s) as a safety net.
          if (nativeShell() && (row.n !== roomsN || roomsAt < 0 || tick - roomsAt >= 4)) {
            roomsN = row.n;
            roomsAt = tick;
            pullRooms();
          }
        })
        .catch(() => undefined);
    };
    const pullRooms = () => {
      void listRooms()
        .then((rooms) => {
          if (dead) return;
          const live = new Set(rooms.map((room) => room.id));
          for (const room of rooms) {
            const prev = roomsSeen.current.get(room.id);
            roomsSeen.current.set(room.id, room.unread);
            if (prev == null) continue;
            if (document.hidden && room.unread > prev) {
              const text = (room.preview || "Новое сообщение").slice(0, 120);
              const shown = messagePreviewOn();
              appNotify({
                id: `msg:${room.id}`,
                channel: "messages",
                kind: "message",
                title: room.title.slice(0, 80) || "Сообщение",
                body: shown ? text : "Новое сообщение",
                preview: shown ? text : undefined,
                chat: room.kind === "group" ? room.title : undefined,
                icon: publicNotifyIcon(room.image),
                ts: Date.parse(room.at) || Date.now(),
                url: `/messages/${room.id}`,
              });
            } else if (room.unread === 0 && prev > 0) {
              cancelAppNotification(`msg:${room.id}`);
            }
          }
          for (const id of roomsSeen.current.keys()) {
            if (!live.has(id)) roomsSeen.current.delete(id);
          }
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 8000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return n;
}
