import { getSql } from "@/lib/db";
import { applyReport, bodyTooBig, manifestOf, rateLimited, type ReportBody } from "@/lib/backup/jobs.server";

const tokenFail = () => Response.json({ ok: false }, { status: 401 });

function bearer(request: Request): string {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export async function handleBackupReport(request: Request): Promise<Response> {
  if (bodyTooBig(request)) return Response.json({ ok: false }, { status: 413 });
  let body: ReportBody;
  try {
    body = (await request.json()) as ReportBody;
  } catch {
    return tokenFail();
  }
  const raw = JSON.stringify(body);
  if (raw.length > 256 * 1024) return Response.json({ ok: false }, { status: 413 });
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  if (!jobId || rateLimited(jobId)) return Response.json({ ok: false }, { status: 429 });
  const token = bearer(request);
  if (!token) return tokenFail();
  const result = await applyReport(await getSql(), token, body);
  if (!result.ok) return tokenFail();
  return Response.json(result);
}

export async function handleBackupManifest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  const token = bearer(request);
  if (!jobId || !token) return tokenFail();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  const result = await manifestOf(await getSql(), token, jobId, commit);
  if (!result.ok) return tokenFail();
  return Response.json(result);
}

export async function handleHealth(): Promise<Response> {
  let db = false;
  try {
    const sql = await getSql();
    await sql.query("select 1 as ok");
    db = true;
  } catch {
    db = false;
  }
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  return Response.json({ ok: true, commit, db });
}
