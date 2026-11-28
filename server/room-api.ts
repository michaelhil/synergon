// The scene API of both installations. Workspace -> Project -> Scene, all in one folder-based store
// (server/project-store.ts). A scene is the live layout: room, placed assets, optional seated operator, undo history.
// An edit and its bounded undo history are written together in one synchronous step.
import { Database } from "bun:sqlite";
import { createHash, getRandomValues } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { roomCommands } from "../shared/room-commands.ts";
import { ROOM_SCHEMA, type RoomCatalog, type RoomScene } from "../shared/room.ts";
import { LIMITS } from "./limits.ts";
import { NameError, isId } from "./names.ts";
import { RoomError, parseRoom, roomCommand, type ContentCtx, type RoomRecord, type RoomWire, type SeenStore } from "./room-model.ts";
import { LIVE, LIVE_PATTERNS, SEEN_STATES, type LiveApps, type SeenReport } from "../shared/room-content.ts";
import { loadLiveApps } from "./live-apps.ts";
import { PROJECT_BODY_BYTES } from "../shared/project.ts";
import { projectCommands } from "../shared/project-commands.ts";
import { ProjectError } from "./project-package.ts";
import { DEFAULT_WORKSPACE, ProjectStore } from "./project-store.ts";
import { projectCommand, projectMcp } from "./project-api.ts";
import { roomMcp } from "./room-mcp.ts";

interface RoomApiOptions {
  dataDir: string; catalog: RoomCatalog; publicMode?: boolean; standardsPath?: string;
  /** Called before a project command that creates something; false refuses it (the public rate limit). */
  allowCreate?: (req: Request) => boolean;
  /** The apps and allowed sites of live screen content; the committed server/live-apps.json when absent. */
  apps?: LiveApps;
}
const CREATES = new Set(["workspace.create", "project.create", "project.scene", "workspace_create", "project_create", "project_scene"]);
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string, hint = "") => json({ ok: false, error: { code, message, hint } }, status);
const method = () => fail(405, "method", "Method unavailable for this route.");
const obj = (a: unknown): a is Record<string, unknown> => !!a && typeof a === "object" && !Array.isArray(a);
class RequestError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

async function body(req: Request, limit: number = LIMITS.bodyBytes): Promise<unknown> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw new RequestError(415, "content_type", "Send an application/json request body.");
  const reader = req.body?.getReader();
  if (!reader) throw new RequestError(400, "json", "Missing JSON body.");
  let length = 0, timedOut = false;
  const pieces: Uint8Array[] = [];
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, LIMITS.bodyTimeoutMs);
  try {
    for (;;) {
      const chunk = await reader.read().catch(() => {
        throw new RequestError(400, "interrupted", "The transfer was interrupted. Retry with the complete request.");
      });
      const { done, value } = chunk;
      if (timedOut) throw new RequestError(408, "timeout", "The request body took too long.");
      if (done) break;
      length += value.length;
      if (length > limit) { void reader.cancel().catch(() => {}); throw new RequestError(413, "too_large", "The request body exceeds " + limit + " bytes."); }
      pieces.push(value);
    }
    try { return JSON.parse(Buffer.concat(pieces).toString("utf8")); }
    catch { throw new RequestError(400, "json", "Malformed JSON body."); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export function createRoomApi({ dataDir, catalog, publicMode = false, standardsPath, allowCreate, apps = loadLiveApps({ public: publicMode }) }: RoomApiOptions) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const listeners = new Map<string, Set<(event: Uint8Array) => void>>();
  // Live screen content: what each open viewer reports per screen, by its stream's private token (memory only).
  const seen = new Map<string, SeenStore>(), lastSeen = new Map<string, number>();
  const encoder = new TextEncoder();
  const event = (scene: RoomScene) => encoder.encode("id: " + scene.version + "\nevent: snapshot\ndata: " + JSON.stringify(scene) + "\n\n");
  const ends = new Set<() => void>();
  function live(req: Request, room: RoomScene) {
    let stop: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let group = listeners.get(room.id);
        if (!group) listeners.set(room.id, group = new Set());
        const send = (bytes: Uint8Array) => {
          if ((controller.desiredSize ?? 0) <= 0) { stop(); return; }
          controller.enqueue(bytes);
        };
        group.add(send);
        // The viewer's private token for its screen reports (POST .../seen), before the first snapshot.
        const token = Buffer.from(getRandomValues(new Uint8Array(12))).toString("hex");
        let viewers = seen.get(room.id);
        if (!viewers) seen.set(room.id, viewers = new Map());
        viewers.set(token, { reports: {}, at: 0, name: "v" + createHash("sha256").update(token).digest("hex").slice(0, 6) });
        // One chunk with the first snapshot, so a reader that takes a chunk per event still finds the snapshot first.
        controller.enqueue(Buffer.concat([encoder.encode("event: viewer\ndata: " + JSON.stringify({ viewer: token }) + "\n\n"), event(room)]));
        const hb = setInterval(() => {
          if ((controller.desiredSize ?? 0) <= 0) { stop(); return; }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }, LIMITS.heartbeatMs);
        stop = () => {
          clearInterval(hb);
          group.delete(send); if (!group.size) listeners.delete(room.id);
          viewers.delete(token); lastSeen.delete(token); if (!viewers.size) seen.delete(room.id);
          ends.delete(stop); req.signal.removeEventListener("abort", stop);
          try { controller.close(); } catch { /* Reader already cancelled. */ }
        };
        ends.add(stop); req.signal.addEventListener("abort", stop, { once: true });
        if (req.signal.aborted) stop();
      },
      cancel() { stop(); },
    }, new ByteLengthQueuingStrategy({ highWaterMark: LIMITS.streamQueueBytes }));
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
  }
  function publish(s: RoomScene) {
    const group = listeners.get(s.id);
    if (!group?.size) return;
    const e = event(s);
    for (const send of group) send(e);
  }
  const projects = new ProjectStore(dataDir, catalog, publish, publicMode);
  migrateRooms(dataDir, projects, publicMode);
  if (projects.empty()) {
    // A new installation opens with one furnished example when the library has the parts for it.
    const demo = catalog.releases.some(r => r.kind === "station") && catalog.releases.some(r => r.variant === "wall") &&
      catalog.releases.some(r => r.variant === "freestanding" && r.version === "1");
    void projects.run("project.create", { workspace: DEFAULT_WORKSPACE, name: "Examples", sceneName: "Control room", template: demo ? "demo" : "empty" });
  }
  const missing = () => new RequestError(404, "no_scene", "Unknown scene.");
  const read = (id: string) => {
    if (!projects.owns(id)) throw missing();
    const record = projects.read(id);
    for (const instance of record.scene.instances) {
      if (!catalog.releases.some(r => r.id === instance.release))
        throw new RoomError("missing_release", instance.id + " needs the exact release " + instance.release, "Restore this release to the installation before opening the room.");
    }
    return record;
  };
  // Live lighting values (a simulation's): at most 10 a second per scene.
  const liveHits = new Map<string, number[]>();
  const liveAllowed = (id: string) => {
    const now = Date.now(), hits = (liveHits.get(id) ?? []).filter(t => t > now - 1000);
    if (hits.length >= 10) return false;
    hits.push(now); liveHits.set(id, hits); return true;
  };
  /** The content context of one request: the settings, public or local, Synergon's own origin, the scene's reports. */
  const contentCtx = (id: string, self: string): ContentCtx => ({ content: { apps, mode: publicMode ? "public" : "local", self },
    seen: seen.get(id) ?? new Map(), publicExample: publicMode && projects.location(id).workspace.id === DEFAULT_WORKSPACE });
  const change = (id: string, wire: RoomWire, self: string) => {
    const current = read(id);
    try {
      if (wire.id === "lighting.set" && obj(wire.args) && wire.args.live === true && !liveAllowed(id))
        throw new RoomError("rate_limited", "At most 10 live lighting values a second per scene.", "Send fewer updates, or combine them.");
      const { record, result, recorded, live } = roomCommand(current, catalog, wire, listeners.get(id)?.size ?? 0, contentCtx(id, self));
      if (recorded !== null || (live && record !== current)) projects.edit(id, () => record);
      return { scene: record.scene, publish: recorded !== null || (live && record !== current), receipt: { ok: true, version: record.scene.version, recorded, result } };
    } catch (e) {
      if (!(e instanceof RoomError)) throw e;
      return { scene: null, publish: false, receipt: { ok: false, version: current.scene.version, error: e.wire() } };
    }
  };
  const run = async (id: string, wire: RoomWire, self: string) => {
    if (wire.id.startsWith("assessment.")) {
      const { assessmentCommand } = await import("./assessment.ts");
      // Reading, evaluating and saving form one synchronous step after optional module loading.
      {
        const record = read(id);
        const storage = { read: () => projects.readAssessment(id), write: (attachment: unknown) => projects.writeAssessment(id, attachment) };
        try {
          const scene = { ...record.scene, id: projects.portableId(id) };
          const result = assessmentCommand(scene,catalog,wire,storage,{ standardsPath,publicMode });
          return {ok:true,version:scene.version,recorded:null,result};
        } catch (e) {
          if (!(e instanceof RoomError)) throw e;
          return { ok:false,version:record.scene.version,error:e.wire() };
        }
      }
    }
    const { scene, publish: send, receipt } = change(id, wire, self);
    if (scene && send) publish(scene);
    return receipt;
  };

  /** POST .../seen: one viewer's whole report, closed states and ids only (§3.8). Never an edit, never stored. */
  function report(id: string, data: unknown): Response {
    if (!projects.owns(id)) throw missing();
    if (!obj(data) || Object.keys(data).some(k => k !== "viewer" && k !== "screens") || typeof data.viewer !== "string" || !obj(data.screens))
      return fail(400, "invalid_report", "Send {viewer, screens: {\"<instance>/<S_ id>\": {state, run?, view?}}}.");
    const viewer = seen.get(id)?.get(data.viewer);
    if (!viewer) return fail(404, "no_viewer", "No open live stream has this viewer token.", "Open the scene's live stream and use the token of its viewer event.");
    const entries = Object.entries(data.screens);
    if (entries.length > LIVE.maxShows) return fail(400, "invalid_report", "At most " + LIVE.maxShows + " screens in one report.");
    const shows = projects.read(id).scene.content;
    const reports: Record<string, SeenReport> = {};
    for (const [key, value] of entries) {
      const [instance, screen, extra] = key.split("/");
      if (extra !== undefined || !LIVE_PATTERNS.instance.test(instance ?? "") || !LIVE_PATTERNS.screen.test(screen ?? ""))
        return fail(400, "invalid_report", "A report key is <instance>/<S_ id>: " + key.slice(0, 100));
      if (!obj(value) || Object.keys(value).some(k => !["state", "run", "view"].includes(k)) || !SEEN_STATES.includes(value.state as never) ||
        (value.run !== undefined && (typeof value.run !== "string" || !LIVE_PATTERNS.run.test(value.run))) ||
        (value.view !== undefined && (typeof value.view !== "string" || !LIVE_PATTERNS.view.test(value.view))))
        return fail(400, "invalid_report", "A screen's report is {state, run?, view?} with state one of " + SEEN_STATES.join(", ") + ".");
      // A screen the scene no longer shows anything on (the report crossed an edit) is dropped, not refused.
      const stored = (shows as { shows?: Record<string, Record<string, unknown>> } | undefined)?.shows?.[instance!];
      if (!obj(stored) || !obj(stored[screen!])) continue;
      reports[key] = { state: value.state as SeenReport["state"], ...(value.run !== undefined ? { run: value.run as string } : {}), ...(value.view !== undefined ? { view: value.view as string } : {}) };
    }
    const now = Date.now(), last = lastSeen.get(data.viewer) ?? 0;
    if (now - last < LIVE.seenEveryMs * 0.9) return fail(429, "rate_limited", "At most one report a second per viewer.", "Send the whole report again after a second.");
    lastSeen.set(data.viewer, now);
    viewer.reports = reports; viewer.at = now;
    return json({ ok: true });
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), path = url.pathname.replace(/\/$/, "");
    try {
      if (req.headers.has("origin") && req.headers.get("origin") !== url.origin) return fail(403, "origin", "Cross-origin room request refused.");
      if (path === "/api/health") return json({ ok: true, format: ROOM_SCHEMA, mode: publicMode ? "public" : "local", public: publicMode });
      if (path === "/api/catalog") return req.method === "GET" ? json({ releases: catalog.releases }) : method();
      if (path === "/api/commands") return req.method === "GET" ? json({ commands: roomCommands }) : method();
      if (req.method === "POST" && !path.endsWith("/mcp") && req.headers.get("x-synergon") !== "1") return fail(403, "header", "Supply the X-Synergon: 1 header.");
      if (path === "/api/projects") return req.method === "GET" ? json({projects:projects.listed()}) : method();
      if (path === "/api/projects/commands") return req.method === "GET" ? json({commands:projectCommands}) : method();
      if (path === "/api/projects/command" || path === "/api/projects/mcp") {
        if (req.method !== "POST") return method();
        const data = await body(req, publicMode ? LIMITS.bodyBytes : PROJECT_BODY_BYTES);
        const named = obj(data) ? String(data.id ?? (obj(data.params) ? data.params.name : "")) : "";
        const args = obj(data) ? (obj(data.args) ? data.args : obj(data.params) && obj(data.params.arguments) ? data.params.arguments : {}) : {};
        // Resetting a browser's existing demo scene creates nothing; making one counts like any other creation.
        const creates = CREATES.has(named) || ((named === "demo.open" || named === "demo_open") && args.scene === undefined);
        if (creates && allowCreate && !allowCreate(req)) return fail(429, "rate_limited", "The creation limit has been reached. Try again later.");
        return path.endsWith("/mcp") ? await projectMcp(projects,data) : json(await projectCommand(projects,data));
      }
      if (path === "/api/workspaces") {
        if (req.method !== "GET") return method();
        // The public sandbox lists only the shared workspace; others open by their own links.
        const all = projects.workspaces();
        return json({ workspaces: publicMode ? all.filter(w => w.id === DEFAULT_WORKSPACE) : all });
      }
      const w = /^\/api\/workspaces\/([^/]+)$/.exec(path);
      if (w) {
        if (req.method !== "GET") return method();
        if (!isId(w[1])) throw missing();
        return json(projects.tree(w[1]));
      }
      const m = /^\/api\/scenes\/([^/]+)(?:\/(state|command|live|mcp|discover|meta|content|seen))?$/.exec(path);
      if (!m || !isId(m[1])) throw missing();
      const [, id, action = "state"] = m;
      if (action === "state" || action === "live" || action === "discover" || action === "meta" || action === "content") {
        if (req.method !== "GET") return method();
        const record = read(id);
        const liveConnections = listeners.get(id)?.size ?? 0;
        if (action === "meta") return json({id, name:record.scene.name, version:record.scene.version, liveConnections, ...projects.location(id)});
        if (action === "discover") return json(roomCommand(record, catalog, { id: "discover", args: Object.fromEntries(url.searchParams) },liveConnections).result);
        if (action === "content") return json(roomCommand(record, catalog, { id: "content.list", args: Object.fromEntries(url.searchParams) }, liveConnections, contentCtx(id, url.origin)).result);
        return action === "live" ? live(req, record.scene) : json(record.scene);
      }
      if (req.method !== "POST") return method();
      if (action === "seen") return report(id, await body(req, LIVE.maxReportBytes));
      const data = await body(req);
      if (action === "mcp") { if (!projects.owns(id)) throw missing(); return await roomMcp(data, wire => run(id, wire, url.origin)); }
      if (!obj(data) || typeof data.id !== "string" || Object.keys(data).some(k => !["id", "args", "expectedVersion"].includes(k)))
        return fail(400, "invalid_command", "Send {id,args,expectedVersion?}.");
      return json(await run(id, { id: data.id, args: data.args, expectedVersion: data.expectedVersion }, url.origin));
    } catch (e) {
      if (e instanceof ProjectError) return fail(e.status,e.code,e.message,e.hint);
      if (e instanceof RequestError) return fail(e.status, e.code, e.message);
      if (e instanceof NameError) return fail(400, "invalid_name", e.message);
      if (e instanceof RoomError) return json({ ok: false, error: e.wire() }, ["unsupported_format", "invalid_scene", "missing_release"].includes(e.code) ? 422 : 400);
      console.error("room:", e);
      return fail(500, "internal", "The room request could not be completed.");
    }
  }
  return { fetch, close() { for (const stop of ends) stop(); } };
}

/** Move scenes from the retired single-file room store into projects, once. Every scene keeps its ID (so its old link
 *  works), revision, undo history and saved assessments. The oldest room named "Control room" becomes the example in
 *  the default workspace (project "Examples"). The others go to project "Earlier layouts": in the default workspace
 *  locally, in an unlisted workspace "Earlier rooms" on the public site. A room with saved assessments gets a project
 *  of its own, because assessments are kept per project. "Untitled room" becomes "Untitled scene". The old file is
 *  renamed, never deleted. */
function migrateRooms(dataDir: string, projects: ProjectStore, publicMode: boolean) {
  const file = join(dataDir, "rooms-v1.sqlite");
  if (!existsSync(file)) return;
  const db = new Database(file, { readonly: true });
  try {
    const hasAssessments = !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='room_assessments'").get();
    const rows = db.query<{ id: string; doc: string }, []>("SELECT id, doc FROM rooms ORDER BY rowid").all().filter(r => !projects.owns(r.id));
    const rooms = rows.map(row => {
      const record: RoomRecord = parseRoom(row.doc);
      if (record.scene.name === "Untitled room") record.scene = { ...record.scene, name: "Untitled scene" };
      const saved = hasAssessments ? db.query<{ attachment: string }, [string]>("SELECT attachment FROM room_assessments WHERE workspace=?").get(row.id) : null;
      return { record, assessment: saved ? JSON.parse(saved.attachment) : undefined };
    });
    const example = rooms.find(r => r.record.scene.name === "Control room" && r.assessment === undefined);
    if (example) projects.adopt("Examples", [example.record], DEFAULT_WORKSPACE);
    const rest = rooms.filter(r => r !== example);
    if (!rest.length) return;
    const workspace = publicMode ? projects.addWorkspace("Earlier rooms") : DEFAULT_WORKSPACE;
    for (const r of rest.filter(r => r.assessment !== undefined)) projects.adopt(r.record.scene.name, [r.record], workspace, r.assessment);
    const plain = rest.filter(r => r.assessment === undefined).map(r => r.record);
    if (plain.length) projects.adopt("Earlier layouts", plain, workspace);
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(file + suffix)) renameSync(file + suffix, file + ".migrated" + suffix);
  }
}
