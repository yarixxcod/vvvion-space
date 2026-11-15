export type AccountPanel = "profile" | "settings" | "about";
export function openAccountPanel(view: AccountPanel) {
  window.dispatchEvent(new CustomEvent("vv-account-panel", { detail: view }));
}
