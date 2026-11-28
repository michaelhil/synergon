import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { RoomCatalog, RoomRelease, RoomScene } from "../shared/room.ts";
import { createRoomApi } from "./room-api.ts";
import { ROOM_HISTORY } from "./room-model.ts";

const station: RoomRelease = {
  id: "desk@1#aaa", label: "Fixture station", asset: "desk", version: "1", digest: "aaa",
  modelUrl: "/a", manifestUrl: "/b", anchor: [0, 0, -0.2], kind: "station", seat: true,
  members: [{ id: "D_monitor", label: "Monitor centre" }, { id: "J_slide", label: "Seat slide" }],
  joints: [{ id: "J_slide", label: "Seat slide", type: "prismatic", lower: 0, upper: 1, neutral: 0 }],
  footprint: { min: [-.5, -.25], max: [.5, .25] },
};
const display: RoomRelease = { ...station, id: "display@1#bbb", label: "Display", version: "1", digest: "bbb", kind: "display", asset: "floor-display",
  variant: "freestanding", seat: false, joints: [], members: [{ id: "screen", label: "Monitor centre" }] };
const wide = { ...display, id: "display@2#ccc", version: "2", digest: "ccc", footprint: { min: [-.8, -.25], max: [.8, .25] } } satisfies RoomRelease;
const wall: RoomRelease = { ...display, id: "wall@1#ddd", asset: "wall-display", variant: "wall" };
const catalog: RoomCatalog = {
  releases: [station, display, wide, wall],
  point: i => [1, 2, .6 + Number(i.pose.J_slide ?? 0)], eye: () => [0, 0, 1.6],
  defaultPerson: () => ({ style: "clay", sex: "male", tone: "medium", glasses: false, headset: false, preset: null, body: {}, posture: "operating" }),
};
const dirs: string[] = [], servers: ReturnType<typeof createRoomApi>[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "synergon-room-test-")); dirs.push(dir);
  let api = createRoomApi({ dataDir: dir, catalog }); servers.push(api);
  const get = (url: string) => api.fetch(new Request("http://localhost/api/" + url));
  const post = (url: string, data: unknown) => api.fetch(new Request("http://localhost/api/" + url, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Synergon": "1" }, body: JSON.stringify(data) }));
  const create = async () => {
    const response = await post("projects/command", { id: "workspace.create", args: { name: "New layout" } });
    expect(response.status).toBe(200);
    const { scene: id } = await response.json() as { scene: string };
    const path = "scenes/" + id;
    return {
      id, path, state: async () => (await get(path + "/state")).json() as Promise<RoomScene>,
      command: async (id: string, args = {}, expectedVersion?: number) =>
        (await post(path + "/command", { id, args, expectedVersion })).json() as Promise<any>,
      mcp: async (method: string, params = {}) => (await post(path + "/mcp", { jsonrpc: "2.0", method, params, id: 1 })).json() as Promise<any>,
    };
  };
  return { get, post, create, dir, restart() {
    api.close(); servers.splice(servers.indexOf(api), 1); api = createRoomApi({ dataDir: dir, catalog }); servers.push(api);
  } };
}
afterEach(() => {
  for (const api of servers.splice(0)) api.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("room workspace", () => {
  test("first-run example, empty creation, exact pins, ordinary names and instance-qualified discovery", async () => {
    const app = setup(), ws = await app.create();
    const index = await (await app.get("workspaces")).json() as any;
    expect(index.workspaces.map((w: any) => w.name)).toEqual(["My workspace", "New layout"]);
    const tree = await (await app.get("workspaces/" + index.workspaces[0].id)).json() as any;
    expect(tree.projects.map((p: any) => [p.name, p.scenes.map((s: any) => s.name)])).toEqual([["Examples", ["Control room"]]]);
    const demo = await (await app.get("scenes/" + tree.projects[0].scenes[0].id + "/state")).json() as RoomScene;
    const meta = await (await app.get(ws.path + "/meta")).json() as any;
    expect([meta.workspace.name, meta.project.name, meta.name]).toEqual(["New layout", "My project", "Scene 1"]);
    expect(demo.instances.map(i => i.release)).toEqual([station.id, station.id, display.id, wall.id]);
    expect(demo.person?.host).toBe("station-a");
    expect((await ws.state()).instances).toEqual([]);
    expect((await ws.command("instances.add", { release: station.asset })).error.code).toBe("missing_release");
    expect((await ws.command("instances.add", { instance: "left", release: station.id, pose: { J_missing: .3 } })).error.code).toBe("unknown_member");
    for (const instance of ["left", "right"]) expect((await ws.command("instances.add", { instance, release: station.id })).ok).toBe(true);
    const ambiguous = await ws.command("instances.move", { instance: "station", x: 99 });
    expect(ambiguous.error.candidates.map((i: any) => i.id)).toEqual(["left", "right"]);
    const found = await ws.command("discover", { query: "monitor" });
    expect(found.result.instances.map((i: any) => i.members.map((m: any) => [m.instance, m.id])))
      .toEqual([[["left", "D_monitor"]], [["right", "D_monitor"]]]);
    expect((await ws.command("instances.swap", { instance: "left", release: "not-installed" })).version).toBe(2);
  });

  test("independent edits commute, no-op/refused edits are atomic and restart retains scoped undo", async () => {
    const app = setup(), ws = await app.create();
    await ws.command("instances.add", { instance: "left", release: station.id, pose: { J_slide: .15 } });
    await ws.command("instances.add", { instance: "right", release: station.id, label: "Right desk" });
    const replies = await Promise.all([
      ws.command("instances.move", { instance: "left", x: 1 }, 2),
      ws.command("instances.move", { instance: "right", y: 2 }, 2),
    ]);
    expect(replies.every(r => r.ok)).toBe(true);
    expect((await ws.command("instances.move", { instance: "left", y: 1 }, 2)).error.code).toBe("stale");
    expect((await ws.command("instances.swap", { instance: "left", release: display.id })).error.message).toContain("J_slide");
    expect((await ws.command("instances.move", { instance: "right", y: 2 })).recorded).toBeNull();
    expect((await ws.command("room.set", { width: .5 })).error.code).toBe("invalid_args");
    expect((await ws.state()).version).toBe(4);
    app.restart();
    expect((await ws.command("undo", { version: replies[0].recorded })).ok).toBe(true);
    let state = await ws.state();
    expect(state.instances.map(i => [i.x, i.y])).toEqual([[0,0],[0,2]]);
    expect(state.instances[0].pose.J_slide).toBe(.15);
    expect((await ws.command("undo", { version: replies[0].recorded })).ok).toBe(false);
    await ws.command("pose.set", { instance: "left", member: "J_slide", value: null });
    const swapped = await ws.command("instances.swap", { instance: "left", release: wide.id });
    expect(swapped.result.instance.id).toBe("left");
    expect(swapped.result.instance.release).toBe(wide.id);
    const old = await ws.command("undo", { version: 1 });
    expect(old.error.code).toBe("undo_unavailable");
    await ws.command("undo", { version: swapped.recorded });
    state = await ws.state(); expect(state.instances[0].release).toBe(station.id);
  });

  test("known independent coordinates, seated eye and aim reference integrity", async () => {
    const ws = await setup().create();
    await ws.command("instances.add", { instance: "a", release: station.id, yaw: 90 });
    await ws.command("instances.add", { instance: "b", release: display.id, x: 3, y: 4 });
    const floor = { instance: "a", member: "floor" }, screen = { instance: "a", member: "D_monitor" };
    expect((await ws.command("measure.distance", { from: floor, to: { instance: "b", member: "floor" } })).result.metres).toBe(5);
    const pt = (await ws.command("measure.distance", { from: floor, to: screen })).result.to.point;
    expect(pt[0]).toBeCloseTo(-2); expect(pt[1]).toBeCloseTo(1); expect(pt[2]).toBeCloseTo(.6);
    expect((await ws.command("person.measure", { to: screen })).error.code).toBe("no_person");
    expect((await ws.command("person.set", { host: "b" })).error.code).toBe("incompatible");
    await ws.command("person.set", { host: "a", aims: { look: "D_monitor", left_hand: { mode: "touch", target: "D_monitor" } } });
    const at = (await ws.command("person.measure", { to: screen })).result.metres;
    expect(at).toBeCloseTo(Math.sqrt(6));
    await ws.command("instances.move", { instance: "a", x: 7, y: 2, yaw: -155 });
    expect((await ws.command("person.measure", { to: screen })).result.metres).toBeCloseTo(at, 9);
    const before = await ws.state();
    expect((await ws.command("instances.swap", { instance: "a", release: display.id })).error.message).toContain("occupied seat");
    expect((await ws.command("instances.remove", { instance: "a" })).error.code).toBe("occupied");
    expect((await ws.command("person.set", { host: "a", aims: { look: "unknown" } })).ok).toBe(false);
    expect(await ws.state()).toEqual(before);
    await ws.command("person.set", { host: "a", aims: { look: null } });
    expect((await ws.state()).person?.state.aims).toEqual({ left_hand: { mode: "touch", target: "D_monitor" } });
  });

  test("deterministic retained-history boundary and stale guard after trimming", async () => {
    const ws = await setup().create();
    await ws.command("instances.add", { instance: "a", release: station.id });
    for (let i = 1; i <= ROOM_HISTORY + 2; ++i) await ws.command("instances.move", { instance: "a", x: i });
    expect((await ws.command("undo", { version: 1 })).error.code).toBe("undo_unavailable");
    expect((await ws.command("room.set", { height: 5 }, 0)).error.code).toBe("stale");
    const height = await ws.command("room.set", { height: 5 }, ROOM_HISTORY);
    expect(height.ok).toBe(true);
  });

  test("component edits, resets and undo stay scoped across reloads", async () => {
    const app=setup(), ws=await app.create();
    for (const instance of ["left","right"]) await ws.command("instances.add",{instance,release:station.id});
    const first=await ws.command("pose.apply",{instance:"left",values:{J_slide:0.2}});
    const second=await ws.command("pose.apply",{instance:"right",values:{J_slide:0.7}});
    expect(second.version).toBe(first.version+1);
    const rejected=await ws.command("pose.apply",{instance:"left",values:{J_slide:0.8,missing:0}});
    expect(rejected.ok).toBe(false);
    const reset=await ws.command("scene.reset",{});
    app.restart();
    expect((await ws.state()).instances.map(i=>i.pose)).toEqual([{},{}]);
    expect((await ws.command("history.list")).result.entries[0].command).toBe("scene.reset");
    expect((await ws.command("undo",{version:reset.recorded})).ok).toBe(true);
    app.restart();
    expect((await ws.state()).instances.map(i=>i.pose)).toEqual([{J_slide:0.2},{J_slide:0.7}]);
    const single=await ws.command("scene.reset",{instance:"left"});
    await ws.command("pose.set",{instance:"right",member:"J_slide",value:0.5});
    expect((await ws.command("undo",{version:single.recorded})).ok).toBe(true);
    expect((await ws.state()).instances.map(i=>i.pose)).toEqual([{J_slide:0.2},{J_slide:0.5}]);
  });

  test("SSE snapshots on subscribe/reconnect and an agent can undo a browser edit", async () => {
    const app = setup(), ws = await app.create();
    await ws.command("instances.add", { instance: "display", release: display.id });
    const reader = (await app.get(ws.path + "/live")).body!.getReader();
    const scene = async (r: typeof reader) => {
      const text = new TextDecoder().decode((await r.read()).value);
      expect(text).toContain("event: snapshot");
      return JSON.parse(text.split("event: snapshot")[1].split("data: ")[1]) as RoomScene;   // a first chunk also carries the viewer token
    };
    expect((await scene(reader)).version).toBe(1);
    expect((await (await app.get(ws.path+"/meta")).json() as any).liveConnections).toBe(1);
    expect((await ws.command("discover")).result.liveConnections).toBe(1);
    const init = await ws.mcp("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    const list = (await ws.mcp("tools/list")).result.tools;
    expect(list.find((s: any) => s.name === "instances_move").inputSchema.properties.expectedVersion).toBeDefined();
    const move = await ws.command("instances.move", { instance: "display", x: 1.5 });
    expect((await scene(reader)).instances[0].x).toBe(1.5);
    const result = await ws.mcp("tools/call", { name: "undo", arguments: { version: move.recorded, expectedVersion: move.version } });
    expect(result.result.structuredContent.ok).toBe(true);
    expect((await scene(reader)).instances[0].x).toBe(0);
    await reader.cancel();
    expect((await ws.command("discover")).result.liveConnections).toBe(0);
    const again = (await app.get(ws.path + "/live")).body!.getReader();
    expect(await scene(again)).toEqual(await ws.state());
    await again.cancel();
  });

  test("failed dependencies during undo and concurrent same-instance writes leave a consistent revision", async () => {
    const ws = await setup().create();
    const added = await ws.command("instances.add", { instance: "desk", release: station.id });
    await ws.command("person.set", { host: "desk", aims: { look: "D_monitor" } });
    const occupied = await ws.command("undo", { version: added.recorded });
    expect(occupied.error.code).toBe("occupied");
    expect(occupied.version).toBe(2);
    const unseat = await ws.command("person.set", { host: null });
    await ws.command("instances.remove", { instance: "desk" });
    expect((await ws.command("undo", { version: unseat.recorded })).ok).toBe(false);
    expect((await ws.state()).person).toBeNull();
    await ws.command("undo", { version: 4 });
    const changes = await Promise.all([1, 2].map(x => ws.command("instances.move", { instance: "desk", x }, 5)));
    expect(changes.map(r => r.ok).sort()).toEqual([false, true]);
    expect((await ws.state()).version).toBe(6);
  });

  test("reopening a missing release identifies the pin and does not substitute a newer one", async () => {
    const app = setup(), ws = await app.create();
    await ws.command("instances.add", { instance: "display", release: display.id });
    const missing = createRoomApi({ dataDir: app.dir, catalog: { ...catalog, releases: [station, wide, wall] } });
    try {
      const res = await missing.fetch(new Request("http://localhost/api/" + ws.path + "/state"));
      expect(res.status).toBe(422);
      expect(((await res.json()) as any).error.message).toContain(display.id);
      expect((await ws.state()).instances[0].release).toBe(display.id);
    } finally { missing.close(); }
  });

  test("the demo is a furnished scene per browser, reset each time it is opened and never listed", async () => {
    const app = setup();
    const call = async (args: object) => (await app.post("projects/command", { id: "demo.open", args })).json() as Promise<any>;
    const first = await call({});
    expect(first.reset).toBe(false);
    const path = "scenes/" + first.scene;
    const fresh = await (await app.get(path + "/state")).json() as RoomScene;
    expect(fresh.instances.length).toBe(4);
    const removed = await (await app.post(path + "/command", { id: "instances.remove", args: { instance: fresh.instances.at(-1)!.id } })).json() as any;
    expect(removed.ok).toBe(true);
    const again = await call({ scene: first.scene });
    expect([again.scene, again.reset]).toEqual([first.scene, true]);
    const reset = await (await app.get(path + "/state")).json() as RoomScene;
    expect([reset.instances.length, reset.version]).toEqual([4, 2]);
    expect((await (await app.get(path + "/meta")).json() as any).workspace.name).toBe("Demo");
    const demoWorkspace = (await (await app.get(path + "/meta")).json() as any).workspace.id;
    await call({});
    expect(((await (await app.get("workspaces/" + demoWorkspace)).json()) as any).projects).toEqual([]);
    expect(((await (await app.get("workspaces")).json()) as any).workspaces.map((w: any) => w.name)).not.toContain("Demo");
    const other = await app.create();
    expect((await call({ scene: other.id })).error.code).toBe("not_demo");
  });

  test("lighting is part of the scene: patched, validated, per asset and undoable", async () => {
    const app = setup(), ws = await app.create();
    expect((await ws.state()).lighting).toBeUndefined();
    const set = await ws.command("lighting.set", { ceiling: { countX: 4, colour: "#ff3300" }, screens: { intensity: 2 } });
    expect(set.ok).toBe(true);
    expect(set.result.lighting.ceiling).toMatchObject({ on: true, countX: 4, countY: 2, colour: "#ff3300", cct: 4000 });
    expect(set.result.lighting.screens.intensity).toBe(2);
    expect((await ws.command("lighting.set", { ceiling: { countX: 9 } })).error.code).toBe("invalid_args");
    expect((await ws.command("lighting.set", { ceiling: { height: 3.5 } })).error.code).toBe("invalid_args");
    await ws.command("instances.add", { instance: "left", release: station.id });
    const own = await ws.command("lighting.set", { instance: "left", lamps: { colour: "#00ff00", intensity: 2 } });
    expect(own.result.lighting.instances.left).toEqual({ colour: "#00ff00", intensity: 2 });
    expect((await ws.command("lighting.set", { instance: "left", lamps: { colour: null, intensity: null } })).result.lighting.instances).toBeUndefined();
    expect((await ws.command("lighting.set", { instance: "nobody", lamps: { on: false } })).ok).toBe(false);
    expect((await ws.command("undo", { version: set.recorded })).ok).toBe(false); // later lighting edits supersede it
    await ws.command("lighting.set", { ceiling: { height: 2.5 } });
    expect((await ws.command("room.set", { height: 2.4 })).error.code).toBe("invalid_args");
    expect((await ws.command("undo", {})).ok).toBe(true);
    expect((await ws.state()).lighting?.ceiling.height).toBeNull();
    // A simulation's live values: stored and visible, but no revision and no undo entry; at most 10 a second.
    const before = await ws.state();
    const live = await ws.command("lighting.set", { instance: "left", lamps: { colour: "#ff0000" }, live: true });
    expect([live.ok, live.recorded, live.version]).toEqual([true, null, before.version]);
    const after = await ws.state();
    expect([after.version, after.lighting?.instances?.left?.colour]).toEqual([before.version, "#ff0000"]);
    const burst = await Promise.all(Array.from({ length: 12 }, (_, n) => ws.command("lighting.set", { ceiling: { intensity: n / 10 }, live: true })));
    expect(burst.filter(r => !r.ok).map(r => r.error.code)).toContain("rate_limited");
  });

  test("unsupported scene format fails without rewriting the file", async () => {
    const app = setup(), ws = await app.create();
    const file = (readdirSync(join(app.dir, "projects"), { recursive: true }) as string[]).find(f => f.endsWith(ws.id + ".json"))!;
    const path = join(app.dir, "projects", file), stored = JSON.parse(readFileSync(path, "utf8"));
    const raw = JSON.stringify({ ...stored, record: { scene: { schema: "other/1" } } });
    writeFileSync(path, raw);
    const response = await app.get(ws.path + "/state");
    expect(response.status).toBe(422);
    expect(((await response.json()) as any).error.code).toBe("unsupported_format");
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  test("rooms from the retired single-file store become projects once, keeping ID, revision and undo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synergon-room-migrate-")); dirs.push(dir);
    const first = setup(), ws = await first.create();
    await ws.command("instances.add", { instance: "display", release: display.id });
    const record = JSON.parse(readFileSync(join(first.dir, "projects", (readdirSync(join(first.dir, "projects"), { recursive: true }) as string[])
      .find(f => f.endsWith(ws.id + ".json"))!), "utf8")).record;
    const db = new Database(join(dir, "rooms-v1.sqlite"), { create: true });
    db.run("CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, doc TEXT NOT NULL)");
    const other = "11111111-1111-4111-8111-111111111111";
    db.query("INSERT INTO rooms VALUES (?,?,?,?)").run(ws.id, "Control room", 1, JSON.stringify({ ...record, scene: { ...record.scene, name: "Control room" } }));
    db.query("INSERT INTO rooms VALUES (?,?,?,?)").run(other, "Untitled room", 0, JSON.stringify({ scene: { ...record.scene, id: other, name: "Untitled room", version: 0, instances: [] }, history: [] }));
    db.close();
    const api = createRoomApi({ dataDir: dir, catalog, publicMode: true }); servers.push(api);
    const get = async (url: string) => (await api.fetch(new Request("http://localhost/api/" + url))).json() as Promise<any>;
    const state = await get("scenes/" + ws.id + "/state");
    expect([state.name, state.version, state.instances.length]).toEqual(["Control room", 1, 1]);
    const where = await get("scenes/" + ws.id + "/meta");
    expect([where.workspace.name, where.project.name]).toEqual(["Shared", "Examples"]);
    // Every other room keeps its link but sits in a workspace the public list does not show.
    const earlier = await get("scenes/" + other + "/meta");
    expect([earlier.name, earlier.workspace.name, earlier.project.name]).toEqual(["Untitled scene", "Earlier rooms", "Earlier layouts"]);
    expect((await get("workspaces")).workspaces.map((w: any) => w.name)).toEqual(["Shared"]);
    expect(readdirSync(dir).filter(f => f.startsWith("rooms-v1"))).toEqual(["rooms-v1.sqlite.migrated"]);
  });

  test("door approach and clipped opening handle jamb overlap, rotation, successive blockers and undo", async () => {
    const ws = await setup().create();
    await ws.command("instances.add", { instance: "display", release: display.id, x: 1.6, y: 1 });
    const measure = async () => (await ws.command("measure.clearance", { instance: "display" })).result;
    const first = await measure();
    expect(first.metres).toBeCloseTo(.75); expect(first.opening.metres).toBeCloseTo(1.2);
    await ws.command("instances.move", { instance: "display", y: .75 });
    expect((await measure()).metres).toBeCloseTo(.5);
    const blocked = await ws.command("instances.move", { instance: "display", x: .8, y: 0 });
    const gap = await measure();
    expect(gap.opening.metres).toBeCloseTo(.9); expect(gap.opening.points[0][0]).toBeCloseTo(1.3);
    expect(gap.metres).toBe(0); expect(gap.opening.blockers).toEqual(["display"]);
    expect(gap.opening.edges).toEqual(["display/footprint.max-x", "door/east-jamb"]);
    await ws.command("instances.add", { instance: "other", release: display.id, x: 2.2, y: 0, yaw: 90 });
    expect((await measure()).opening.metres).toBeCloseTo(.65);
    await ws.command("undo", { version: blocked.recorded });
    expect((await measure()).opening.metres).toBeCloseTo(.95);
    await ws.command("undo", { version: 4 });
    expect((await measure()).opening.metres).toBeCloseTo(1.2);
  });
});
