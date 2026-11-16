/**
 * Pure editors for Xray JSON and Hysteria2 JSON.
 * Managed clients are marked `vvvion:`. Unrelated clients stay.
 * The shared credential is removed only when dropShared is true.
 */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function managed(email) {
  return String(email || "").startsWith("vvvion:");
}

export function patchXray(config, input) {
  const next = clone(config);
  const inbounds = Array.isArray(next.inbounds) ? next.inbounds : [];
  let touched = 0;
  for (const inbound of inbounds) {
    if (!inbound || inbound.protocol !== "vless") continue;
    const settings = inbound.settings && typeof inbound.settings === "object" ? inbound.settings : {};
    const current = Array.isArray(settings.clients) ? settings.clients : [];
    const template = current.find((item) => item && typeof item === "object") || {};
    let kept = current.filter((item) => item && !managed(item.email));
    if (input.dropShared && input.shared) kept = kept.filter((item) => item.id !== input.shared);
    if (!input.dropShared && input.shared && !kept.some((item) => item.id === input.shared)) {
      kept.push({ id: input.shared, email: "vvvion-shared", flow: template.flow || "" });
    }
    const personal = (input.users || [])
      .filter((item) => item && item.protocol === "vless" && item.secret && item.email)
      .map((item) => ({ id: item.secret, email: item.email, flow: template.flow || "" }));
    settings.clients = [...kept, ...personal];
    inbound.settings = settings;
    touched += 1;
  }
  if (!touched) return { ok: false, error: "no vless inbound", config: next };
  return { ok: true, error: "", config: next };
}

export function patchHysteria(config, input) {
  const next = clone(config);
  const auth = next.auth && typeof next.auth === "object" ? next.auth : {};
  if (auth.type && auth.type !== "userpass") return { ok: false, error: "hysteria auth must be userpass", config: next };
  const current = auth.userpass && typeof auth.userpass === "object" ? auth.userpass : {};
  const userpass = {};
  for (const [secret, email] of Object.entries(current)) {
    if (managed(email)) continue;
    if (input.dropShared && input.shared && secret === input.shared) continue;
    userpass[secret] = email;
  }
  if (!input.dropShared && input.shared && !userpass[input.shared]) userpass[input.shared] = "vvvion-shared";
  for (const item of input.users || []) {
    if (!item || item.protocol !== "hy2" || !item.secret || !item.email) continue;
    userpass[item.secret] = item.email;
  }
  next.auth = { ...auth, type: "userpass", userpass };
  return { ok: true, error: "", config: next };
}
