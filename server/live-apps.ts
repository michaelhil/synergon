// The installation's apps for live screen content and the sites allowed on the public site (§3.5 of the step-1 plan):
// the committed server/live-apps.json, deployed with Synergon and readable without network. Synergon never calls an
// app; the item lists are refreshed by a local tool (tools/live-apps.ts). A local installation may replace the apps
// with SYNERGON_APPS=<path to a JSON array of LiveApp> (for a local Leitbild on a loopback address); tests pass them.
import { readFileSync } from "node:fs";
import committed from "./live-apps.json";
import { appPage, LIVE, LIVE_PATTERNS, templateOk, type LiveApp, type LiveApps, type LiveItem } from "../shared/room-content.ts";

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const SAMPLE_RUN = "a".repeat(LIVE.nameLength);

function label(x: unknown, where: string): string {
  if (typeof x !== "string" || !x.trim() || x.length > LIVE.maxLabel || /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(x))
    throw new Error(where + ": a label is one line of 1–" + LIVE.maxLabel + " characters");
  return x;
}
function only(x: Record<string, unknown>, where: string, required: string[], optional: string[] = []) {
  for (const k of required) if (!(k in x)) throw new Error(where + ": missing " + k);
  for (const k of Object.keys(x)) if (!required.includes(k) && !optional.includes(k)) throw new Error(where + ": unknown field " + k);
}
/** An exact origin: https, or (not on the public site) http on a loopback host; nothing after the port. */
function origin(x: unknown, where: string, isPublic: boolean): string {
  let u: URL;
  try { u = new URL(String(x)); } catch { throw new Error(where + ": not an address"); }
  const loopback = u.protocol === "http:" && LOOPBACK.includes(u.hostname);
  if (u.protocol !== "https:" && !(loopback && !isPublic)) throw new Error(where + ": " + x + " is not https" + (isPublic ? "" : " or a loopback http address"));
  if (u.origin !== x) throw new Error(where + ": " + x + " is not an exact origin (write it as " + u.origin + ")");
  return u.origin;
}

/** One app item list (`items` of a LiveApp), as the refresh tool also reads it from an app's `list` answer. */
export function checkItems(items: unknown, app: Pick<LiveApp, "id" | "label" | "origin">, where = "apps." + app.id + ".items"): LiveItem[] {
  if (!Array.isArray(items) || !items.length) throw new Error(where + ": a non-empty list");
  const seen = new Set<string>();
  return items.map((it, n): LiveItem => {
    const at = where + "[" + n + "]";
    if (!plain(it)) throw new Error(at + ": an object");
    only(it, at, ["id", "label", "page", "views"]);
    // An item id becomes the scene's source id, so it follows the source pattern.
    if (typeof it.id !== "string" || !LIVE_PATTERNS.source.test(it.id)) throw new Error(at + ".id: 1–32 lower-case letters, digits or '-'");
    if (seen.has(it.id)) throw new Error(at + ".id: " + it.id + " twice");
    seen.add(it.id);
    if (typeof it.page !== "string" || !templateOk(it.page)) throw new Error(at + ".page: a template relative to the app's origin, without a leading //, \\ or @");
    if (!Array.isArray(it.views) || !it.views.length) throw new Error(at + ".views: a non-empty list");
    const views = new Set<string>();
    const item: LiveItem = { id: it.id, label: label(it.label, at + ".label"), page: it.page, views: it.views.map((v, k) => {
      const vat = at + ".views[" + k + "]";
      if (!plain(v)) throw new Error(vat + ": an object");
      only(v, vat, ["id", "label"]);
      if (typeof v.id !== "string" || !LIVE_PATTERNS.view.test(v.id)) throw new Error(vat + ".id: 1–64 letters, digits or . _ : -");
      if (views.has(v.id)) throw new Error(vat + ".id: " + v.id + " twice");
      views.add(v.id);
      return { id: v.id, label: label(v.label, vat + ".label") };
    }) };
    const page = appPage({ ...app, items: [item] }, item, item.views[0]!.id, SAMPLE_RUN);
    if (!page.ok) throw new Error(at + ".page: " + page.why);
    return item;
  });
}

/** One app entry. */
export function checkApp(a: unknown, where: string, isPublic: boolean): LiveApp {
  if (!plain(a)) throw new Error(where + ": an object");
  only(a, where, ["id", "label", "origin", "items"], ["list"]);
  if (typeof a.id !== "string" || !LIVE_PATTERNS.source.test(a.id)) throw new Error(where + ".id: 1–32 lower-case letters, digits or '-'");
  const head = { id: a.id, label: label(a.label, where + ".label"), origin: origin(a.origin, where + ".origin", isPublic) };
  if (a.list !== undefined && (typeof a.list !== "string" || !a.list.startsWith("/") || !templateOk(a.list)))
    throw new Error(where + ".list: a path on the app's origin");
  return { ...head, ...(a.list !== undefined ? { list: a.list as string } : {}), items: checkItems(a.items, head, where + ".items") };
}

/** The whole settings block, strictly. Throws an Error naming the first problem. */
export function checkLiveApps(x: unknown, isPublic: boolean): LiveApps {
  if (!plain(x)) throw new Error("live apps: an object");
  only(x, "live apps", ["format", "apps", "publicSites"]);
  if (x.format !== "live-surfaces/1") throw new Error("live apps: format must be live-surfaces/1");
  if (!Array.isArray(x.apps)) throw new Error("live apps: apps must be a list");
  const apps = x.apps.map((a, n) => checkApp(a, "apps[" + n + "]", isPublic));
  if (new Set(apps.map(a => a.id)).size !== apps.length) throw new Error("live apps: two apps with one id");
  if (!Array.isArray(x.publicSites)) throw new Error("live apps: publicSites must be a list");
  const publicSites = x.publicSites.map((s, n) => {
    const o = origin(s, "publicSites[" + n + "]", true);
    if (apps.some(a => a.origin === o)) throw new Error("publicSites[" + n + "]: " + o + " is an app's origin");
    return o;
  });
  return { format: "live-surfaces/1", apps, publicSites };
}

/**
 * The settings of this installation: the committed file (or `file`), with `apps` replacing its apps (tests), or else
 * SYNERGON_APPS replacing them on a local installation. `public` (the public server) refuses loopback origins and
 * ignores SYNERGON_APPS. Throws at start-up on a bad file.
 */
export function loadLiveApps(o: { file?: string; apps?: LiveApp[]; public?: boolean } = {}): LiveApps {
  const isPublic = o.public === true;
  const base: unknown = o.file ? JSON.parse(readFileSync(o.file, "utf8")) : structuredClone(committed);
  let apps: unknown = plain(base) ? base.apps : undefined;
  if (o.apps) apps = o.apps;
  else if (!isPublic && process.env.SYNERGON_APPS) {
    try { apps = JSON.parse(readFileSync(process.env.SYNERGON_APPS, "utf8")); }
    catch (e) { throw new Error("SYNERGON_APPS=" + process.env.SYNERGON_APPS + ": " + (e instanceof Error ? e.message : String(e))); }
    if (!Array.isArray(apps)) throw new Error("SYNERGON_APPS names a file that must hold a JSON array of apps");
  }
  return checkLiveApps(plain(base) ? { ...base, apps } : base, isPublic);
}

/** The page's frame policy for the public release (§3.12): the app origins and allowed sites, sorted, nothing else
 *  (never default-src or child-src). tools/room-dist.ts writes it right after <head>; tools/deploy.ts checks it live. */
export function frameSrcMeta(apps: LiveApps = loadLiveApps({ public: true })): string {
  const origins = [...new Set([...apps.apps.map(a => a.origin), ...apps.publicSites])].sort();
  return '<meta http-equiv="Content-Security-Policy" content="frame-src ' + origins.join(" ") + '">';
}
