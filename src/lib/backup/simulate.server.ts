import { type StepKey } from "@/lib/backup/plan";
import { applyReport, withDb } from "@/lib/backup/jobs.server";

const timers = new Map<string, ReturnType<typeof setInterval>>();

export function startSimulation(jobId: string, token: string, fail: boolean) {
  if (timers.has(jobId)) return;
  const progress = new Map<string, number>();
  let failedOnce = false;
  const timer = setInterval(() => {
    void withDb(async (db) => {
      const jobs = await db.query<{ status: string; options: unknown }>("select status, options from backup_jobs where id = $1", [jobId]);
      const job = jobs[0];
      if (!job || job.status === "canceled" || job.status === "done") {
        clearInterval(timer);
        timers.delete(jobId);
        return;
      }
      if (job.status === "paused") return;
      const steps = await db.query<{ key: string; status: string; title: string }>("select key, status, title from backup_steps where job_id = $1 order by position", [jobId]);
      const current = steps.find((step) => step.status !== "done" && step.status !== "skipped");
      if (!current) {
        clearInterval(timer);
        timers.delete(jobId);
        return;
      }
      if (current.status === "failed") return;
      if (current.status === "pending") progress.set(current.key, 0);
      const percent = Math.min(100, (progress.get(current.key) || 0) + 34);
      progress.set(current.key, percent);
      const failing = fail && !failedOnce && current.key === "build" && percent >= 100;
      if (failing) failedOnce = true;
      const status = percent >= 100 ? (failing ? "failed" : "done") : "running";
      const options = typeof job.options === "string" ? JSON.parse(job.options) as { lastSeq?: number } : (job.options as { lastSeq?: number } | null) || {};
      const seq = Number(options.lastSeq || 0) + 1;
      await applyReport(db, token, {
        jobId,
        seq,
        steps: [{ key: current.key as StepKey, status, percent, detail: failing ? "Сборка не прошла" : current.title }],
        logs: [{ level: failing ? "error" : "info", step: current.key, text: failing ? "Сборка не прошла" : current.title }],
      });
    }).catch(() => undefined);
  }, 2000);
  timers.set(jobId, timer);
}