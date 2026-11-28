// Live screen content, the pure shared core (B0): the address check and its hostile inputs, YouTube and Vimeo
// players, app pages and run ids, strict validation of a content block, distribution of an item's views over an
// asset's screens, and run names. The server's commands, routes and reports are tested further down by package B.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Refusal } from "../shared/commands/schema.ts";
import {
  appPage, appRunId, distribute, embeddable, frameAddress, LIVE, orderScreens, screenWhy, validateContent,
  type AddressPolicy, type ContentContext, type LiveApp, type LiveApps, type SurfaceInfo,
} from "../shared/room-content.ts";
import { base32, newKey, runName, sha256 } from "../shared/run-name.ts";

const SELF = "https://synergon.mightwork.ai";
const NOCOOKIE = "https://www.youtube-nocookie.com", VIMEO = "https://player.vimeo.com";
const VIEWS = ["dashboard", "unit-1", "unit-2", "procedures-1", "grid", "map"];
const app: LiveApp = {
  id: "fixture-app", label: "Fixture app", origin: "https://app.example.org", list: "/api/list",
  items: [{ id: "process-one", label: "Process one", page: "/w/runs/run-ext-{run}?item={item}&view={view}&theme=dark",
    views: VIEWS.map((id) => ({ id, label: id })) }],
};
const loopApp: LiveApp = { ...app, id: "loop-app", origin: "http://127.0.0.1:43100" };
const apps: LiveApps = { format: "live-surfaces/1", apps: [app], publicSites: [NOCOOKIE, VIMEO] };
const pub: AddressPolicy = { mode: "public", self: SELF, apps: apps.apps, publicSites: apps.publicSites };
const loc: AddressPolicy = { ...pub, mode: "local" };

describe("frameAddress", () => {
  // [address, public accepts, local accepts]
  const hostile: [string, boolean, boolean][] = [
    ["javascript:alert(1)", false, false],
    ["JaVaScRiPt:x", false, false],
    ["java\tscript:x", false, false],
    ["java\nscript:x", false, false],
    [" https://ok", false, false],
    ["blob:https://synergon.mightwork.ai/x", false, false],
    ["data:text/html,x", false, false],
    ["about:blank", false, false],
    ["about:srcdoc", false, false],
    ["file:///etc/passwd", false, false],
    ["ws://127.0.0.1:9/", false, false],
    ["//www.youtube-nocookie.com/x", false, false],
    ["/embed/x", false, false],
    ["https://user@www.youtube-nocookie.com/", false, false],
    ["https://:pw@www.youtube-nocookie.com/", false, false],
    ["https://www.youtube-nocookie.com./", false, false],
    ["https:\\\\www.youtube-nocookie.com/", false, false],
    ["https://www.youtube-nocookie.com/a\u0085b", false, false],
    ["https://www.youtube-nocookie.com:443/embed/x", true, true],
    ["https://www.youtube-nocookie.com:444/", false, true],
    ["https://www.xn--yutube-nocookie-xyz.com/", false, false],
    ["https://xn--bcher-kva.example/", false, false],
    ["http://127.0.0.1:9/", false, false],
    ["http://localhost:9/", false, false],
    ["http://[::1]:9/", false, false],
    ["http://example.org/", false, false],
    ["https://synergon.mightwork.ai/", false, false],
    ["https://synergon.mightwork.ai:443/workspaces/x", false, false],
    ["https://" + "a".repeat(LIVE.maxUrl - 8) + "/", false, false],  // 2,049 characters
    ["https://example.org/page", false, true],
    ["https://player.vimeo.com/video/1", true, true],
  ];
  for (const [raw, okPublic, okLocal] of hostile) test(JSON.stringify(raw).slice(0, 60), () => {
    const a = frameAddress(raw, pub), b = frameAddress(raw, loc);
    expect(a.ok).toBe(okPublic);
    expect(b.ok).toBe(okLocal);
    for (const r of [a, b]) if (!r.ok) expect(r.why.length).toBeGreaterThan(0);
  });

  test("the 2,049-character address is refused for its length; 2,048 passes the length rule", () => {
    const long = "https://example.org/" + "a".repeat(LIVE.maxUrl - 20);
    expect(long.length).toBe(LIVE.maxUrl);
    expect(frameAddress(long, loc).ok).toBe(true);
    const r = frameAddress(long + "a", loc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("longer");
  });
  test("the origin normalises: href and origin come from the parsed address", () => {
    expect(frameAddress("https://WWW.YouTube-NoCookie.com:443/embed/x", pub))
      .toEqual({ ok: true, href: NOCOOKIE + "/embed/x", origin: NOCOOKIE });
  });
  test("loopback http on a local installation: only typed, or a configured app's origin", () => {
    expect(frameAddress("http://127.0.0.1:9/", { ...loc, typed: true }).ok).toBe(true);
    expect(frameAddress("http://localhost:9/x", { ...loc, typed: true }).ok).toBe(true);
    expect(frameAddress("http://[::1]:9/", { ...loc, typed: true }).ok).toBe(true);
    expect(frameAddress("http://127.0.0.1:43100/w", { ...loc, apps: [loopApp] }).ok).toBe(true);
    expect(frameAddress("http://127.0.0.1:43101/w", { ...loc, apps: [loopApp] }).ok).toBe(false);
    expect(frameAddress("http://127.0.0.1:9/", { ...pub, typed: true }).ok).toBe(false);
    expect(frameAddress("http://example.org/", { ...loc, typed: true }).ok).toBe(false);
  });
  test("an app source must stay on its app's origin exactly", () => {
    expect(frameAddress("https://app.example.org/w/runs/x", { ...pub, app }).ok).toBe(true);
    expect(frameAddress("https://app.example.org:8443/w", { ...loc, app }).ok).toBe(false);
    expect(frameAddress(NOCOOKIE + "/embed/x", { ...pub, app }).ok).toBe(false);
    expect(frameAddress("http://127.0.0.1:43100/w", { ...loc, apps: [loopApp], app: loopApp }).ok).toBe(true);
    expect(frameAddress("http://127.0.0.1:43100/w", { ...pub, apps: [loopApp], app: loopApp }).ok).toBe(false);
  });
  test("an international host name passes only when its origin is listed exactly", () => {
    const listed = "https://xn--bcher-kva.example";
    expect(frameAddress(listed + "/", { ...loc, publicSites: [listed] }).ok).toBe(true);
    expect(frameAddress(listed + "/", { ...pub, publicSites: [listed] }).ok).toBe(true);
    expect(frameAddress("https://bücher.example/", loc).ok).toBe(false);   // parses to the xn-- form
  });
  test("not text is refused, never thrown", () => {
    expect(frameAddress(42 as unknown as string, loc).ok).toBe(false);
    expect(frameAddress(undefined as unknown as string, loc).ok).toBe(false);
  });
});

describe("embeddable", () => {
  const yt = (id: string, extra = "") => NOCOOKIE + "/embed/" + id + "?autoplay=1&mute=1&playsinline=1&loop=1&playlist=" + id + "&rel=0" + extra;
  const id = "dQw4w9WgXcQ";
  const cases: [string, string][] = [
    ["https://www.youtube.com/watch?v=" + id, yt(id)],
    ["https://youtube.com/watch?v=" + id + "&feature=share", yt(id)],
    ["https://m.youtube.com/watch?v=" + id, yt(id)],
    ["http://www.youtube.com/watch?v=" + id, yt(id)],
    ["https://youtu.be/" + id, yt(id)],
    ["https://youtu.be/" + id + "?si=abc&t=42", yt(id, "&start=42")],
    ["https://www.youtube.com/shorts/" + id, yt(id)],
    ["https://www.youtube.com/embed/" + id, yt(id)],
    ["https://www.youtube-nocookie.com/embed/" + id, yt(id)],
    ["https://www.youtube.com/watch?v=" + id + "&t=90", yt(id, "&start=90")],
    ["https://www.youtube.com/watch?v=" + id + "&t=90s", yt(id, "&start=90")],
    ["https://www.youtube.com/watch?v=" + id + "&t=1m30s", yt(id, "&start=90")],
    ["https://www.youtube.com/watch?v=" + id + "&t=1h2m3s", yt(id, "&start=3723")],
    ["https://www.youtube.com/embed/" + id + "?start=45", yt(id, "&start=45")],
    ["https://www.youtube.com/watch?v=" + id + "&t=0", yt(id)],
    ["https://www.youtube.com/watch?v=" + id + "&t=soon", yt(id)],
    ["https://www.youtube.com/watch?v=" + id + "&list=PLabcdefghij", yt(id)],
    ["https://www.youtube.com/playlist?list=PLabcdefghij", NOCOOKIE + "/embed/videoseries?list=PLabcdefghij&autoplay=1&mute=1&playsinline=1&loop=1&rel=0"],
    ["https://www.youtube.com/watch?list=PLabcdefghij", NOCOOKIE + "/embed/videoseries?list=PLabcdefghij&autoplay=1&mute=1&playsinline=1&loop=1&rel=0"],
    ["https://vimeo.com/76979871", VIMEO + "/video/76979871?autoplay=1&muted=1&loop=1"],
    ["https://player.vimeo.com/video/76979871?h=abc", VIMEO + "/video/76979871?autoplay=1&muted=1&loop=1"],
  ];
  for (const [input, out] of cases) test(input, () => expect(embeddable(input)).toBe(out));
  const unchanged = [
    "https://www.youtube.com/watch?v=short", "https://www.youtube.com/watch?v=" + id + "x", "https://youtu.be/",
    "https://www.youtube.com/channel/UCabc", "https://www.youtube.com/watch", "https://evil.example/watch?v=" + id,
    "https://www.youtube.com.evil.example/watch?v=" + id, "https://user@www.youtube.com/watch?v=" + id,
    "https://www.youtube.com:8443/watch?v=" + id, "https://vimeo.com/channels/staffpicks", "https://vimeo.com/76979871/abcdef",
    "https://example.org/page", "javascript:alert(1)", "not an address", "",
  ];
  for (const input of unchanged) test("unchanged: " + JSON.stringify(input), () => expect(embeddable(input)).toBe(input));
  test("the result of a recognised link passes the public address check", () => {
    for (const [input] of cases) expect(frameAddress(embeddable(input), pub).ok).toBe(true);
  });
});

describe("appPage and appRunId", () => {
  const item = app.items[0]!, name = runName("00000000-0000-4000-8000-000000000000", "abcdefghij");
  test("fills run, item and view and stays on the app's origin", () => {
    expect(appPage(app, item, "unit-1", name))
      .toEqual({ ok: true, href: "https://app.example.org/w/runs/run-ext-" + name + "?item=process-one&view=unit-1&theme=dark" });
  });
  test("item and view are encoded", () => {
    const odd = { ...item, id: "a&b", views: [{ id: "x:y", label: "x" }] };
    const r = appPage({ ...app, items: [odd] }, odd, "x:y", name);
    expect(r.ok && r.href).toBe("https://app.example.org/w/runs/run-ext-" + name + "?item=a%26b&view=x%3Ay&theme=dark");
  });
  test("refusals", () => {
    expect(appPage(app, item, "unit-1", "short").ok).toBe(false);
    expect(appPage(app, item, "unit-1", name.toUpperCase()).ok).toBe(false);
    expect(appPage(app, item, "nope", name).ok).toBe(false);
    expect(appPage(app, { ...item, id: "other" }, "unit-1", name).ok).toBe(false);
    for (const page of ["//evil.example/{run}", "https://evil.example/{run}", "/a\\b/{run}", "/x@evil.example/{run}", ""]) {
      const bad = { ...item, page };
      expect(appPage({ ...app, items: [bad] }, bad, "unit-1", name).ok).toBe(false);
    }
  });
  test("the app-side run id is the segment that held {run}", () => {
    expect(appRunId(item, name)).toBe("run-ext-" + name);
    expect(appRunId({ ...item, page: "/play?run={run}&view={view}" }, name)).toBe(name);
    expect(appRunId({ ...item, page: "/r/{item}-{run}/{view}" }, name)).toBe("process-one-" + name);
    expect(appRunId({ ...item, page: "/r/{run}-{view}" }, name)).toBeNull();
    expect(appRunId({ ...item, page: "/r/static" }, name)).toBeNull();
  });
});

describe("validateContent", () => {
  const ctx: ContentContext = { apps, mode: "public", self: SELF };
  const good = () => ({
    sources: {
      "process-one": { kind: "app", app: "fixture-app", item: "process-one", label: "Process one", run: { key: "k3m7q2w7x5" } },
      page: { kind: "page", url: "https://youtu.be/dQw4w9WgXcQ", label: "A clip" },
    },
    shows: {
      "desk-a": { S_big_screen_L: { source: "process-one", view: "dashboard" }, S_small_screen_1: { source: "page" } },
      "wall-display": {},
    },
  });
  const refusal = (c: unknown, context = ctx) => {
    try { validateContent(c, context); } catch (e) {
      expect(e).toBeInstanceOf(Refusal);
      const r = e as Refusal;
      expect(r.code).toBe("invalid_content");
      expect(r.hint.length).toBeGreaterThan(0);
      return r.message;
    }
    throw new Error("accepted: " + JSON.stringify(c));
  };
  test("a valid block: keys kept, the clip stored as its player, empty instance maps dropped", () => {
    const out = validateContent(good(), ctx);
    expect(out.sources["process-one"]).toEqual(good().sources["process-one"] as never);
    expect(out.sources.page).toEqual({ kind: "page", url: embeddable("https://youtu.be/dQw4w9WgXcQ"), label: "A clip" });
    expect(Object.keys(out.shows)).toEqual(["desk-a"]);
    expect(out.shows["desk-a"]).toEqual(good().shows["desk-a"]);
    expect(validateContent({ sources: {}, shows: {} }, ctx)).toEqual({ sources: {}, shows: {} });
  });
  const mutate = (f: (c: any) => void) => { const c: any = good(); f(c); return c; };
  const bad: [string, unknown, string][] = [
    ["not an object", [], "content"],
    ["null", null, "content"],
    ["an unknown top-level field", mutate((c) => { c.zoom = 1; }), "unknown field zoom"],
    ["missing shows", { sources: {} }, "missing shows"],
    ["shows not an object", { sources: {}, shows: [] }, "content"],
    ["a bad source id", mutate((c) => { c.sources.Page = c.sources.page; }), "content.sources.Page"],
    ["a source id too long", mutate((c) => { c.sources["a".repeat(33)] = c.sources.page; }), "source id"],
    ["an unknown kind", mutate((c) => { c.sources.page.kind = "picture"; }), "kind"],
    ["an unknown source field", mutate((c) => { c.sources.page.share = true; }), "unknown field share"],
    ["an unknown app", mutate((c) => { c.sources["process-one"].app = "other"; }), "no app"],
    ["an unknown item", mutate((c) => { c.sources["process-one"].item = "other"; }), "no item"],
    ["a bad key", mutate((c) => { c.sources["process-one"].run.key = "ABCDEFGHIJ"; }), "run.key"],
    ["a key of 9", mutate((c) => { c.sources["process-one"].run.key = "abcdefghi"; }), "run.key"],
    ["an extra run field", mutate((c) => { c.sources["process-one"].run.name = "x"; }), "unknown field name"],
    ["an empty label", mutate((c) => { c.sources.page.label = " "; }), "label"],
    ["a label with a newline", mutate((c) => { c.sources.page.label = "a\nb"; }), "label"],
    ["a label with a bidi override", mutate((c) => { c.sources.page.label = "a‮b"; }), "label"],
    ["a javascript: page", mutate((c) => { c.sources.page.url = "javascript:alert(1)"; }), "refused"],
    ["a site not listed on the public site", mutate((c) => { c.sources.page.url = "https://example.org/"; }), "refused"],
    ["Synergon itself", mutate((c) => { c.sources.page.url = SELF + "/"; }), "refused"],
    ["a show of an unknown source", mutate((c) => { c.shows["desk-a"].S_big_screen_L.source = "nope"; }), "no source"],
    ["an app show without a view", mutate((c) => { delete c.shows["desk-a"].S_big_screen_L.view; }), "needs a view"],
    ["an app show with an unknown view", mutate((c) => { c.shows["desk-a"].S_big_screen_L.view = "unit-9"; }), "no view"],
    ["a page show with a view", mutate((c) => { c.shows["desk-a"].S_small_screen_1.view = "dashboard"; }), "takes no view"],
    ["an unknown show field", mutate((c) => { c.shows["desk-a"].S_small_screen_1.zoom = 2; }), "unknown field zoom"],
    ["a screen that is not S_", mutate((c) => { c.shows["desk-a"].C_frame = { source: "page" }; }), "screen id"],
    ["an instance id with a slash", mutate((c) => { c.shows["desk/a"] = {}; }), "instance id"],
    ["an instance map that is a list", mutate((c) => { c.shows["desk-a"] = []; }), "content.shows.desk-a"],
    ["17 sources", mutate((c) => { for (let i = 0; i < 16; i++) c.sources["p" + i] = c.sources.page; }), "at most 16"],
    ["65 shows", { sources: { page: good().sources.page }, shows: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ["d" + i, { S_screen: { source: "page" } }])) }, "at most 64"],
    ["more than 64 KB", mutate((c) => { c.sources.page.label = "x".repeat(LIVE.maxContentBytes); }), "bytes"],
  ];
  for (const [name, c, part] of bad) test("refused: " + name, () => expect(refusal(c)).toContain(part));
  test("local mode accepts any https page, refuses loopback http that was not typed", () => {
    const local = { ...ctx, mode: "local" as const };
    expect(validateContent(mutate((c) => { c.sources.page.url = "https://example.org/x"; }), local).sources.page)
      .toMatchObject({ url: "https://example.org/x" });
    expect(refusal(mutate((c) => { c.sources.page.url = "http://127.0.0.1:9/"; }), local)).toContain("refused");
  });
  test("64 shows are accepted", () => {
    const c = { sources: { page: good().sources.page }, shows: Object.fromEntries(Array.from({ length: 64 }, (_, i) => ["d" + i, { S_screen: { source: "page" } }])) };
    expect(Object.keys(validateContent(c, ctx).shows).length).toBe(64);
  });
});

describe("distribute", () => {
  const s = (screen: string, w: number, h: number, centre: [number, number, number], o: Partial<SurfaceInfo> = {}): SurfaceInfo =>
    ({ screen, label: screen, size: [w, h], flat: true, facing: [-1, 0, 0], centre, ...o });
  // The demo desk as the server builds it from the GLB: asset frame, the operator's left is +Y.
  const desk: SurfaceInfo[] = [
    s("S_small_screen_1", 0.599, 0.337, [0.70, 0.618, 0.885]),
    s("S_small_screen_2", 0.599, 0.337, [0.78, 0, 0.890]),
    s("S_small_screen_3", 0.599, 0.337, [0.70, -0.618, 0.885]),
    s("S_keyboard_touch", 0.238, 0.141, [0.44, 0.01, 0.856], { facing: [-0.31, 0, 0.95] }),
    s("S_big_screen_R", 1.086, 0.608, [0.82, -0.561, 1.443]),
    s("S_big_screen_L", 1.086, 0.608, [0.82, 0.561, 1.443]),
  ];
  test("demo desk: the two big screens (L, then R), then small 1, 2, 3; keyboard panel skipped", () => {
    expect(distribute(desk, VIEWS, [])).toEqual({
      assigned: [
        { screen: "S_big_screen_L", view: "dashboard" }, { screen: "S_big_screen_R", view: "unit-1" },
        { screen: "S_small_screen_1", view: "unit-2" }, { screen: "S_small_screen_2", view: "procedures-1" },
        { screen: "S_small_screen_3", view: "grid" },
      ],
      skipped: [{ screen: "S_keyboard_touch", why: "faces up" }],
      unplaced: ["map"],
    });
  });
  test("a second asset continues with the views not shown elsewhere", () => {
    const wall = [s("S_screen", 1.2, 0.7, [0, 0, 1.5])];
    expect(distribute(wall, VIEWS, ["dashboard", "unit-1", "unit-2", "procedures-1", "grid"]))
      .toEqual({ assigned: [{ screen: "S_screen", view: "map" }], skipped: [], unplaced: [] });
    expect(distribute(wall, VIEWS, new Set(VIEWS)))
      .toEqual({ assigned: [], skipped: [{ screen: "S_screen", why: "no more views" }], unplaced: [] });
  });
  test("fewer views than screens: the rest keep what they showed", () => {
    const r = distribute(desk, ["dashboard", "unit-1"], []);
    expect(r.assigned.map((a) => a.screen)).toEqual(["S_big_screen_L", "S_big_screen_R"]);
    expect(r.skipped).toEqual([
      { screen: "S_keyboard_touch", why: "faces up" },
      { screen: "S_small_screen_1", why: "no more views" }, { screen: "S_small_screen_2", why: "no more views" },
      { screen: "S_small_screen_3", why: "no more views" },
    ]);
    expect(r.unplaced).toEqual([]);
  });
  test("the rig: a curved monitor is skipped, the touchscreen at 0.51 up is offered", () => {
    const rig = [
      s("S_mon_screen", 0.8, 0.35, [0.6, 0, 1.1], { flat: false }),
      s("S_ts_screen", 0.3, 0.2, [0.4, 0.2, 0.9], { facing: [-0.86, 0, 0.51] }),
    ];
    expect(screenWhy(rig[0]!)).toBe("curved: not in this release");
    expect(screenWhy(rig[1]!)).toBeNull();
    expect(distribute(rig, VIEWS, [])).toEqual({
      assigned: [{ screen: "S_ts_screen", view: "dashboard" }],
      skipped: [{ screen: "S_mon_screen", why: "curved: not in this release" }],
      unplaced: ["unit-1", "unit-2", "procedures-1", "grid", "map"],
    });
  });
  test("areas within 20 % count as equal; then left before right, then top before bottom", () => {
    const a = s("a", 1, 1, [0, -1, 1]), b = s("b", 0.9, 0.9, [0, 1, 1]), c = s("c", 0.85, 0.85, [0, 1, 2]);
    // b is 0.81 of a (same class), c is 0.7225 of a (next class)
    expect(orderScreens([a, b, c]).map((x) => x.screen)).toEqual(["b", "a", "c"]);
    const top = s("top", 1, 1, [0, 0, 2]), bottom = s("bottom", 1, 1, [0, 0, 1]);
    expect(orderScreens([bottom, top]).map((x) => x.screen)).toEqual(["top", "bottom"]);
    expect(orderScreens([s("z", 1, 1, [0, 0, 1]), s("y", 1, 1, [0, 0, 1])]).map((x) => x.screen)).toEqual(["y", "z"]);
  });
  test("exactly at the facing-up limit is offered; above it is not", () => {
    expect(screenWhy(s("x", 1, 1, [0, 0, 0], { facing: [0, -0.714, LIVE.facingUpLimit] }))).toBeNull();
    expect(screenWhy(s("x", 1, 1, [0, 0, 0], { facing: [0, -0.71, 0.701] }))).toBe("faces up");
  });
  test("a repeated view in the list is placed once", () => {
    expect(distribute(desk, ["dashboard", "dashboard"], []).assigned).toEqual([{ screen: "S_big_screen_L", view: "dashboard" }]);
  });
});

describe("run names", () => {
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
  const node = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const utf8 = (s: string) => new TextEncoder().encode(s);
  test("the pinned vectors", () => {
    expect(runName("00000000-0000-4000-8000-000000000000", "abcdefghij")).toBe("o4rixhaipecaxyubndzqtwzkax");
    expect(runName("0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4", "k3m9q2w7x5")).toBe("q5pybqqv3hf54fxnde6usf4bhv");
  });
  test("runName is the formula of §3.2", () => {
    const want = (id: string, key: string) => {
      const digest = createHash("sha256").update("live-surfaces/1\n" + id + "\n" + key, "utf8").digest();
      return base32(new Uint8Array(digest)).slice(0, 26);
    };
    expect(runName("b1e2", "zzzzzzzzzz")).toBe(want("b1e2", "zzzzzzzzzz"));
    expect(runName("b1e2", "zzzzzzzzzz")).toMatch(/^[a-z2-7]{26}$/);
  });
  test("sha256 of \"\" and \"abc\" against node:crypto", () => {
    expect(hex(sha256(utf8("")))).toBe(node(utf8("")));
    expect(hex(sha256(utf8("")))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256(utf8("abc")))).toBe(node(utf8("abc")));
    expect(hex(sha256(utf8("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("sha256 of 1,000 random strings and the block boundaries against node:crypto", () => {
    for (let n = 0; n < 130; n++) { const b = crypto.getRandomValues(new Uint8Array(n)); expect(hex(sha256(b))).toBe(node(b)); }
    const chars = "abcxyz09 \né中😀-/";
    for (let i = 0; i < 1000; i++) {
      const len = Math.floor(Math.random() * 300);
      let s = "";
      for (let j = 0; j < len; j++) s += chars[Math.floor(Math.random() * chars.length)];
      const b = utf8(s);
      expect(hex(sha256(b))).toBe(node(b));
    }
    const big = crypto.getRandomValues(new Uint8Array(65_536));
    expect(hex(sha256(big))).toBe(node(big));
  });
  test("base32: RFC 4648 vectors, lower case, no padding", () => {
    const rfc: [string, string][] = [["", ""], ["f", "my"], ["fo", "mzxq"], ["foo", "mzxw6"], ["foob", "mzxw6yq"], ["fooba", "mzxw6ytb"], ["foobar", "mzxw6ytboi"]];
    for (const [i, o] of rfc) expect(base32(utf8(i))).toBe(o);
    expect(base32(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]))).toBe("77777777");
  });
  test("newKey: 10 base32 characters, fresh each time", () => {
    const keys = new Set(Array.from({ length: 200 }, newKey));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^[a-z2-7]{10}$/);
  });
});
