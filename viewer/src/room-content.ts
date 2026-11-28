// Live screen content, the part without three.js: which address each screen's frame loads, what state it is in, the
// greeting with the framed page (live-surfaces/1), the loading rule, and the reports a viewer sends back. The frame
// layer (room-frames.ts) owns the DOM and the 3D side and drives these pieces.
import {
  appPage, appRunId, frameAddress, LIVE, LIVE_PATTERNS,
  type LiveApp, type SceneContent, type SeenReport, type SeenState, type Show,
} from "../../shared/room-content.ts";
import { runName } from "../../shared/run-name.ts";

/** GET /api/scenes/<id>/content (§3.7). */
export interface ContentListScreen {
  instance: string; screen: string; label: string; size: [number, number]; flat: boolean;
  facing: "up" | "operator"; offered: boolean; why?: string; shows: Show | null;
  seen: { viewer: string; state: SeenState; run?: string; view?: string; at: string }[];
}
export interface ContentListSource { id: string; kind: "app" | "page"; app?: string; item?: string; label: string; run?: string; url?: string; screens: number }
export interface ContentListResult {
  version: number; mode: "public" | "local"; viewers: number; apps: LiveApp[]; publicSites: string[];
  sources: ContentListSource[]; screens: ContentListScreen[];
  waiting: { instance: string; screen: string; source: string }[];
}

/** "instance/S_member": one screen of one placed asset. */
export const screenKey = (instance: string, screen: string) => instance + "/" + screen;

/** One show, resolved to the address its frame loads (or why it may not load here). */
export interface ResolvedShow {
  key: string; instance: string; screen: string; source: string; kind: "app" | "page";
  /** the item's or the site's label */
  label: string; view?: string; viewLabel?: string;
  /** set when the address passed frameAddress */
  href?: string; origin?: string;
  /** set when it did not ("Not allowed here") */
  refused?: string;
  /** the host shown on a "Content from …" plate */
  host?: string;
  /** the app's label, for "Leitbild: <text>" */
  app?: string;
  /** the app-side run id this show should join (§3.6), when the template gives one */
  run?: string;
}

const hostOf = (s: string) => { try { return new URL(s).host; } catch { return undefined; } };

/** Every show on an offered screen, with its address checked again here (§3.3: the viewer checks before every load). */
export function resolveShows(content: SceneContent | undefined, sceneId: string, list: ContentListResult | null,
  self: string, typed: readonly string[]): ResolvedShow[] {
  if (!content || !list || typeof content.shows !== "object" || typeof content.sources !== "object") return [];
  const offered = new Map(list.screens.map(s => [screenKey(s.instance, s.screen), s]));
  const out: ResolvedShow[] = [];
  for (const [instance, screens] of Object.entries(content.shows)) {
    if (!screens || typeof screens !== "object") continue;
    for (const [screen, show] of Object.entries(screens)) {
      const key = screenKey(instance, screen), place = offered.get(key);
      if (!place?.offered || !show || typeof show.source !== "string") continue;
      const source = content.sources[show.source];
      if (!source || typeof source !== "object") continue;
      const base = { key, instance, screen, source: show.source };
      const policy = { mode: list.mode, self, apps: list.apps, publicSites: list.publicSites };
      if (source.kind === "app") {
        const app = list.apps.find(a => a.id === source.app), item = app?.items.find(i => i.id === source.item);
        const view = typeof show.view === "string" ? show.view : "";
        const viewLabel = item?.views.find(v => v.id === view)?.label ?? view;
        const label = item?.label ?? (typeof source.label === "string" ? source.label : show.source);
        const head = { ...base, kind: "app" as const, label, view, viewLabel, app: app?.label };
        if (!app || !item) { out.push({ ...head, refused: "this app or item is not set up here" }); continue; }
        if (typeof source.run?.key !== "string" || !LIVE_PATTERNS.key.test(source.run.key)) { out.push({ ...head, refused: "no run key" }); continue; }
        const name = runName(sceneId, source.run.key), page = appPage(app, item, view, name);
        if (!page.ok) { out.push({ ...head, refused: page.why }); continue; }
        const address = frameAddress(page.href, { ...policy, app });
        const run = appRunId(item, name) ?? undefined;
        out.push(address.ok ? { ...head, href: address.href, origin: address.origin, host: hostOf(address.href), run }
          : { ...head, refused: address.why, host: hostOf(page.href) });
      } else if (source.kind === "page") {
        const url = typeof source.url === "string" ? source.url : "";
        const label = typeof source.label === "string" ? source.label : hostOf(url) ?? show.source;
        const address = frameAddress(url, { ...policy, typed: typed.includes(url) });
        out.push(address.ok ? { ...base, kind: "page", label, href: address.href, origin: address.origin, host: hostOf(address.href) }
          : { ...base, kind: "page", label, refused: address.why, host: hostOf(url) });
      }
    }
  }
  return out;
}

// ---- the state of one screen (§5.7) -----------------------------------------------------------------------------

export interface Timeouts { ready: number; load: number }
export const TIMEOUTS: Timeouts = { ready: LIVE.readyTimeoutMs, load: LIVE.loadTimeoutMs };
/** `?liveTimeouts=fast`, for the browser check on a local installation only. */
export const FAST_TIMEOUTS: Timeouts = { ready: 1_500, load: 1_500 };

/**
 * A framed screen's state: `starting` until the page shows (app: `status live`; page: `load`), then `showing`;
 * `waiting`, `ended`, `refused` from the app; `not_answering` when an app page has not said `ready` (or a plain page
 * has not loaded) in time. A late `ready` or `load` always recovers. Each method says whether anything changed.
 */
export class ScreenStatus {
  state: SeenState = "starting";
  text?: string;
  run?: string;
  ready = false;
  loaded = false;
  /** The app has said `live`, `ended` or `refused` once: from then on an out-of-sight frame may be told `rate 0`
   *  (an app may report `live` only after it has drawn, which a paused page never does). */
  settled = false;
  operable: boolean;
  private shown = false;
  constructor(readonly kind: "app" | "page", private started: number, private t: Timeouts = TIMEOUTS) {
    this.operable = kind === "page";
  }
  private set(state: SeenState, text?: string) {
    if (this.state === state && this.text === text) return false;
    this.state = state; this.text = text; return true;
  }
  /** The frame fired `load`. */
  onLoad(): boolean {
    this.loaded = true;
    if (this.kind === "page") { this.shown = true; return this.set("showing"); }
    return false;
  }
  /** `ready {operable}` from the page. */
  onReady(operable: boolean): boolean {
    const was = this.operable;
    this.ready = true; this.operable = this.kind === "page" || operable;
    if (this.state === "not_answering") return this.set(this.kind === "page" && this.loaded ? "showing" : "starting") || true;
    return was !== this.operable;
  }
  /** `status` from an app page. */
  onStatus(state: "starting" | "live" | "waiting" | "ended" | "refused", run?: string, text?: string): boolean {
    const runChanged = run !== undefined && run !== this.run;
    if (run !== undefined) this.run = run;
    if (this.kind === "page") return runChanged;
    this.ready = true;
    if (state === "live" || state === "ended" || state === "refused") this.settled = true;
    let changed: boolean;
    if (state === "live") { this.shown = true; changed = this.set("showing"); }
    else if (state === "waiting") changed = this.set(this.shown ? "waiting" : "starting");
    else if (state === "starting") changed = this.set("starting");
    else changed = this.set(state, text);
    return changed || runChanged;
  }
  /** Timeouts; call now and then. */
  tick(now: number): boolean {
    if (this.state !== "starting") return false;
    if (this.kind === "app" && !this.ready && now - this.started >= this.t.ready) return this.set("not_answering");
    if (this.kind === "page" && !this.loaded && now - this.started >= this.t.load) return this.set("not_answering");
    return false;
  }
  /** The page shows: cut the hole. */
  get hole() { return this.state === "showing" || (this.state === "waiting" && this.shown); }
}

// ---- the greeting (§3.10) ---------------------------------------------------------------------------------------

export const PROTOCOL = "live-surfaces/1";
export type LiveMessage =
  | { type: "ready"; operable: boolean }
  | { type: "status"; state: "starting" | "live" | "waiting" | "ended" | "refused"; run?: string; view?: string; text?: string }
  | { type: "leave" };
const STATUS = ["starting", "live", "waiting", "ended", "refused"] as const;
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** One line of at most 140 characters, without control or bidirectional-override characters. */
export function cleanText(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const line = s.slice(0, 1000).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  return line ? line.slice(0, 140) : undefined;
}

/** A message from a framed page, or null when it is not one Synergon understands. */
export function readMessage(data: unknown): LiveMessage | null {
  if (!plain(data) || data.protocol !== PROTOCOL) return null;
  if (data.type === "ready") return { type: "ready", operable: data.operable === true };
  if (data.type === "leave") return { type: "leave" };
  if (data.type !== "status" || !STATUS.includes(data.state as never)) return null;
  if (data.run !== undefined && (typeof data.run !== "string" || !LIVE_PATTERNS.run.test(data.run))) return null;
  if (data.view !== undefined && (typeof data.view !== "string" || !LIVE_PATTERNS.view.test(data.view))) return null;
  const text = cleanText(data.text);
  return { type: "status", state: data.state as (typeof STATUS)[number],
    ...(data.run !== undefined ? { run: data.run as string } : {}), ...(data.view !== undefined ? { view: data.view as string } : {}),
    ...(text ? { text } : {}) };
}

/** At most `limit` messages a second per frame; the rest are dropped. */
export class MessageGate {
  private times: number[] = [];
  constructor(private limit = 60, private windowMs = 1000) {}
  allow(now: number) {
    while (this.times.length && now - this.times[0]! >= this.windowMs) this.times.shift();
    if (this.times.length >= this.limit) return false;
    this.times.push(now); return true;
  }
}

/** A message event is accepted only from the frame's own window and its expected origin (checked on every message). */
export function acceptMessage(e: { source: unknown; origin: string; data: unknown }, frame: { window: unknown; origin: string },
  gate: MessageGate, now: number): LiveMessage | null {
  if (!frame.window || e.source !== frame.window || e.origin !== frame.origin) return null;
  if (!gate.allow(now)) return null;
  return readMessage(e.data);
}

// ---- this browser's choices (§5.8) -----------------------------------------------------------------------------

const KEYS = { accepted: "synergon.live.accepted", typed: "synergon.live.typed", on: "synergon.live.on" } as const;
const MAX_REMEMBERED = 200;
function readList(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v.filter(s => typeof s === "string") : []; }
  catch { return []; }
}
function addToList(key: string, value: string) {
  try {
    const list = readList(key).filter(s => s !== value);
    list.push(value);
    localStorage.setItem(key, JSON.stringify(list.slice(-MAX_REMEMBERED)));
  } catch { /* without storage the browser asks every time */ }
}
export const liveStorage = {
  /** origins whose pages this browser shows at once (the *Show* button) */
  accepted: () => readList(KEYS.accepted),
  accept: (origin: string) => addToList(KEYS.accepted, origin),
  /** addresses typed in this browser (*Web address…*), stored as the server stores them */
  typed: () => readList(KEYS.typed),
  addTyped: (href: string) => addToList(KEYS.typed, href),
  /** the Settings switch: true, false, or null when never set */
  enabled(): boolean | null {
    try { const v = localStorage.getItem(KEYS.on); return v === "1" ? true : v === "0" ? false : null; } catch { return null; }
  },
  setEnabled(on: boolean) { try { localStorage.setItem(KEYS.on, on ? "1" : "0"); } catch { /* this page only */ } },
};

/** Phones start with live content off (§5.9). */
export function isPhone() {
  try { return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches; } catch { return false; }
}

// ---- reports (§3.8) ---------------------------------------------------------------------------------------------

export type Reports = Record<string, SeenReport>;
/** The report a viewer sends: only the fields §3.8 allows. */
export function reportBody(viewer: string, screens: Reports) {
  const out: Reports = {};
  for (const [key, r] of Object.entries(screens).slice(0, LIVE.maxShows)) {
    out[key] = { state: r.state, ...(r.run && LIVE_PATTERNS.run.test(r.run) ? { run: r.run } : {}),
      ...(r.view && LIVE_PATTERNS.view.test(r.view) ? { view: r.view } : {}) };
  }
  return { viewer, screens: out };
}

/**
 * When to send: within `gap` of a change but at most once per `gap`, and again every `every` while anything is
 * reported, so the server's reports stay younger than its 60 s limit.
 */
export class ReportSchedule {
  private last = -Infinity;
  private sent = "";
  private current: Reports = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private send: (screens: Reports) => boolean, private gap: number = LIVE.seenEveryMs, private every = 30_000,
    private now = () => Date.now()) {}
  update(screens: Reports) { this.current = screens; this.wake(); }
  /** Send what is due now, and set the timer for the next. */
  wake() {
    clearTimeout(this.timer); this.timer = undefined;
    const key = JSON.stringify(this.current), now = this.now(), changed = key !== this.sent;
    const anything = Object.keys(this.current).length > 0;
    if (!changed && !anything) return;
    const due = changed ? this.last + this.gap : this.last + this.every;
    if (now >= due) {
      if (this.send(this.current)) { this.sent = key; this.last = now; }
      else { this.timer = setTimeout(() => this.wake(), this.gap); return; }
      if (!anything) return;
      this.timer = setTimeout(() => this.wake(), this.every);
    } else this.timer = setTimeout(() => this.wake(), due - now);
  }
  /** Send the current report again as soon as allowed (a new viewer token). */
  resend() { this.sent = "\u0000"; this.wake(); }
  stop() { clearTimeout(this.timer); this.timer = undefined; }
}
