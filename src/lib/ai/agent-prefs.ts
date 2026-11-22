import { diskAccessEnabled } from "@/lib/ai/disk-access";

export type AgentPrefs = {
  autonomy: "auto" | "ask";
  web: boolean;
  image: boolean;
  files: boolean;
};

const KEY = "vv-agent-v1";

export function readAgentPrefs(): AgentPrefs {
  const files = diskAccessEnabled();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { autonomy: "auto", web: true, image: true, files };
    const parsed = JSON.parse(raw) as Partial<AgentPrefs>;
    return {
      autonomy: parsed.autonomy === "ask" ? "ask" : "auto",
      web: parsed.web !== false,
      image: parsed.image !== false,
      files: typeof parsed.files === "boolean" ? parsed.files : files,
    };
  } catch {
    return { autonomy: "auto", web: true, image: true, files };
  }
}

export function writeAgentPrefs(next: AgentPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Private browser storage may be unavailable. */
  }
}
