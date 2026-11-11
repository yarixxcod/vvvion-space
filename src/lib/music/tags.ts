export type MusicTags = {
  title: string;
  artist: string;
  album: string;
  genre: string;
  cover: { mime: string; bytes: Uint8Array } | null;
  bitrate: number;
  sampleRate: number;
  bits: number;
  duration: number;
};

const EMPTY: MusicTags = {
  title: "",
  artist: "",
  album: "",
  genre: "",
  cover: null,
  bitrate: 0,
  sampleRate: 0,
  bits: 0,
  duration: 0,
};

const GENRE = [
  "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal",
  "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial",
  "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk",
  "Fusion", "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise",
  "Alt Rock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic",
  "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta",
  "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes",
  "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock",
];

export function isMusicFile(name: string, mime: string): boolean {
  if (/^voice\./i.test(name)) return false;
  const kind = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (kind === "audio/webm") return false;
  if (/\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(name)) return true;
  return kind === "audio/mpeg" || kind === "audio/mp3" || kind === "audio/mp4" || kind === "audio/aac" || kind === "audio/flac" || kind === "audio/x-flac" || kind === "audio/wav" || kind === "audio/x-wav" || kind === "audio/ogg" || kind === "audio/opus";
}

const PLAYBACK: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "audio/mp4",
  webm: "audio/webm",
};

export function playbackType(name: string, mime: string): string {
  const clean = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (clean.startsWith("audio/") || clean.startsWith("video/") || clean.startsWith("image/")) return clean || mime;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return PLAYBACK[ext] || clean || "application/octet-stream";
}

export function readTags(bytes: Uint8Array): MusicTags {
  const id3 = readId3(bytes);
  const flac = readFlac(bytes);
  const mp4 = readMp4(bytes);
  const mp3 = mp3Facts(bytes);
  const wav = wavFacts(bytes);
  const picked =
    id3 && (id3.title || id3.artist || id3.cover)
      ? id3
      : flac && (flac.title || flac.artist || flac.cover)
        ? flac
        : mp4 && (mp4.title || mp4.artist || mp4.cover)
          ? mp4
          : (id3 ?? flac ?? mp4 ?? { ...EMPTY });
  return {
    title: picked.title,
    artist: picked.artist,
    album: picked.album,
    genre: picked.genre,
    cover: picked.cover,
    bitrate: picked.bitrate || flac?.bitrate || mp3.bitrate || wav.bitrate || 0,
    sampleRate: picked.sampleRate || flac?.sampleRate || mp3.sampleRate || wav.sampleRate || 0,
    bits: picked.bits || flac?.bits || wav.bits || 0,
    duration: picked.duration || flac?.duration || 0,
  };
}

export function musicBits(tags: { bitrate: number; sampleRate: number; bits: number; duration?: number } | null, size = 0): string {
  if (!tags) return "";
  const parts: string[] = [];
  let kbps = tags.bitrate;
  const duration = tags.duration ?? 0;
  if (!kbps && duration > 1 && size > 0) kbps = Math.round((size * 8) / duration / 1000);
  if (kbps > 0 && kbps < 2000) parts.push(`${kbps} кбит/с`);
  if (tags.sampleRate >= 8000 && tags.sampleRate <= 192000) {
    const khz = tags.sampleRate / 1000;
    parts.push(Number.isInteger(khz) ? `${khz} кГц` : `${khz.toFixed(1)} кГц`);
  }
  if (tags.bits >= 8 && tags.bits <= 32) parts.push(`${tags.bits} бит`);
  return parts.join(" · ");
}

export function coverUrl(cover: MusicTags["cover"]): string | null {
  if (!cover || cover.bytes.length < 32 || cover.bytes.length > 1_500_000) return null;
  const mime = cover.mime.startsWith("image/") ? cover.mime : "image/jpeg";
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < cover.bytes.length; i += step) {
    binary += String.fromCharCode(...cover.bytes.subarray(i, Math.min(cover.bytes.length, i + step)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function textOf(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const enc = bytes[0] ?? 0;
  const body = bytes.subarray(1);
  try {
    if (enc === 0) return clean(new TextDecoder("latin1").decode(body));
    if (enc === 1) return clean(new TextDecoder("utf-16").decode(body));
    if (enc === 2) return clean(new TextDecoder("utf-16be").decode(body));
    return clean(new TextDecoder("utf-8").decode(body));
  } catch {
    return "";
  }
}

function clean(value: string): string {
  return value.replace(/\0/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function genreOf(value: string): string {
  const match = value.match(/^\((\d+)\)(.*)$/);
  if (match) {
    const named = GENRE[Number(match[1])] ?? "";
    return clean(match[2] || named);
  }
  if (/^\d+$/.test(value)) return GENRE[Number(value)] ?? "";
  return clean(value);
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
}

function syncsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) & 0x7f) * 0x200000 + ((bytes[at + 1] ?? 0) & 0x7f) * 0x4000 + ((bytes[at + 2] ?? 0) & 0x7f) * 0x80 + ((bytes[at + 3] ?? 0) & 0x7f);
}

function readId3(bytes: Uint8Array): MusicTags | null {
  let view = bytes;
  if (!(view[0] === 0x49 && view[1] === 0x44 && view[2] === 0x33)) {
    if (view.length >= 128 && view[view.length - 128] === 0x54 && view[view.length - 127] === 0x41 && view[view.length - 126] === 0x47) {
      return readId3v1(view.subarray(view.length - 128));
    }
    return null;
  }
  const version = view[3] ?? 0;
  const flags = view[5] ?? 0;
  const size = syncsafe(view, 6);
  let data = view.subarray(10, Math.min(view.length, 10 + size));
  if (flags & 0x80) data = unsync(data);
  const tags = { ...EMPTY };
  let at = 0;
  const v4 = version === 4;
  while (at + 10 <= data.length) {
    const id = String.fromCharCode(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0, data[at + 3] ?? 0);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize = v4 ? syncsafe(data, at + 4) : u32(data, at + 4);
    const start = at + 10;
    const end = start + frameSize;
    if (frameSize < 1 || end > data.length) break;
    const frame = data.subarray(start, end);
    if (id === "TIT2") tags.title = textOf(frame);
    else if (id === "TPE1") tags.artist = textOf(frame);
    else if (id === "TALB") tags.album = textOf(frame);
    else if (id === "TCON") tags.genre = genreOf(textOf(frame));
    else if (id === "TLEN") {
      const ms = Number(textOf(frame));
      if (ms > 0 && ms < 10_000_000) tags.duration = ms / 1000;
    } else if (id === "APIC" && !tags.cover) tags.cover = apic(frame);
    at = end;
  }
  if (!tags.title && !tags.artist) {
    const v1 = view.length >= 128 ? readId3v1(view.subarray(view.length - 128)) : null;
    if (v1) return { ...v1, cover: tags.cover };
  }
  return tags;
}

function apic(frame: Uint8Array): MusicTags["cover"] {
  const enc = frame[0] ?? 0;
  let at = 1;
  while (at < frame.length && frame[at] !== 0) at += 1;
  const mime = clean(new TextDecoder("latin1").decode(frame.subarray(1, at))) || "image/jpeg";
  at += 2;
  if (enc === 1 || enc === 2) {
    while (at + 1 < frame.length && !(frame[at] === 0 && frame[at + 1] === 0)) at += 2;
    at += 2;
  } else {
    while (at < frame.length && frame[at] !== 0) at += 1;
    at += 1;
  }
  if (at >= frame.length || frame.length - at > 1_500_000) return null;
  return { mime: mime.startsWith("image/") ? mime : "image/jpeg", bytes: frame.subarray(at) };
}

function unsync(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    out.push(bytes[i] ?? 0);
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i += 1;
  }
  return Uint8Array.from(out);
}

function readId3v1(bytes: Uint8Array): MusicTags | null {
  if (bytes.length < 128 || bytes[0] !== 0x54 || bytes[1] !== 0x41 || bytes[2] !== 0x47) return null;
  const latin = new TextDecoder("latin1");
  const title = clean(latin.decode(bytes.subarray(3, 33)));
  const artist = clean(latin.decode(bytes.subarray(33, 63)));
  const album = clean(latin.decode(bytes.subarray(63, 93)));
  const genre = GENRE[bytes[127] ?? 255] ?? "";
  if (!title && !artist) return null;
  return { ...EMPTY, title, artist, album, genre };
}

function readFlac(bytes: Uint8Array): MusicTags | null {
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== "fLaC") return null;
  const tags = { ...EMPTY };
  let at = 4;
  for (let guard = 0; guard < 16 && at + 4 <= bytes.length; guard += 1) {
    const head = bytes[at] ?? 0;
    const last = (head & 0x80) !== 0;
    const type = head & 0x7f;
    const size = ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const start = at + 4;
    const end = start + size;
    if (end > bytes.length) break;
    const block = bytes.subarray(start, end);
    if (type === 0) applyFlacStream(tags, block);
    if (type === 4) {
      const text = vorbis(block);
      if (text.title) tags.title = text.title;
      if (text.artist) tags.artist = text.artist;
      if (text.album) tags.album = text.album;
      if (text.genre) tags.genre = text.genre;
    }
    if (type === 6 && !tags.cover) tags.cover = flacPicture(block);
    at = end;
    if (last) break;
  }
  return tags.title || tags.artist || tags.cover || tags.sampleRate ? tags : null;
}

function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24);
}

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function applyFlacStream(tags: MusicTags, block: Uint8Array) {
  if (block.length < 18) return;
  const sr = ((block[10] ?? 0) << 12) | ((block[11] ?? 0) << 4) | ((block[12] ?? 0) >> 4);
  const bits = ((((block[12] ?? 0) & 1) << 4) | ((block[13] ?? 0) >> 4)) + 1;
  const hi = (block[13] ?? 0) & 0xf;
  const lo = (((block[14] ?? 0) << 24) | ((block[15] ?? 0) << 16) | ((block[16] ?? 0) << 8) | (block[17] ?? 0)) >>> 0;
  const samples = hi * 0x100000000 + lo;
  if (sr >= 8000 && sr <= 192000) tags.sampleRate = sr;
  if (bits >= 8 && bits <= 32) tags.bits = bits;
  if (tags.sampleRate && samples > 0) tags.duration = samples / tags.sampleRate;
}

const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
const MPEG1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0];
const MPEG2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0];
const RATE = [
  [11025, 12000, 8000],
  [0, 0, 0],
  [22050, 24000, 16000],
  [44100, 48000, 32000],
];

function mp3Facts(bytes: Uint8Array): { bitrate: number; sampleRate: number } {
  let start = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) start = Math.min(bytes.length, 10 + syncsafe(bytes, 6));
  const end = Math.min(bytes.length - 4, start + 128000);
  for (let i = start; i < end; i += 1) {
    if (bytes[i] !== 0xff || ((bytes[i + 1] ?? 0) & 0xe0) !== 0xe0) continue;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const ver = (b1 >> 3) & 3;
    const layer = (b1 >> 1) & 3;
    const brIndex = (b2 >> 4) & 0xf;
    const srIndex = (b2 >> 2) & 3;
    if (ver === 1 || layer === 0 || brIndex === 0 || brIndex === 15 || srIndex === 3) continue;
    const mpeg1 = ver === 3;
    const table = layer === 1 ? (mpeg1 ? MPEG1_L3 : MPEG2_L3) : layer === 2 ? (mpeg1 ? MPEG1_L2 : MPEG2_L3) : mpeg1 ? MPEG1_L1 : MPEG2_L1;
    const bitrate = table[brIndex] ?? 0;
    const sampleRate = RATE[ver]?.[srIndex] ?? 0;
    if (!bitrate || !sampleRate) continue;
    const pad = (b2 >> 1) & 1;
    const frameLen = layer === 3 ? Math.floor((12 * bitrate * 1000) / sampleRate + pad) * 4 : mpeg1 ? Math.floor((144 * bitrate * 1000) / sampleRate) + pad : Math.floor((72 * bitrate * 1000) / sampleRate) + pad;
    if (frameLen < 24) continue;
    const next = i + frameLen;
    if (next + 1 < bytes.length && (bytes[next] !== 0xff || ((bytes[next + 1] ?? 0) & 0xe0) !== 0xe0)) continue;
    return { bitrate, sampleRate };
  }
  return { bitrate: 0, sampleRate: 0 };
}

function wavFacts(bytes: Uint8Array): { bitrate: number; sampleRate: number; bits: number } {
  const none = { bitrate: 0, sampleRate: 0, bits: 0 };
  if (bytes.length < 44) return none;
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF") return none;
  if (String.fromCharCode(...bytes.subarray(8, 12)) !== "WAVE") return none;
  let at = 12;
  while (at + 8 <= bytes.length && at < 200000) {
    const id = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = u32le(bytes, at + 4);
    if (id === "fmt " && size >= 16 && at + 24 <= bytes.length) {
      const channels = u16le(bytes, at + 10);
      const sampleRate = u32le(bytes, at + 12);
      const byteRate = u32le(bytes, at + 16);
      const bits = u16le(bytes, at + 22);
      const bitrate = byteRate ? Math.round((byteRate * 8) / 1000) : Math.round((sampleRate * channels * bits) / 1000);
      return { bitrate, sampleRate, bits };
    }
    const step = 8 + size + (size % 2);
    if (step < 8) break;
    at += step;
  }
  return none;
}

function vorbis(block: Uint8Array): MusicTags {
  const tags = { ...EMPTY };
  if (block.length < 8) return tags;
  let at = 4 + u32le(block, 0);
  if (at + 4 > block.length) return tags;
  const count = u32le(block, at);
  at += 4;
  for (let i = 0; i < count && i < 64 && at + 4 <= block.length; i += 1) {
    const len = u32le(block, at);
    at += 4;
    if (len < 0 || at + len > block.length) break;
    const line = new TextDecoder("utf-8").decode(block.subarray(at, at + len));
    at += len;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).toLowerCase();
    const value = clean(line.slice(eq + 1));
    if (key === "title") tags.title = value;
    else if (key === "artist") tags.artist = value;
    else if (key === "album") tags.album = value;
    else if (key === "genre") tags.genre = value;
  }
  return tags;
}

function flacPicture(block: Uint8Array): MusicTags["cover"] {
  if (block.length < 32) return null;
  let at = 4;
  const mimeLen = u32(block, at);
  at += 4;
  if (mimeLen < 0 || at + mimeLen > block.length) return null;
  const mime = clean(new TextDecoder("latin1").decode(block.subarray(at, at + mimeLen))) || "image/jpeg";
  at += mimeLen;
  const descLen = u32(block, at);
  at += 4 + descLen + 16;
  if (at + 4 > block.length) return null;
  const dataLen = u32(block, at);
  at += 4;
  if (dataLen < 32 || at + dataLen > block.length || dataLen > 1_500_000) return null;
  return { mime: mime.startsWith("image/") ? mime : "image/jpeg", bytes: block.subarray(at, at + dataLen) };
}

function readMp4(bytes: Uint8Array): MusicTags | null {
  const ilst = findAtom(bytes, ["moov", "udta", "meta", "ilst"]);
  if (!ilst) return null;
  const tags = { ...EMPTY };
  let at = 0;
  while (at + 8 <= ilst.length) {
    const size = u32(ilst, at);
    if (size < 8 || at + size > ilst.length) break;
    const type = atomType(ilst, at + 4);
    const body = ilst.subarray(at + 8, at + size);
    const data = mp4Data(body);
    if (data) {
      if (type === "©nam") tags.title = clean(new TextDecoder("utf-8").decode(data));
      else if (type === "©ART") tags.artist = clean(new TextDecoder("utf-8").decode(data));
      else if (type === "©alb") tags.album = clean(new TextDecoder("utf-8").decode(data));
      else if (type === "©gen") tags.genre = clean(new TextDecoder("utf-8").decode(data));
      else if (type === "covr") {
        const mime = body[11] === 14 ? "image/png" : "image/jpeg";
        if (data.length >= 32 && data.length <= 1_500_000) tags.cover = { mime, bytes: data };
      }
    }
    at += size;
  }
  return tags.title || tags.artist || tags.cover ? tags : null;
}

export function readTailTags(bytes: Uint8Array): MusicTags {
  const parsed = readTags(bytes);
  if (parsed.title || parsed.artist || parsed.cover) return parsed;
  for (let i = 4; i + 8 < bytes.length; i += 1) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x6f || bytes[i + 2] !== 0x6f || bytes[i + 3] !== 0x76) continue;
    const size = u32(bytes, i - 4);
    if (size < 16 || i - 4 + size > bytes.length) continue;
    const found = readMp4(bytes.subarray(i - 4, i - 4 + size));
    if (found) return found;
  }
  return parsed;
}

function atomType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

function findAtom(bytes: Uint8Array, path: string[]): Uint8Array | null {
  let view = bytes;
  let inMeta = false;
  for (const name of path) {
    const origin = inMeta ? 4 : 0;
    inMeta = name === "meta";
    let found: Uint8Array | null = null;
    let at = origin;
    while (at + 8 <= view.length) {
      const size = u32(view, at);
      if (size < 8 || at + size > view.length) break;
      if (atomType(view, at + 4) === name) {
        found = view.subarray(at + 8, at + size);
        break;
      }
      at += size;
    }
    if (!found) return null;
    view = found;
  }
  return view;
}

function mp4Data(body: Uint8Array): Uint8Array | null {
  if (body.length < 16 || atomType(body, 4) !== "data") return null;
  const size = u32(body, 0);
  if (size < 16 || size > body.length) return null;
  return body.subarray(16, size);
}
