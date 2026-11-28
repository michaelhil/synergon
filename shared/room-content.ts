// Live content on a scene's flat screens: which page or app view each screen shows (`scene.content`, beside
// `lighting`). Lenient scene, strict commands: a malformed stored block only makes its screens wait
// (`contentShapeOk`); a command's block is checked strictly (`validateContent`). Everything here is pure and runs
// unchanged in the server and the viewer.
import { Refusal } from "./commands/schema.ts";

/** The feature's constants, in one place for the server (the viewer's own are at the top of its frame layer). */
export const LIVE = {
  maxSources: 16, maxShows: 64, maxUrl: 2048, keyLength: 10, nameLength: 26,
  layoutWidth: 1280,              // CSS px of every frame's layout, at the screen's aspect
  maxFrames: 12, readyTimeoutMs: 30_000, loadTimeoutMs: 20_000, hiddenTabMs: 120_000,
  seenEveryMs: 1_000, seenTtlMs: 60_000, facingUpLimit: 0.7, areaClass: 0.8, flatDepth: 0.002,
  maxContentBytes: 64 * 1024,     // JSON of one scene's content block
  maxLabel: 200,                  // characters of a source label
  maxReportBytes: 16 * 1024,      // body of one viewer report (POST .../seen)
  seenPublicPerMinute: 120,       // viewer reports a visitor may send to the public server per minute (own budget, not edits)
} as const;

/** The identifier patterns of §3.1, shared so that server, viewer and checks agree. */
export const LIVE_PATTERNS = {
  source: /^[a-z0-9][a-z0-9-]{0,31}$/,          // source id; also app ids in the settings
  key: /^[a-z2-7]{10}$/,                         // run key (base32)
  name: /^[a-z2-7]{26}$/,                        // run name (base32)
  view: /^[A-Za-z0-9._:-]{1,64}$/,               // view id
  run: /^[A-Za-z0-9_-]{1,64}$/,                  // app-side run id (reports, status messages)
  instance: /^[a-z0-9][a-z0-9_-]{0,79}$/,        // instance id (as instances.add accepts)
  screen: /^S_[A-Za-z0-9_]{1,78}$/,              // S_ member id
} as const;

export interface SceneContent {
  sources: Record<string, ContentSource>;                 // id ^[a-z0-9][a-z0-9-]{0,31}$
  shows: Record<string, Record<string, Show>>;            // instance id → S_ member id → show
}
export type ContentSource = AppSource | PageSource;
export interface AppSource  { kind: "app";  app: string; item: string; label: string; run: { key: string } }   // key ^[a-z2-7]{10}$
export interface PageSource { kind: "page"; url: string; label: string }                                     // url passed frameAddress
export interface Show { source: string; view?: string }  // view ^[A-Za-z0-9._:-]{1,64}$, required iff the source is an app source

export interface LiveApps { format: "live-surfaces/1"; apps: LiveApp[]; publicSites: string[] }
export interface LiveApp  { id: string; label: string; origin: string; list?: string; items: LiveItem[] }
export interface LiveItem { id: string; label: string; page: string; views: { id: string; label: string }[] }

export type SeenState = "starting" | "showing" | "waiting" | "ended" | "refused" | "not_answering"
  | "awaiting_click" | "not_allowed" | "off";
export const SEEN_STATES: readonly SeenState[] = ["starting", "showing", "waiting", "ended", "refused", "not_answering",
  "awaiting_click", "not_allowed", "off"];
export interface SeenReport { state: SeenState; run?: string; view?: string }   // run ^[A-Za-z0-9_-]{1,64}$

export interface SurfaceInfo {                            // from RoomCatalog.surfaces(instance)
  screen: string; label: string; size: [number, number];  // metres, width × height of the sheet
  flat: boolean; facing: [number, number, number];        // room frame unit normal (east, north, up)
  centre: [number, number, number];                       // asset frame, posed
}

export interface AddressPolicy { mode: "public" | "local"; self: string; apps: LiveApp[]; publicSites: string[]; typed?: boolean; app?: LiveApp }
export interface ContentContext { apps: LiveApps; mode: "public" | "local"; self: string }

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Lenient: is this a content block worth keeping? Never throws. Unknown keys and kinds are kept as they are. */
export function contentShapeOk(x: unknown): boolean {
  if (!plain(x) || !plain(x.sources) || !plain(x.shows)) return false;
  try {
    const json = JSON.stringify(x);
    return typeof json === "string" && new TextEncoder().encode(json).length <= LIVE.maxContentBytes;
  } catch { return false; }   // a cycle or a BigInt: not a stored block
}

// ---- the address check (§3.3) ----------------------------------------------------------------------------------

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];
const originOf = (s: string) => { try { return new URL(s).origin; } catch { return s; } };

/** The one address check (§3.3). Every frame address in server and viewer comes from `href` returned here. */
export function frameAddress(raw: string, p: AddressPolicy): { ok: true; href: string; origin: string } | { ok: false; why: string } {
  const no = (why: string) => ({ ok: false as const, why });
  // 1. Characters. Controls, spaces and C1 controls anywhere (tabs and newlines inside "java\tscript:"), and "\".
  if (typeof raw !== "string") return no("not text");
  if (raw.length > LIVE.maxUrl) return no("longer than " + LIVE.maxUrl + " characters");
  if (/[\u0000- \u007f-\u009f]/.test(raw)) return no("contains spaces or control characters");
  if (raw.includes("\\")) return no("contains a backslash");
  // 2. Absolute only.
  let u: URL;
  try { u = new URL(raw); } catch { return no("not a complete address"); }
  // 3. Scheme.
  const loopbackHttp = u.protocol === "http:" && LOOPBACK.includes(u.hostname);
  if (!(u.protocol === "https:" || (p.mode === "local" && loopbackHttp)))
    return no(u.protocol === "http:" ? "not https" : "the scheme " + u.protocol + " is not allowed");
  // 4. No credentials, no trailing-dot host.
  if (u.username !== "" || u.password !== "") return no("contains a user name or password");
  if (u.hostname.endsWith(".")) return no("the host name ends with a dot");
  // 5. Never Synergon itself.
  if (u.origin === originOf(p.self)) return no("Synergon's own address");
  // 6. Origin allowed.
  const listed = new Set([...p.publicSites, ...p.apps.map((a) => a.origin), ...(p.app ? [p.app.origin] : [])]);
  if (p.app) {
    if (u.origin !== p.app.origin) return no("not on " + p.app.label + "'s address " + p.app.origin);
  } else if (p.mode === "public") {
    if (!p.publicSites.includes(u.origin)) return no("not a site allowed on the public site");
  } else if (u.protocol === "http:") {
    if (!p.typed && !p.apps.some((a) => a.origin === u.origin)) return no("a local http address that is neither an app nor typed by you");
  }
  if (u.hostname.includes("xn--") && !listed.has(u.origin)) return no("an international host name that is not listed");
  // 7.
  return { ok: true, href: u.href, origin: u.origin };
}

// ---- YouTube and Vimeo (§3.4) ----------------------------------------------------------------------------------

const VIDEO = /^[A-Za-z0-9_-]{11}$/, LIST = /^[A-Za-z0-9_-]{2,64}$/, VIMEO = /^\d{1,20}$/;
const YOUTUBE = ["youtube.com", "www.youtube.com", "m.youtube.com"], NOCOOKIE = ["youtube-nocookie.com", "www.youtube-nocookie.com"];

/** Seconds from "90", "90s", "1m30s" or "1h2m3s"; null when not a positive time. */
function seconds(t: string | null): number | null {
  if (!t) return null;
  const m = /^(?:(\d{1,5})h)?(?:(\d{1,5})m)?(?:(\d{1,7})s?)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const n = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return n > 0 ? n : null;
}

/** YouTube and Vimeo links to their embeddable players; other addresses unchanged (§3.4). */
export function embeddable(url: string): string {
  if (typeof url !== "string") return url;
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return url;
  if (u.username || u.password || (u.port && u.port !== "443" && u.port !== "80")) return url;
  const host = u.hostname, parts = u.pathname.split("/").filter(Boolean), q = u.searchParams;
  let video: string | null = null;
  if (YOUTUBE.includes(host)) {
    if (parts.length === 1 && parts[0] === "watch") video = q.get("v");
    else if (parts.length === 2 && (parts[0] === "shorts" || parts[0] === "embed")) video = parts[1]!;
    else if (!(parts.length === 1 && parts[0] === "playlist")) return url;
  } else if (host === "youtu.be") {
    if (parts.length !== 1) return url;
    video = parts[0]!;
  } else if (NOCOOKIE.includes(host)) {
    if (parts.length !== 2 || parts[0] !== "embed") return url;
    video = parts[1]!;
  } else if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const id = host === "player.vimeo.com" ? (parts.length === 2 && parts[0] === "video" ? parts[1]! : "") : (parts.length === 1 ? parts[0]! : "");
    return VIMEO.test(id) ? "https://player.vimeo.com/video/" + id + "?autoplay=1&muted=1&loop=1" : url;
  } else return url;
  if (video === "videoseries") video = null;
  if (video !== null) {
    if (!VIDEO.test(video)) return url;
    const start = seconds(q.get("start") ?? q.get("t"));
    return "https://www.youtube-nocookie.com/embed/" + video + "?autoplay=1&mute=1&playsinline=1&loop=1&playlist=" + video
      + "&rel=0" + (start ? "&start=" + start : "");
  }
  const list = q.get("list");
  if (!list || !LIST.test(list)) return url;
  return "https://www.youtube-nocookie.com/embed/videoseries?list=" + list + "&autoplay=1&mute=1&playsinline=1&loop=1&rel=0";
}

// ---- app pages (§3.5) ------------------------------------------------------------------------------------------

/** A template the settings may hold: relative to the app's origin, no "//" start, no "\" or "@". */
export function templateOk(page: string): boolean {
  return typeof page === "string" && page.length > 0 && page.length <= LIVE.maxUrl && !page.startsWith("//")
    && !page.includes("\\") && !page.includes("@") && !/[\u0000- \u007f-\u009f]/.test(page);
}

/** The address of an app view, or a refusal (§3.5). Run it through `frameAddress` with `app` before framing it. */
export function appPage(app: LiveApp, item: LiveItem, view: string, runName: string): { ok: true; href: string } | { ok: false; why: string } {
  const no = (why: string) => ({ ok: false as const, why });
  if (!LIVE_PATTERNS.name.test(runName)) return no("not a run name");
  if (!app.items.some((i) => i.id === item.id)) return no(item.id + " is not an item of " + app.label);
  if (!item.views.some((v) => v.id === view)) return no(view + " is not a view of " + item.label);
  if (!templateOk(item.page)) return no("the page template of " + item.label + " is not allowed");
  const filled = item.page.replaceAll("{run}", runName).replaceAll("{item}", encodeURIComponent(item.id))
    .replaceAll("{view}", encodeURIComponent(view));
  let u: URL;
  try { u = new URL(filled, app.origin); } catch { return no("the page template of " + item.label + " does not make an address"); }
  if (u.origin !== app.origin) return no("the page of " + item.label + " leaves " + app.origin);
  return { ok: true, href: u.href };
}

/**
 * The app-side run id (§3.6): the item's page template filled, then the path segment or query value that contained
 * `{run}` (for Leitbild `run-ext-<name>`). Null when the template has no `{run}`, the segment also depends on the
 * view, or the result is not a valid run id.
 */
export function appRunId(item: LiveItem, runName: string): string | null {
  const [path = "", query = ""] = item.page.split("#")[0]!.split("?");
  const pieces = [...path.split("/"), ...query.split("&").map((kv) => kv.slice(kv.indexOf("=") + 1))];
  const raw = pieces.find((s) => s.includes("{run}"));
  if (raw === undefined || raw.includes("{view}")) return null;
  let id: string;
  try { id = decodeURIComponent(raw.replaceAll("{run}", runName).replaceAll("{item}", encodeURIComponent(item.id))); } catch { return null; }
  return LIVE_PATTERNS.run.test(id) ? id : null;
}

// ---- strict validation (§3.6 content.set) ----------------------------------------------------------------------

const refuse = (where: string, what: string) => new Refusal("invalid_content", where + ": " + what,
  "Read content.list for the apps, items, views and allowed sites; sources need kind, label and (app) app, item, run.key or (page) url; every show names a source, and a view only for app sources.");

function onlyKeys(x: Record<string, unknown>, where: string, required: string[], optional: string[] = []) {
  for (const k of required) if (!(k in x)) throw refuse(where, "missing " + k);
  for (const k of Object.keys(x)) if (!required.includes(k) && !optional.includes(k)) throw refuse(where, "unknown field " + k);
}
function label(x: unknown, where: string): string {
  if (typeof x !== "string" || !x.trim() || x.length > LIVE.maxLabel || /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(x))
    throw refuse(where, "label must be one line of 1–" + LIVE.maxLabel + " characters");
  return x;
}

/**
 * Strict (commands, content.set): the block as it will be stored, or a `Refusal` (`{ code: "invalid_content",
 * message, hint }`, which the server turns into a RoomError). Keys are kept as given; page addresses are stored as
 * `embeddable` + `frameAddress` made them; instance maps without shows are dropped. Whether the instances and
 * screens exist is the caller's business (shows of missing instances wait).
 */
export function validateContent(c: unknown, ctx: ContentContext): SceneContent {
  if (!plain(c)) throw refuse("content", "must be an object with sources and shows");
  onlyKeys(c, "content", ["sources", "shows"]);
  if (!contentShapeOk(c)) throw refuse("content", "sources and shows must be objects, together at most " + LIVE.maxContentBytes + " bytes of JSON");
  const sources: Record<string, ContentSource> = {}, inSources = c.sources as Record<string, unknown>;
  const ids = Object.keys(inSources);
  if (ids.length > LIVE.maxSources) throw refuse("content.sources", "at most " + LIVE.maxSources + " sources");
  for (const id of ids) {
    const where = "content.sources." + id, s = inSources[id];
    if (!LIVE_PATTERNS.source.test(id)) throw refuse(where, "a source id is 1–32 lower-case letters, digits or '-', starting with a letter or digit");
    if (!plain(s)) throw refuse(where, "must be an object");
    if (s.kind === "app") {
      onlyKeys(s, where, ["kind", "app", "item", "label", "run"]);
      const app = ctx.apps.apps.find((a) => a.id === s.app);
      if (!app) throw refuse(where, "no app " + JSON.stringify(s.app) + " in this installation");
      const item = app.items.find((i) => i.id === s.item);
      if (!item) throw refuse(where, "no item " + JSON.stringify(s.item) + " in " + app.label);
      if (!plain(s.run)) throw refuse(where, "run must be { key }");
      onlyKeys(s.run, where + ".run", ["key"]);
      if (typeof s.run.key !== "string" || !LIVE_PATTERNS.key.test(s.run.key)) throw refuse(where + ".run.key", "10 characters of a–z and 2–7");
      sources[id] = { kind: "app", app: app.id, item: item.id, label: label(s.label, where), run: { key: s.run.key } };
    } else if (s.kind === "page") {
      onlyKeys(s, where, ["kind", "url", "label"]);
      if (typeof s.url !== "string") throw refuse(where, "url must be text");
      const a = frameAddress(embeddable(s.url), { mode: ctx.mode, self: ctx.self, apps: ctx.apps.apps, publicSites: ctx.apps.publicSites, typed: false });
      if (!a.ok) throw refuse(where + ".url", "refused, " + a.why);
      sources[id] = { kind: "page", url: a.href, label: label(s.label, where) };
    } else throw refuse(where, "kind must be \"app\" or \"page\"");
  }
  const shows: Record<string, Record<string, Show>> = {}, inShows = c.shows as Record<string, unknown>;
  let count = 0;
  for (const instance of Object.keys(inShows)) {
    const where = "content.shows." + instance, screens = inShows[instance];
    if (!LIVE_PATTERNS.instance.test(instance)) throw refuse(where, "not an instance id");
    if (!plain(screens)) throw refuse(where, "must be an object of screen → show");
    for (const screen of Object.keys(screens)) {
      const at = where + "." + screen, show = screens[screen];
      if (!LIVE_PATTERNS.screen.test(screen)) throw refuse(at, "not a screen id (S_…)");
      if (!plain(show)) throw refuse(at, "must be { source, view? }");
      onlyKeys(show, at, ["source"], ["view"]);
      const source = typeof show.source === "string" ? sources[show.source] : undefined;
      if (!source) throw refuse(at, "no source " + JSON.stringify(show.source) + " in content.sources");
      if (source.kind === "app") {
        if (typeof show.view !== "string" || !LIVE_PATTERNS.view.test(show.view)) throw refuse(at, "an app source needs a view");
        const item = ctx.apps.apps.find((a) => a.id === source.app)!.items.find((i) => i.id === source.item)!;
        if (!item.views.some((v) => v.id === show.view)) throw refuse(at, "no view " + JSON.stringify(show.view) + " in " + item.label);
        (shows[instance] ??= {})[screen] = { source: show.source as string, view: show.view };
      } else {
        if (show.view !== undefined) throw refuse(at, "a page source takes no view");
        (shows[instance] ??= {})[screen] = { source: show.source as string };
      }
      if (++count > LIVE.maxShows) throw refuse("content.shows", "at most " + LIVE.maxShows + " shows");
    }
  }
  return { sources, shows };
}

// ---- distribution (§3.6) ---------------------------------------------------------------------------------------

export type SkipWhy = "faces up" | "curved: not in this release" | "no more views";
export interface Distribution { assigned: { screen: string; view: string }[]; skipped: { screen: string; why: SkipWhy }[]; unplaced: string[] }

/** Why a screen is not offered for live content, or null when it is (§3.6 Distribution 1). */
export function screenWhy(s: SurfaceInfo): Exclude<SkipWhy, "no more views"> | null {
  if (!s.flat) return "curved: not in this release";
  if (s.facing[2] > LIVE.facingUpLimit) return "faces up";
  return null;
}

/**
 * The offered screens in placement order (§3.6 Distribution 2): area descending, areas within `areaClass` counting
 * as equal (a class is opened by its largest screen); within a class centre Y descending (the operator's left), then
 * centre Z descending (top first); the screen id breaks remaining ties.
 */
export function orderScreens(screens: SurfaceInfo[]): SurfaceInfo[] {
  const area = (s: SurfaceInfo) => s.size[0] * s.size[1];
  const bySize = screens.filter((s) => screenWhy(s) === null).sort((a, b) => area(b) - area(a) || (a.screen < b.screen ? -1 : 1));
  const classes: SurfaceInfo[][] = [];
  for (const s of bySize) {
    const open = classes.at(-1);
    if (open && area(open[0]!) > 0 && area(s) / area(open[0]!) >= LIVE.areaClass) open.push(s);
    else if (open && area(open[0]!) === 0 && area(s) === 0) open.push(s);
    else classes.push([s]);
  }
  return classes.flatMap((c) => c.sort((a, b) => b.centre[1] - a.centre[1] || b.centre[2] - a.centre[2] || (a.screen < b.screen ? -1 : 1)));
}

/**
 * An app item's views over one asset's screens (§3.6 Distribution). `views` are the item's view ids in list order;
 * `shownElsewhere` the view ids this item shows on other instances' screens. Pure.
 */
export function distribute(screens: SurfaceInfo[], views: string[], shownElsewhere: Iterable<string>): Distribution {
  const elsewhere = new Set(shownElsewhere), seen = new Set<string>();
  const toPlace = views.filter((v) => !elsewhere.has(v) && !seen.has(v) && seen.add(v));
  const skipped: Distribution["skipped"] = [];
  for (const s of screens) { const why = screenWhy(s); if (why) skipped.push({ screen: s.screen, why }); }
  const ordered = orderScreens(screens), n = Math.min(ordered.length, toPlace.length);
  const assigned = ordered.slice(0, n).map((s, i) => ({ screen: s.screen, view: toPlace[i]! }));
  for (const s of ordered.slice(n)) skipped.push({ screen: s.screen, why: "no more views" });
  return { assigned, skipped, unplaced: toPlace.slice(n) };
}
