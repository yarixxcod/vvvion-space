type PasteData = Pick<DataTransfer, "files" | "items">;
/** Prefer files; browsers often expose the same bitmap again in items. */
export function pastedFiles(data: PasteData): File[] {
  const files = Array.from(data.files || []);
  if (!files.length)
    for (const item of Array.from(data.items || [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  return files
    .filter((file) => file.size > 0)
    .map((file, i) => {
      if (file.name && file.name !== "image" && file.name !== "blob") return file;
      const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return new File([file], `Вставленное изображение ${i + 1}.${ext}`, {
        type: file.type || "image/png",
        lastModified: file.lastModified,
      });
    });
}
export async function readClipboardImages(): Promise<File[]> {
  if (!navigator.clipboard?.read)
    throw new Error("Используйте «Вставить» в поле сообщения или Ctrl+V");
  const items = await navigator.clipboard.read();
  const files: File[] = [];
  for (const item of items) {
    const mime = item.types.find((type) => /^image\/(png|jpeg|webp|gif)$/.test(type));
    if (!mime) continue;
    const blob = await item.getType(mime);
    files.push(
      new File([blob], `Из буфера ${files.length + 1}.${mime.split("/")[1]}`, { type: mime }),
    );
  }
  if (!files.length) throw new Error("В буфере нет изображения. Скопируйте картинку или скриншот");
  return files;
}
