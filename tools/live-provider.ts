// A fake app for live screen content (live-surfaces/1), for the browser check and local tests: a Bun server on
// localhost:<port> (a different site from Synergon's 127.0.0.1) whose pages speak the greeting.
//   /app?run=&item=&view=  the contract page: ready {operable}, hello, status starting then live ("run-ext-" + run),
//                          rate (its animation stops at 0), use (shows its controls), leave on an Esc it did not use,
//                          a button and a "map" that pans on drag and zooms on the wheel (drags end on leave, cancel,
//                          lost capture and blur). Every input event is recorded.
//   /page                  a plain page that never greets
//   /silent                an app page that loads and never greets (must become "Not answering")
//   /refused               an app page that greets and refuses with a raw technical line
//   /slow                  never finishes loading within 25 s
//   /refuse                sends X-Frame-Options: DENY
//   GET /events            what the pages recorded (CORS *); DELETE /events clears
// No console output anywhere, so a check's page.errors stays empty.
//   bun tools/live-provider.ts [--port 4932]
export interface ProviderEvent { page: string; type: string; t: number; [k: string]: unknown }

const PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake app</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<style>
  html,body{margin:0;height:100%;background:#0d1b26;color:#e6eef4;font:16px/1.35 system-ui,sans-serif;overflow:hidden}
  header{display:flex;align-items:center;gap:16px;height:64px;padding:0 24px;background:#132a3a}
  header b{font-size:22px} header span{opacity:.7}
  #controls{margin-left:auto;display:none;gap:8px} body.use #controls{display:flex}
  button{font:600 16px system-ui;padding:10px 18px;border:0;border-radius:6px;background:#2d7ff9;color:#fff;cursor:pointer}
  /* fixed places, so a check can aim at them through the frame's transform: the button at (40..240, 104..184) of the
     1280-px layout, the map from x 280 to the right edge below the header */
  #ack{position:absolute;left:40px;top:104px;width:200px;height:80px;font-size:22px}
  #count{position:absolute;left:40px;top:200px;font-size:40px;font-weight:700}
  #needle{position:absolute;left:40px;top:280px;width:120px;height:6px;background:#f9c22d;transform-origin:0 50%}
  #map{position:absolute;left:280px;top:64px;right:0;bottom:0;width:calc(100% - 280px);height:calc(100% - 64px);display:block;cursor:grab;touch-action:none}
</style></head><body>
<header><b id="title"></b><span id="state">Starting</span><div id="controls"><button id="fit">Fit</button></div></header>
<button id="ack">Acknowledge</button><div id="count">0</div><div id="needle"></div><canvas id="map"></canvas>
<script>
(() => {
  const q = new URLSearchParams(location.search), page = location.pathname, PROTOCOL = "live-surfaces/1";
  const run = q.get("run") || "", view = q.get("view") || "", greet = page === "/app" || page === "/refused";
  document.getElementById("title").textContent = (q.get("item") || "page") + " · " + (view || page.slice(1));
  const log = (type, extra) => { try { fetch("/event", { method: "POST", body: JSON.stringify({ page, view, type, t: Date.now(), ...extra }), keepalive: true }); } catch (e) {} };
  let parent = "";
  try { const r = new URL(document.referrer); if (/^(127\.0\.0\.1|localhost|\[::1\])$/.test(r.hostname)) parent = r.origin; } catch (e) {}
  const send = m => { if (parent && window.parent !== window) window.parent.postMessage({ protocol: PROTOCOL, ...m }, parent); };
  let fps = 30, using = false, live = false, started = false, pending = false;
  if (greet) {
    addEventListener("message", e => {
      if (e.origin !== parent || e.source !== window.parent || !e.data || e.data.protocol !== PROTOCOL) return;
      const m = e.data; log("message:" + m.type, { fps: m.fps, active: m.active, width: m.width, height: m.height });
      // like Leitbild: "live" is said only once the page has drawn, and a page told rate 0 does not draw
      if (m.type === "hello" || m.type === "rate") fps = typeof m.fps === "number" ? m.fps : fps;
      // /refused: an app page whose view cannot start, with the kind of raw text a real app may send
      if (page === "/refused" && m.type === "hello") { send({ type: "status", state: "refused", run: "run-ext-" + run, view, text: "AJAXError: Service Unavailable (503): /map/tiles/current/9/272/150.mvt" }); return; }
      const goLive = () => { if (live) return; if (fps > 0) { live = true; document.getElementById("state").textContent = "Live"; send({ type: "status", state: "live", run: "run-ext-" + run, view }); } else pending = true; };
      if (m.type === "hello" && !live && !started) { started = true; send({ type: "status", state: "starting", run: "run-ext-" + run, view }); setTimeout(goLive, 300); }
      else if (m.type === "hello" && live) send({ type: "status", state: "live", run: "run-ext-" + run, view });
      if (m.type === "rate" && fps > 0 && pending) { pending = false; goLive(); }
      if (m.type === "use") { using = !!m.active; document.body.classList.toggle("use", using); }
    });
    send({ type: "ready", v: 1, pixels: false, operable: true });
  }
  let count = 0;
  document.getElementById("ack").addEventListener("click", e => { count++; document.getElementById("count").textContent = count; log("click", { target: "ack", x: e.clientX, y: e.clientY }); });
  document.getElementById("fit").addEventListener("click", () => { zoom = 1; pan = [0, 0]; draw(); log("click", { target: "fit" }); });
  addEventListener("keydown", e => {
    log("keydown", { key: e.key });
    if (e.key === "+" ) { zoom *= 1.2; draw(); e.preventDefault(); }
    if (e.key === "Escape" && !e.defaultPrevented) send({ type: "leave" });
  });
  // the map: drag pans, wheel zooms, a drag ends on leave, cancel, lost capture and blur
  const map = document.getElementById("map"), ctx = map.getContext("2d");
  let zoom = 1, pan = [0, 0], drag = null;
  function draw() {
    const w = map.width = map.clientWidth, h = map.height = map.clientHeight;
    ctx.fillStyle = "#10243a"; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2 + pan[0], h / 2 + pan[1]); ctx.scale(zoom, zoom);
    ctx.strokeStyle = "#2c5578"; ctx.lineWidth = 1 / zoom;
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(i * 40, -400); ctx.lineTo(i * 40, 400); ctx.moveTo(-400, i * 40); ctx.lineTo(400, i * 40); ctx.stroke(); }
    ctx.fillStyle = "#f9c22d"; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill(); ctx.restore();
  }
  const end = why => { if (drag) { log("dragend", { why, pan: pan.slice() }); drag = null; map.style.cursor = "grab"; } };
  map.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, pan: pan.slice() }; map.setPointerCapture(e.pointerId); map.style.cursor = "grabbing"; log("pointerdown", { target: "map", x: e.clientX, y: e.clientY }); });
  map.addEventListener("pointermove", e => { if (!drag) return; pan = [drag.pan[0] + e.clientX - drag.x, drag.pan[1] + e.clientY - drag.y]; draw(); log("drag", { x: e.clientX, y: e.clientY }); });
  map.addEventListener("pointerup", e => { log("pointerup", { target: "map", x: e.clientX, y: e.clientY }); end("up"); });
  for (const t of ["pointercancel", "lostpointercapture", "pointerleave"]) map.addEventListener(t, () => end(t));
  addEventListener("blur", () => end("blur"));
  map.addEventListener("wheel", e => { e.preventDefault(); zoom = Math.max(.2, Math.min(8, zoom * Math.exp(-e.deltaY / 400))); draw(); log("wheel", { deltaY: e.deltaY, zoom }); }, { passive: false });
  addEventListener("resize", draw); draw();
  // a needle that moves while the screen is in sight (rate 0 stops it)
  let angle = 0, last = 0, frames = 0;
  const tick = t => { if (fps > 0 && t - last >= 1000 / fps) { last = t; angle += .05; frames++; document.getElementById("needle").style.transform = "rotate(" + Math.sin(angle) * 40 + "deg)"; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setInterval(() => log("frames", { frames, fps }), 1000);
})();
</script></body></html>`;

export function startLiveProvider({ port = 0 }: { port?: number } = {}) {
  const events: ProviderEvent[] = [];
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  const html = (body: string, extra: Record<string, string> = {}) =>
    new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra } });
  const server = Bun.serve({
    port, hostname: "localhost", idleTimeout: 60,
    async fetch(request) {
      const url = new URL(request.url), path = url.pathname;
      if (path === "/event" && request.method === "POST") {
        try { const e = await request.json() as ProviderEvent; if (e && typeof e.type === "string" && e.type !== "frames") events.push(e); else if (e?.type === "frames") latest.set(e.page + "?" + (e as { view?: string }).view, e); } catch { /* not an event */ }
        return new Response(null, { status: 204, headers: cors });
      }
      if (path === "/events") {
        if (request.method === "DELETE") { events.length = 0; return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, DELETE" } }); }
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, DELETE" } });
        return Response.json({ events, frames: Object.fromEntries(latest) }, { headers: cors });
      }
      if (path === "/app" || path === "/page" || path === "/silent" || path === "/refused") return html(path === "/silent" ? PAGE.replace('greet = page === "/app"', "greet = false") : PAGE);
      if (path === "/refuse") return html(PAGE, { "X-Frame-Options": "DENY" });
      if (path === "/slow") {
        let timer: ReturnType<typeof setTimeout>;
        const body = new ReadableStream({
          start(c) { c.enqueue(new TextEncoder().encode("<!doctype html><title>Slow</title><p>Loading")); timer = setTimeout(() => { try { c.enqueue(new TextEncoder().encode("…</p>")); c.close(); } catch { /* gone */ } }, 26_000); },
          cancel() { clearTimeout(timer); },
        });
        return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
      if (path === "/favicon.ico") return new Response(null, { status: 204 });
      return new Response("Not found", { status: 404 });
    },
  });
  const latest = new Map<string, ProviderEvent>();
  return { url: new URL(`http://localhost:${server.port}`), events, frames: latest, close: () => server.stop(true) };
}

if (import.meta.main) {
  const i = process.argv.indexOf("--port");
  const p = startLiveProvider({ port: i >= 0 ? Number(process.argv[i + 1]) : 4932 });
  process.stdout.write("Fake live app " + p.url.href + "\n");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { p.close(); process.exit(0); });
}
