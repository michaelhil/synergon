// Build the public release: the homepage, the room editor, the agent guide, the built-in asset editions and the
// public screening source. The local room service, its data directory and project stores are never opened by this build.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { loadRoomLibrary } from "../server/room-library.ts";
import { frameSrcMeta } from "../server/live-apps.ts";
import { ROOM_SCHEMA } from "../shared/room.ts";
import { runtimeParams } from "./bundle.ts";
import { ROOT } from "./timeline.ts";

export async function buildRoomRelease(out: string) {
  const view = join(ROOT, "viewer");
  const bundle = await Bun.build({
    entrypoints: [join(view, "src", "room-app.ts")], target: "browser", format: "esm", splitting: true, minify: true,
    naming: { entry: "room-entry.[ext]", chunk: "room-[hash].[ext]" }, plugins: [runtimeParams],
  });
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  for (const file of bundle.outputs) writeFileSync(join(out, basename(file.path)), new Uint8Array(await file.arrayBuffer()));
  for (const file of ["release-entry.js", "room.css", "room-view.css"]) copyFileSync(join(view, file), join(out, file));
  // The homepage's own small script and its story pictures.
  const home = await Bun.build({ entrypoints: [join(view, "src", "home.ts")], target: "browser", format: "esm", minify: true, naming: { entry: "home.[ext]" } });
  if (!home.success) throw new Error(home.logs.map(String).join("\n"));
  writeFileSync(join(out, "home.js"), new Uint8Array(await home.outputs[0].arrayBuffer()));
  mkdirSync(join(out, "home"), { recursive: true });
  for (const file of readdirSync(join(view, "home"))) if (file.endsWith(".jpg")) copyFileSync(join(view, "home", file), join(out, "home", file));
  // A tag from the bytes of every page script and stylesheet: a new release gets new addresses, so browsers
  // that cached the previous scripts (they are not marked no-cache) load the new ones.
  const tagged = ["release-entry.js", "room-entry.js", "home.js", "room.css", "room-view.css"].filter(f => existsSync(join(out, f)));
  const tag = createHash("sha256").update(tagged.map(f => readFileSync(join(out, f))).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))).digest("hex").slice(0, 12);
  const page = readFileSync(join(view, "room.html"), "utf8");
  if (!page.includes('src="/room-entry.js"')) throw new Error("viewer/room.html does not load /room-entry.js");
  if ((page.match(/<head>/g) ?? []).length !== 1) throw new Error("viewer/room.html needs exactly one <head>");
  // Live screen content: frames may load only the apps' origins and the allowed sites (a framed page cannot navigate
  // its frame anywhere else). Caddy serves these files as they are, so the policy is a meta tag.
  writeFileSync(join(out, "index.html"), page.replace("<head>", "<head>\n" + frameSrcMeta()).replace('src="/room-entry.js"', 'src="/release-entry.js?v=' + tag + '"'));
  // One guide for both installations; its local-only section says so itself.
  copyFileSync(join(view, "room-guide.txt"), join(out, "llms.txt"));
  const guide = "workstation-screening.md", source = join(ROOT, "wiki", "85-standards", guide);
  for (const folder of ["standards", "server/standards"]) {
    mkdirSync(join(out, folder), { recursive: true });
    copyFileSync(source, join(out, folder, guide));
  }
  const tmp = mkdtempSync(join(tmpdir(), "synergon-room-assets-"));
  try {
    const { catalog, files } = await loadRoomLibrary(tmp);
    const pins = catalog.releases.map(({ id, digest }) => ({ id, digest }));
    if (!catalog.releases.some(r => r.kind === "station")) throw new Error("No built-in station edition for the public release");
    for (const { id } of pins) if (!catalog.transfer?.describe(id).redistributable)
      throw new Error("The public release requires a redistributable edition: " + id);
    // The server serves these files at /api/library/<digest>/..., the operator's packages among them.
    for (const [url, bytes] of files) {
      const dest = join(out, url);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
    }
    writeFileSync(join(out, "server", "room-catalog.json"), JSON.stringify(pins));
    return { format: ROOM_SCHEMA, releases: pins };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Exercise writes only on the fresh loopback installation started by tools/dist.ts. */
export async function verifyDisposableRoom(origin: string, room: Awaited<ReturnType<typeof buildRoomRelease>>) {
  if (new URL(origin).hostname !== "127.0.0.1") throw new Error("The writable room smoke test requires a loopback preview");
  const endpoint = origin + "/api/", headers = { "x-synergon": "1", "content-type": "application/json", origin, "x-synergon-probe": "1" };
  async function call(path: string, payload?: unknown) {
    const response = await fetch(endpoint + path, { headers, ...(payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) }) });
    if (!response.ok) throw new Error("room smoke: " + path + " HTTP " + response.status + " " + (await response.text()).slice(0, 400));
    return response.json();
  }
  const project = (id: string, args = {}) => fetch(endpoint + "projects/command", { method: "POST", headers, body: JSON.stringify({ id, args }) });
  const made = await project("workspace.create", { name: "Release check (temporary)", template: "demo" });
  const created = made.ok ? await made.json() : await made.text();
  if (typeof created?.scene !== "string" || typeof created.workspace !== "string") throw new Error("public workspace.create failed: HTTP " + made.status + " " + JSON.stringify(created).slice(0, 400));
  const { workspace: ws, scene: id } = created;
  const tree = await call("workspaces/" + ws);
  if (!tree.projects?.some((p: { scenes: { id: string }[] }) => p.scenes.some(s => s.id === id))) throw new Error("the new workspace's tree lacks its scene");
  const meta = await call("scenes/" + id + "/meta");
  if (meta.workspace?.id !== ws || typeof meta.project?.id !== "string") throw new Error("scene meta does not name its workspace and project");
  // A visitor's workspace opens only from its own links: no public listing may name it, its projects or its scenes.
  const listed = await call("workspaces");
  if (listed.workspaces.some((w: { id: string }) => w.id === ws)) throw new Error("the public workspace list shows a visitor's workspace");
  for (const [what, answer] of [["GET /api/projects", await fetch(endpoint + "projects", { headers })], ["project.list", await project("project.list")]] as const) {
    const text = await answer.text();
    if (answer.ok && (text.includes(ws) || text.includes(meta.project.id))) throw new Error(what + " lists a visitor's workspace and project on the public server");
  }
  const apply = (command: string, args = {}) => call("scenes/" + id + "/command", { id: command, args });
  const moved = await apply("room.set", { width: 9 });
  const saved = await call("scenes/" + id + "/state");
  if (!moved.ok || saved.version !== 1 || saved.room.width !== 9) throw new Error("public room edit was not persisted");
  const profile = await apply("assessment.profiles");
  if (!profile.ok || !profile.result.profiles?.length || profile.result.profiles.some((p: {id:string}) => p.id === "customer-layout"))
    throw new Error("public room assessment profile directory failed or exposed customer profile");
  const assessment = await apply("assessment.run");
  if (!assessment.ok) throw new Error("public assessment failed: " + JSON.stringify(assessment.error));
  const customer = await apply("assessment.configure", { profile: "customer-layout" });
  if (customer.ok || customer.error?.code !== "local_only") throw new Error("public server accepted a private customer profile");
  for (const [local, args] of Object.entries({
    "project.record": { project: meta.project.id, markdown: "# Check\n", previous: "" }, "project.save": { project: meta.project.id, scene: id, name: "Check" },
    "project.export": { project: meta.project.id }, "project.import": { package: {} },
  })) {
    const refused = await project(local, args);
    if (refused.status !== 403) throw new Error("public server accepted the local command " + local + " (HTTP " + refused.status + ")");
  }
  const commands = await call("commands");
  if (commands.commands.some((c: {id:string})=> c.id.startsWith("project."))) throw new Error("project commands in the scene command catalogue");
  const { releases } = await call("catalog");
  if (!room.releases.every(pin => releases.some((r: {id:string}) => r.id === pin.id))) throw new Error("public catalog pin mismatch");
  const pinned = releases.find((r: { modelUrl: string }) => r.modelUrl);
  if (!pinned?.modelUrl.startsWith("/api/library/") || !(await fetch(origin + pinned.modelUrl, { headers })).ok) throw new Error("library files are not served under /api/library/");
  const page = await (await fetch(origin + "/", { headers })).text();
  if (page.split("Content-Security-Policy").length !== 2 || !page.includes("<head>\n" + frameSrcMeta()))
    throw new Error("index.html lacks the frame-src meta tag of server/live-apps.json right after <head>, or has another policy");
  const catalogFile = await fetch(origin + "/server/room-catalog.json", { headers, redirect: "manual" });
  if (catalogFile.status !== 404) throw new Error("server catalog file is downloadable");
  for (const file of ["standards/workstation-screening.md", "wiki/85-standards/workstation-screening.html"]) {
    if (!(await fetch(origin + "/" + file)).ok) throw new Error("missing screening source " + file);
  }
  return { workspace: ws, scene: id };
}
