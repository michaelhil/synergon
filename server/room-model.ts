import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { check, Refusal } from "../shared/commands/schema.ts";
import { AIM_LIMBS, type PersonAims } from "../shared/person-aims.ts";
import { limitViolation, type JointValue } from "../shared/pose.ts";
import { doorClearance, footprint } from "../shared/room-geometry.ts";
import { operatorFields,type OperatorPatch } from "../shared/room-person.ts";
import { roomCommands } from "../shared/room-commands.ts";
import { ROOM_SCHEMA, roomPoint, effectiveLighting, LIGHTING_LIMITS, type RoomLighting, type RoomCatalog, type RoomDimensions, type RoomInstance,
  type RoomPerson, type RoomPoint, type RoomRef, type RoomRelease, type RoomScene } from "../shared/room.ts";
import { appRunId, contentShapeOk, distribute, embeddable, frameAddress, LIVE, orderScreens, screenWhy, validateContent,
  type ContentContext, type ContentSource, type LiveApp, type LiveItem, type SceneContent, type SeenReport, type Show, type SurfaceInfo } from "../shared/room-content.ts";
import { newKey, runName } from "../shared/run-name.ts";
import { loadLiveApps } from "./live-apps.ts";
import { cleanName } from "./names.ts";

export const ROOM_HISTORY = 200;
export class RoomError extends Error {
  constructor(public code: string, message: string, public hint: string, public candidates?: unknown[]) { super(message); }
  wire() { return { code: this.code, message: this.message, hint: this.hint, ...(this.candidates ? { candidates: this.candidates } : {}) }; }
}
const invalid = (message: string) => new RoomError("invalid_args", message, "Use discover or the command's argument schema.");
type PoseGroup = {instance:string; pose:RoomInstance["pose"]}[];
type Prior = RoomPerson | RoomInstance | RoomDimensions | RoomLighting | SceneContent | PoseGroup | null;
interface Change { version: number; command: string; key: string; keys?:string[]; before: Prior; index?: number; undoes?: number }
export interface RoomRecord { scene: RoomScene; history: Change[]; historyStart?: number }
export interface RoomWire { id: string; args?: unknown; expectedVersion?: unknown }
export function newRoom(id: string, name: string, catalog: RoomCatalog, template: "demo" | "empty" = "empty"): RoomRecord {
  const scene: RoomScene = { schema: ROOM_SCHEMA, id, name, version: 0,
    room: { width: 8, depth: 6, height: 2.8, door: { offset: 1, width: 1.2 }, window: { offset: 3, width: 2 } },
    instances: [], person: null };
  if (template === "demo") {
    const station = catalog.releases.find(r => r.kind === "station");
    const display = catalog.releases.find(r => r.variant === "freestanding" && r.version === "1");
    const adjustableWall = catalog.releases.find(r => r.variant === "wall" && r.joints.some(j => j.id === "J_mount_height"));
    const wall = adjustableWall ?? catalog.releases.find(r => r.variant === "wall");
    if (!station || !display || !wall) throw new RoomError("missing_release", "The room demo needs a station, freestanding display and wall display.", "Create an empty room or install the missing releases.");
    scene.room.window = { offset: 0.65, width: 2 };
    const center = scene.room.width / 2;
    // The station monitors sit below the shared wall screen's sightlines from both seats.
    const stationPose: RoomInstance["pose"] = station.joints.some(j => j.id === "J_mon_height") ? { J_mon_height: -0.075 } : {};
    const wallPose: RoomInstance["pose"] = adjustableWall ? { J_mount_height: 0.54 } : {};
    for (const [id, label, release, x, y, yaw, pose] of [
      ["station-a", "Station A", station.id, center - 1.35, 3.6, 90, stationPose],
      ["station-b", "Station B", station.id, center + 1.35, 3.6, 90, stationPose],
      ["display-a", "Freestanding display", display.id, 7.25, 4.2, 23, {}],
      ["wall-display", "Wall display", wall.id, center, scene.room.depth - wall.footprint.max[0], 90, wallPose],
    ] as const) scene.instances.push({ id, label, release, x, y, yaw, pose: { ...pose } });
    // An operator desk, when the library has one: back to the east wall, clear of the door and of both stations.
    const desk = catalog.releases.find(r => r.kind === "desk");
    if (desk) scene.instances.push({ id: "desk-a", label: "Operator desk", release: desk.id, x: 6.9, y: 1.4, yaw: 0, pose: {} });
    if (station.seat && catalog.defaultPerson) scene.person = { host: "station-a", state: structuredClone(catalog.defaultPerson(scene.instances[0])) };
  }
  return { scene, history: [] };
}

function validPose(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every(v => Array.isArray(v) ? v.length === 3 && v.every(Number.isFinite) : Number.isFinite(v));
}

function validHistoryEntry(entry: Change, version: number): boolean {
  if (!entry || entry.version !== version || typeof entry.key !== "string" || !("before" in entry)) return false;
  if (entry.key === "poses") {
    const {before, keys} = entry;
    return Array.isArray(before) && Array.isArray(keys) && before.length === keys.length &&
      new Set(keys).size === keys.length && before.every((row, n) =>
        row && typeof row.instance === "string" && keys[n] === instanceKey(row.instance) && validPose(row.pose));
  }
  if (entry.key === "content") return entry.keys === undefined && (entry.before === null || (typeof entry.before === "object" && !Array.isArray(entry.before)));
  if (entry.key === "room" || entry.key === "person" || entry.key === "lighting" || entry.key.startsWith("instance/")) return entry.keys === undefined;
  // A key of a newer release: kept, so the history stays contiguous, but never undoable (undoable() skips it).
  return entry.keys === undefined || (Array.isArray(entry.keys) && entry.keys.every(k => typeof k === "string"));
}
/** The history keys this release can undo. Entries under any other key are kept but never offered. */
const knownKey = (key: string) => ["room", "person", "lighting", "content", "poses"].includes(key) || key.startsWith("instance/");

export function parseRoom(text: string): RoomRecord {
  const r: RoomRecord = JSON.parse(text);
  if (r?.scene?.schema !== ROOM_SCHEMA) throw new RoomError("unsupported_format", "Unsupported stored scene format. Expected " + ROOM_SCHEMA + ".", "Open a room created with this installation's room editor.");
  const d = r.scene;
  const malformed = () => new RoomError("invalid_scene", "The stored room or its history is incomplete.", "Recover a complete copy of this scene.");
  if (typeof d.id !== "string" || typeof d.name !== "string" || !d.room?.door || !d.room.window ||
    !Array.isArray(d.instances) || !Number.isSafeInteger(d.version) || d.version < 0 || !Array.isArray(r.history) ||
    (!Number.isSafeInteger(r.historyStart ?? 0) || (r.historyStart ?? 0) < 0 || (r.historyStart ?? 0) > d.version) ||
    r.history.length !== Math.min(d.version - (r.historyStart ?? 0), ROOM_HISTORY) ||
    r.history.some((entry, n) => !validHistoryEntry(entry, d.version - r.history.length + n + 1)))
    throw malformed();
  try { validateRoom(d.room); } catch { throw malformed(); }
  const ids = new Set<string>();
  for (const i of d.instances) {
    if (!i || typeof i.id !== "string" || ids.has(i.id) || typeof i.release !== "string" || typeof i.label !== "string" ||
      ![i.x, i.y, i.yaw].every(Number.isFinite) || !validPose(i.pose))
      throw malformed();
    ids.add(i.id);
  }
  if (d.person !== null && (!d.person || !ids.has(d.person.host) || !d.person.state?.body || typeof d.person.state.posture !== "string")) throw malformed();
  if (d.lighting !== undefined) try { validateLighting(d.lighting, d.room.height); } catch { throw malformed(); }
  // A malformed `content` block (contentShapeOk false) is kept as it is: the scene opens and its screens wait.
  return r;
}

function releaseFor(catalog: RoomCatalog, pin: string) {
  const r = catalog.releases.find(r => r.id === pin);
  if (!r) throw new RoomError("missing_release", "Exact release is not installed: " + pin, "Read the installed pins with discover. Supply the exact pin.");
  return r;
}
const fold = (s: string) => s.toLowerCase().replace(/[-_]+/g, " ").trim();
const instanceKey = (id: string) => "instance/" + id;
function describe(i: RoomInstance) { return { id: i.id, label: i.label, release: i.release }; }
function getInstance(scene: RoomScene, catalog: RoomCatalog, name: string) {
  const exact = scene.instances.find(i => i.id === name);
  if (exact) return exact;
  const q = fold(name);
  let found = scene.instances.filter(i => fold(i.label) === q);
  if (!found.length) found = scene.instances.filter(i => {
    const r = releaseFor(catalog, i.release);
    return [i.id, i.label, r.asset, r.label, r.kind].some(s => fold(s).includes(q));
  });
  if (found.length === 1) return found[0];
  if (found.length > 1) throw new RoomError("ambiguous", "More than one instance matches " + name + ".", "Choose an instance by its exact ID.", found.map(describe));
  throw new RoomError("unknown_instance", "No instance matches " + name + ".", "Use discover to find its scene-local ID.");
}
const floor = { id: "floor", label: "Floor anchor", kind: "datum" as const };
const members = (r: RoomRelease) => [floor, ...r.members.filter(m => m.id !== floor.id)];
function memberOf(r: RoomRelease, name: string, joints = false) {
  const items = joints ? r.joints.map(j => ({ id: j.id, label: j.label ?? j.id })) : members(r);
  const exact = items.find(m => m.id === name);
  if (exact) return exact.id;
  const q = fold(name), hits = items.filter(m => fold(m.label).includes(q) || fold(m.id).includes(q));
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) throw new RoomError("ambiguous", "Several members match " + name + ".", "Choose the exact member ID within this instance.", hits);
  throw new RoomError("unknown_member", "No " + (joints ? "joint" : "member") + " matches " + name + " on " + r.label + ".", "Use discover with instance to list local IDs.");
}

function problem(r: RoomRelease, id: string, value: JointValue): string | null {
  const j = r.joints.find(j => j.id === id);
  if (!j) return "missing joint";
  if (j.locked && !j.assumed) return "locked joint";
  if (j.type === "ball" ? !Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite) : !Number.isFinite(value))
    return "expected " + (j.type === "ball" ? "three finite angles" : "a finite number");
  return limitViolation({ ...j, axis: null }, value);
}
export function validateInstance(scene: RoomScene, catalog: RoomCatalog, i: RoomInstance) {
  const r = releaseFor(catalog, i.release);
  const problems = Object.entries(i.pose).map(([k, v]) => {
    const why = problem(r, k, v);
    return why ? k + " (" + why + ")" : null;
  }).filter(Boolean);
  const occupied = scene.person?.host === i.id;
  if (occupied && !r.seat) problems.push("occupied seat on " + i.id);
  if (occupied && scene.person?.state.aims) {
    const a = scene.person.state.aims;
    const targets = [a.look, ...AIM_LIMBS.map(limb => {
      const aim = a[limb];
      return aim && "target" in aim ? aim.target : undefined;
    })];
    for (const t of targets) if (t && !r.members.some(m => m.id === t)) problems.push("person aim at " + t);
  }
  if (problems.length) throw new RoomError("incompatible", problems.join(", "), "Clear the listed pose values with pose.set value null, or clear/rebind the seated person or their named aims with person.set.");
}
const COLOUR = /^#[0-9a-fA-F]{6}$/;
export function validateLighting(l: RoomLighting, roomHeight: number) {
  const { count, intensity, spread, cct, height } = LIGHTING_LIMITS, c = l.ceiling;
  const within = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  const bool = (v: unknown) => typeof v === "boolean", colour = (v: unknown) => v === null || (typeof v === "string" && COLOUR.test(v));
  if (!c || !bool(c.on) || ![c.countX, c.countY].every(n => Number.isInteger(n) && within(n, count)))
    throw invalid("Ceiling lights: countX and countY are whole numbers from " + count[0] + " to " + count[1] + ".");
  if (c.height !== null && !within(c.height, [height, roomHeight])) throw invalid("Ceiling light height is between " + height + " m and the room height (" + roomHeight + " m), or null.");
  if (!within(c.intensity, intensity) || !within(c.spread, spread) || !within(c.cct, cct) || !colour(c.colour))
    throw invalid("Ceiling lights: intensity 0–3, spread 0–1, cct 2200–8000 K, colour #rrggbb or null.");
  if (!l.screens || !bool(l.screens.on) || !within(l.screens.intensity, intensity)) throw invalid("Screens: on and intensity 0–3.");
  if (!l.lamps || !bool(l.lamps.on) || !within(l.lamps.intensity, intensity) || !colour(l.lamps.colour)) throw invalid("Lamps: on, intensity 0–3, colour #rrggbb or null.");
  for (const o of Object.values(l.instances ?? {})) {
    if (!o || (o.on !== undefined && !bool(o.on)) || (o.intensity !== undefined && !within(o.intensity, intensity)) || (o.colour !== undefined && !colour(o.colour)))
      throw invalid("An asset's lamps: on, intensity 0–3, colour #rrggbb or null.");
  }
}
function validateRoom(r: RoomDimensions) {
  if ([r.width, r.depth, r.height].some(n => !(n > 0) || !Number.isFinite(n))) throw invalid("Room dimensions must be positive and finite.");
  for (const key of ["door", "window"] as const) {
    const o = r[key];
    if (!(Number.isFinite(o.width) && Number.isFinite(o.offset) && o.width > 0 && o.offset >= 0 && o.offset + o.width <= r.width)) throw invalid("The " + key + " must fit within the wall width.");
  }
}
function located(scene: RoomScene, c: RoomCatalog, ref: RoomRef) {
  const i = getInstance(scene, c, ref.instance), r = releaseFor(c, i.release), member = memberOf(r, ref.member);
  const local: RoomPoint = member === "floor" ? [0, 0, 0] : c.point(i, member);
  return { instance: i.id, member, point: roomPoint(i, local) };
}
type Located = ReturnType<typeof located>;
function distance(from: Located, to: Located) {
  return { from, to, metres: Math.hypot(...from.point.map((n, k) => to.point[k] - n)) };
}
function discover(scene: RoomScene, c: RoomCatalog, args: { query?: string; instance?: string }) {
  const q = fold(args.query ?? ""), matches = (...names: string[]) => names.some(s => fold(s).includes(q));
  const items = args.instance ? [getInstance(scene, c, args.instance)] : scene.instances;
  const instances = items.flatMap(i => {
    const r = releaseFor(c, i.release);
    const selectedMembers = args.instance || q ? members(r).filter(m => matches(m.id, m.label)).map(m => ({ ...m, instance: i.id })) : [];
    if (!args.instance && q && !matches(i.id, i.label, r.asset, r.label, r.kind) && !selectedMembers.length) return [];
    const placement={x:i.x,y:i.y,yaw:i.yaw};
    const base={...describe(i),kind:r.kind,placement};
    if (!args.instance && !q) return [base];
    const controls=new Set(selectedMembers.flatMap(m=>"controls" in m ? m.controls ?? [] : []));
    const matched=r.joints.filter(j=>matches(j.id,j.label ?? "") || controls.has(j.id));
    const axes=args.instance && matched.length ? c.jointAxesInRoom?.(i,matched) : undefined;
    const joints=matched.map(j=>({...j,value:i.pose[j.id] ?? j.neutral,...(axes?.[j.id] ? {axisRoom:axes[j.id]} : {})}));
    return [{...base,frame:r.frame,footprintRoom:footprint(i,r).vertices,members:selectedMembers,joints}];
  });
  const releases=c.releases.filter(r=>!q || matches(r.id,r.asset,r.label,r.kind))
    .map(({id,asset,label,version,kind,variant,footprint})=>({id,asset,label,version,kind,variant,...(q || args.instance ? {footprint} : {})}));
  return {version:scene.version,...(!args.instance ? {room:scene.room} : {}),instances,releases,commands:roomCommands.map(s=>s.id)};
}

type AimPatch = { [K in keyof PersonAims]?: PersonAims[K] | null };
function editAims(person: RoomPerson, patch: AimPatch, release: RoomRelease) {
  const aims = person.state.aims ?? {};
  const target = (name: string) => {
    const id = memberOf(release, name);
    if (id === "floor" || release.joints.some(j => j.id === id)) throw invalid("A person aim needs a part or datum on the host.");
    return id;
  };
  if (patch.look === null) delete aims.look;
  else if (patch.look !== undefined) aims.look = target(patch.look);
  for (const k of AIM_LIMBS) {
    const aim = patch[k];
    if (aim === undefined) continue;
    if (aim === null) delete aims[k];
    else Object.assign(aims, { [k]: "target" in aim ? { ...aim, target: target(aim.target) } : aim });
  }
  if (Object.keys(aims).length) person.state.aims = aims;
  else delete person.state.aims;
}

function undoable(record: RoomRecord) {
  const claimed = new Set<string>(), undone = new Set<number>(), available: Change[] = [];
  for (const e of [...record.history].reverse()) {
    if (!knownKey(e.key)) continue;
    if (e.undoes !== undefined) { undone.add(e.undoes); continue; }
    if (undone.has(e.version)) continue;
    const keys=e.keys ?? [e.key];
    if (!keys.some(k=>claimed.has(k))) available.push(e);
    keys.forEach(k=>claimed.add(k));
  }
  return available;
}
function guard(record: RoomRecord, expected: unknown, keys: string[]) {
  if (expected === undefined) return;
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 || expected > record.scene.version) throw invalid("expectedVersion must be a known non-negative scene version.");
  if (expected < record.scene.version - record.history.length || record.history.some(e => e.version > expected && (e.keys ?? [e.key]).some(k=>keys.includes(k))))
    throw new RoomError("stale", "The selected object changed since version " + expected + ", or that version is outside retained history.", "Read state and repeat the intended change at its current version.");
}

// ---- live screen content (content.*) ---------------------------------------------------------------------------

/** What the open viewers of one scene report, by their private stream token (server memory only, never stored).
 *  `name` is the token's public alias shown in content.list (the token itself is never shown). */
export type SeenStore = Map<string, { reports: Record<string, SeenReport>; at: number; name: string }>;
export interface ContentCtx { content: ContentContext; seen: SeenStore; publicExample: boolean }
let defaultCtx: ContentCtx | undefined;
/** Without a context (tests, tools): the committed settings, a local installation, no viewers. */
const fallbackCtx = () => defaultCtx ??= { content: { apps: loadLiveApps(), mode: "local", self: "http://127.0.0.1" }, seen: new Map(), publicExample: false };

const EDITS = new Set(["content.show", "content.move", "content.clear", "content.restart", "content.set"]);
const plainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const contentHint = "Read content.list for the apps, items, views, sources and offered screens.";
/** The scene's block as commands edit it: a malformed stored block counts as empty, malformed shows are dropped,
 *  sources of a kind this release does not know are kept as they are. */
function editable(scene: RoomScene): SceneContent {
  const c: SceneContent = { sources: {}, shows: {} };
  if (!contentShapeOk(scene.content)) return c;
  const stored = structuredClone(scene.content!) as unknown as { sources: Record<string, unknown>; shows: Record<string, unknown> };
  for (const [id, s] of Object.entries(stored.sources)) if (plainObject(s)) c.sources[id] = s as unknown as ContentSource;
  for (const [instance, screens] of Object.entries(stored.shows)) {
    if (!plainObject(screens)) continue;
    for (const [screen, show] of Object.entries(screens))
      if (plainObject(show) && typeof show.source === "string") (c.shows[instance] ??= {})[screen] = show as unknown as Show;
  }
  return c;
}
const readable = (scene: RoomScene): SceneContent => contentShapeOk(scene.content) ? editable(scene) : { sources: {}, shows: {} };
function allShows(c: SceneContent) {
  return Object.entries(c.shows).flatMap(([instance, screens]) => Object.entries(screens).map(([screen, show]) => ({ instance, screen, show })));
}
/** Removes the sources no show uses; returns their ids. */
function pruneSources(c: SceneContent) {
  const used = new Set(allShows(c).map(s => s.show.source));
  const removed = Object.keys(c.sources).filter(id => !used.has(id));
  for (const id of removed) delete c.sources[id];
  return removed;
}
function store(draft: RoomScene, c: SceneContent) {
  for (const [instance, screens] of Object.entries(c.shows)) if (!Object.keys(screens).length) delete c.shows[instance];
  if (Object.keys(c.sources).length > LIVE.maxSources) throw new RoomError("too_many", "A scene holds at most " + LIVE.maxSources + " content sources.", "Clear content you no longer need with content.clear.");
  if (allShows(c).length > LIVE.maxShows) throw new RoomError("too_many", "A scene holds at most " + LIVE.maxShows + " shows.", "Clear content you no longer need with content.clear.");
  if (!contentShapeOk(c)) throw new RoomError("too_many", "The scene's content block would exceed " + LIVE.maxContentBytes + " bytes.", "Clear content you no longer need with content.clear.");
  if (!Object.keys(c.sources).length && !Object.keys(c.shows).length) delete draft.content;
  else draft.content = c;
}
function itemOf(ctx: ContentCtx, s: ContentSource | undefined): { app: LiveApp; item: LiveItem } | null {
  if (!s || s.kind !== "app") return null;
  const app = ctx.content.apps.apps.find(a => a.id === s.app), item = app?.items.find(i => i.id === s.item);
  return app && item ? { app, item } : null;
}
/** The app-side run id of a source (§3.6), or null (a page, or an item this installation no longer offers). */
function runIdOf(scene: RoomScene, ctx: ContentCtx, s: ContentSource | undefined) {
  const found = itemOf(ctx, s);
  return found && s?.kind === "app" && typeof s.run?.key === "string" ? appRunId(found.item, runName(scene.id, s.run.key)) : null;
}
const surfacesOf = (catalog: RoomCatalog, i: RoomInstance): SurfaceInfo[] => catalog.surfaces?.(i) ?? [];
const screenMembers = (r: RoomRelease) => r.members.filter(m => m.id.startsWith("S_"));
/** A screen of one placed asset: its S_ members only (exact id, else a unique label or id match). */
function screenOf(i: RoomInstance, r: RoomRelease, name: string) {
  const items = screenMembers(r).map(m => ({ id: m.id, label: m.label.replace(/\s*:\s*lit area$/i, "") }));
  const exact = items.find(m => m.id === name);
  if (exact) return exact.id;
  const q = fold(name), hits = items.filter(m => fold(m.label) === q);
  const near = hits.length ? hits : items.filter(m => fold(m.label).includes(q) || fold(m.id).includes(q));
  if (near.length === 1) return near[0].id;
  if (near.length > 1) throw new RoomError("ambiguous", "Several screens of " + i.label + " match " + name + ".", "Choose the exact S_ id from content.list.", near);
  throw new RoomError("unknown_screen", "No screen of " + i.label + " matches " + name + ".", items.length ? "Read content.list {\"instance\": \"" + i.id + "\"} for its screens." : i.label + " has no screens.");
}
function notOffered(i: RoomInstance, screen: string, why: string) {
  return new RoomError("not_offered", screen + " on " + i.label + " cannot show content: " + why + ".", "Choose a flat screen that faces the operator; content.list says which screens are offered.");
}
/** A named screen that can show content, or a refusal with its reason. */
function offeredScreen(scene: RoomScene, catalog: RoomCatalog, ref: { instance: string; screen: string }) {
  const i = getInstance(scene, catalog, ref.instance), r = releaseFor(catalog, i.release), screen = screenOf(i, r, ref.screen);
  const surface = surfacesOf(catalog, i).find(s => s.screen === screen);
  const why = surface ? screenWhy(surface) : "not a screen with its own geometry";
  if (why) throw notOffered(i, screen, why);
  return { instance: i, screen };
}
/** Shows that point at an instance or S_ member the scene no longer has (they wait and come back with Undo). */
function waitingShows(scene: RoomScene, catalog: RoomCatalog, c: SceneContent) {
  return allShows(c).filter(({ instance, screen }) => {
    const i = scene.instances.find(x => x.id === instance), r = i && catalog.releases.find(x => x.id === i.release);
    return !r || !screenMembers(r).some(m => m.id === screen);
  }).map(({ instance, screen, show }) => ({ instance, screen, source: show.source }));
}
const round = (n: number) => Math.round(n * 1000) / 1000;

function contentList(scene: RoomScene, catalog: RoomCatalog, ctx: ContentCtx, instance?: string) {
  const c = readable(scene), now = Date.now();
  let items = scene.instances, only: string | undefined;
  if (instance !== undefined) {
    // A removed instance's id still answers with its waiting shows.
    if (c.shows[instance] && !scene.instances.some(i => i.id === instance)) { items = []; only = instance; }
    else { const i = getInstance(scene, catalog, instance); items = [i]; only = i.id; }
  }
  const fresh = [...ctx.seen.values()].filter(v => now - v.at < LIVE.seenTtlMs);
  const uses = (id: string) => allShows(c).filter(s => s.show.source === id).length;
  const screens = items.flatMap(i => surfacesOf(catalog, i).map(s => {
    const why = screenWhy(s), show = c.shows[i.id]?.[s.screen], key = i.id + "/" + s.screen;
    return { instance: i.id, screen: s.screen, label: s.label, size: s.size.map(round), flat: s.flat,
      facing: s.facing[2] > LIVE.facingUpLimit ? "up" : "operator", offered: !why, ...(why ? { why } : {}),
      shows: show ? { source: show.source, ...(show.view !== undefined ? { view: show.view } : {}) } : null,
      seen: fresh.filter(v => v.reports[key]).map(v => ({ viewer: v.name, ...v.reports[key], at: new Date(v.at).toISOString().replace(/\.\d{3}Z$/, "Z") })) };
  }));
  const sources = Object.entries(c.sources).map(([id, s]) => {
    const n = uses(id);
    if (s.kind === "app") return { id, kind: s.kind, app: s.app, item: s.item, label: s.label, run: runIdOf(scene, ctx, s), screens: n };
    if (s.kind === "page") return { id, kind: s.kind, url: s.url, label: s.label, screens: n };
    return { id, kind: String((s as { kind?: unknown }).kind), label: String((s as { label?: unknown }).label ?? id), screens: n };
  });
  const waiting = waitingShows(scene, catalog, c).filter(w => only === undefined || w.instance === only);
  const { apps, publicSites } = ctx.content.apps;
  return { version: scene.version, mode: ctx.content.mode, viewers: ctx.seen.size,
    apps: apps.map(({ id, label, origin, items }) => ({ id, label, origin, items })), publicSites, sources, screens, waiting };
}

type ContentArgs = { instance?: string; screen?: string; item?: string; app?: string; url?: string; source?: string; view?: string;
  from: { instance: string; screen: string }; to: { instance: string; screen: string }; content: unknown };

/** The content edits. Returns the reply; the caller records draft.content against scene.content under key "content". */
function contentEdit(draft: RoomScene, catalog: RoomCatalog, wire: RoomWire, ctx: ContentCtx): unknown {
  const a = (wire.args ?? {}) as ContentArgs, c = editable(draft);
  const unknownSource = (id: string) => new RoomError("unknown_source", "The scene has no content source " + id + ".", contentHint);
  switch (wire.id) {
    case "content.show": {
      if ([a.item, a.url, a.source].filter(v => v !== undefined).length !== 1) throw invalid("Give one of item, url or source.");
      if (a.view !== undefined && a.screen === undefined) throw invalid("A view goes with a screen; without screen an item's views are distributed over the asset's screens.");
      const i = getInstance(draft, catalog, a.instance!), screens = surfacesOf(catalog, i);
      const target = a.screen !== undefined ? offeredScreen(draft, catalog, { instance: i.id, screen: a.screen }).screen : undefined;
      if (!orderScreens(screens).length)
        throw new RoomError("no_screens", i.label + " has no screen that can show content (only flat screens facing the operator can in this release).", "Choose another asset; content.list lists the offered screens.");
      let id: string;
      if (a.item !== undefined) {
        const apps = ctx.content.apps.apps.filter(x => a.app === undefined || x.id === a.app);
        if (a.app !== undefined && !apps.length) throw new RoomError("unknown_app", "This installation has no app " + a.app + ".", contentHint);
        const found = apps.flatMap(app => app.items.filter(it => it.id === a.item).map(item => ({ app, item })));
        if (found.length > 1) throw new RoomError("ambiguous", "Several apps offer the item " + a.item + ".", "Name the app.", found.map(f => ({ app: f.app.id, item: f.item.id, label: f.item.label })));
        if (!found.length) throw new RoomError("unknown_item", "No app of this installation offers the item " + a.item + ".", contentHint,
          ctx.content.apps.apps.flatMap(app => app.items.map(it => ({ app: app.id, item: it.id, label: it.label }))));
        const { app, item } = found[0];
        id = Object.keys(c.sources).find(k => { const s = c.sources[k]; return s.kind === "app" && s.app === app.id && s.item === item.id; }) ?? "";
        if (!id) {
          id = item.id;
          for (let n = 2; c.sources[id]; n++) id = item.id.slice(0, 32 - String(n).length - 1) + "-" + n;
          c.sources[id] = { kind: "app", app: app.id, item: item.id, label: item.label, run: { key: newKey() } };
        }
      } else if (a.url !== undefined) {
        const { mode, self, apps } = ctx.content;
        const checked = frameAddress(embeddable(a.url), { mode, self, apps: apps.apps, publicSites: apps.publicSites, typed: false });
        if (!checked.ok) throw new RoomError("address_refused", "The address is refused: " + checked.why + ".", mode === "public"
          ? "On the public site only these sites are allowed: " + apps.publicSites.join(", ") + " (YouTube and Vimeo links become their players)."
          : "Use a complete https address (YouTube and Vimeo links become their players).");
        id = Object.keys(c.sources).find(k => { const s = c.sources[k]; return s.kind === "page" && s.url === checked.href; }) ?? "";
        if (!id) {
          id = "page";
          for (let n = 2; c.sources[id]; n++) id = "page-" + n;
          c.sources[id] = { kind: "page", url: checked.href, label: new URL(checked.href).hostname };
        }
      } else {
        id = a.source!;
        if (!c.sources[id]) throw unknownSource(id);
      }
      const source = c.sources[id];
      const assigned: { instance: string; screen: string; view?: string; previous: Show | null }[] = [];
      const skipped: { instance: string; screen: string; why: string }[] = [];
      let unplaced: string[] = [];
      const put = (screen: string, view?: string) => {
        const shows = c.shows[i.id] ??= {}, previous = shows[screen] ?? null;
        shows[screen] = { source: id, ...(view !== undefined ? { view } : {}) };
        assigned.push({ instance: i.id, screen, ...(view !== undefined ? { view } : {}), previous });
      };
      if (source.kind === "app") {
        const found = itemOf(ctx, source);
        if (!found) throw new RoomError("unknown_item", "This installation no longer offers " + source.app + " › " + source.item + ".", "Clear the source with content.clear, or show another item.");
        const views = found.item.views.map(v => v.id), shownBy = allShows(c).filter(s => s.show.source === id);
        if (target !== undefined) {
          if (a.view !== undefined && !views.includes(a.view))
            throw new RoomError("unknown_view", found.item.label + " has no view " + a.view + ".", "Choose one of its views.", found.item.views);
          const elsewhere = new Set(shownBy.filter(s => !(s.instance === i.id && s.screen === target)).map(s => s.show.view));
          put(target, a.view ?? views.find(v => !elsewhere.has(v)) ?? views[0]);
        } else {
          const plan = distribute(screens, views, shownBy.filter(s => s.instance !== i.id).map(s => s.show.view!));
          for (const p of plan.assigned) put(p.screen, p.view);
          skipped.push(...plan.skipped.map(s => ({ instance: i.id, ...s })));
          unplaced = plan.unplaced;
        }
      } else if (source.kind === "page") {
        if (a.view !== undefined) throw invalid("A web page takes no view.");
        put(target ?? orderScreens(screens)[0].screen);
      } else throw new RoomError("unsupported_source", "The source " + id + " is of a kind this installation cannot show.", "Clear it with content.clear, or replace the block with content.set.");
      pruneSources(c); store(draft, c);
      const run = runIdOf(draft, ctx, source);
      return { source: id, ...(run ? { run } : {}), assigned, skipped, unplaced };
    }
    case "content.move": {
      const from = offeredScreen(draft, catalog, a.from), to = offeredScreen(draft, catalog, a.to);
      if (from.instance.id === to.instance.id && from.screen === to.screen) throw invalid("from and to are the same screen.");
      const x = c.shows[from.instance.id]?.[from.screen], y = c.shows[to.instance.id]?.[to.screen];
      if (!x && !y) throw new RoomError("nothing_to_move", "Neither screen shows any content.", contentHint);
      const set = (where: typeof from, show: Show | undefined) => {
        const shows = c.shows[where.instance.id] ??= {};
        if (show) shows[where.screen] = show; else delete shows[where.screen];
      };
      set(to, x); set(from, y); store(draft, c);
      return { from: { instance: from.instance.id, screen: from.screen, shows: y ?? null }, to: { instance: to.instance.id, screen: to.screen, shows: x ?? null } };
    }
    case "content.clear": {
      if (a.instance === undefined && a.source === undefined) throw invalid(a.screen === undefined ? "Give instance (and screen), or source." : "A screen needs its instance.");
      let instance: string | undefined, screen: string | undefined;
      if (a.instance !== undefined) {
        const gone = c.shows[a.instance] && !draft.instances.some(i => i.id === a.instance);
        const i = gone ? undefined : getInstance(draft, catalog, a.instance);
        instance = i?.id ?? a.instance;
        if (a.screen !== undefined) {
          screen = i ? screenOf(i, releaseFor(catalog, i.release), a.screen) : a.screen;
          if (!i && !c.shows[instance]?.[screen]) throw new RoomError("unknown_screen", a.instance + " has no waiting show on " + a.screen + ".", contentHint);
        }
      }
      if (a.source !== undefined && !c.sources[a.source]) throw unknownSource(a.source);
      const cleared = allShows(c).filter(s => (instance === undefined || s.instance === instance) && (screen === undefined || s.screen === screen) &&
        (a.source === undefined || s.show.source === a.source)).map(({ instance, screen }) => ({ instance, screen }));
      for (const s of cleared) delete c.shows[s.instance][s.screen];
      const removedSources = pruneSources(c); store(draft, c);
      return { cleared, removedSources };
    }
    case "content.restart": {
      const s = c.sources[a.source!];
      if (!s) throw unknownSource(a.source!);
      if (s.kind !== "app") throw invalid("Only an app source has a run to restart; " + a.source + " is a " + String(s.kind) + ".");
      const previous = runIdOf(draft, ctx, s);
      let key = newKey();
      while (key === s.run?.key) key = newKey();
      s.run = { key }; store(draft, c);
      return { source: a.source, run: runIdOf(draft, ctx, s), previous };
    }
    case "content.set": {
      let next: SceneContent;
      try { next = validateContent(a.content, ctx.content); }
      catch (e) { if (e instanceof Refusal) throw new RoomError(e.code, e.message, e.hint); throw e; }
      for (const { instance, screen } of allShows(next)) {
        const i = draft.instances.find(x => x.id === instance), surface = i && surfacesOf(catalog, i).find(s => s.screen === screen);
        const why = surface && screenWhy(surface);
        if (i && why) throw notOffered(i, screen, why);
      }
      store(draft, next);
      return { content: draft.content ?? null, waiting: waitingShows(draft, catalog, next) };
    }
  }
  throw invalid("Unsupported content command");
}

type Args = {
  allowAssumed?: boolean; instance: string; member: string; x?: number; y?: number; yaw?: number; label?: string; release: string;
  values:Record<string,JointValue|null>; pose?: Record<string, JointValue>; value: JointValue | null; host: string | null; aims?: AimPatch;
  version?: number; from: RoomRef; to: RoomRef; query?: string;
} & Partial<RoomDimensions>;

/** A candidate record is isolated from its source. The store publishes it only after a successful commit. */
export function roomCommand(record: RoomRecord, catalog: RoomCatalog, wire: RoomWire, liveConnections = 0, ctx: ContentCtx = fallbackCtx()) {
  const spec = roomCommands.find(s => s.id === wire.id);
  if (!spec) throw new RoomError("unknown_command", "Unknown room command " + String(wire.id) + ".", "Use discover to list room commands.");
  const args = wire.args === undefined ? {} : wire.args;
  const err = check(spec.inputSchema, args);
  if (err) throw invalid(err);
  const a = args as Args, scene = record.scene;
  const reply = (result: unknown, next = record) => ({ record: next, result, recorded: next === record ? null : next.scene.version, live: false });
  switch (wire.id) {
    case "state": return reply({ scene, undoable: undoable(record).map(e => e.version) });
    case "history.list": return reply({entries:record.history.slice().reverse().map(({version,command,key,undoes})=>({version,command,key,undoes}))});
    case "discover": return reply({ ...discover(scene, catalog, a), liveConnections });
    case "content.list": return reply(contentList(scene, catalog, ctx, a.instance));
    case "measure.distance": return reply(distance(located(scene, catalog, a.from), located(scene, catalog, a.to)));
    case "measure.clearance": return reply(doorClearance(scene, getInstance(scene, catalog, a.instance), catalog.releases));
    case "person.options": {
      const host=getInstance(scene,catalog,a.host!);
      if(!catalog.operatorOptions || !releaseFor(catalog,host.release).seat) throw invalid("Choose a station with an installed operator package.");
      const prior=scene.person?.host===host.id ? scene.person.state : catalog.defaultPerson?.(host);
      if(!prior) throw invalid("The station has no supported operator.");
      const options=wire.args as Pick<OperatorPatch,"style"|"sex">;
      return reply(catalog.operatorOptions(host,{...prior,style:options.style??prior.style,sex:options.sex??prior.sex}));
    }
    case "person.measure": {
      if (!scene.person || !catalog.eye) throw new RoomError("no_person", "No measurable seated person in this scene.", "Attach a person to a compatible station using person.set.");
      if (scene.person.state.posture!=="operating") throw new RoomError("unsupported_posture","The eye solver requires the operating posture.","Select operating posture before measuring the eye.");
      const host = getInstance(scene, catalog, scene.person.host);
      const from = { instance: host.id, member: "eye", point: roomPoint(host, catalog.eye(host, scene.person.state)) };
      return reply(distance(from, located(scene, catalog, a.to)));
    }
  }

  const draft = structuredClone(scene);
  // One reversible change per command. Instance changes store only their own prior state.
  let key: string, before: Prior, after: Prior, index: number | undefined, undoes: number | undefined;
  let result: unknown, keys:string[] | undefined;
  if (wire.id === "undo") {
    const options = undoable(record), target = a.version === undefined ? options[0] : options.find(e => e.version === a.version);
    if (!target) throw new RoomError("undo_unavailable", "The edit is outside retained history, already undone or superseded on the same object.", "Read state for the list of undoable versions.");
    key = target.key; undoes = target.version; after = structuredClone(target.before);
    keys=target.keys;
    guard(record, wire.expectedVersion, keys ?? [key]);
    if (key === "poses") {
      const saved=after as PoseGroup, replaced:PoseGroup=[];
      for (const ref of saved) {
        const item=getInstance(draft,catalog,ref.instance);
        replaced.push({instance:item.id,pose:item.pose});item.pose=ref.pose;
      }
      before=replaced;
    }
    else if (key === "room") { before = draft.room; draft.room = after as RoomDimensions; }
    else if (key === "lighting") { before = draft.lighting ?? null; if (after) draft.lighting = after as unknown as RoomLighting; else delete draft.lighting; }
    else if (key === "content") { before = draft.content ?? null; if (after) draft.content = after as SceneContent; else delete draft.content; }
    else if (key === "person") { before = draft.person; draft.person = after as RoomPerson | null; }
    else if (key.startsWith("instance/")) {
      const id = key.slice("instance/".length);
      index = draft.instances.findIndex(i => i.id === id); before = draft.instances[index] ?? null;
      if (index >= 0) draft.instances.splice(index, 1);
      if (after) draft.instances.splice(Math.min(target.index ?? draft.instances.length, draft.instances.length), 0, after as RoomInstance);
    } else throw new RoomError("undo_unavailable", "This installation cannot undo a " + key + " edit.", "Read state for the list of undoable versions.");
    if (draft.person && !draft.instances.some(i => i.id === draft.person!.host))
      throw new RoomError("occupied", "Undo would remove the seated person's station.", "Move or unseat the person before undoing this edit.");
    for (const item of draft.instances) validateInstance(draft, catalog, item);
    result = { undone: undoes };
  } else if (EDITS.has(wire.id)) {
    // On the public site the shared example would make every visitor start an app's run: refused there.
    if (ctx.publicExample) throw new RoomError("content_not_here", "Live screen content is not available in the shared example. Open your own demo, or make a workspace.", "Use demo.open or workspace.create, then show content there.");
    if (wire.id === "content.set" && wire.expectedVersion === undefined) throw invalid("content.set needs expectedVersion");
    key = "content"; guard(record, wire.expectedVersion, [key]);
    result = contentEdit(draft, catalog, wire, ctx);
    before = scene.content ?? null; after = draft.content ?? null;
  } else if (wire.id === "scene.reset") {
    const items=a.instance ? [getInstance(draft,catalog,a.instance)] : draft.instances;
    guard(record,wire.expectedVersion,items.map(i=>instanceKey(i.id)));
    const changed=items.filter(i=>Object.keys(i.pose).length);
    key="poses";keys=changed.map(i=>instanceKey(i.id));
    before=changed.map(i=>({instance:i.id,pose:i.pose}));
    after=changed.map(i=>{i.pose={};return {instance:i.id,pose:i.pose};});
    result={reset:changed.map(i=>i.id)};
  } else if (wire.id === "lighting.set") {
    key = "lighting"; guard(record, wire.expectedVersion, [key]);
    type Patch = { ceiling?: Partial<RoomLighting["ceiling"]>; screens?: Partial<RoomLighting["screens"]>; lamps?: { on?: boolean | null; intensity?: number | null; colour?: string | null }; instance?: string };
    const patch = wire.args as Patch, next = structuredClone(effectiveLighting(scene));
    Object.assign(next.ceiling, patch.ceiling ?? {}); Object.assign(next.screens, patch.screens ?? {});
    if (patch.instance !== undefined) {
      const item = getInstance(draft, catalog, patch.instance), own = { ...next.instances?.[item.id] } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch.lamps ?? {})) { if (v === null) delete own[k]; else own[k] = v; }
      const instances = { ...next.instances };
      if (Object.keys(own).length) instances[item.id] = own; else delete instances[item.id];
      if (Object.keys(instances).length) next.instances = instances; else delete next.instances;
    } else if (patch.lamps) {
      if (patch.lamps.on === null || patch.lamps.intensity === null) throw invalid("Without instance, lamps.on and lamps.intensity need values; only colour may be null.");
      Object.assign(next.lamps, patch.lamps);
    }
    validateLighting(next, scene.room.height);
    before = scene.lighting ?? null; after = draft.lighting = next; result = { lighting: next };
    // A live value (a simulation's): stored and sent to every viewer, but no revision and no undo entry.
    if ((wire.args as { live?: boolean }).live) return { record: isDeepStrictEqual(before, after) ? record : { ...record, scene: draft }, result, recorded: null, live: true };
  } else if (wire.id === "room.set") {
    key = "room"; guard(record, wire.expectedVersion, [key]);
    before = scene.room; after = draft.room = { ...scene.room, ...wire.args as Partial<RoomDimensions> };
    validateRoom(after);
    const hung = scene.lighting?.ceiling.height;
    if (typeof hung === "number" && hung > after.height) throw invalid("The ceiling lights hang at " + hung + " m, above the new room height. Lower them first with lighting.set, or set their height to null (under the ceiling).");
    result = { room: after };
  } else if (wire.id === "person.set") {
    const host = a.host === null ? null : getInstance(draft, catalog, a.host);
    key = "person"; guard(record, wire.expectedVersion, host ? [key, instanceKey(host.id)] : [key]);
    before = scene.person;
    const supplied=wire.args as OperatorPatch;
    const patch=Object.fromEntries(Object.keys(operatorFields).filter(k=>Object.hasOwn(supplied,k)).map(k=>[k,supplied[k as keyof OperatorPatch]])) as OperatorPatch;
    if (!host) {
      if (a.aims || Object.keys(patch).length) throw invalid("Operator settings require an occupied host.");
      draft.person = null;
    } else {
      const r = releaseFor(catalog, host.release);
      if (!r.seat || !catalog.defaultPerson) throw new RoomError("incompatible", host.label + " has no compatible seated operator.", "Select a station with seat support.");
      const prior = draft.person;
      let state = prior?.state ?? structuredClone(catalog.defaultPerson(host));
      if (Object.keys(patch).length) {
        if (!catalog.configureOperator) throw invalid("This release has no configurable operator package.");
        try {state=catalog.configureOperator(host,state,patch);}
        catch(e) {if(e instanceof Refusal) throw new RoomError(e.code,e.message,e.hint); throw e;}
      }
      if(a.aims && state.posture!=="operating") throw invalid("Gaze and limb targets require the operating posture.");
      // Aim IDs belong to the host. validateInstance requires every retained target on a rebind.
      draft.person = { host: host.id, state };
      if (a.aims) editAims(draft.person, a.aims, r);
      validateInstance(draft, catalog, host);
    }
    after = draft.person; result = { person: after };
  } else if (wire.id === "instances.add") {
    const r = releaseFor(catalog, a.release), id = a.instance ?? randomUUID();
    key = instanceKey(id); guard(record, wire.expectedVersion, [key]);
    if (draft.instances.some(i => i.id === id)) throw new RoomError("duplicate_instance", "The scene already has instance " + id + ".", "Choose an unused instance ID or omit it.");
    if (!a.allowAssumed && Object.keys(a.pose ?? {}).some(id=>r.joints.some(j=>j.id===id && j.locked && j.assumed)))
      throw invalid("Set allowAssumed to use this modeled adjustment.");
    let label: string;
    try { label = cleanName(a.label, r.label); } catch (e) { throw invalid(String(e)); }
    const item: RoomInstance = { id, label, release: r.id, x: a.x ?? 0, y: a.y ?? 0, yaw: a.yaw ?? 0, pose: {} };
    for (const [name, val] of Object.entries(a.pose ?? {})) item.pose[memberOf(r, name, true)] = val;
    validateInstance(draft, catalog, item);
    index = draft.instances.length; draft.instances.push(item); before = null; after = item; result = { instance: item };
  } else {
    const i = getInstance(draft, catalog, a.instance), r = releaseFor(catalog, i.release);
    key = instanceKey(i.id); guard(record, wire.expectedVersion, [key]);
    index = draft.instances.indexOf(i); before = scene.instances[index]; after = i;
    switch (wire.id) {
      case "instances.remove":
        if (draft.person?.host === i.id) throw new RoomError("occupied", i.label + " hosts the seated person.", "Rebind with person.set or remove the person with host null.");
        draft.instances.splice(index, 1); after = null; break;
      case "instances.swap": {
        const replacement = releaseFor(catalog, a.release);
        for (const joint of Object.keys(i.pose)) {
          const old = r.joints.find(j => j.id === joint), next = replacement.joints.find(j => j.id === joint);
          if (old && next && old.type !== next.type) throw new RoomError("incompatible", joint + " changes joint type on the new release.", "Clear this setting with pose.set value null before swapping.");
        }
        i.release = replacement.id; validateInstance(draft, catalog, i); break;
      }
      case "instances.move":
        if (a.x !== undefined) i.x = a.x;
        if (a.y !== undefined) i.y = a.y;
        if (a.yaw !== undefined) i.yaw = a.yaw;
        break;
      case "pose.set":
      case "pose.apply": {
        const changes = wire.id === "pose.set" ? { [a.member]: a.value } : a.values;
        for (const [member, value] of Object.entries(changes)) {
          const id = memberOf(r, member, true);
          if (value === null) { delete i.pose[id]; continue; }
          const joint = r.joints.find(j => j.id === id);
          if (joint?.locked && joint.assumed && !a.allowAssumed) throw invalid("Set allowAssumed to use " + id + ".");
          const why = problem(r, id, value);
          if (why) throw invalid(id + ": " + why);
          i.pose[id] = value;
        }
        break;
      }
      default: throw invalid("Unsupported edit");
    }
    result = { instance: after ?? { id: i.id, removed: true } };
    // A removed or swapped asset keeps its shows: they wait (and come back with Undo).
    if (wire.id === "instances.remove" || wire.id === "instances.swap") {
      const waiting = waitingShows(draft, catalog, readable(draft)).filter(w => w.instance === i.id).map(({ instance, screen }) => ({ instance, screen }));
      if (waiting.length) result = { ...(result as object), content: { waiting } };
    }
  }
  if (isDeepStrictEqual(before, after)) return reply(result);
  const change: Change = { command: wire.id, version: ++draft.version, key, keys, before, index, undoes };
  return reply(result, { ...record, scene: draft, history: [...record.history, change].slice(-ROOM_HISTORY) });
}
