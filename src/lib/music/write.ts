export type TagFields = {
  title: string;
  artist: string;
  album: string;
  genre: string;
  cover: { mime: string; bytes: Uint8Array } | null;
};

export type TagPlan =
  | { mode: "skip" }
  | { mode: "keep"; header: Uint8Array }
  | { mode: "rewrite"; file: Uint8Array }
  | { mode: "no"; reason: string };

const COVER_MAX = 380_000;

function clip(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function tagSpan(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
  const span = 10 + size;
  if (span < 10 || span > bytes.length) return -1;
  return span;
}

function putU32(bytes: Uint8Array, at: number, value: number) {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

function textFrame(id: string, value: string): Uint8Array | null {
  const text = clip(value);
  if (!text) return null;
  const body = new TextEncoder().encode(text);
  const payload = 1 + body.length;
  const frame = new Uint8Array(10 + payload);
  frame[0] = id.charCodeAt(0);
  frame[1] = id.charCodeAt(1);
  frame[2] = id.charCodeAt(2);
  frame[3] = id.charCodeAt(3);
  putU32(frame, 4, payload);
  frame[10] = 3;
  frame.set(body, 11);
  return frame;
}

function apicFrame(mime: string, data: Uint8Array): Uint8Array | null {
  if (data.length < 32 || data.length > COVER_MAX) return null;
  const kind = mime === "image/png" ? "image/png" : "image/jpeg";
  const mimeBytes = new TextEncoder().encode(kind);
  const payload = 1 + mimeBytes.length + 1 + 1 + 1 + data.length;
  const frame = new Uint8Array(10 + payload);
  frame[0] = 65;
  frame[1] = 80;
  frame[2] = 73;
  frame[3] = 67;
  putU32(frame, 4, payload);
  let at = 10;
  frame[at++] = 0;
  frame.set(mimeBytes, at);
  at += mimeBytes.length;
  frame[at++] = 0;
  frame[at++] = 3;
  frame[at++] = 0;
  frame.set(data, at);
  return frame;
}

function buildTag(frames: Uint8Array[], padTo: number): Uint8Array {
  const body = frames.reduce((sum, frame) => sum + frame.length, 0);
  const total = Math.max(10 + body, padTo);
  const out = new Uint8Array(total);
  out[0] = 0x49;
  out[1] = 0x44;
  out[2] = 0x33;
  out[3] = 3;
  const size = total - 10;
  out[6] = (size >>> 21) & 0x7f;
  out[7] = (size >>> 14) & 0x7f;
  out[8] = (size >>> 7) & 0x7f;
  out[9] = size & 0x7f;
  let at = 10;
  for (const frame of frames) {
    out.set(frame, at);
    at += frame.length;
  }
  return out;
}

function knownContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const head = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (head === "fLaC" || head === "OggS" || head === "RIFF") return true;
  if (bytes.length > 8 && String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!) === "ftyp") return true;
  return false;
}

function isMpeg(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length - 1, 8192);
  for (let i = 0; i < end; i += 1) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1] ?? 0;
    if ((next & 0xe0) !== 0xe0) continue;
    if ((next & 0x18) === 0x08) continue;
    if ((next & 0x06) === 0) continue;
    return true;
  }
  return false;
}

export function planTagWrite(file: Uint8Array, fields: TagFields, opts?: { partial?: boolean }): TagPlan {
  const span = tagSpan(file);
  if (span < 0) return { mode: "no", reason: "Теги в файле обрезаны, целиком его сейчас не прочитать." };
  const frames: Uint8Array[] = [];
  for (const frame of [
    textFrame("TIT2", fields.title),
    textFrame("TPE1", fields.artist),
    textFrame("TALB", fields.album),
    textFrame("TCON", fields.genre),
  ]) {
    if (frame) frames.push(frame);
  }
  if (fields.cover) {
    if (fields.cover.bytes.length > COVER_MAX) return { mode: "no", reason: "Обложка слишком большая." };
    const picture = apicFrame(fields.cover.mime, fields.cover.bytes);
    if (!picture) return { mode: "no", reason: "Обложка не подошла." };
    frames.push(picture);
  }
  if (!frames.length && span === 0) return { mode: "skip" };
  const minTag = buildTag(frames, 0).length;
  if (span > 0 && minTag <= span) return { mode: "keep", header: buildTag(frames, span) };
  if (opts?.partial) return { mode: "no", reason: "Файл большой: обложка не помещается в старые теги." };
  const audio = file.subarray(span);
  if (knownContainer(audio) || !isMpeg(audio)) {
    return { mode: "no", reason: "У этого формата теги не переписываются. Имя можно сменить." };
  }
  const header = buildTag(frames, minTag + 1024);
  const next = new Uint8Array(header.length + audio.length);
  next.set(header, 0);
  next.set(audio, header.length);
  return { mode: "rewrite", file: next };
}
