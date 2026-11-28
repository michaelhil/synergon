// The local Synergon installation: homepage, scene editor, project pages and the scene API (Workspace -> Project ->
// Scene) over one folder-based store under --data.
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createRoomLibrary } from "../server/room-installed.ts";
import { PROJECT_BODY_BYTES } from "../shared/project.ts";
import { loadRoomLibrary } from "../server/room-library.ts";
import { createRoomApi } from "../server/room-api.ts";
import { loadLiveApps } from "../server/live-apps.ts";
import type { LiveApp } from "../shared/room-content.ts";
import { LOCAL_HOSTS } from "../server/http-guards.ts";
import { runtimeParams } from "./bundle.ts";
import { ROOT } from "./timeline.ts";

/** Pages of the local installation may frame any https page and loopback http (live screen content, §3.12). */
export const LOCAL_FRAME_POLICY = "frame-src https: http://127.0.0.1:* http://localhost:*";

/** `apps` replaces the apps of live screen content (tests; otherwise server/live-apps.json or SYNERGON_APPS). */
export async function serveRoom({ port, dataDir, emptyLibrary = false, apps }: { port: number; dataDir: string; emptyLibrary?: boolean; apps?: LiveApp[] }) {
  mkdirSync(dataDir, { recursive: true });
  const viewRoot = join(ROOT, "viewer");
  const [library, bundle] = await Promise.all([
    emptyLibrary ? createRoomLibrary() : loadRoomLibrary(join(dataDir, "build")),
    Bun.build({ entrypoints: [join(viewRoot, "src", "room-entry.ts")], target: "browser", format: "esm", splitting: true, minify: true,
      naming: { entry: "room-entry.[ext]", chunk: "room-[hash].[ext]" }, plugins: [runtimeParams] }),
  ]);
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  let wikiDirectory: string | undefined;
  const api = createRoomApi({ dataDir, catalog: library.catalog, apps: loadLiveApps({ apps }) });
  const scripts = new Map(bundle.outputs.map(o => ["/" + basename(o.path), o]));
  const html = Bun.file(join(viewRoot, "room.html"));
  const staticFiles = new Map([
    ["/room.css", join(viewRoot, "room.css")], ["/room-view.css", join(viewRoot, "room-view.css")],
    ["/llms.txt", join(viewRoot, "room-guide.txt")],
    ...readdirSync(join(viewRoot, "home")).filter(f => f.endsWith(".jpg")).map(f => ["/home/" + f, join(viewRoot, "home", f)] as [string, string]),
    ["/standards/workstation-screening.md", join(ROOT, "wiki", "85-standards", "workstation-screening.md")],
    ...["basis_transcoder.wasm","basis_transcoder.js"].map(f => ["/libs/basis/" + f, join(ROOT, "node_modules", "three", "examples", "jsm", "libs", "basis", f)] as [string,string]),
  ]);
  const mime: Record<string,string> = { ".glb": "model/gltf-binary", ".json": "application/json", ".ktx2": "image/ktx2", ".png": "image/png", ".jpg":"image/jpeg" };
  const server = Bun.serve({ port, development: false, maxRequestBodySize: PROJECT_BODY_BYTES, hostname: "127.0.0.1", idleTimeout: 0,
    async fetch(request) {
      const { pathname, origin } = new URL(request.url);
      if (!LOCAL_HOSTS.test(request.headers.get("host") ?? "") || (request.headers.has("origin") && request.headers.get("origin") !== origin)) return new Response("Local access only", { status: 403 });
      if (pathname.startsWith("/api/") || pathname === "/mcp") return api.fetch(request);
      if (!["GET","HEAD"].includes(request.method)) return new Response(null, { status: 405 });
      if (pathname === "/" || /^\/(?:workspaces(?:\/room)?|projects)(?:\/[^/]+)?\/?$/.test(pathname)) {
        return new Response(html, { headers: { "Link": '</llms.txt>; rel="help", </api/commands>; rel="service-desc"', "Cache-Control": "no-cache", "Content-Security-Policy": LOCAL_FRAME_POLICY } });
      }
      if (pathname.startsWith("/wiki/")) {
        let relative = decodeURIComponent(pathname.slice(6));
        if (relative === "" || relative.endsWith("/")) relative += "index.html";
        if (!relative.split("/").every(p => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(p))) return new Response("Invalid page", {status:400});
        if (!wikiDirectory) {
          const {buildWiki} = await import("./wiki.ts");
          if (!wikiDirectory) {
            const root = join(ROOT,"work"); mkdirSync(root,{recursive:true});
            const folder = mkdtempSync(join(root,"room-wiki-"));
            try { buildWiki({out:folder}); wikiDirectory = folder; }
            catch (error) { rmSync(folder,{recursive:true,force:true}); throw error; }
          }
        }
        const page = Bun.file(join(wikiDirectory,relative));
        return await page.exists() ? new Response(page) : new Response("Page not found", {status:404});
      }
      const script = scripts.get(pathname), path = staticFiles.get(pathname);
      if (script) return new Response(script, { headers: { "Content-Type":"text/javascript", "Cache-Control":"no-cache" } });
      if (path) return new Response(Bun.file(path));
      const bytes = library.files.get(pathname);
      if (bytes) return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime[extname(pathname)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "public,max-age=31536000,immutable" } });
      return new Response("Not found", { status: 404 });
    },
  });
  return { url: server.url, close() { server.stop(true); api.close(); if (wikiDirectory) rmSync(wikiDirectory,{recursive:true,force:true}); } };
}

if (import.meta.main) {
  const flag = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index+1] : undefined; };
  const dataDir = resolve(flag("--data") ?? join(ROOT, "work", "room-layout"));
  const service = await serveRoom({ port: Number(flag("--port") ?? 4173), dataDir, emptyLibrary: process.argv.includes("--empty-library") });
  console.log("Room editor", service.url.href, "· data", dataDir);
  for (const signal of ["SIGINT","SIGTERM"]) process.once(signal, () => { service.close(); process.exit(0); });
}
