// bun test viewer/src — live screen content in the viewer: frame placement, the address check as the viewer runs it,
// the screen state machine (with a fake clock), the message filter and the report schedule.
import { describe, expect, test } from "bun:test";
import { frameAddress, type AddressPolicy, type LiveApp, type SceneContent } from "../../shared/room-content.ts";
import { runName } from "../../shared/run-name.ts";
import { homography, mapPoint } from "./room-frames.ts";
import {
  acceptMessage, cleanText, MessageGate, readMessage, reportBody, ReportSchedule, resolveShows, ScreenStatus,
  type ContentListResult,
} from "./room-content.ts";

describe("placement", () => {
  const quads: [number, number][][] = [
    [[10, 20], [330, 20], [330, 200], [10, 200]],                 // square on
    [[100, 40], [420, 90], [410, 260], [95, 300]],                // oblique
    [[300.5, 10.25], [310.75, 30], [305, 80.5], [296, 60]],       // 70° off axis, small
  ];
  for (const [i, to] of quads.entries()) test("the homography maps the frame's four corners (" + i + ")", () => {
    const m = homography(1280, 720, to)!;
    expect(m).toStartWith("matrix3d(");
    const from: [number, number][] = [[0, 0], [1280, 0], [1280, 720], [0, 720]];
    from.forEach(([u, v], k) => {
      const [x, y] = mapPoint(m, u, v);
      expect(Math.abs(x - to[k]![0])).toBeLessThan(1e-3);
      expect(Math.abs(y - to[k]![1])).toBeLessThan(1e-3);
    });
  });
  test("a degenerate quad gives no transform", () => {
    expect(homography(1280, 720, [[5, 5], [5, 5], [5, 5], [5, 5]])).toBeNull();
  });
});

describe("the address check, as the viewer runs it before every load (§3.3)", () => {
  const self = "https://synergon.mightwork.ai";
  const apps: LiveApp[] = [{ id: "fake", label: "Fake", origin: "http://127.0.0.1:43100", items: [] }];
  const publicSites = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"];
  const pub: AddressPolicy = { mode: "public", self, apps, publicSites };
  const local: AddressPolicy = { mode: "local", self: "http://127.0.0.1:4173", apps, publicSites };
  const refused = ["javascript:alert(1)", "JaVaScRiPt:x", "java\tscript:x", "java\nscript:x", " https://ok",
    "blob:https://synergon.mightwork.ai/x", "data:text/html,x", "about:blank", "about:srcdoc", "//www.youtube-nocookie.com/x",
    "https://user@www.youtube-nocookie.com/", "https://www.youtube-nocookie.com./", "https://www.youtube-nocookie.com:444/",
    "https://www.xn--yutube-nocookie-xyz.com/", "http://127.0.0.1:9/", "https://synergon.mightwork.ai/", "https://x.org/" + "a".repeat(2030)];
  for (const raw of refused) test("public refuses " + JSON.stringify(raw.slice(0, 40)), () => expect(frameAddress(raw, pub).ok).toBe(false));
  test("the default port normalises", () => {
    const a = frameAddress("https://www.youtube-nocookie.com:443/embed/x", pub);
    expect(a.ok && a.origin).toBe("https://www.youtube-nocookie.com");
  });
  test("local: loopback http only when typed or an app", () => {
    expect(frameAddress("http://127.0.0.1:9/", local).ok).toBe(false);
    expect(frameAddress("http://127.0.0.1:9/", { ...local, typed: true }).ok).toBe(true);
    expect(frameAddress("http://127.0.0.1:43100/x", { ...local, app: apps[0] }).ok).toBe(true);
    expect(frameAddress("https://example.org/", local).ok).toBe(true);
    expect(frameAddress("http://127.0.0.1:4173/", { ...local, typed: true }).ok).toBe(false);
  });
});

describe("resolving the scene's shows", () => {
  const app: LiveApp = { id: "fake", label: "Fake", origin: "http://localhost:43100", items: [{ id: "demo", label: "Demo item",
    page: "/app?run={run}&item={item}&view={view}", views: [{ id: "one", label: "One" }, { id: "map", label: "Map" }] }] };
  const screen = (instance: string, s: string, offered = true) => ({ instance, screen: s, label: s, size: [1, .5] as [number, number], flat: true,
    facing: "operator" as const, offered, shows: null, seen: [] });
  const list: ContentListResult = { version: 1, mode: "local", viewers: 1, apps: [app], publicSites: ["https://player.vimeo.com"],
    sources: [], screens: [screen("desk", "S_a"), screen("desk", "S_up", false), screen("wall", "S_screen")], waiting: [] };
  const content: SceneContent = {
    sources: { demo: { kind: "app", app: "fake", item: "demo", label: "Demo item", run: { key: "abcdefghij" } },
      clip: { kind: "page", url: "https://player.vimeo.com/video/1?autoplay=1&muted=1&loop=1", label: "player.vimeo.com" },
      lost: { kind: "app", app: "gone", item: "x", label: "Gone", run: { key: "abcdefghij" } } },
    shows: { desk: { S_a: { source: "demo", view: "map" }, S_up: { source: "demo", view: "one" } }, wall: { S_screen: { source: "clip" } },
      old: { S_screen: { source: "lost", view: "x" } } },
  };
  const sceneId = "00000000-0000-4000-8000-000000000000";
  const shows = resolveShows(content, sceneId, list, "http://127.0.0.1:4173", []);
  test("an app view gets its run's page; a screen not offered is left out", () => {
    const a = shows.find(s => s.key === "desk/S_a")!;
    expect(a.href).toBe("http://localhost:43100/app?run=" + runName(sceneId, "abcdefghij") + "&item=demo&view=map");
    expect(a.origin).toBe("http://localhost:43100");
    expect(a.viewLabel).toBe("Map");
    expect(a.run).toBe(runName(sceneId, "abcdefghij"));
    expect(shows.some(s => s.key === "desk/S_up")).toBe(false);
    expect(shows.some(s => s.instance === "old")).toBe(false);
  });
  test("a page keeps its stored address; an app not set up here is not allowed", () => {
    expect(shows.find(s => s.key === "wall/S_screen")!.href).toBe("https://player.vimeo.com/video/1?autoplay=1&muted=1&loop=1");
    const other = resolveShows({ ...content, shows: { wall: { S_screen: { source: "lost", view: "x" } } } }, sceneId, list, "http://127.0.0.1:4173", []);
    expect(other[0]!.refused).toBeTruthy();
    expect(other[0]!.href).toBeUndefined();
  });
  test("a page from a site not allowed here is refused, never loaded", () => {
    const evil: SceneContent = { sources: { p: { kind: "page", url: "javascript:alert(1)", label: "x" } }, shows: { wall: { S_screen: { source: "p" } } } };
    const r = resolveShows(evil, sceneId, { ...list, mode: "public" }, "https://synergon.mightwork.ai", []);
    expect(r[0]!.href).toBeUndefined();
    expect(r[0]!.refused).toBeTruthy();
  });
  test("no list, no frames", () => expect(resolveShows(content, sceneId, null, "x", [])).toEqual([]));
});

describe("the state of a screen", () => {
  const t = { ready: 30_000, load: 20_000 };
  test("app: starting, then showing on status live; never times out after ready", () => {
    const s = new ScreenStatus("app", 0, t);
    expect(s.state).toBe("starting"); expect(s.operable).toBe(false);
    s.onLoad(); expect(s.state).toBe("starting");
    s.onReady(true); expect(s.operable).toBe(true);
    s.onStatus("starting", "run-ext-x");
    expect(s.tick(60_000)).toBe(false); expect(s.state).toBe("starting");
    s.onStatus("live", "run-ext-x"); expect(s.state).toBe("showing"); expect(s.hole).toBe(true); expect(s.run).toBe("run-ext-x");
    s.onStatus("waiting"); expect(s.state).toBe("waiting"); expect(s.hole).toBe(true);
    s.onStatus("live"); expect(s.state).toBe("showing");
    s.onStatus("ended", undefined, "Run over"); expect(s.state).toBe("ended"); expect(s.text).toBe("Run over"); expect(s.hole).toBe(false);
  });
  test("app: settled (rate 0 allowed out of sight) only after its first live, ended or refused", () => {
    const s = new ScreenStatus("app", 0, t);
    s.onReady(true); s.onStatus("starting"); s.onStatus("waiting");
    expect(s.settled).toBe(false);
    s.onStatus("live"); expect(s.settled).toBe(true);
    const r = new ScreenStatus("app", 0, t); r.onStatus("refused", undefined, "Busy"); expect(r.settled).toBe(true);
  });
  test("app: no ready in 30 s is Not answering; a late ready recovers", () => {
    const s = new ScreenStatus("app", 1000, t);
    expect(s.tick(30_999)).toBe(false);
    expect(s.tick(31_000)).toBe(true); expect(s.state).toBe("not_answering");
    expect(s.onReady(true)).toBe(true); expect(s.state).toBe("starting");
    s.onStatus("live"); expect(s.state).toBe("showing");
  });
  test("app: waiting before it ever showed stays starting; refused carries its sentence", () => {
    const s = new ScreenStatus("app", 0, t);
    s.onStatus("waiting"); expect(s.state).toBe("starting"); expect(s.hole).toBe(false);
    s.onStatus("refused", undefined, "All shared screens are in use."); expect(s.state).toBe("refused");
  });
  test("page: showing on load, Not answering without load in 20 s, a late load recovers; no greeting needed", () => {
    const s = new ScreenStatus("page", 0, t);
    expect(s.operable).toBe(true);
    expect(s.tick(19_999)).toBe(false); expect(s.tick(20_000)).toBe(true); expect(s.state).toBe("not_answering");
    expect(s.onLoad()).toBe(true); expect(s.state).toBe("showing"); expect(s.hole).toBe(true);
    s.onStatus("ended"); expect(s.state).toBe("showing");
  });
});

describe("messages from a framed page", () => {
  const win = {}, other = {};
  const ok = (data: object) => ({ source: win, origin: "http://localhost:43100", data: { protocol: "live-surfaces/1", ...data } });
  const frame = { window: win, origin: "http://localhost:43100" };
  test("only from the frame's own window and its expected origin", () => {
    expect(acceptMessage(ok({ type: "ready", operable: true }), frame, new MessageGate(), 0)).toEqual({ type: "ready", operable: true });
    expect(acceptMessage({ ...ok({ type: "ready" }), source: other }, frame, new MessageGate(), 0)).toBeNull();
    expect(acceptMessage({ ...ok({ type: "ready" }), origin: "http://localhost:43101" }, frame, new MessageGate(), 0)).toBeNull();
    expect(acceptMessage({ ...ok({ type: "ready" }), origin: "null" }, { window: win, origin: "null" }, new MessageGate(), 0)).toEqual({ type: "ready", operable: false });
    expect(acceptMessage(ok({ type: "ready" }), { window: null, origin: "http://localhost:43100" }, new MessageGate(), 0)).toBeNull();
  });
  test("at most 60 a second per frame", () => {
    const gate = new MessageGate();
    const results = Array.from({ length: 61 }, (_, i) => acceptMessage(ok({ type: "leave" }), frame, gate, i * 10));
    expect(results.filter(Boolean).length).toBe(60);
    expect(results.at(-1)).toBeNull();
    expect(acceptMessage(ok({ type: "leave" }), frame, gate, 1000)).toEqual({ type: "leave" });
  });
  test("unknown shapes, protocols, states and patterns are dropped", () => {
    expect(readMessage({ type: "ready" })).toBeNull();
    expect(readMessage({ protocol: "live-surfaces/2", type: "ready" })).toBeNull();
    expect(readMessage({ protocol: "live-surfaces/1", type: "status", state: "exploded" })).toBeNull();
    expect(readMessage({ protocol: "live-surfaces/1", type: "status", state: "live", run: "../x" })).toBeNull();
    expect(readMessage({ protocol: "live-surfaces/1", type: "status", state: "live", view: "a b" })).toBeNull();
    expect(readMessage("ready")).toBeNull();
  });
  test("text: one line, at most 140 characters, without control or bidi-override characters", () => {
    const m = readMessage({ protocol: "live-surfaces/1", type: "status", state: "refused", text: "Full\n‮now\u0007 " + "x".repeat(300) });
    expect(m && m.type === "status" && m.text).toBe(("Full now " + "x".repeat(300)).slice(0, 140));
    expect(cleanText("   ")).toBeUndefined();
    expect(cleanText(42)).toBeUndefined();
  });
});

describe("reports", () => {
  test("the body carries only state, run and view", () => {
    const b = reportBody("v1", { "desk/S_a": { state: "showing", run: "run-ext-x", view: "map", extra: 1 } as never, "w/S_b": { state: "off", run: "bad run" } });
    expect(b).toEqual({ viewer: "v1", screens: { "desk/S_a": { state: "showing", run: "run-ext-x", view: "map" }, "w/S_b": { state: "off" } } });
  });
  test("sent at once, then at most once per gap, the latest state winning", async () => {
    let now = 0;
    const sent: string[] = [];
    const s = new ReportSchedule(r => { sent.push(Object.values(r).map(x => x.state).join()); return true; }, 30, 10_000, () => now);
    s.update({ a: { state: "starting" } });
    expect(sent).toEqual(["starting"]);
    now = 5; s.update({ a: { state: "showing" } }); now = 6; s.update({ a: { state: "ended" } });
    expect(sent).toEqual(["starting"]);
    now = 40; await Bun.sleep(45);
    expect(sent).toEqual(["starting", "ended"]);
    s.update({ a: { state: "ended" } });
    expect(sent.length).toBe(2);
    s.stop();
  });
});
