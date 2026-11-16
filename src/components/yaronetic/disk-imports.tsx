import { useState } from "react";
import { toast } from "sonner";
import { uploadDiskDocument } from "@/lib/files/documents.fn";
import { getDisk, makeDiskFolder } from "@/lib/social/disk.fn";
import { DOCUMENT_MAX, documentKind, isSiteAsset } from "@/lib/files/document-kind";
export function DiskImports({
  folder,
  onSaved,
}: {
  folder: string | null;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  async function upload(files: File[], directory: boolean) {
    if (!files.length || busy) return;
    setBusy(true);
    let done = 0;
    try {
      if (files.length > 100) throw new Error("За один раз можно загрузить до 100 файлов");
      for (const file of files)
        if (file.size > DOCUMENT_MAX || !(documentKind(file.name) || isSiteAsset(file.name)))
          throw new Error(`«${file.name}»: поддерживаются документы и ресурсы сайта до 3 МБ`);
      let destination = folder;
      if (directory) {
        const paths = files.map((file) => file.webkitRelativePath.split("/"));
        if (paths.some((path) => path.length !== 2))
          throw new Error(
            "Диск поддерживает один уровень папок. Для вложенного сайта используйте Мегадиск.",
          );
        const name = paths[0][0];
        const before = await getDisk();
        const label = before.folders.some((item) => item.name === name)
          ? `${name.slice(0, 55)} ${Date.now().toString(36)}`
          : name;
        const next = await makeDiskFolder({ data: label });
        destination = next.folders.find((item) => item.name === label)?.id ?? null;
        if (!destination) throw new Error("Папка не создалась");
      }
      for (const file of files) {
        setProgress(`${done + 1} / ${files.length} · ${file.name}`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let data = "";
        for (let at = 0; at < bytes.length; at += 8192)
          data += String.fromCharCode(...bytes.subarray(at, at + 8192));
        await uploadDiskDocument({
          data: { name: file.name, data: btoa(data), folder: destination },
        });
        done++;
      }
      toast.success(`Загружено файлов: ${done}`);
    } catch (err) {
      toast.error(
        `${err instanceof Error ? err.message : "Не удалось загрузить"}${done ? ` Уже сохранено: ${done}.` : ""}`,
      );
    } finally {
      await onSaved().catch(() => undefined);
      setBusy(false);
      setProgress("");
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {[false, true].map((directory) => (
        <label
          key={String(directory)}
          className={`press inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm ${busy ? "opacity-50" : "cursor-pointer"}`}
        >
          {directory ? "Загрузить папку" : "Загрузить файлы"}
          <input
            type="file"
            multiple
            disabled={busy}
            className="hidden"
            {...(directory ? { webkitdirectory: "", directory: "" } : {})}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void upload(files, directory);
            }}
          />
        </label>
      ))}
      {busy ? (
        <p role="status" className="w-full truncate text-xs text-muted">
          Загрузка {progress}
        </p>
      ) : (
        <p className="w-full text-xs text-muted">
          Документы и файлы сайта до 3 МБ каждый. Вложенные папки — на Мегадиске.
        </p>
      )}
    </div>
  );
}
