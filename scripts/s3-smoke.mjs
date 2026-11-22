// Authorized storage probe. Credentials arrive only through stdin, never argv or files.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
const rl = createInterface({ input: process.stdin });
console.log("Ready for S3 configuration on stdin (input is hidden).");
for await (const line of rl) {
  const c = JSON.parse(line);
  const key = `vvvion/health/${randomUUID()}`;
  const sample = "vvvion-storage-probe";
  const url = `${c.endpoint}/${c.bucket}/${key}`;
  const request = (method, auth = true, body, headers = []) => new Promise((resolve, reject) => {
    const args = ["--silent", "--show-error", "--max-time", "25", "--request", method, "--write-out", "\n%{http_code}", url];
    if (auth) args.push("--aws-sigv4", `aws:amz:${c.region}:s3`, "--config", "-");
    for (const header of headers) args.push("-H", header);
    if (body) args.push("--data-binary", body, "-H", "Content-Type: application/octet-stream");
    const p = spawn("curl", args);
    p.stdin.end(auth ? `user = "${c.accessKeyId}:${c.secretAccessKey}"\n` : "");
    let result = "";
    p.stdout.on("data", x => result += x);
    p.stderr.on("data", () => {});
    p.on("close", code => code ? reject(new Error("Storage network failure")) : resolve({ status: Number(result.slice(-3)), body: result.slice(0, -4) }));
  });
  let created = false;
  try {
    const put = await request("PUT", true, sample, ["If-None-Match: *"]);
    if (put.status !== 200) throw new Error(`Storage write status ${put.status}`);
    created = true;
    const get = await request("GET");
    if (get.status !== 200 || get.body !== sample) throw new Error("Storage read mismatch");
    const collision = await request("PUT", true, "must-not-overwrite", ["If-None-Match: *"]);
    const stale = await request("PUT", true, "must-not-overwrite", ['If-Match: "invalid-etag"']);
    if (collision.status !== 412 || stale.status !== 412) throw new Error("Storage conditional writes unsupported");
    const anonymous = await request("GET", false);
    if (![403, 404].includes(anonymous.status)) throw new Error(`Bucket privacy check failed: ${anonymous.status}`);
    console.log(JSON.stringify({ write: put.status, read: get.status, anonymous: anonymous.status, integrity: true, conditionalCreate: collision.status, conditionalUpdate: stale.status }));
  } catch (e) { console.log(JSON.stringify({ error: e.message })); process.exitCode = 1; }
  finally {
    if (created) { const cleanup = await request("DELETE"); console.log(JSON.stringify({ cleanup: cleanup.status })); }
  }
  rl.close(); break;
}
