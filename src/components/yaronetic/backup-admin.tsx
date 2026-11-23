import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTx } from "@/lib/lang";
import { confirmWordOk, deleteWordOk, staleLabel } from "@/lib/backup/plan";
import {
  backupCommand,
  backupEnvList,
  backupForget,
  backupHistory,
  backupLink,
  backupLoadSettings,
  backupProbe,
  backupSchedule,
  backupSettings,
  backupStart,
  backupStatus,
  backupWipe,
} from "@/lib/backup/api";

type Check = { key: string; level: "ok" | "warn" | "fail"; text: string };
type Step = { key: string; title: string; status: string; percent: number; detail: string };
type Job = {
  id: string;
  status: string;
  hostMasked: string;
  percent: number;
  stage: string;
  error: string;
  publicUrl: string;
  staleSeconds: number | null;
  steps: Step[];
  logs: { id: string; text: string; level: string; step: string }[];
  result: { counts?: { key: string; source: number; copy: number; diff: number; level: string }[]; warnings?: string[]; health?: string };
};

function mirrorMap(text: string) {
  const out: Record<string, string[]> = { npm: [], docker: [], node: [], code: [], ytdlp: [] };
  for (const line of text.split("\n")) {
    const [kind, url] = line.trim().split(/\s+/);
    if (!kind || !url || !(kind in out)) continue;
    out[kind].push(url);
  }
  return out;
}

export function BackupChip() {
  const tx = useTx();
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    let stop = false;
    const pull = () => {
      void backupStatus()
        .then((next) => {
          if (!stop) setJob((next as Job | null) && ((next as Job).status === "running" || (next as Job).status === "paused") ? (next as Job) : null);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = setInterval(pull, 15000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);
  if (!job) return null;
  return <p className="mt-2 rounded-xl bg-accent/15 px-3 py-2 text-xs text-accent">{tx({ ru: `Перенос ${job.percent}%`, en: `Transfer ${job.percent}%`, kk: `Көшіру ${job.percent}%` })}</p>;
}

export function BackupAdmin() {
  const tx = useTx();
  const [host, setHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [user, setUser] = useState("root");
  const [secret, setSecret] = useState("");
  const [keyMode, setKeyMode] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [appPort, setAppPort] = useState("3000");
  const [hostKey, setHostKey] = useState("");
  const [checks, setChecks] = useState<Check[]>([]);
  const [confirm, setConfirm] = useState("");
  const [wipeWord, setWipeWord] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<{ id: string; status: string; hostMasked: string; createdAt: string }[]>([]);
  const [names, setNames] = useState<{ name: string; present: boolean }[]>([]);
  const [include, setInclude] = useState<string[]>([]);
  const [mega, setMega] = useState(true);
  const [database, setDatabase] = useState(true);
  const [settings, setSettings] = useState(true);
  const [code, setCode] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [fail, setFail] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [github, setGithub] = useState("");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [latest, setLatest] = useState(false);
  const [mirrors, setMirrors] = useState("npm https://registry.npmjs.org\nnpm https://registry.npmmirror.com\ndocker https://mirror.gcr.io\nnode https://nodejs.org/dist\nnode https://npmmirror.com/mirrors/node");
  const [cancelAsk, setCancelAsk] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void backupEnvList().then((row) => {
      setNames(row.names);
      setInclude(row.names.filter((item) => item.present).map((item) => item.name));
      setSimulate(row.simulate);
    }).catch(() => undefined);
    void backupLoadSettings().then((row) => {
      const lines = Object.entries(row.mirrors || {}).flatMap(([key, list]) => (Array.isArray(list) ? list : []).map((url) => `${key} ${url}`));
      if (lines.length) setMirrors(lines.join("\n"));
    }).catch(() => undefined);
    void backupHistory().then(setHistory).catch(() => undefined);
    void backupStatus().then((next) => setJob(next as Job | null)).catch(() => undefined);
  }, []);

  const jobId = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || (jobStatus !== "running" && jobStatus !== "paused")) return;
    const hidden = () => document.visibilityState === "hidden";
    const pull = () => {
      void backupStatus({ data: { id: jobId } }).then((next) => {
        if (next) setJob(next as Job);
      }).catch(() => undefined);
    };
    let timer = 0;
    const arm = () => {
      window.clearInterval(timer);
      timer = window.setInterval(pull, hidden() ? 15000 : 2000);
    };
    arm();
    const onShow = () => {
      arm();
      if (!hidden()) pull();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [jobId, jobStatus]);

  const failed = checks.some((item) => item.level === "fail");
  const payload = () => ({
    host, sshPort: Number(sshPort), user, secret, appPort: Number(appPort), hostKey, publicUrl, include, mega, database, settings, code, overwrite, fail, github, databaseUrl, latest, mirrors: mirrorMap(mirrors),
  });

  async function probe() {
    setBusy(true);
    try {
      const result = await backupProbe({ data: payload() });
      if (result.fingerprint) setHostKey(result.fingerprint);
      setChecks(result.checks);
      if (result.needConfirm) toast.message(tx({ ru: "Сверьте отпечаток SSH с панелью хостинга", en: "Compare the SSH fingerprint with your host", kk: "SSH ізі хостингпен сәйкес пе, тексеріңіз" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx({ ru: "Сервер не проверился", en: "Server check failed", kk: "Сервер тексерілмеді" }));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const created = await backupStart({ data: { ...payload(), confirm } });
      const next = await backupStatus({ data: { id: created.id } });
      setJob(next as Job | null);
      setSecret("");
      setConfirm("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx({ ru: "Перенос не начался", en: "Transfer did not start", kk: "Көшіру басталмады" }));
    } finally {
      setBusy(false);
    }
  }

  async function command(commandName: string) {
    if (!job) return;
    await backupCommand({ data: { id: job.id, command: commandName } }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Ошибка"));
    const next = await backupStatus({ data: { id: job.id } });
    setJob(next as Job | null);
  }

  const quiet = job?.staleSeconds != null ? staleLabel(job.staleSeconds) : "ok";
  return (
    <section className="mt-4 space-y-4" aria-label={tx({ ru: "Бэкап", en: "Backup", kk: "Сақтық көшірме" })}>
      <h4 className="text-lg font-semibold">{tx({ ru: "Перенос на свой сервер", en: "Move to your server", kk: "Өз серверіңізге көшіру" })}</h4>
      <p className="text-xs leading-relaxed text-muted">{tx({ ru: "Пароль и ключ нигде не сохраняются. На сервер уйдут настройки и данные пользователей. Расписание задач на копии выключено, пока вы сами его не включите.", en: "The password and key are not stored. Settings and user data will be copied. Scheduled jobs stay off until you turn them on.", kk: "Құпиясөз бен кілт сақталмайды. Баптаулар мен пайдаланушы деректері көшіріледі. Кесте сөндірулі." })}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="h-11 rounded-xl border border-line bg-bg px-3 text-sm" placeholder={tx({ ru: "Адрес сервера", en: "Server address", kk: "Сервер мекенжайы" })} value={host} onChange={(event) => setHost(event.target.value)} autoComplete="off" />
        <input className="h-11 rounded-xl border border-line bg-bg px-3 text-sm" inputMode="numeric" value={sshPort} onChange={(event) => setSshPort(event.target.value)} aria-label="SSH" />
        <input className="h-11 rounded-xl border border-line bg-bg px-3 text-sm" value={user} onChange={(event) => setUser(event.target.value)} autoComplete="off" aria-label={tx({ ru: "Пользователь", en: "User", kk: "Пайдаланушы" })} />
        <input className="h-11 rounded-xl border border-line bg-bg px-3 text-sm" placeholder={tx({ ru: "Публичный адрес нового сайта", en: "Public URL of the new site", kk: "Жаңа сайттың ашық мекенжайы" })} value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} autoComplete="off" />
        <input className="h-11 rounded-xl border border-line bg-bg px-3 text-sm" inputMode="numeric" value={appPort} onChange={(event) => setAppPort(event.target.value)} aria-label={tx({ ru: "Порт сайта", en: "Site port", kk: "Сайт порты" })} />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={keyMode} onChange={(event) => setKeyMode(event.target.checked)} />{tx({ ru: "Приватный ключ вместо пароля", en: "Private key instead of a password", kk: "Құпиясөз орнына жеке кілт" })}</label>
      {keyMode ? (
        <textarea className="min-h-24 w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono text-sm break-all" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" spellCheck={false} />
      ) : (
        <input className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm" type="password" placeholder={tx({ ru: "Пароль SSH", en: "SSH password", kk: "SSH құпиясөзі" })} value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" />
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={code} onChange={(event) => setCode(event.target.checked)} />{tx({ ru: "Код и сборка", en: "Code and build", kk: "Код және жинақ" })}</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={database} onChange={(event) => setDatabase(event.target.checked)} />{tx({ ru: "База и пользователи", en: "Database and users", kk: "База және пайдаланушылар" })}</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={settings} onChange={(event) => setSettings(event.target.checked)} />{tx({ ru: "Настройки", en: "Settings", kk: "Баптаулар" })}</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={mega} onChange={(event) => setMega(event.target.checked)} />{tx({ ru: "Зеркало Мегадиска", en: "MegaDisk mirror", kk: "Мегадиск айнасы" })}</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />{tx({ ru: "Перезаписать /opt/vvvion", en: "Overwrite /opt/vvvion", kk: "/opt/vvvion үстінен жазу" })}</label>
        {simulate ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} />{tx({ ru: "Имитация ошибки", en: "Simulate a failure", kk: "Қатені еліктету" })}</label> : null}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={latest} onChange={(event) => setLatest(event.target.checked)} />{tx({ ru: "Последний коммит ветки, а не тот, что сейчас работает", en: "Latest branch commit, not the one running now", kk: "Қазіргі емес, тармақтың соңғы коммиті" })}</label>
      <input className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm" type="password" placeholder={tx({ ru: "Токен GitHub, если репозиторий закрытый", en: "GitHub token if the repo is private", kk: "Репозиторий жабық болса, GitHub токені" })} value={github} onChange={(event) => setGithub(event.target.value)} autoComplete="off" />
      <input className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm" type="password" placeholder={tx({ ru: "Прямая строка базы, если пулер не подходит", en: "Direct database URL if the pooler is wrong", kk: "Пул жарамаса, базаның тікелей жолы" })} value={databaseUrl} onChange={(event) => setDatabaseUrl(event.target.value)} autoComplete="off" />
      <textarea className="min-h-24 w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono text-xs break-all" aria-label={tx({ ru: "Зеркала", en: "Mirrors", kk: "Айналар" })} value={mirrors} onChange={(event) => setMirrors(event.target.value)} spellCheck={false} />
      <button type="button" className="press h-11 rounded-xl bg-subtle px-4 text-sm" onClick={() => void backupSettings({ data: { mirrors: mirrorMap(mirrors) } }).then(() => toast.message(tx({ ru: "Зеркала сохранены", en: "Mirrors saved", kk: "Айналар сақталды" }))).catch(() => toast.error(tx({ ru: "Зеркала не сохранились", en: "Mirrors were not saved", kk: "Айналар сақталмады" })))}>{tx({ ru: "Сохранить зеркала", en: "Save mirrors", kk: "Айналарды сақтау" })}</button>
      <div className="max-h-40 overflow-auto rounded-xl border border-line p-2 text-xs">
        {names.map((item) => (
          <label key={item.name} className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={include.includes(item.name)} onChange={(event) => setInclude((current) => event.target.checked ? [...current, item.name] : current.filter((name) => name !== item.name))} />
            <span className="break-all">{item.name}</span>
            <span className="text-muted">{item.present ? tx({ ru: "есть", en: "set", kk: "бар" }) : tx({ ru: "пусто", en: "empty", kk: "бос" })}</span>
          </label>
        ))}
      </div>
      <button type="button" className="press h-11 rounded-xl bg-subtle px-4 text-sm" disabled={busy} onClick={() => void probe()}>{tx({ ru: "Проверить сервер", en: "Check server", kk: "Серверді тексеру" })}</button>
      {hostKey ? <p className="break-all font-mono text-xs">{tx({ ru: "Отпечаток", en: "Fingerprint", kk: "Із" })}: {hostKey}</p> : null}
      <ul className="space-y-1 text-xs">
        {checks.map((item) => <li key={item.key} className={item.level === "fail" ? "text-red-500" : item.level === "warn" ? "text-amber-500" : "text-muted"}>{item.text}</li>)}
      </ul>
      <p className="text-xs text-muted">{tx({ ru: "На сервер будут переданы секреты и данные всех пользователей.", en: "Secrets and every user's data will be sent to the server.", kk: "Құпиялар мен барлық пайдаланушы деректері серверге барады." })}</p>
      <input className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm" placeholder={tx({ ru: "Введите ПЕРЕНЕСТИ", en: "Type TRANSFER", kk: "ПЕРЕНЕСТИ деп жазыңыз" })} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
      <button type="button" className="press h-11 rounded-xl bg-accent px-4 text-sm text-white disabled:opacity-40" disabled={busy || !confirmWordOk(confirm) || failed || !hostKey} onClick={() => void start()}>{tx({ ru: "Начать перенос", en: "Start transfer", kk: "Көшіруді бастау" })}</button>
      {job ? (
        <div className="rounded-2xl border border-line p-3">
          <p className="text-3xl font-semibold tabular-nums">{job.percent}%</p>
          <p className="text-sm">{job.hostMasked} · {job.stage || job.status}</p>
          {quiet !== "ok" ? <p className="mt-1 text-xs text-amber-500">{tx({ ru: `Агент не вышел на связь ${job.staleSeconds} с. Проверьте, что сервер включён и имеет выход в интернет, затем нажмите «Проверить связь».`, en: `No signal for ${job.staleSeconds}s. Check that the server is on and can reach the internet, then press Check the link.`, kk: `${job.staleSeconds} с байланыс жоқ. Сервер қосулы екенін тексеріп, «Байланысты тексеру» басыңыз.` })}</p> : null}
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-accent" style={{ width: `${job.percent}%` }} /></div>
          <ul className="mt-3 space-y-2 text-xs">
            {job.steps.map((step) => <li key={step.key} className="flex items-center justify-between gap-2"><span className="min-w-0 break-all">{step.title} · {step.detail}</span><span>{step.status} {step.percent}%</span></li>)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="press h-11 rounded-xl bg-subtle px-3 text-sm" onClick={() => void command(job.status === "paused" ? "continue" : "pause")}>{job.status === "paused" ? tx({ ru: "Продолжить", en: "Continue", kk: "Жалғастыру" }) : tx({ ru: "Пауза", en: "Pause", kk: "Кідірту" })}</button>
            <button type="button" className="press h-11 rounded-xl bg-subtle px-3 text-sm" onClick={() => { if (!cancelAsk) { setCancelAsk(true); return; } setCancelAsk(false); void command("cancel"); }}>{cancelAsk ? tx({ ru: "Да, отменить", en: "Yes, cancel", kk: "Иә, тоқтату" }) : tx({ ru: "Отмена", en: "Cancel", kk: "Бас тарту" })}</button>
            {job.steps.filter((step) => step.status === "failed").map((step) => <button key={step.key} type="button" className="press h-11 rounded-xl bg-subtle px-3 text-sm" onClick={() => void command(`retry:${step.key}`)}>{tx({ ru: "Повторить этап", en: "Retry step", kk: "Қайталау" })}</button>)}
            {job.steps.filter((step) => step.key === "mega" || step.key === "system").map((step) => <button key={`skip-${step.key}`} type="button" className="press h-11 rounded-xl bg-subtle px-3 text-sm" onClick={() => void command(`skip:${step.key}`)}>{tx({ ru: "Пропустить", en: "Skip", kk: "Өткізу" })} {step.title}</button>)}
          </div>
          <button type="button" className="mt-2 text-xs text-muted" onClick={() => setLogOpen((value) => !value)}>{tx({ ru: "Журнал", en: "Log", kk: "Журнал" })}</button>
          {logOpen ? (
            <div>
              <button type="button" className="press h-11 rounded-xl bg-subtle px-3 text-xs" onClick={() => void navigator.clipboard.writeText(job.logs.map((line) => line.text).join("\n"))}>{tx({ ru: "Скопировать", en: "Copy", kk: "Көшіру" })}</button>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{job.logs.map((line) => line.text).join("\n")}</pre>
            </div>
          ) : null}
          {job.status === "done" ? (
            <div className="mt-3 space-y-2 text-xs text-muted">
              <a className="break-all text-accent" href={job.publicUrl}>{job.publicUrl}</a>
              <p>{tx({ ru: "Сессии останутся действительными только на том же домене и с HTTPS. Включите режим обслуживания на старом сайте перед досинхронизацией, иначе новые правки потеряются.", en: "Sessions stay valid only on the same domain with HTTPS. Pause the old site before a catch-up copy.", kk: "Сессия сол доменде және HTTPS-пен ғана жарамды." })}</p>
              <p>{tx({ ru: "Дальше: A-запись домена на IP сервера, сертификат, затем остановите старую копию. Две живые копии расходятся.", en: "Next: point DNS at the server, add HTTPS, then stop the old copy. Two live copies drift apart.", kk: "Кейін: DNS-ті серверге бұрып, HTTPS қосыңыз." })}</p>
              {job.result.counts ? <table className="w-full text-left"><tbody>{job.result.counts.map((row) => <tr key={row.key}><td>{row.key}</td><td>{row.source}</td><td>{row.copy}</td><td>{row.diff}</td></tr>)}</tbody></table> : null}
            </div>
          ) : null}
          {quiet !== "ok" ? <button type="button" className="press mt-2 h-11 rounded-xl bg-subtle px-3 text-sm" onClick={() => void backupLink({ data: payload() }).then((row) => toast.message(row.text.slice(0, 180))).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Нет связи"))}>{tx({ ru: "Проверить связь", en: "Check the link", kk: "Байланысты тексеру" })}</button> : null}
        </div>
      ) : null}
      <div className="rounded-2xl border border-line p-3 text-xs">
        <p className="text-sm">{tx({ ru: "Очистить сервер", en: "Wipe the server", kk: "Серверді тазалау" })}</p>
        <p className="mt-1 text-muted">{tx({ ru: "Удалятся /opt/vvvion, служба переноса и зеркало /var/lib/vvvion-mirror. Docker и Node вне этого каталога не трогаются.", en: "Removes /opt/vvvion, the migrate service and /var/lib/vvvion-mirror. Docker and Node outside that stay.", kk: "/opt/vvvion, қызмет және айна жойылады." })}</p>
        <input className="mt-2 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm" placeholder="УДАЛИТЬ" value={wipeWord} onChange={(event) => setWipeWord(event.target.value)} autoComplete="off" />
        <button type="button" className="press mt-2 h-11 rounded-xl bg-subtle px-3 text-sm disabled:opacity-40" disabled={!deleteWordOk(wipeWord)} onClick={() => void backupWipe({ data: { ...payload(), confirm: wipeWord } }).then(() => toast.message(tx({ ru: "Сервер очищен", en: "Server wiped", kk: "Сервер таза" }))).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Ошибка"))}>{tx({ ru: "Удалить с сервера", en: "Delete from the server", kk: "Серверден жою" })}</button>
        <button type="button" className="press ml-2 mt-2 h-11 rounded-xl bg-subtle px-3 text-sm" onClick={() => void backupSchedule({ data: { ...payload(), enable: true } })}>{tx({ ru: "Включить расписание", en: "Enable schedule", kk: "Кестені қосу" })}</button>
      </div>
      <ul className="space-y-1 text-xs text-muted">
        {history.map((item) => <li key={item.id} className="flex items-center justify-between gap-2"><span className="break-all">{item.createdAt?.slice(0, 16).replace("T", " ")} · {item.hostMasked} · {item.status}</span><button type="button" className="h-11 px-2" onClick={() => void backupForget({ data: { id: item.id } }).then(() => backupHistory().then(setHistory))}>{tx({ ru: "Скрыть", en: "Hide", kk: "Жасыру" })}</button></li>)}
      </ul>
    </section>
  );
}
