import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLoader } from "@/components/yaronetic/page-loader";
import { SecretInput } from "@/components/yaronetic/secret-input";
import { sizeLabel } from "@/components/yaronetic/upload-meter";
import { checkMegaNode, installMegaNode, listMegaNodes, removeMegaNode, saveMegaNode, trustMegaHost, type MegaNodePublic } from "@/lib/social/mega";

const STATUS = { new: "Не поставлен", ready: "Работает", error: "Не отвечает" } as const;

export function MegaAdmin() {
  const [nodes, setNodes] = useState<MegaNodePublic[] | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [sshUser, setSshUser] = useState("root");
  const [sshPort, setSshPort] = useState("22");
  const [password, setPassword] = useState("");
  const [diskName, setDiskName] = useState("");
  const [agentPort, setAgentPort] = useState("8742");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editHost, setEditHost] = useState("");
  const [editUser, setEditUser] = useState("root");
  const [editSsh, setEditSsh] = useState("22");
  const [editPassword, setEditPassword] = useState("");
  const [editDisk, setEditDisk] = useState("");
  const [editPort, setEditPort] = useState("8742");

  useEffect(() => {
    void listMegaNodes()
      .then(setNodes)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Диски не открылись"));
  }, []);

  async function run(task: () => Promise<MegaNodePublic[]>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      setNodes(await task());
      toast(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 className="text-sm font-medium">Мегадиск</h3>
      <p className="mt-1 text-[13px] text-muted">
        Сервер, куда встанет диск на 2 ГБ. Пароль остаётся здесь и больше не показывается. Скрипт слушает свой порт и не занимает 443 и 8443. Новый человек попадает на менее занятый диск.
      </p>
      {nodes === null ? <PageLoader compact /> : null}
      <ul className="mt-3 space-y-2">
        {(nodes ?? []).map((node) => (
          <li key={node.id} className="rounded-2xl border border-line bg-bg px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{node.name}</p>
                <p className="truncate text-xs text-faint">
                  {node.sshUser}@{node.host}:{node.sshPort} · {node.diskName} · порт {node.agentPort}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">{STATUS[node.status]}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Занято {sizeLabel(node.used)} · подписок {node.subscribers}
              {node.detail ? ` · ${node.detail}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" disabled={busy} className="press h-9 rounded-lg bg-accent px-2 text-xs font-medium text-accent-fg disabled:opacity-40" onClick={() => void run(() => installMegaNode({ data: node.id }), "Скрипт поставлен")}>
                {node.status === "ready" ? "Поставить снова" : "Поставить"}
              </button>
              {/SHA256:/.test(node.detail) ? (
                <button
                  type="button"
                  disabled={busy}
                  className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
                  onClick={() => {
                    const fingerprint = /SHA256:[A-Za-z0-9+/]+/.exec(node.detail)?.[0] || "";
                    void run(() => trustMegaHost({ data: { id: node.id, fingerprint } }), "Отпечаток сохранён");
                  }}
                >
                  Это мой сервер
                </button>
              ) : null}
              <button type="button" disabled={busy} className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40" onClick={() => void run(() => checkMegaNode({ data: node.id }), "Проверено")}>
                Проверить
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
                onClick={() => {
                  setEditId(node.id);
                  setEditName(node.name);
                  setEditHost(node.host);
                  setEditUser(node.sshUser);
                  setEditSsh(String(node.sshPort));
                  setEditDisk(node.diskName);
                  setEditPort(String(node.agentPort));
                  setEditPassword("");
                }}
              >
                Изменить
              </button>
              <button
                type="button"
                disabled={busy}
                className="press h-9 rounded-lg border border-line px-2 text-xs disabled:opacity-40"
                onClick={() => {
                  if (!window.confirm("Убрать сервер из панели? Каталог на нём не стирается.")) return;
                  void run(() => removeMegaNode({ data: node.id }), "Сервер убран");
                }}
              >
                Убрать
              </button>
            </div>
            {editId === node.id ? (
              <form
                className="mt-3 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const next = await saveMegaNode({
                      data: {
                        id: node.id,
                        name: editName,
                        host: editHost,
                        sshUser: editUser,
                        sshPort: Number(editSsh),
                        password: editPassword,
                        diskName: editDisk,
                        agentPort: Number(editPort),
                      },
                    });
                    setEditId(null);
                    setEditPassword("");
                    return next;
                  }, "Данные диска записаны");
                }}
              >
                <label className="block text-xs text-faint">
                  Название
                  <input className="field mt-1" value={editName} maxLength={40} onChange={(event) => setEditName(event.target.value)} />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-xs text-faint">
                    IP
                    <input className="field mt-1" value={editHost} autoCapitalize="none" onChange={(event) => setEditHost(event.target.value)} />
                  </label>
                  <label className="block text-xs text-faint">
                    Имя диска
                    <input className="field mt-1" value={editDisk} autoCapitalize="none" onChange={(event) => setEditDisk(event.target.value)} />
                  </label>
                  <label className="block text-xs text-faint">
                    Логин
                    <input className="field mt-1" value={editUser} autoCapitalize="none" onChange={(event) => setEditUser(event.target.value)} />
                  </label>
                  <label className="block text-xs text-faint">
                    Порт SSH
                    <input className="field mt-1 tabular-nums" inputMode="numeric" value={editSsh} onChange={(event) => setEditSsh(event.target.value.replace(/[^\d]/g, "").slice(0, 5))} />
                  </label>
                </div>
                <SecretInput value={editPassword} onChange={setEditPassword} autoComplete="off" maxLength={200} label="Новый пароль" placeholder="Пусто — оставить прежний" />
                <label className="block text-xs text-faint">
                  Порт диска
                  <input className="field mt-1 tabular-nums" inputMode="numeric" value={editPort} onChange={(event) => setEditPort(event.target.value.replace(/[^\d]/g, "").slice(0, 5))} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="press h-9 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40">
                    Сохранить
                  </button>
                  <button type="button" className="press h-9 rounded-lg border border-line px-3 text-xs" onClick={() => setEditId(null)}>
                    Отмена
                  </button>
                </div>
                <p className="text-[13px] text-muted">Если меняете адрес, порт или имя диска, после записи нажмите «Поставить снова».</p>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="mt-4 space-y-2 rounded-2xl border border-line bg-bg p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const next = await saveMegaNode({
              data: {
                name,
                host,
                sshUser,
                sshPort: Number(sshPort),
                password,
                diskName,
                agentPort: Number(agentPort),
              },
            });
            setName("");
            setHost("");
            setPassword("");
            setDiskName("");
            return next;
          }, "Сервер записан");
        }}
      >
        <h4 className="text-sm font-medium">Новый сервер</h4>
        <label className="block text-xs text-faint">
          Название
          <input className="field mt-1" value={name} maxLength={40} placeholder="Франкфурт" onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-faint">
            IP
            <input className="field mt-1" value={host} autoCapitalize="none" placeholder="203.0.113.10" onChange={(event) => setHost(event.target.value)} />
          </label>
          <label className="block text-xs text-faint">
            Имя диска
            <input className="field mt-1" value={diskName} autoCapitalize="none" placeholder="disk-1" onChange={(event) => setDiskName(event.target.value)} />
          </label>
          <label className="block text-xs text-faint">
            Логин
            <input className="field mt-1" value={sshUser} autoCapitalize="none" onChange={(event) => setSshUser(event.target.value)} />
          </label>
          <label className="block text-xs text-faint">
            Порт SSH
            <input className="field mt-1 tabular-nums" inputMode="numeric" value={sshPort} onChange={(event) => setSshPort(event.target.value.replace(/[^\d]/g, "").slice(0, 5))} />
          </label>
        </div>
        <SecretInput value={password} onChange={setPassword} autoComplete="off" maxLength={200} label="Пароль root" placeholder="Пароль сервера" />
        <label className="block text-xs text-faint">
          Порт диска
          <input className="field mt-1 tabular-nums" inputMode="numeric" value={agentPort} onChange={(event) => setAgentPort(event.target.value.replace(/[^\d]/g, "").slice(0, 5))} />
        </label>
        <button type="submit" disabled={busy} className="press h-10 rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40">
          Записать
        </button>
      </form>
    </section>
  );
}
