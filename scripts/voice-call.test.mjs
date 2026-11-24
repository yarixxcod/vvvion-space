import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(path, require = () => ({})) {
  const exports = {};
  new Function(
    "exports",
    "require",
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, require);
  return exports;
}
const turns = load("src/lib/ai/voice-turn.ts");
const { VoiceCall } = load("src/lib/ai/voice-call.ts", () => turns);
test("speech boundaries keep short pauses, discard silence, cap long phrases", () => {
  assert.equal(turns.voiceBoundary(5000, 0, 0, 0), "wait");
  assert.equal(turns.voiceBoundary(8100, 0, 0, 0), "discard");
  assert.equal(turns.voiceBoundary(2000, 0, 1500, 500), "wait");
  assert.equal(turns.voiceBoundary(2700, 0, 1500, 500), "send");
  assert.equal(turns.voiceBoundary(30000, 0, 29999, 3000), "send");
  assert.equal(turns.voiceBoundary(30000, 0, 29999, 100), "discard");
});
test("spoken reply excludes code, URLs and control tokens", () => {
  assert.equal(
    turns.voiceText("**Привет** [[like]] ```js\nalert(1)\n``` [сайт](https://example.com)"),
    "Привет Код оставлен в чате. сайт",
  );
});
function harness(t, overrides = {}) {
  let call;
  const saved = new Map();
  const put = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  t.after(() => {
    call?.close();
    for (const [k, v] of saved) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  let now = 0,
    level = 0.05,
    tick;
  const track = {
    enabled: true,
    stopped: false,
    onended: null,
    stop() {
      this.stopped = true;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const audios = [],
    requests = [],
    recorders = [];
  put("window", {
    setInterval: (fn) => ((tick = fn), 1),
    clearInterval: () => {
      tick = undefined;
    },
  });
  put("document", { hidden: false });
  put("performance", { now: () => now });
  put("navigator", { mediaDevices: { getUserMedia: overrides.media ?? (async () => stream) } });
  put(
    "AudioContext",
    class {
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          getFloatTimeDomainData(a) {
            a.fill(level);
          },
        };
      }
    },
  );
  put(
    "Audio",
    class {
      onended = null;
      onerror = null;
      paused = false;
      constructor() {
        audios.push(this);
      }
      setAttribute() {}
      play() {
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
    },
  );
  put(
    "MediaRecorder",
    class {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm";
      onstop = null;
      ondataavailable = null;
      constructor() {
        recorders.push(this);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["a".repeat(1000)]) });
        this.onstop?.();
      }
    },
  );
  put("fetch", async (url, init = {}) => {
    requests.push({ url, init, enabled: track.enabled });
    if (overrides.fetch) return overrides.fetch(url, init);
    if (!init.method) return Response.json({ ready: true });
    if (url === "/api/transcribe") return Response.json({ text: "Привет" });
    return new Response(new Blob(["a".repeat(100)], { type: "audio/mpeg" }));
  });
  const states = [],
    said = [];
  let stops = 0;
  call = new VoiceCall(
    (s) => states.push(s),
    async (text) => {
      said.push(text);
      return overrides.turn ? overrides.turn(text) : { text: "Здравствуйте" };
    },
    () => stops++,
  );
  return {
    call,
    states,
    track,
    requests,
    said,
    audios,
    recorders,
    get stops() {
      return stops;
    },
    sample(ms, rms) {
      now += ms;
      level = rms;
      tick?.();
    },
    stream,
  };
}
const settle = async () => {
  for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
};
test("Whisper → current model → TTS: one turn, no recording during reply, resumes after playback", async (t) => {
  const h = harness(t);
  await h.call.start();
  assert.equal(h.states.at(-1).phase, "listening");
  for (let i = 0; i < 5; i++) h.sample(80, 0.05);
  h.sample(1200, 0);
  await settle();
  assert.deepEqual(h.said, ["Привет"]);
  assert.equal(h.states.at(-1).phase, "speaking");
  assert.equal(h.track.enabled, false);
  assert.equal(
    h.requests.filter((r) => r.url === "/api/transcribe" && r.init.method === "POST").length,
    1,
  );
  assert.equal(
    h.requests.find((r) => r.url === "/api/tts" && r.init.method === "POST").enabled,
    false,
  );
  h.audios[0].onended();
  assert.equal(h.states.at(-1).phase, "listening");
  assert.equal(h.track.enabled, true);
  h.call.close();
  assert.equal(h.track.stopped, true);
  assert.equal(h.audios[0].paused, true);
});
test("closing during microphone permission releases the eventual stream without starting requests", async (t) => {
  let release;
  const h = harness(t, { media: () => new Promise((r) => (release = r)) });
  const pending = h.call.start();
  h.call.close();
  release(h.stream);
  await pending;
  await settle();
  assert.equal(h.track.stopped, true);
  assert.equal(h.requests.length, 0);
});
test("mute discards unfinished audio and silence never calls providers", async (t) => {
  const h = harness(t);
  await h.call.start();
  h.sample(8200, 0);
  await settle();
  assert.equal(h.said.length, 0);
  h.call.toggleMute();
  assert.equal(h.states.at(-1).phase, "paused");
  assert.equal(h.track.enabled, false);
  h.call.toggleMute();
  assert.equal(h.states.at(-1).phase, "listening");
});
test("closing while the model works cancels its turn and ignores late TTS", async (t) => {
  let release;
  const h = harness(t, { turn: () => new Promise((r) => (release = r)) });
  await h.call.start();
  for (let i = 0; i < 5; i++) h.sample(80, 0.05);
  h.sample(1200, 0);
  await settle();
  assert.equal(h.states.at(-1).phase, "thinking");
  h.call.close();
  release({ text: "late" });
  await settle();
  assert.equal(h.stops, 1);
  assert.equal(
    h.requests.some((r) => r.url === "/api/tts" && r.init.method === "POST"),
    false,
  );
});
test("missing configured speech service fails clearly and releases the microphone", async (t) => {
  const h = harness(t, { fetch: async () => Response.json({ ready: false }) });
  await h.call.start();
  assert.equal(h.states.at(-1).phase, "error");
  assert.match(h.states.at(-1).error, /Whisper/);
  assert.equal(h.track.stopped, true);
});
test("interrupt waits for an aborted model turn before listening again, without late speech", async (t) => {
  let release;
  const h = harness(t, { turn: () => new Promise((r) => (release = r)) });
  await h.call.start();
  for (let i = 0; i < 5; i++) h.sample(80, 0.05);
  h.sample(1200, 0);
  await settle();
  h.call.interrupt();
  assert.equal(h.states.at(-1).phase, "paused");
  release({ text: "Не озвучивать" });
  await settle();
  assert.equal(h.states.at(-1).phase, "listening");
  assert.equal(
    h.requests.some((r) => r.url === "/api/tts" && r.init.method === "POST"),
    false,
  );
});
test("a backgrounded screen pauses capture and foreground resumes it", async (t) => {
  const h = harness(t);
  await h.call.start();
  document.hidden = true;
  h.call.visibility();
  assert.equal(h.track.enabled, false);
  assert.equal(h.states.at(-1).phase, "paused");
  document.hidden = false;
  h.call.visibility();
  assert.equal(h.states.at(-1).phase, "listening");
  assert.equal(h.track.enabled, true);
});
