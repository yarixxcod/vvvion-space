const base = (process.env.API_BASE || "").replace(/\/$/, "");
const key = process.env.API_KEY || "";
const rows = [];

function line(name, ok, detail) {
  rows.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

async function main() {
  if (!base || !key) {
    console.error("Нужны API_BASE и API_KEY");
    process.exit(1);
  }
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  let model = "";
  try {
    const res = await fetch(`${base}/models`, { headers });
    const body = await res.json();
    model = body?.data?.find((item) => item.type === "chat")?.id || body?.data?.[0]?.id || "";
    line("GET /v1/models", res.ok && Array.isArray(body?.data), `status ${res.status}`);
  } catch (error) {
    line("GET /v1/models", false, error instanceof Error ? error.name : "error");
  }
  if (model) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 16 }),
      });
      const body = await res.json();
      line("POST /v1/chat/completions", res.ok && body?.choices?.[0], `status ${res.status}`);
    } catch (error) {
      line("POST /v1/chat/completions", false, error instanceof Error ? error.name : "error");
    }
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 16, stream: true }),
      });
      const text = await res.text();
      line("POST /v1/chat/completions stream", res.ok && text.includes("data:") && text.includes("[DONE]"), `status ${res.status}`);
    } catch (error) {
      line("POST /v1/chat/completions stream", false, error instanceof Error ? error.name : "error");
    }
    try {
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { ...headers, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
      });
      const body = await res.json();
      line("POST /v1/messages", res.ok && body?.type === "message", `status ${res.status}`);
    } catch (error) {
      line("POST /v1/messages", false, error instanceof Error ? error.name : "error");
    }
  } else {
    line("chat and messages", false, "no chat model");
  }
  if (process.env.API_SMOKE_IMAGE === "1") {
    try {
      const listed = await fetch(`${base}/models`, { headers });
      const body = await listed.json();
      const image = body?.data?.find((item) => item.type === "image")?.id;
      if (!image) line("POST /v1/images/generations", false, "no image model");
      else {
        const res = await fetch(`${base}/images/generations`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: image, prompt: "a small blue square", n: 1 }),
        });
        const parsed = await res.json();
        line("POST /v1/images/generations", res.ok && parsed?.data?.[0]?.b64_json, `status ${res.status}`);
      }
    } catch (error) {
      line("POST /v1/images/generations", false, error instanceof Error ? error.name : "error");
    }
  }
  if (rows.some((row) => !row.ok)) process.exit(1);
}

await main();
