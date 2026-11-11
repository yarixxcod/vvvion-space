import assert from "node:assert/strict";
import test from "node:test";
import { mcpUrlShape, mcpUrlsOf } from "./mcp.server.ts";

test("mcp links stay on public https", () => {
  assert.equal(mcpUrlShape("http://example.com/mcp"), null);
  assert.equal(mcpUrlShape("https://127.0.0.1/mcp"), null);
  assert.equal(mcpUrlShape("https://localhost/mcp"), null);
  assert.equal(mcpUrlShape("https://10.0.0.4/mcp"), null);
  assert.match(mcpUrlShape("https://mcp.example.com/v1") || "", /^https:\/\/mcp\.example\.com\/v1$/);
  assert.deepEqual(mcpUrlsOf(["https://mcp.example.com/a", "https://127.0.0.1/no", "https://mcp.example.com/a"]), ["https://mcp.example.com/a"]);
});
