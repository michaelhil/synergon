// bun run deploy [--dry-run] [--allow-lint] [--allow-dirty] [--no-images]
// bun run deploy --prepared          upload, switch and check a dist/ that a `--dry-run` of the same commit has just built
//                                    and checked (the CI runs the two as separate steps, so that the deploy key is on disk
//                                    only while the network part runs; security review S9)
// bun run deploy --rollback [--dry-run]
//   --config <file>  another settings file (default deploy.config.json), for a test server
//
// Publishes the viewer, the model and the wiki (the folder dist/ that `bun run dist` assembles) to a plain static web
// server over SSH. Every deployment is a new, complete release folder; the live site is a symlink that is switched to the
// new folder in one atomic step, checked over HTTPS, and switched back if the check fails. Settings: deploy.config.json.
//
//   (a) refuse unless: `bun run check` passes; `bun run wiki lint` passes (or --allow-lint); the git working tree has no
//       uncommitted change (or --allow-dirty; a folder that is not a git repository yet counts as uncommitted)
//   (b) bun run build; bun run render --set wiki (skipped with --no-images); bun run wiki index; bun run wiki build;
//       bun run dist (which verifies the result from the root / in headless Chromium). If these steps changed a
//       committed file (regenerated images, the index), stop unless --allow-dirty: the site would not match the commit.
//   (c) ssh <host> mkdir -p <remoteRoot>/releases; rsync -az --delete dist/ to <remoteRoot>/releases/<UTC time>-<revision>/
//   (d) ln -sfn <release> <remoteRoot>/current.tmp && mv -T <remoteRoot>/current.tmp <remoteRoot>/current
//   (e) over HTTPS: <publicUrl> is 200 and HTML (https://synergon.mightwork.ai/); <publicUrl>version.json equals
//       dist/version.json; the GLB under <publicUrl>asset/ has the local size and SHA-256; <publicUrl>wiki/ and two wiki
//       pages are 200;
//       <publicUrl>server/server.js does not answer 200 (the server's code is in the release but never served); and for
//       a release with a server (version.json has a `server` entry) <publicUrl>api/health reports the deployed revision
//       within 20 s, polled every second (any 404 or other answer after 20 s fails and switches back), then, read only,
//       the scene API: the health's format, GET api/workspaces (the shared workspace), its tree with a scene, that
//       scene's meta, api/catalog (the editions pinned in version.json), api/commands, llms.txt and the homepage's
//       release-entry (sceneChecks; a rollback target from before the scene API is checked by its health). Before the
//       switch, a release with a server first asks <publicUrl>api/health: a 404 means the web server has no route for
//       the API, hence no 404 rule for server/ either, and the deploy stops before the upload (run setup-server.sh
//       --apply on the host first). On any failure the symlink goes back to the previous release, that is checked again, and the command
//       exits non-zero. Only after a successful check are release folders beyond keepReleases deleted (never the live one
//       or the one before it).
//   (f) prints a summary and writes dist/deploy-receipt.json.
//
//   --dry-run    do every local step for real, then print the exact remote commands and HTTPS checks without running them
//   --rollback   switch `current` to the release before the live one and check the site (no local build). Refused when
//                the live release has a server and that release has none (both version.json files read with `cat`): once
//                the host runs the server, the site does not go back to a release without it. Refused too when the live
//                release's version.json `reads` names a scene field that release's lacks (scenes saved since might not open
//                there). (The automatic switch-back
//                after a failed deploy always returns to the release that was live before, so this never stops it.)
//
// What this script expects of the server; it never reads or changes web-server configuration:
//   - `host` is an SSH alias (~/.ssh/config) that logs in without a password prompt and may write under remoteRoot;
//     the server has rsync and GNU coreutils (mv -T).
//   - a static file server serves the directory <remoteRoot>/current (following the symlink, resolved per request) at
//     the URL path of publicUrl (the root /; a sub-path works too), serves index.html for a folder and redirects a
//     folder without its trailing slash (and, under a sub-path, the sub-path without its slash). Recommended: the header
//     X-Robots-Tag: noindex.
//   - for a release with a server: <publicUrl>server/* answers 404 and <publicUrl>api/* goes to the Synergon server
//     (the path is not changed); the service restarts from the new release by itself after the switch.
//     The site block for Caddy is deploy/synergon.caddy; the host is set up by deploy/setup-server.sh.
// Server layout:
//   <remoteRoot>/releases/<YYYYMMDDTHHMMSSZ>-<revision>/   one folder per deployment, never changed after upload
//   <remoteRoot>/current -> <remoteRoot>/releases/<…>      what the web server shows
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, timeline } from "./timeline.ts";
import { sourceRevision } from "./version.ts";
import { lintWiki, formatFinding } from "./wiki.ts";
import { ROOM_SCHEMA } from "../shared/room.ts";
import { frameSrcMeta } from "../server/live-apps.ts";

interface Config { host: string; remoteRoot: string; publicUrl: string; keepReleases: number }
interface Check { what: string; url: string; ok: boolean; detail: string; required: boolean }
interface Step { step: string; seconds: number; ok: boolean; note?: string }

const args = process.argv.slice(2), flag = (n: string) => args.includes(n);
const dryRun = flag("--dry-run"), rollback = flag("--rollback"), allowLint = flag("--allow-lint"), allowDirty = flag("--allow-dirty"), noImages = flag("--no-images"), prepared = flag("--prepared");
const known = ["--dry-run", "--rollback", "--allow-lint", "--allow-dirty", "--no-images", "--config", "--prepared"];
const configArg = args.includes("--config") ? args[args.indexOf("--config") + 1] : undefined;
const RELEASE_NAME = /^\d{8}T\d{6}Z-[A-Za-z0-9._+-]+$/;
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20"];
const t0 = performance.now(), steps: Step[] = [];
const secs = (from: number) => (performance.now() - from) / 1000;
const q = (s: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);   // shell quoting for printed and remote commands
const say = (s = "") => console.log(s);
const heading = (s: string) => say(`\n── ${s}`);
function stop(message: string, code = 1): never { console.error(`\ndeploy: ${message}`); timeline(rollback ? "rollback failed" : "deploy failed", secs(t0), message.split("\n")[0]); process.exit(code); }

if (import.meta.main) for (const a of args.filter((x) => x !== configArg)) if (!known.includes(a)) stop(`unknown option ${a} (known: ${known.join(", ")})`, 2);

// ------------------------------------------------------------------------------------------------ configuration
function loadConfig(): Config {
  const file = configArg ? resolve(ROOT, configArg) : join(ROOT, "deploy.config.json");
  if (!existsSync(file)) stop(`${configArg ?? "deploy.config.json"} is missing (host, remoteRoot, publicUrl, keepReleases)`);
  const c = JSON.parse(readFileSync(file, "utf8"));
  const bad: string[] = [];
  if (typeof c.host !== "string" || !/^[A-Za-z0-9._@-]+$/.test(c.host)) bad.push("host must be an SSH alias or user@host without spaces");
  if (typeof c.remoteRoot !== "string" || !/^\/[A-Za-z0-9._/-]+[A-Za-z0-9._-]$/.test(c.remoteRoot) || c.remoteRoot.split("/").filter(Boolean).length < 2 || c.remoteRoot.includes("..")) bad.push("remoteRoot must be an absolute folder at least two levels deep, such as /srv/synergon");
  if (typeof c.publicUrl !== "string" || !/^(https:\/\/[^/]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/(.+\/)?$/.test(c.publicUrl)) bad.push("publicUrl must start with https:// (plain http only for a local test server) and end with /");
  if (!Number.isInteger(c.keepReleases) || c.keepReleases < 2) bad.push("keepReleases must be a whole number, at least 2");
  if (bad.length) stop("deploy.config.json: " + bad.join("; "));
  return { host: c.host, remoteRoot: c.remoteRoot, publicUrl: c.publicUrl, keepReleases: c.keepReleases };
}

// ------------------------------------------------------------------------------------------------ running things
/** A local command, its output shown as it runs. */
function local(step: string, cmd: string[]): boolean {
  heading(`${step}: ${cmd.map(q).join(" ")}`);
  const s = performance.now(), r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: "inherit", env: process.env });
  const ok = r.status === 0;
  steps.push({ step, seconds: secs(s), ok }); timeline(`deploy: ${step}${ok ? "" : " failed"}`, secs(s), cmd.join(" "));
  return ok;
}
/** Every remote command that was (or, in a dry run, would be) run, in order. */
const remoteLog: string[] = [];
function sshCommand(cfg: Config, command: string) { return ["ssh", ...SSH_OPTS, cfg.host, command]; }
/** A command on the server. In a dry run it is printed, not run, and `dry` is returned in place of its output. */
function remote(cfg: Config, command: string, opts: { dry?: string; mayFail?: boolean } = {}): { ok: boolean; out: string } {
  const cmd = sshCommand(cfg, command), shown = cmd.map(q).join(" ");
  remoteLog.push(shown);
  if (dryRun) { say(`  would run: ${shown}`); return { ok: true, out: opts.dry ?? "" }; }
  say(`  $ ${shown}`);
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (r.status !== 0 && !opts.mayFail) stop(`remote command failed (exit ${r.status}): ${shown}\n${(r.stderr || r.stdout || "").trim()}`);
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

// ------------------------------------------------------------------------------------------------ the server side
const releasesDir = (cfg: Config) => `${cfg.remoteRoot}/releases`;
/** Atomic switch of the symlink `current` to an absolute release path. */
const switchCommand = (cfg: Config, target: string, quote = true) => `ln -sfn ${quote ? q(target) : target} ${q(cfg.remoteRoot + "/current.tmp")} && mv -T ${q(cfg.remoteRoot + "/current.tmp")} ${q(cfg.remoteRoot + "/current")}`;
function currentRelease(cfg: Config, dry: string): string | null {
  // the link is written with an absolute target; a relative one (made by hand) is read relative to remoteRoot
  const r = remote(cfg, `readlink ${q(cfg.remoteRoot + "/current")} || true`, { dry });
  const target = (r.out.startsWith("/") ? r.out : r.out ? `${cfg.remoteRoot}/${r.out}` : "").replace(/\/+$/, "").replace(/\/\.\//g, "/");
  return target.startsWith(releasesDir(cfg) + "/") && RELEASE_NAME.test(target.slice(releasesDir(cfg).length + 1)) ? target : null;
}
function listReleases(cfg: Config, dry: string[]): string[] {
  const r = remote(cfg, `ls -1 ${q(releasesDir(cfg))}`, { dry: dry.join("\n") });
  return r.out.split("\n").map((s) => s.trim()).filter((s) => RELEASE_NAME.test(s)).sort();
}

// ------------------------------------------------------------------------------------------------ checking the live site
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string, opts: { redirect?: RequestRedirect } = {}) {
  return fetch(url, { redirect: opts.redirect ?? "follow", headers: { "cache-control": "no-cache", "user-agent": "synergon-deploy-check" }, signal: AbortSignal.timeout(30000) });
}
/** Checks of the live site. `expect` says what version.json must be and how big the model is. */
export async function verifySite(cfg: Config, expect: { version: any; glb: { path: string; bytes: number; sha256: string }; wikiPages: string[] }): Promise<Check[]> {
  const u = cfg.publicUrl, bust = `?check=${Date.now()}`, out: Check[] = [];
  const attempt = async (what: string, url: string, required: boolean, fn: () => Promise<string | true>) => {
    let detail = "";
    for (let i = 0; i < 3; i++) {
      try { const r = await fn(); if (r === true) { out.push({ what, url, ok: true, detail: "ok", required }); return; } detail = r; }
      catch (e: any) { detail = e?.message ?? String(e); }
      await sleep(1000);
    }
    out.push({ what, url, ok: false, detail, required });
  };
  const html = (what: string, url: string, required = true) => attempt(what, url, required, async () => {
    const r = await get(url), type = r.headers.get("content-type") ?? "", body = await r.text();
    if (r.status !== 200) return `HTTP ${r.status}`;
    if (!type.includes("text/html")) return `content-type ${type || "missing"}`;
    return /<html/i.test(body) ? true : "the answer is not an HTML page";
  });
  await html("viewer page", u);
  // live screen content: a release that reads `content` limits what its frames may load with the meta tag made from
  // server/live-apps.json, on the homepage and on a scene's page alike, and with no other policy
  if (Array.isArray(expect.version.reads) && expect.version.reads.includes("content")) await attempt("frame-src meta tag of server/live-apps.json (homepage and workspaces/<id>)", u, true, async () => {
    for (const p of ["", "workspaces/deploy-check"]) {
      const r = await get(u + p + bust), body = await r.text();
      if (p && r.status !== 200) continue;   // a scene's page that is not the viewer page has its own (warning) check below
      if (body.split("Content-Security-Policy").length !== 2 || !body.includes(frameSrcMeta())) return `${u + p} does not carry exactly ${frameSrcMeta()}`;
    }
    return true;
  });
  await attempt("version.json is the expected one", u + "version.json" + bust, true, async () => {
    const r = await get(u + "version.json" + bust);
    if (r.status !== 200) return `HTTP ${r.status}`;
    const live = await r.json();
    return JSON.stringify(live) === JSON.stringify(expect.version) ? true : `live ${live?.short ?? "?"} (built ${live?.built ?? "?"}), expected ${expect.version.short} (built ${expect.version.built})`;
  });
  await attempt("model (GLB): size and SHA-256", u + expect.glb.path, true, async () => {
    const r = await get(u + expect.glb.path);
    if (r.status !== 200) return `HTTP ${r.status}`;
    const buf = Buffer.from(await r.arrayBuffer()), sha = createHash("sha256").update(buf).digest("hex");
    return buf.length === expect.glb.bytes && sha === expect.glb.sha256 ? true : `${buf.length} bytes, sha256 ${sha.slice(0, 12)}…; expected ${expect.glb.bytes} bytes, ${expect.glb.sha256.slice(0, 12)}…`;
  });
  await html("wiki start page", u + "wiki/");
  for (const p of expect.wikiPages) await html(`wiki page ${p}`, u + "wiki/" + p);
  // the server's code is in every release with a server, and the web server must never hand it out
  await attempt("server code not served (server/server.js, server/, server)", u + "server/server.js", true, async () => {
    for (const p of ["server/server.js", "server/", "server"]) {
      const r = await get(u + p + bust, { redirect: "manual" }); await r.arrayBuffer();
      if (r.status === 200) return `HTTP 200 for ${u + p}: the server's code is public; is the 404 rule for server/ in the web server's site block?`;
    }
    return true;
  });
  if (expect.version.server) {
    const health = await serverHealth(u, expect.version.revision);
    out.push(health);
    // the scene API of this release (read only: the deploy never writes to the live site). A release from before it
    // (a rollback target whose version.json names another format) is checked by its health alone.
    if (health.ok && expect.version.server.format === ROOM_FORMAT) out.push(...(await sceneChecks(u, expect.version.server)));
  }
  // server behaviour the site relies on; reported, but not a reason to roll back
  const base = u.replace(/\/$/, "");
  if (new URL(u).pathname !== "/") {   // a site under a sub-path: the sub-path without its slash leads to the one with it
    await attempt(`${new URL(base).pathname} redirects to ${new URL(u).pathname}`, base, false, async () => {
      const r = await get(base, { redirect: "manual" }), to = r.headers.get("location") ?? "";
      return r.status >= 301 && r.status <= 308 && new URL(to, base).href === u ? true : `HTTP ${r.status}${to ? ` to ${to}` : ""}`;
    });
  }
  // a scene's address is a page of the viewer (the web server hands out index.html for workspaces/*)
  await attempt("workspaces/<scene id> gives the viewer page", u + "workspaces/deploy-check", false, async () => {
    const r = await get(u + "workspaces/deploy-check"), type = r.headers.get("content-type") ?? "", body = await r.text();
    return r.status === 200 && type.includes("text/html") && /<html/i.test(body) ? true : `HTTP ${r.status}${type ? `, ${type}` : ""}`;
  });
  await attempt("wiki without the trailing slash redirects to wiki/", u + "wiki", false, async () => {
    const r = await get(u + "wiki", { redirect: "manual" }), to = r.headers.get("location") ?? "";
    return r.status >= 301 && r.status <= 308 && new URL(to, u + "wiki").href === u + "wiki/" ? true : `HTTP ${r.status}${to ? ` to ${to} (resolves to ${new URL(to, u + "wiki").href})` : ""}`;
  });
  await attempt("X-Robots-Tag: noindex", u, false, async () => { const h = (await get(u)).headers.get("x-robots-tag") ?? ""; return /noindex/i.test(h) ? true : `header ${h ? `is '${h}'` : "missing"} (the pages also carry a robots meta tag)`; });
  return out;
}
/** The order of the first rollout (design step 1): the host's route first, then a release with a server. */
export const FIRST_ROLLOUT = "the web server has no /api/ route, so it has no 404 rule for /server/ either, and this release would make server/server.js public. Order of the first rollout: (1) on the host, deploy/setup-server.sh --apply (the Caddy route and the 404 rule, then the service); (2) then deploy a release with server/; (3) then the health check passes. Nothing was switched.";
/** Before the switch (the old release still live): a release with a server needs the API route on the host. A 404 (no route) or no
 *  answer stops the deploy; 200 (an older server) or 502/503 (the route without a running service, as before the first server release) go on. */
export async function routeProbe(cfg: Pick<Config, "publicUrl">): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const url = cfg.publicUrl + "api/health";
  try {
    const r = await fetch(url, { headers: { "cache-control": "no-cache", "user-agent": "synergon-deploy-check" }, signal: AbortSignal.timeout(10000), redirect: "manual" });
    await r.arrayBuffer();
    if (r.status === 404) return { ok: false, status: 404, detail: `GET ${url} answered 404: ${FIRST_ROLLOUT}` };
    return { ok: true, status: r.status, detail: `GET ${url} answered ${r.status}: the route is there` };
  } catch (e: any) { return { ok: false, status: null, detail: `GET ${url} did not answer (${e?.message ?? e}); without it the 404 rule for server/ cannot be confirmed, so nothing was switched` }; }
}
/** The Synergon server of a release: <publicUrl>api/health must report `revision` within 20 s (polled every second; the server of the release that was
 *  live before keeps answering until it notices the switch and systemd starts the new one). A 404 fails at once (the route has gone); anything else
 *  after 20 s (502, another revision) is a failure. */
async function serverHealth(u: string, revision: string): Promise<Check> {
  const url = u + "api/health", what = `server: api/health reports revision ${revision} within 20 s`, t = Date.now();
  let detail = "no answer";
  for (;;) {
    try {
      const r = await fetch(url, { headers: { "cache-control": "no-cache", "user-agent": "synergon-deploy-check" }, signal: AbortSignal.timeout(5000) }), body = await r.text();
      if (r.status === 404) return { what, url, ok: false, detail: "HTTP 404: the web server has no route for the API", required: true };
      if (r.status === 200) {
        const live = (() => { try { return JSON.parse(body); } catch { return null; } })();
        if (live?.revision === revision) return { what, url, ok: true, detail: `ok after ${((Date.now() - t) / 1000).toFixed(1)} s`, required: true };
        detail = live ? `reports revision ${live.revision}` : "HTTP 200 but not JSON";
      } else detail = `HTTP ${r.status}`;
    } catch (e: any) { detail = e?.message ?? String(e); }
    if (Date.now() - t >= 20000) return { what, url, ok: false, detail: `${detail} after 20 s`, required: true };
    await sleep(1000);
  }
}
/** The format of the scene API whose routes sceneChecks reads. */
export const ROOM_FORMAT = ROOM_SCHEMA;
/** The public scene API, read only: health format, the shared workspace and one of its scenes, the installed editions, the command
 *  catalogue, the agent guide and the homepage. Every check is required. */
async function sceneChecks(u: string, server: { format: string; releases: { id: string; digest: string }[] }): Promise<Check[]> {
  const out: Check[] = [];
  const read = async (url: string) => {
    const r = await get(url), body: any = r.status === 200 ? await r.json().catch(() => null) : (await r.arrayBuffer(), null);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (body === null) throw new Error("HTTP 200 but not JSON");
    return body;
  };
  const check = async (what: string, url: string, fn: () => Promise<string | true>) => {
    try { const r = await fn(); out.push({ what, url, ok: r === true, detail: r === true ? "ok" : r, required: true }); return r === true; }
    catch (e: any) { out.push({ what, url, ok: false, detail: e?.message ?? String(e), required: true }); return false; }
  };
  await check(`server: api/health reports the format ${server.format}`, u + "api/health", async () => {
    const h = await read(u + "api/health");
    return h.format === server.format ? true : `reports format ${h.format}`;
  });
  let ws = "", scene = "";
  const listed = await check("server: api/workspaces lists the shared workspace", u + "api/workspaces", async () => {
    const body = await read(u + "api/workspaces");
    if (!Array.isArray(body?.workspaces)) return "HTTP 200 but not a list of workspaces";
    if (body.workspaces.length !== 1 || typeof body.workspaces[0]?.id !== "string") return `expected the shared workspace alone, got ${body.workspaces.length} workspace(s)`;
    ws = body.workspaces[0].id;
    return true;
  });
  if (listed) await check("server: the shared workspace's tree has a scene", u + "api/workspaces/" + ws, async () => {
    const tree = await read(u + "api/workspaces/" + encodeURIComponent(ws));
    if (tree?.id !== ws || !Array.isArray(tree?.projects)) return "not the tree of the shared workspace";
    scene = tree.projects.flatMap((p: any) => Array.isArray(p?.scenes) ? p.scenes : [])[0]?.id ?? "";
    return scene ? true : "the shared workspace holds no scene (the server makes one at its first start)";
  });
  if (scene) await check("server: scene metadata names its workspace", u + "api/scenes/" + scene + "/meta", async () => {
    const meta = await read(u + "api/scenes/" + encodeURIComponent(scene) + "/meta");
    return meta?.id === scene && meta?.workspace?.id === ws && typeof meta?.project?.id === "string" ? true : "metadata does not match the scene";
  });
  await check("server: installed public room editions", u + "api/catalog", async () => {
    const { releases } = await read(u + "api/catalog");
    return Array.isArray(releases) && server.releases.every((pin) => releases.some((r: any) => r.id === pin.id && r.digest === pin.digest && String(r.modelUrl).startsWith("/api/library/")))
      ? true : "the catalog differs from version.json or its files are not under /api/library/";
  });
  await check("server: public scene command catalogue", u + "api/commands", async () => {
    const { commands } = await read(u + "api/commands");
    return Array.isArray(commands) && ["instances.move", "assessment.run"].every((id) => commands.some((c: any) => c.id === id)) &&
      commands.every((c: any) => !c.id.startsWith("project.")) ? true : "room or assessment commands missing, or project commands in the scene catalogue";
  });
  await check("agent guide, homepage and public screening source", u + "llms.txt", async () => {
    const guide = await get(u + "llms.txt"), text = guide.ok ? await guide.text() : "";
    const home = await (await get(u)).text(), source = await get(u + "standards/workstation-screening.md");
    if (!text.includes("/api/scenes/") || text.includes("/api/room")) return `the agent guide (HTTP ${guide.status}) does not describe /api/scenes/`;
    if (!home.includes("/release-entry.js?v=")) return "the homepage does not load /release-entry.js?v=<tag>";
    return source.ok && (await source.text()).includes("#") ? true : `public criteria source HTTP ${source.status}`;
  });
  return out;
}
/** What the receipt records about the server, from the checks of one release. */
function serverStatus(checks: Check[], version: any): string {
  const c = checks.find((x) => x.what.startsWith("server: api/health"));
  if (!version.server) return "no server in this release";
  if (!c) return "not checked";
  return c.ok ? `running revision ${version.revision}` : `FAILED: ${c.detail}`;
}
const printChecks = (checks: Check[]) => { for (const c of checks) say(`  ${c.ok ? "ok  " : c.required ? "FAIL" : "warn"} ${c.what}${c.ok ? (c.detail !== "ok" ? ` (${c.detail})` : "") : `: ${c.detail}`}  (${c.url})`); };
const failedRequired = (checks: Check[]) => checks.filter((c) => !c.ok && c.required);
function printPlannedChecks(cfg: Config, glbPath: string, pages: string[], source = "dist/version.json", server: { revision: string } | null | "if it has one" = null) {
  const u = cfg.publicUrl;
  for (const [what, url] of [["200, HTML", u], [`equals ${source}`, u + "version.json"], [`size and SHA-256 given in ${source}`, u + glbPath], ["200, HTML", u + "wiki/"], ...pages.map((p) => ["200, HTML", u + "wiki/" + p]), ["anything but 200 (the server's code is never served)", u + "server/server.js"], ["anything but 200 (also without the file name)", u + "server/"], ["anything but 200 (also without the slash)", u + "server"]]) say(`  would check: GET ${url}  → ${what}`);
  say(`  would check: GET ${u} and ${u}workspaces/deploy-check  → exactly the meta tag ${frameSrcMeta()} (for a release whose version.json reads content)`);
  if (server) say(`  would check: GET ${u}api/health  → ${server === "if it has one" ? "for a release with a server: its revision" : `revision ${server.revision}`} within 20 s, asked every second (404 at once, or 502 or another revision after 20 s: a failure)`);
  if (server) {
    const which = server === "if it has one" ? `for a release with server.format ${ROOM_FORMAT}: ` : "";
    for (const [what, url] of [[`format ${ROOM_FORMAT}`, u + "api/health"], ["the shared workspace alone", u + "api/workspaces"], ["its projects, at least one scene", u + "api/workspaces/<shared id>"],
      ["the scene's workspace and project", u + "api/scenes/<scene id>/meta"], [`the editions pinned in ${source}, files under /api/library/`, u + "api/catalog"],
      ["instances.move and assessment.run, no project.* command", u + "api/commands"], ["describes /api/scenes/", u + "llms.txt"], ["loads /release-entry.js?v=<tag>", u], ["200 with the criteria", u + "standards/workstation-screening.md"]])
      say(`  would check: GET ${url}  → ${which}${what} (read only)`);
  }
  else say(`  (no api/health check: ${source} has no server entry)`);
  for (const [what, url] of [...(new URL(u).pathname !== "/" ? [["redirect to " + u + " (warning only)", u.replace(/\/$/, "")]] : []), ["the viewer page, 200 HTML (warning only)", u + "workspaces/deploy-check"], ["redirect to wiki/ (warning only)", u + "wiki"], ["X-Robots-Tag noindex (warning only)", u]]) say(`  would check: GET ${url}  → ${what}`);
}

// ------------------------------------------------------------------------------------------------ rollback
/** Why the site must not go back from the live release to `target` (both version.json contents), or null. */
export function rollbackRefusal(live: { server?: unknown; reads?: unknown }, target: { server?: unknown; reads?: unknown }, liveName: string, targetName: string, remoteRoot = "/srv/synergon"): string | null {
  // once the host runs the server, the site does not go back to a release without one (the service would have nothing to start)
  if (live.server && !target.server) return `refusing to roll back: the live release ${liveName} has a server and ${targetName} has none (no server entry in its version.json). Deploy a fixed release instead, or, if the server must go, run deploy/setup-server.sh --undo on the host and switch ${remoteRoot}/current there by hand.`;
  // a scene saved under the live release may carry a field the older one cannot read: the scene would no longer open
  const list = (x: unknown) => Array.isArray(x) ? x.map(String) : [], has = list(target.reads), lacks = list(live.reads).filter((f) => !has.includes(f));
  if (lacks.length) return `refusing to roll back: the live release ${liveName} reads the scene field${lacks.length > 1 ? "s" : ""} ${lacks.join(", ")} and ${targetName} does not (reads in its version.json), so scenes saved since might not open there. Deploy a fixed release instead.`;
  return null;
}
async function doRollback(cfg: Config) {
  heading(`rollback on ${cfg.host}:${cfg.remoteRoot}${dryRun ? " (dry run: nothing is changed)" : ""}`);
  const live = currentRelease(cfg, `${releasesDir(cfg)}/<live release>`);
  if (dryRun) {
    say(`  would list ${releasesDir(cfg)}, pick the newest release older than the live one, read both version.json files, then run:`);
    remote(cfg, `cat ${releasesDir(cfg)}/<live release>/version.json`);
    remote(cfg, `cat ${releasesDir(cfg)}/<previous release>/version.json`);
    say("  (refused, before the switch, when the live release's version.json has a server entry and the previous release's has none, or reads a scene field (reads) that the previous release's does not)");
    remote(cfg, switchCommand(cfg, `${releasesDir(cfg)}/<previous release>`, false));
    printPlannedChecks(cfg, "asset/rig-b.glb", ["README.html"], "that release's version.json", "if it has one");
    say("\ndry run finished: nothing was changed on the server"); timeline("rollback dry run", secs(t0), cfg.host); return;
  }
  if (!live) stop(`${cfg.remoteRoot}/current does not point into ${releasesDir(cfg)}; nothing to roll back`);
  const all = listReleases(cfg, []), liveName = live.slice(releasesDir(cfg).length + 1), older = all.filter((r) => r < liveName);
  if (!older.length) stop(`the live release ${liveName} is the oldest one on the server; nothing to roll back to`);
  const target = `${releasesDir(cfg)}/${older[older.length - 1]}`;
  const readVersion = (release: string) => { const out = remote(cfg, `cat ${q(release + "/version.json")}`).out; try { return JSON.parse(out); } catch { return stop(`${release}/version.json is not JSON`); } };
  const liveVersion = readVersion(live), version = readVersion(target);
  say(`  live: ${liveName}${liveVersion.server ? " (with a server)" : ""}\n  back to: ${older[older.length - 1]} (${version.short})${version.server ? " (with a server)" : ""}`);
  const refused = rollbackRefusal(liveVersion, version, liveName, older[older.length - 1], cfg.remoteRoot);
  if (refused) stop(refused);
  const s = performance.now();
  remote(cfg, switchCommand(cfg, target));
  const checks = await verifySite(cfg, { version, glb: { path: `asset/${version.model.asset}.glb`, bytes: version.model.bytes, sha256: version.model.sha256 }, wikiPages: ["README.html"] });
  printChecks(checks);
  if (failedRequired(checks).length) {
    remote(cfg, switchCommand(cfg, live));
    stop(`the site did not pass its checks after the rollback; switched back to ${liveName}`);
  }
  say(`\nrolled back: ${cfg.publicUrl} now serves ${older[older.length - 1]} (${version.short}); ${liveName} is still on the server; server: ${serverStatus(checks, version)}`);
  timeline("rollback", secs(s), `${liveName} -> ${older[older.length - 1]}`);
}

// ------------------------------------------------------------------------------------------------ deploy
async function doDeploy(cfg: Config) {
  if (prepared) {
    // (a) and (b) ran in the --dry-run before this; dist/ must be that build of this very commit, unchanged since
    heading("prepared: dist/ from the dry run of this commit");
    const rev = sourceRevision(), v = JSON.parse(readFileSync(join(ROOT, "dist", "version.json"), "utf8"));
    if (dryRun) stop("--prepared and --dry-run do not go together", 2);
    if (!rev.repository || rev.dirty || v.revision !== rev.revision || v.dirty) stop(`--prepared needs dist/ built by a dry run of the clean commit ${rev.revision}; dist/ is from ${v.revision}${v.dirty ? " with uncommitted changes" : ""}. Run 'bun run deploy --dry-run' first.`);
    say(`  dist/ is ${v.short}`);
  } else await prepare();
  await publish(cfg);
}
/** (a) and (b): everything that runs on this machine, before anything is sent anywhere. */
async function prepare() {
  // (a) refuse early, and say every reason at once
  heading("preflight: working tree, wiki lint, checks");
  const reasons: string[] = [];
  const rev = sourceRevision(), porcelain = () => (rev.repository ? spawnSync("git", ["-C", ROOT, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim() : "");
  const before = porcelain();
  if (!rev.repository) (allowDirty ? say : (m: string) => reasons.push(m))("the folder is not a git repository yet, so what would be published is not a commit" + (allowDirty ? " (allowed by --allow-dirty)" : "; commit it first or pass --allow-dirty"));
  else if (rev.dirty) (allowDirty ? say : (m: string) => reasons.push(m))(`the working tree has uncommitted changes${allowDirty ? " (allowed by --allow-dirty)" : "; commit them or pass --allow-dirty"}:\n    ${before.split("\n").slice(0, 12).join("\n    ")}${before.split("\n").length > 12 ? "\n    …" : ""}`);
  else say(`  working tree clean at ${rev.revision}`);
  const s = performance.now(), lint = lintWiki();
  steps.push({ step: "wiki lint", seconds: secs(s), ok: !lint.errors, note: lint.summary });
  if (lint.errors) {
    const shown = lint.findings.filter((f) => f.level === "error").slice(0, 10).map(formatFinding);
    (allowLint ? say : (m: string) => reasons.push(m))(`wiki lint: ${lint.summary}${allowLint ? " (allowed by --allow-lint)" : "; fix the pages or pass --allow-lint"}\n    ${shown.join("\n    ")}${lint.errors > 10 ? `\n    … ('bun run wiki lint' lists all ${lint.errors})` : ""}`);
  } else say(`  wiki lint: ${lint.summary}`);
  if (!local("check", ["bun", "run", "check"])) reasons.push("bun run check failed (see above)");
  if (reasons.length) stop(`refusing to deploy:\n  - ${reasons.join("\n  - ")}`);

  // (b) build everything locally
  for (const [step, cmd] of [
    ["build", ["bun", "run", "build"]],
    ...(noImages ? [] : [["documentation images", ["bun", "run", "render", "--set", "wiki"]]]),
    ["wiki index", ["bun", "run", "wiki", "index"]],
    ["wiki build", ["bun", "run", "wiki", "build", "--quiet", ...(allowLint ? ["--allow-broken"] : [])]],
    ["dist", ["bun", "run", "dist"]],
  ] as [string, string[]][]) if (!local(step, cmd)) stop(`'${cmd.join(" ")}' failed; nothing was uploaded`);
  if (noImages) say("\n(--no-images: the documentation images were not regenerated; the committed ones are published)");
  const after = porcelain();
  if (rev.repository && after !== before) {
    const changed = after.split("\n").filter((l) => l && !before.split("\n").includes(l));
    (allowDirty ? say : (m: string) => stop(m))(`the build changed committed files, so the site would not match revision ${rev.revision}${allowDirty ? " (allowed by --allow-dirty)" : "; commit them and run 'bun run deploy' again (or pass --allow-dirty)"}:\n    ${changed.slice(0, 12).join("\n    ")}`);
  }
}
/** (b2) to (f): the route probe, upload, switch, checks, switch back on failure, prune, receipt. */
async function publish(cfg: Config) {

  // what was built
  const dist = join(ROOT, "dist"), version = JSON.parse(readFileSync(join(dist, "version.json"), "utf8"));
  if (!version.model) stop("dist/version.json has no model entry");
  const glbPath = `asset/${version.model.asset}.glb`, glbBuf = readFileSync(join(dist, glbPath));
  const glb = { path: glbPath, bytes: glbBuf.length, sha256: createHash("sha256").update(glbBuf).digest("hex") };
  if (glb.sha256 !== version.model.sha256) stop(`dist/${glbPath} does not match the hash in dist/version.json`);
  const wikiPages = ["README.html", "50-implementation/deployment.html", "00-overview/summary.html", "40-method/pipeline.html"].filter((p) => existsSync(join(dist, "wiki", p))).slice(0, 2);
  const stamp = version.built.replace(/[-:]/g, "").replace(/\.\d+/, ""), name = `${stamp}-${version.revision}${version.dirty ? "-dirty" : ""}`;
  if (!RELEASE_NAME.test(name)) stop(`cannot form a release name from dist/version.json (got '${name}')`);
  const release = `${releasesDir(cfg)}/${name}`;
  heading(`upload to ${cfg.host}:${release}${dryRun ? " (dry run: printed, not run)" : ""}`);
  say(`  version ${version.short}; model ${glb.bytes.toLocaleString("en")} bytes, sha256 ${glb.sha256.slice(0, 16)}…`);

  // (b2) a release with a server needs the host's API route (and with it the 404 rule for server/) before anything is switched
  if (version.server) {
    heading("before the switch: the host's route for the API");
    if (dryRun) say(`  would check: GET ${cfg.publicUrl}api/health  → anything but 404 (no answer or 404: stop, upload and switch nothing; ${FIRST_ROLLOUT.split(". Order")[0]})`);
    else {
      const p = await routeProbe(cfg);
      say(`  ${p.ok ? "ok  " : "STOP"} ${p.detail}`);
      if (!p.ok) stop(p.detail);
    }
  }

  // (c) upload
  let s2 = performance.now();
  remote(cfg, `mkdir -p ${q(releasesDir(cfg))}`);
  const previous = currentRelease(cfg, `${releasesDir(cfg)}/<previous release, if any>`);
  const exists = remote(cfg, `test -e ${q(release)} && echo exists || true`, { dry: "" }).out === "exists";
  if (exists) stop(`${release} already exists on the server; releases are never overwritten`);
  const rsync = ["rsync", "-az", "--delete", "-e", ["ssh", ...SSH_OPTS].join(" "), "dist/", `${cfg.host}:${release}/`], rsyncShown = rsync.map(q).join(" ");
  remoteLog.push(rsyncShown);
  if (dryRun) say(`  would run: ${rsyncShown}`);
  else {
    say(`  $ ${rsyncShown}`);
    const r = spawnSync(rsync[0], rsync.slice(1), { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) { remote(cfg, `rm -rf -- ${q(release)}`, { mayFail: true }); stop(`rsync failed (exit ${r.status}); the partial upload was removed and the live site is unchanged`); }
  }
  remote(cfg, `chmod -R u+rwX,go+rX,go-w ${q(release)} && test -f ${q(release + "/version.json")} && test -f ${q(release + "/index.html")}`);
  if (!dryRun) { steps.push({ step: "upload", seconds: secs(s2), ok: true }); timeline("deploy: upload", secs(s2), `${cfg.host}:${release}`); }

  // (d) switch
  heading(`switch ${cfg.remoteRoot}/current → ${name}${previous ? ` (was ${previous.slice(releasesDir(cfg).length + 1)})` : dryRun ? "" : " (first release)"}`);
  remote(cfg, switchCommand(cfg, release));

  // (e) check the live site; go back on failure
  heading(`check ${cfg.publicUrl}`);
  const receipt: any = { deployed: new Date().toISOString(), dryRun, host: cfg.host, remoteRoot: cfg.remoteRoot, publicUrl: cfg.publicUrl, release: name, releasePath: release, previous, version, glb, steps, remoteCommands: remoteLog, checks: [] as Check[], pruned: [] as string[], result: "" };
  const writeReceipt = () => writeFileSync(join(dist, "deploy-receipt.json"), JSON.stringify(receipt, null, 1) + "\n");
  if (dryRun) {
    printPlannedChecks(cfg, glbPath, wikiPages, "dist/version.json", version.server ? { revision: version.revision } : null);
    say(`  if a required check fails: ${switchCommand(cfg, releasesDir(cfg) + "/<previous release>", false)}, then the same checks against its version.json`);
    say(`  after the checks pass: list ${releasesDir(cfg)} and delete all but the ${cfg.keepReleases} newest (never the live release or the one before it):`);
    remote(cfg, `ls -1 ${q(releasesDir(cfg))}`);
    remote(cfg, `rm -rf -- ${releasesDir(cfg)}/<older release> …`);
    receipt.result = "dry run: nothing was changed on the server"; writeReceipt();
    say(`\ndry run finished in ${secs(t0).toFixed(1)} s: every local step ran; the ${remoteLog.length} remote commands above were not run. Receipt: dist/deploy-receipt.json`);
    timeline("deploy dry run", secs(t0), `${name}; ${remoteLog.length} remote commands printed`);
    return;
  }
  s2 = performance.now();
  const checks = await verifySite(cfg, { version, glb, wikiPages });
  printChecks(checks); receipt.checks = checks; receipt.server = serverStatus(checks, version);
  steps.push({ step: "verify", seconds: secs(s2), ok: !failedRequired(checks).length });
  if (failedRequired(checks).length) {
    if (!previous) { receipt.result = "FAILED checks; no previous release to go back to, the new release stays live"; writeReceipt(); stop(`the live site failed ${failedRequired(checks).length} check(s) and there is no previous release to return to; ${name} stays live. Is the web server configured (see the header of tools/deploy.ts)?`); }
    heading(`rolling back to ${previous.slice(releasesDir(cfg).length + 1)}`);
    remote(cfg, switchCommand(cfg, previous));
    const prevVersion = JSON.parse(remote(cfg, `cat ${q(previous + "/version.json")}`).out);
    const again = await verifySite(cfg, { version: prevVersion, glb: { path: `asset/${prevVersion.model.asset}.glb`, bytes: prevVersion.model.bytes, sha256: prevVersion.model.sha256 }, wikiPages: ["README.html"] });
    printChecks(again);
    receipt.result = `FAILED checks; switched back to ${previous} (${failedRequired(again).length ? "which ALSO fails its checks" : "which passes its checks"})`; receipt.rollbackChecks = again; receipt.rollbackServer = serverStatus(again, prevVersion); writeReceipt();
    stop(`the new release failed its checks; ${receipt.result}. The failed release ${name} is left on the server for inspection.`);
  }

  // prune old releases (only now that the new one is known to work)
  const all = listReleases(cfg, []), keep = new Set([...all.slice(-cfg.keepReleases), name, ...(previous ? [previous.slice(releasesDir(cfg).length + 1)] : [])]);
  const drop = all.filter((r) => !keep.has(r));
  if (drop.length) remote(cfg, `rm -rf -- ${drop.map((r) => q(`${releasesDir(cfg)}/${r}`)).join(" ")}`);
  receipt.pruned = drop;

  // (f) summary
  receipt.result = "live"; writeReceipt();
  const warn = checks.filter((c) => !c.ok && !c.required);
  say(`\ndeployed ${name} in ${secs(t0).toFixed(1)} s: ${cfg.publicUrl} serves version ${version.short}`);
  say(`  previous release: ${previous ? previous.slice(releasesDir(cfg).length + 1) + " (bun run deploy --rollback switches back to it)" : "none"}; releases on the server: ${all.length - drop.length}${drop.length ? `, ${drop.length} old one(s) deleted` : ""}`);
  say(`  server: ${receipt.server}`);
  if (warn.length) say(`  ${warn.length} warning(s) about the server configuration: ${warn.map((c) => c.what).join("; ")}`);
  say("  receipt: dist/deploy-receipt.json");
  timeline("deploy", secs(t0), `${name} live at ${cfg.publicUrl}; ${checks.filter((c) => c.ok).length}/${checks.length} checks ok`);
}

if (import.meta.main) {
  const cfg = loadConfig();
  if (rollback) await doRollback(cfg); else await doDeploy(cfg);
  process.exit(0);
}
