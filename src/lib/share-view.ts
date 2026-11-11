export type ShareMedia = "image" | "video" | "audio" | "pdf" | "file";

export type ShareEntry = {
  id: string;
  name: string;
  kind: "file" | "folder";
  mime: string;
  bytes: number;
  media: ShareMedia;
  view: string;
  download: string;
};

export type SharePageData = {
  title: string;
  rootId: string;
  folderId: string;
  crumbs: { id: string; name: string }[];
  file: ShareEntry | null;
  entries: ShareEntry[];
};

export function mediaKind(name: string, mime: string): ShareMedia {
  const type = mime.toLowerCase();
  const file = name.toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/.test(file)) return "image";
  if (type.startsWith("video/") || /\.(mp4|webm|mov)$/.test(file)) return "video";
  if (type.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|flac|aac)$/.test(file)) return "audio";
  if (type === "application/pdf" || file.endsWith(".pdf")) return "pdf";
  return "file";
}
