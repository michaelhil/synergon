// The public Synergon server: the scene API (Workspace -> Project -> Scene) behind the loopback proxy, with the
// sandbox's rate, size and stream limits. It reads only the library packaged with its release and writes its own
// store under <data>/rooms. Caddy maps /api/* to this process unchanged.
//
//   bun server/server.js --mode deployed|local [--port 4191] [--host 127.0.0.1] --data <dir> [--release <dir>]
import { existsSync, readFileSync, realpathSync, statfsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ROOM_SCHEMA } from "../shared/room.ts";
import { LIMITS } from "./limits.ts";
import { createRoomApi } from "./room-api.ts";
import { openPublicRoomLibrary } from "./room-public-library.ts";
import { blockKey, LOCAL_HOSTS, RateWindow, visitorKey } from "./http-guards.ts";
import { loadLiveApps } from "./live-apps.ts";
import { LIVE } from "../shared/room-content.ts";

const fail = (status: number, code: string, message: string) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mode = opt("--mode") ?? "local";
if (mode !== "local" && mode !== "deployed") { console.error(`--mode is local or deployed, not ${mode}`); process.exit(2); }
const release = realpathSync(dirname(dirname(resolve(process.argv[1]))));   // the folder above server/ (real path)
const byLayout = basename(dirname(release)) === "releases" ? join(dirname(dirname(release)), "current") : null;
const releaseDir = opt("--release") ? resolve(opt("--release")!) : byLayout && existsSync(byLayout) ? byLayout : release;
if (mode === "deployed" && realpathSync(releaseDir) !== release) { console.log(JSON.stringify({ release_changed: { from: release, to: realpathSync(releaseDir) } })); process.exit(0); }
let revision = opt("--revision") ?? "working copy";
if (!opt("--revision") && existsSync(join(release, "version.json"))) try { revision = JSON.parse(readFileSync(join(release, "version.json"), "utf8")).revision ?? revision; } catch { /* keep the default */ }
const dataDir = opt("--data") ? resolve(opt("--data")!) : null;
if (!dataDir) { console.error("--data <dir> is required"); process.exit(2); }

const roomData = join(dataDir, "rooms");
const { catalog, files } = openPublicRoomLibrary(release, roomData);
const reads = new RateWindow(LIMITS.queriesPerMinutePerVisitor, 60_000);
const writes = new RateWindow(LIMITS.editsPerMinutePerVisitor, 60_000);
const blockWrites = new RateWindow(LIMITS.editsPerSecondPerBlock, 1_000);
const allWrites = new RateWindow(LIMITS.editsPerSecondTotal, 1_000);
const creates = new RateWindow(LIMITS.workspacesPerHourPerVisitor, 3_600_000);
const blockCreates = new RateWindow(LIMITS.workspacesPerHourPerBlock, 3_600_000);
const allCreates = new RateWindow(LIMITS.workspacesPerDayTotal, 86_400_000);
// Viewer reports of live screen content (POST .../seen) have their own budget: they are never edits.
const reports = new RateWindow(LIVE.seenPublicPerMinute, 60_000);
const windows = [reads, writes, blockWrites, allWrites, creates, blockCreates, allCreates, reports];
// The visitor of each request in flight, for the creation limit that the scene API asks about.
const visitors = new WeakMap<Request, { visitor: string; block: string }>();
const api = createRoomApi({
  dataDir: roomData, catalog, publicMode: true, apps: loadLiveApps({ public: true }), standardsPath: join(release, "server", "standards", "workstation-screening.md"),
  allowCreate: req => {
    const who = visitors.get(req);
    return !!who && creates.hit(who.visitor) && blockCreates.hit(who.block) && allCreates.hit("*");
  },
});
const sweep = setInterval(() => windows.forEach(w => w.sweep()), 60_000);
const streams = new Set<{ visitor: string; block: string }>();

async function handle(req: Request, ip: string): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
  if (mode === "local" && !LOCAL_HOSTS.test(req.headers.get("host") ?? "")) return fail(403, "host", "Use the loopback address of the preview.");
  // Caddy terminates TLS, preserves Host and sets the original scheme. The service binds loopback.
  if (req.headers.get("x-forwarded-proto") === "https") url.protocol = "https:";
  if (req.headers.has("origin") && req.headers.get("origin") !== url.origin) return fail(403, "origin", "Cross-origin request refused.");
  if (url.pathname.startsWith("/api/library/")) {
    if (!["GET", "HEAD"].includes(req.method)) return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    const asset = files.get(url.pathname);
    if (!asset) return new Response("Unknown library file", { status: 404 });
    const file = Bun.file(asset);
    return new Response(req.method === "HEAD" ? null : file, { headers: {
      "content-type": file.type || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(file.size),
    } });
  }
  const path = url.pathname.replace(/\/$/, "");
  const visitor = visitorKey(ip, req.headers.get("x-forwarded-for")), block = blockKey(visitor);
  if (req.method === "GET" || req.method === "HEAD") {
    if (!reads.hit(visitor)) return fail(429, "rate_limited", "Too many reads. Try again in a minute.");
    if (path === "/api/health") return Response.json({ ok: true, revision, mode, public: true, format: ROOM_SCHEMA }, { headers: { "cache-control": "no-store" } });
  } else if (req.method === "POST" && path.endsWith("/seen")) {
    if (!reports.hit(visitor)) return fail(429, "rate_limited", "Too many viewer reports. Try again in a minute.");
  } else {
    if (!writes.hit(visitor) || !blockWrites.hit(block) || !allWrites.hit("*")) return fail(429, "rate_limited", "Too many writes. Try again later.");
    const disk = statfsSync(roomData);
    if (disk.bavail * disk.bsize < LIMITS.diskMinFreeBytes || disk.bavail / disk.blocks < LIMITS.diskMinFreeFraction)
      return fail(507, "disk_low", "The service has insufficient free disk space.");
  }
  const inner = new Request(url, req);
  visitors.set(inner, { visitor, block });
  if (req.method !== "GET" || !path.endsWith("/live")) return api.fetch(inner);
  if (streams.size >= LIMITS.streamsTotal) return fail(503, "too_many_streams", "The live connection limit has been reached.");
  const places = [...streams];
  if (places.filter(p => p.visitor === visitor).length >= LIMITS.streamsPerVisitor || places.filter(p => p.block === block).length >= LIMITS.streamsPerBlock)
    return fail(429, "too_many_streams", "Close another viewer before opening a live connection.");
  const place = { visitor, block };
  streams.add(place);
  try {
    const response = await api.fetch(inner);
    if (!response.ok || !response.body) { streams.delete(place); return response; }
    const reader = response.body.getReader();
    const free = () => { streams.delete(place); req.signal.removeEventListener("abort", cancel); };
    const cancel = () => { free(); void reader.cancel().catch(() => {}); };
    req.signal.addEventListener("abort", cancel, { once: true });
    if (req.signal.aborted) cancel();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) { free(); controller.close(); return; }
          controller.enqueue(value);
          sent += value.byteLength;
          if (sent >= LIMITS.streamBytesMax) {
            await reader.cancel();
            controller.close();
            setTimeout(free, LIMITS.streamDrainMs).unref();
          }
        } catch (error) { free(); controller.error(error); }
      },
      cancel,
    });
    return new Response(body, { headers: response.headers });
  } catch (error) { streams.delete(place); throw error; }
}

const server = Bun.serve({
  port: Number(opt("--port") ?? 4173), hostname: opt("--host") ?? "127.0.0.1", development: false,
  idleTimeout: LIMITS.idleTimeoutS, maxRequestBodySize: LIMITS.bodyBytes,
  async fetch(req, s) {
    try { return await handle(req, s.requestIP(req)?.address ?? ""); }
    catch (e) { console.error(e); return fail(500, "internal", "The request could not be completed."); }
  },
});
console.log(JSON.stringify({ listening: server.port }));
// Deployed: exit when `current` no longer points at this release; systemd starts the new one.
const watch = mode === "deployed" ? setInterval(() => {
  let now: string;
  try { now = realpathSync(releaseDir); } catch { return; }
  if (now === release) return;
  console.log(JSON.stringify({ release_changed: { from: release, to: now } }));
  stop();
}, LIMITS.releaseWatchMs) : null;
function stop() { if (watch) clearInterval(watch); clearInterval(sweep); api.close(); server.stop(true); process.exit(0); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
