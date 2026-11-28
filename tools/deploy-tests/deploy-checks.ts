// Local test of the live-site checks of tools/deploy.ts (builder D, step 1): verifySite() against local stand-ins
// for the production site, built from dist/ (run `bun run dist` first). No SSH, no network beyond 127.0.0.1.
//   bun tools/deploy-tests/deploy-checks.ts
import { readFileSync, readdirSync, statSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { verifySite, routeProbe, rollbackRefusal, FIRST_ROLLOUT } from "../deploy.ts";
import { READS, currentVersion } from "../version.ts";
import { serveFolder } from "../dist.ts";

const dist = process.env.SYNERGON_DIST_TEST_DIR || join(import.meta.dir, "..", "..", "dist");
const version = JSON.parse(readFileSync(join(dist, "version.json"), "utf8"));
if (!version.server?.format) throw new Error("dist/version.json has no server entry: run bun run dist first");
const glbBuf = readFileSync(join(dist, "asset", `${version.model.asset}.glb`));
const glb = { path: `asset/${version.model.asset}.glb`, bytes: glbBuf.length, sha256: createHash("sha256").update(glbBuf).digest("hex") };
const wikiPages = ["README.html"];
let pass = 0, fail = 0;
const expect = (what: string, cond: boolean, detail = "") => { cond ? pass++ : fail++; console.log(`  ${cond ? "ok  " : "FAIL"} ${what}${!cond && detail ? `: ${detail}` : ""}`); };

/** A stand-in Synergon server: answers /api/health with `status` and `revision()`, and the read-only scene API that the checks of the live
 *  site ask besides the health: the shared workspace, its tree, one scene's meta, the catalog and the command catalogue. `workspaces` false:
 *  no hierarchy (404), as the server of a release before it. */
const WS = "00000000-0000-4000-8000-000000000001", PROJECT = "6f1c2a3e-5b7d-4c9a-8e0f-1a2b3c4d5e6f", SCENE = "7a2d3b4f-6c8e-4dab-9f10-2b3c4d5e6f70";
function fakeApi(status: () => number, revision: () => string, workspaces = true) {
  return Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/api/health") return Response.json({ ok: true, revision: revision(), format: version.server?.format, mode: "deployed" }, { status: status() });
    if (p === "/api/catalog") return Response.json({ releases: version.server?.releases.map((r: { id: string; digest: string }) => ({ ...r, modelUrl: `/api/library/${r.digest}/model.glb` })) });
    if (p === "/api/commands") return Response.json({ commands: ["instances.move", "assessment.run"].map(id => ({id})) });
    if (!workspaces) return new Response("not found", { status: 404 });
    if (p === "/api/workspaces") return Response.json({ workspaces: [{ id: WS, name: "Shared" }] });
    if (p === `/api/workspaces/${WS}`) return Response.json({ id: WS, name: "Shared", projects: [{ id: PROJECT, name: "Control room", scenes: [{ id: SCENE, name: "Control room" }] }] });
    if (p === `/api/scenes/${SCENE}/meta`) return Response.json({ id: SCENE, name: "Control room", version: 0, liveConnections: 0, workspace: { id: WS, name: "Shared" }, project: { id: PROJECT, name: "Control room" } });
    return new Response("not found", { status: 404 });
  } });
}
async function run(name: string, site: { origin: string }, v: any) {
  const cfg = { host: "unused", remoteRoot: "/srv/synergon", publicUrl: `${site.origin}/`, keepReleases: 5 };
  const t = performance.now(), checks = await verifySite(cfg, { version: v, glb, wikiPages });
  const secs = (performance.now() - t) / 1000;
  console.log(`${name} (${secs.toFixed(1)} s)`);
  return { checks, secs, failed: checks.filter((c) => !c.ok && c.required), get: (s: string) => checks.find((c) => c.what.startsWith(s)) };
}
const noServer = (() => { const { server, ...v } = version; return v; })();
// the same release as it was before the server: a folder of links to dist/ with a version.json without the server entry
const oldDist = mkdtempSync(join(tmpdir(), "deploy-checks-"));
for (const f of readdirSync(dist)) if (f !== "version.json") symlinkSync(join(dist, f), join(oldDist, f));
writeFileSync(join(oldDist, "version.json"), JSON.stringify(noServer, null, 1) + "\n");

// 1. a release without a server entry, today's site (no API route): no health check, server.js not served
{
  const s = serveFolder(oldDist, "/");
  const r = await run("1. release without a server, site without the API route", s, noServer);
  expect("all required checks pass", r.failed.length === 0, r.failed.map((c) => c.what + ": " + c.detail).join("; "));
  expect("no api/health check", !r.get("server: api/health"));
  expect("server/server.js checked", r.get("server code not served")?.ok === true);
  s.server.stop(true);
}
// 2. a release with a server, host not set up yet (no route: api/health 404). Security review M4: the deploy asks before
//    the switch and stops; if it got that far anyway, the 404 after the switch is a failure (the deploy switches back).
{
  const s = serveFolder(oldDist, "/");                     // today's site: no API route, so api/health is a 404
  const p = await routeProbe({ publicUrl: `${s.origin}/` });
  console.log("2. release with a server, host not set up (api/health 404)");
  expect("the probe before the switch says stop", p.ok === false && p.status === 404, p.detail);
  expect("naming the order of the first rollout", p.detail.includes(FIRST_ROLLOUT) && /setup-server\.sh --apply/.test(p.detail), p.detail);
  const r = await run("   ... and after a switch", s, version);
  const h = r.get("server: api/health");
  expect("a 404 after the switch fails at once (and switches back)", h?.ok === false && h.required && /404/.test(h.detail) && r.secs < 10, `${h?.detail}; ${r.secs} s`);
  s.server.stop(true);
  const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }), port = dead.port; dead.stop(true);
  const routed = serveFolder(dist, "/", { api: `http://127.0.0.1:${port}` });       // the route, no service yet: 502
  const q = await routeProbe({ publicUrl: `${routed.origin}/` });
  expect("with the route but no service yet (502) the deploy goes on", q.ok === true && q.status === 502, q.detail);
  routed.server.stop(true);
  const gone = await routeProbe({ publicUrl: `http://127.0.0.1:${port}/` });
  expect("no answer at all: stop (the 404 rule cannot be confirmed)", gone.ok === false && gone.status === null, gone.detail);
}
// 3. route and server, the old server answers for 3 s with the previous revision, then the new one
{
  const t0 = Date.now(), api = fakeApi(() => 200, () => (Date.now() - t0 < 3000 ? "0000000" : version.revision));
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("3. old server first, then the new revision", s, version);
  expect("all required checks pass", r.failed.length === 0, r.failed.map((c) => c.what + ": " + c.detail).join("; "));
  expect("health ok after the switch", /^ok after/.test(r.get("server: api/health")?.detail ?? ""), r.get("server: api/health")?.detail);
  s.server.stop(true); api.stop(true);
}
// 4. route, but the service does not run (502 from the proxy): failure after 20 s
{
  const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }), port = dead.port; dead.stop(true);
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${port}` });
  const r = await run("4. route without a running service (502)", s, version);
  const h = r.get("server: api/health");
  expect("health check fails (so the deploy rolls back)", h?.ok === false && h.required, h?.detail);
  expect("after about 20 s", r.secs >= 19 && r.secs < 30, `${r.secs} s`);
  expect("says 502", /HTTP 502 after 20 s/.test(h?.detail ?? ""), h?.detail);
  s.server.stop(true);
}
// 5. the server keeps reporting another revision: failure
{
  const api = fakeApi(() => 200, () => "fedcba9");
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("5. a server that reports another revision", s, version);
  const h = r.get("server: api/health");
  expect("health check fails, naming the revision", h?.ok === false && /reports revision fedcba9 after 20 s/.test(h.detail), h?.detail);
  s.server.stop(true); api.stop(true);
}
// 6. a web server that hands out server/server.js: failure, also for a release without a server entry
{
  const files = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname);
    let f = join(oldDist, p.replace(/^\//, ""));
    try { if (statSync(f).isDirectory()) { if (!p.endsWith("/")) return new Response(null, { status: 301, headers: { location: p + "/" } }); f = join(f, "index.html"); } return new Response(Bun.file(f), { headers: f.endsWith(".html") ? { "content-type": "text/html; charset=utf-8" } : {} }); } catch { return new Response("no", { status: 404 }); }
  } });
  const r = await run("6. web server without the 404 rule for server/", { origin: `http://127.0.0.1:${files.port}` }, noServer);
  const c = r.get("server code not served");
  expect("server.js check fails and is required", c?.ok === false && c.required, c?.detail);
  expect("it is the only failure", r.failed.length === 1, r.failed.map((x) => x.what).join("; "));
  files.stop(true);
}
// 7. a server that answers its health but has no workspace hierarchy (a release before it): the deploy must not call it good
{
  const api = fakeApi(() => 200, () => version.revision, false);
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("7. a server without the workspace hierarchy", s, version);
  const w = r.get("server: api/workspaces");
  expect("the list of workspaces fails and is required", w?.ok === false && w.required && /HTTP 404/.test(w.detail), w?.detail);
  expect("health itself is fine", r.get("server: api/health reports revision")?.ok === true);
  s.server.stop(true); api.stop(true);
}
// 8. the scene API in a good server: every read passes, the deploy only reads, and no removed address is asked
{
  const asked: string[] = [], inner = fakeApi(() => 200, () => version.revision), api = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) { asked.push(`${req.method} ${new URL(req.url).pathname}`); return inner.fetch(req); } });
  const s = serveFolder(dist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("8. what the checks ask of the server", s, version);
  const names = ["server: api/health reports the format", "server: api/workspaces", "server: the shared workspace's tree", "server: scene metadata", "server: installed public room editions", "server: public scene command catalogue", "agent guide, homepage"];
  expect("the hierarchy, a scene's meta, catalog, commands and guide are checked and ok", names.every((n) => r.get(n)?.ok === true), r.checks.map((c) => `${c.what}: ${c.detail}`).join("; "));
  expect("all required checks pass", r.failed.length === 0, r.failed.map((c) => c.what + ": " + c.detail).join("; "));
  expect("the deploy only reads", asked.every((a) => a.startsWith("GET ")), asked.join(", "));
  expect("no scene is opened live or edited", !asked.some((a) => /\/(live|command|mcp|state)$/.test(a)), asked.join(", "));
  expect("no removed address is asked", !asked.some((a) => a.includes("/api/room") || ["/api/live", "/api/command", "/api/mcp"].some((p) => a.endsWith(" " + p))), asked.join(", "));
  s.server.stop(true); api.stop(true); inner.stop(true);
}
// 9. a rollback target from before the scene API (another server.format): its health alone is checked
{
  const older = { ...version, server: { format: "synergon-scene/1" } }, olderDist = mkdtempSync(join(tmpdir(), "deploy-checks-older-"));
  for (const f of readdirSync(dist)) if (f !== "version.json") symlinkSync(join(dist, f), join(olderDist, f));
  writeFileSync(join(olderDist, "version.json"), JSON.stringify(older, null, 1) + "\n");
  const api = fakeApi(() => 200, () => version.revision, false);
  const s = serveFolder(olderDist, "/", { api: `http://127.0.0.1:${api.port}` });
  const r = await run("9. an older release's server", s, older);
  expect("health checked and ok", r.get("server: api/health reports revision")?.ok === true);
  expect("no scene API check", !r.get("server: api/workspaces") && !r.get("server: installed public room editions"), r.checks.map((c) => c.what).join("; "));
  expect("all required checks pass", r.failed.length === 0, r.failed.map((c) => c.what + ": " + c.detail).join("; "));
  s.server.stop(true); api.stop(true); rmSync(olderDist, { recursive: true, force: true });
}
// 10. the rollback rule for scene fields: never back to a release that cannot read what the live one reads
{
  console.log("10. rollback and the scene fields a release reads (version.json reads)");
  const server = { format: version.server.format }, before = { server }, reader = { server, reads: ["content"] };
  const reads = currentVersion().reads;
  expect("a version.json made now reads content", JSON.stringify(reads) === JSON.stringify(READS) && reads.includes("content"), JSON.stringify(reads));
  const why = rollbackRefusal(reader, before, "live-a", "older-b");
  expect("refused from a release that reads content to one without reads", !!why && why.includes("content") && why.includes("older-b"), String(why));
  expect("refused when the target reads less", !!rollbackRefusal({ server, reads: ["content", "next"] }, reader, "l", "t")?.includes("next"));
  expect("allowed between releases that read the same", rollbackRefusal(reader, { server, reads: ["content"] }, "l", "t") === null);
  expect("allowed to a release that reads more", rollbackRefusal(reader, { server, reads: ["content", "next"] }, "l", "t") === null);
  expect("allowed between releases without reads", rollbackRefusal(before, { server }, "l", "t") === null);
  expect("the server rule still holds", /has a server and t has none/.test(rollbackRefusal(reader, { reads: ["content"] }, "l", "t") ?? ""));
}
// 11. live screen content: a release that reads content carries the frame-src meta tag of server/live-apps.json
{
  const bare = mkdtempSync(join(tmpdir(), "deploy-checks-meta-"));
  for (const f of readdirSync(oldDist)) if (f !== "index.html") symlinkSync(join(oldDist, f), join(bare, f));
  writeFileSync(join(bare, "index.html"), readFileSync(join(dist, "index.html"), "utf8").replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, ""));
  const s = serveFolder(bare, "/");
  const r = await run("11. a page without the frame-src meta tag", s, noServer);
  const c = r.get("frame-src meta tag");
  expect("the meta tag check fails and is required", c?.ok === false && c.required, c?.detail);
  const old = await run("   ... and a release that does not read content", s, { ...noServer, reads: [] });
  expect("is not asked for it", !old.get("frame-src meta tag"), old.checks.map((x) => x.what).join("; "));
  const good = serveFolder(oldDist, "/"), ok = await run("   ... and the built page", good, noServer);
  expect("the built page passes", ok.get("frame-src meta tag")?.ok === true, ok.get("frame-src meta tag")?.detail);
  s.server.stop(true); good.server.stop(true); rmSync(bare, { recursive: true, force: true });
}
rmSync(oldDist, { recursive: true, force: true });
console.log(`\ndeploy checks test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
