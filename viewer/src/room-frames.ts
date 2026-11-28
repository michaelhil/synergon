// Live screen content, the frame layer: one cross-origin page per live flat screen, laid exactly over its screen with
// its own matrix3d (from the four projected corners), under the 3D canvas, seen through a depth-correct hole that the
// screen cuts once its page shows. Outside *Use* every frame is inert and under the canvas, so the room orbits, zooms
// and selects exactly as before; *Use* raises one frame above the canvas and gives it the pointer and keyboard.
// The address, state, greeting and report logic is in room-content.ts; this file owns the DOM and the 3D side.
import * as THREE from "three";
import { LIVE, type SeenState } from "../../shared/room-content.ts";
import type { RoomScene } from "../../shared/room.ts";
import {
  acceptMessage, FAST_TIMEOUTS, isPhone, liveStorage, MessageGate, PROTOCOL, reportBody, ReportSchedule, resolveShows,
  ScreenStatus, TIMEOUTS, type ContentListResult, type Reports, type ResolvedShow,
} from "./room-content.ts";
import type { PlacedAsset, ScreenLook } from "./room-assets-renderer.ts";
import type { RoomOrbit } from "./room-orbit-renderer.ts";

/** The viewer's constants for live content (the shared ones are `LIVE` in shared/room-content.ts). */
export const FRAMES = {
  /** frames per viewer; the furthest shows beyond this keep a plate */
  maxFrames: LIVE.maxFrames,
  /** a tab hidden this long releases its frames */
  hiddenTabMs: LIVE.hiddenTabMs,
  /** the rate a shown greeting page is told (0 when its screen is out of sight) */
  fps: 30,
  /** frames are not tone-mapped: a constant dim so a page sits beside a built-in picture */
  brightness: 0.9,
  /** a frame larger than this many viewports is hidden (zoomed right into it), except in *Use* */
  oversize: 3,
  /** *Use*: the sheet fills this share of the stage, the view turns within this time, and nothing nearer than this
   *  many metres in front of the sheet is drawn meanwhile */
  useFraction: 0.85, useGlideMs: 380, useClearMetres: 0.35,
  /** status plates: width in px (height at the sheet's aspect), background, text */
  plateWidth: 1024, plateBackground: "#10161d",
  /** how often the content list is read again, and how long after a change of the scene's content */
  listEveryMs: 60_000, listDebounceMs: 300,
  /** reports are repeated this often while anything is reported */
  reportEveryMs: 30_000,
  /** the state machine's clock */
  tickMs: 250,
} as const;
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];
const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";
const ALLOW = "gamepad 'none'; picture-in-picture 'none'; storage-access 'none'; media-playback-while-not-visible 'none'";

// ---- placement ---------------------------------------------------------------------------------------------------

function solve(A: number[][], b: number[]) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!]; [b[i], b[p]] = [b[p]!, b[i]!];
    if (Math.abs(A[i]![i]!) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r]![i]! / A[i]![i]!;
      for (let c = i; c < n; c++) A[r]![c]! -= f * A[i]![c]!;
      b[r]! -= f * b[i]!;
    }
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]!; for (let c = i + 1; c < n; c++) s -= A[i]![c]! * x[c]!; x[i] = s / A[i]![i]!; }
  return x;
}
/** The projective map taking (0,0), (w,0), (w,h), (0,h) to the four points (px), as a CSS matrix3d, or null. */
export function homography(w: number, h: number, to: [number, number][]): string | null {
  const from = [[0, 0], [w, 0], [w, h], [0, h]], A: number[][] = [], b: number[] = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = from[k]!, [X, Y] = to[k]!;
    A.push([x!, y!, 1, 0, 0, 0, -x! * X, -y! * X]); b.push(X);
    A.push([0, 0, 0, x!, y!, 1, -x! * Y, -y! * Y]); b.push(Y);
  }
  const m = solve(A, b);
  if (!m || m.some(v => !Number.isFinite(v))) return null;
  const [a, bb, c, d, e, f, g, hh] = m.map(v => +v!.toPrecision(10));
  return `matrix3d(${a},${d},0,${g},${bb},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
}
/** Apply a matrix3d string to a point (for tests and checks): where a frame's (u, v) lands, in layer px. */
export function mapPoint(matrix: string, u: number, v: number): [number, number] {
  const m = matrix.slice(9, -1).split(",").map(Number);
  const x = m[0]! * u + m[4]! * v + m[12]!, y = m[1]! * u + m[5]! * v + m[13]!, w = m[3]! * u + m[7]! * v + m[15]!;
  return [x / w, y / w];
}
/** The sheet's corners in its mesh's frame, top-left first as the operator sees it: the sheet lies in the node's
 *  y–z plane facing −x, so +y is the operator's left and +z up. */
function sheetCorners(box: THREE.Box3): THREE.Vector3[] {
  const x = (box.min.x + box.max.x) / 2;
  return [[box.max.y, box.max.z], [box.min.y, box.max.z], [box.min.y, box.min.z], [box.max.y, box.min.z]]
    .map(([y, z]) => new THREE.Vector3(x, y, z));
}

// ---- plates ------------------------------------------------------------------------------------------------------

interface PlateText { title: string; line: string; dim?: boolean }
function drawPlate(canvas: HTMLCanvasElement, t: PlateText) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height, m = Math.round(w * 0.06);
  ctx.fillStyle = FRAMES.plateBackground; ctx.fillRect(0, 0, w, h);
  const font = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  const big = Math.max(14, Math.round(Math.min(h * 0.13, w * 0.055))), small = Math.round(big * 0.72);
  const fit = (text: string, size: number, weight: number) => {
    ctx.font = `${weight} ${size}px ${font}`;
    let s = text;
    while (s.length > 1 && ctx.measureText(s).width > w - 2 * m) s = s.slice(0, -2) + "…";
    return s;
  };
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  const top = h / 2 - (t.line ? big * 0.25 : -big * 0.35);
  ctx.fillStyle = `rgba(255,255,255,${t.dim ? 0.4 : 0.8})`; ctx.fillText(fit(t.title, big, 600), m, top);
  if (t.line) { ctx.fillStyle = `rgba(255,255,255,${t.dim ? 0.3 : 0.55})`; ctx.fillText(fit(t.line, small, 450), m, top + big * 1.15); }
}

// ---- the layer -----------------------------------------------------------------------------------------------------

export interface ContentState { state: SeenState; text?: string; host?: string; operable: boolean }
/** What the configurator (room-app.ts) uses. */
export interface ContentApi {
  state(key: string): ContentState | null;
  onChange(cb: () => void): () => void;
  /** the *Show* button: pages from this origin load at once in this browser from now on */
  accept(origin: string): void;
  retry(key: string): void;
  use(key: string): void; done(): void; using(): string | null;
  /** the Settings switch, kept in localStorage "synergon.live.on" */
  enabled(): boolean; setEnabled(on: boolean): void;
  /** the operable live screen under the pointer */
  hovered(): string | null;
  /** the last GET …/content */
  list(): ContentListResult | null;
  /** read GET …/content again now */
  refresh(): void;
  /** *Show* and *Use* are offered (not while Synergon is itself framed by another page) */
  interactive(): boolean;
}

interface Entry {
  key: string; instance: string; screen: string; show: ResolvedShow;
  /** the frame, while the show loads or shows */
  el?: HTMLIFrameElement; status?: ScreenStatus; gate?: MessageGate; href?: string;
  /** no frame: why */
  idle?: "awaiting_click" | "not_allowed" | "capped" | "off";
  W: number; H: number; transform: string; displayed: boolean; rate: number | null; filter: string;
  oversize: boolean; loads: number;
  /** the sheet's centre in layer px at the last render, when in view (checks aim with it) */
  point?: [number, number] | null;
  plate?: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; key: string };
}

export interface LiveContentOptions {
  /** the .rv-stage element */
  stage: HTMLElement;
  /** the scene's API root (/api/scenes/<id>); without it nothing is fetched or reported */
  api?: string;
  model(instance: string): PlacedAsset | undefined;
  mode(): "plan" | "3d";
  lighting(): "day" | "lamps";
}

export function mountLiveContent(o: LiveContentOptions) {
  const layer = document.createElement("div"); layer.className = "rv-frames";
  const dim = document.createElement("div"); dim.className = "rv-use-dim"; dim.hidden = true;
  const bar = document.createElement("div"); bar.className = "rv-use-bar"; bar.hidden = true; bar.setAttribute("role", "status");
  const barText = document.createElement("span"), doneButton = document.createElement("button");
  doneButton.type = "button"; doneButton.className = "rv-use-done"; doneButton.textContent = "Done";
  doneButton.onclick = () => done();
  bar.append(barText, doneButton);
  const local = LOOPBACK.includes(location.hostname);
  const timeouts = local && new URLSearchParams(location.search).get("liveTimeouts") === "fast" ? FAST_TIMEOUTS : TIMEOUTS;
  const framed = (() => { try { return window.top !== window; } catch { return true; } })();
  const entries = new Map<string, Entry>(), listeners = new Set<() => void>();
  let scene: RoomScene | undefined, list: ContentListResult | null = null, orbit: RoomOrbit | undefined;
  let enabled = liveStorage.enabled() ?? !isPhone(), tabGone = false, disposed = false;
  let usingKey: string | null = null, restoreCamera: ((ms?: number) => void) | undefined, hoveredKey: string | null = null;
  let viewer: string | undefined, lastContent = "", lastInstances = "", listTimer: ReturnType<typeof setTimeout> | undefined;
  let listEpoch = 0, hoverFrame = 0, swallow: number | null = null, hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  const lastLooks = new Map<string, string>();

  const notify = () => { for (const cb of [...listeners]) { try { cb(); } catch { /* a listener's own problem */ } } };

  // ---- data in
  async function fetchList() {
    if (!o.api || disposed) return;
    const epoch = ++listEpoch;
    try {
      const r = await fetch(o.api + "/content", { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as ContentListResult;
      if (epoch !== listEpoch || disposed || !json || !Array.isArray(json.screens) || !Array.isArray(json.apps)) return;
      list = json; sync(); notify();
    } catch { /* offline: the screens keep what they show */ }
  }
  const listEvery = setInterval(() => void fetchList(), FRAMES.listEveryMs);
  function setScene(next: RoomScene) {
    scene = next;
    const content = JSON.stringify(next.content ?? null), instances = next.instances.map(i => i.id + ":" + i.release).join(",");
    const changed = content !== lastContent || instances !== lastInstances;
    lastContent = content; lastInstances = instances;
    if (changed) { clearTimeout(listTimer); listTimer = setTimeout(() => void fetchList(), list ? FRAMES.listDebounceMs : 0); }
    sync();
  }

  // ---- frames
  function sheet(entry: Entry) {
    const mesh = o.model(entry.instance)?.screenMesh(entry.screen);
    if (!mesh) return null;
    const box = (mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox))!;
    return { mesh, box, size: [box.max.y - box.min.y, box.max.z - box.min.z] as [number, number] };
  }
  function layoutSize(entry: Entry) {
    const s = sheet(entry), aspect = s && s.size[1] > 0 ? s.size[0] / s.size[1] : 16 / 9;
    entry.W = LIVE.layoutWidth; entry.H = Math.max(1, Math.round(LIVE.layoutWidth / aspect));
  }
  function post(entry: Entry, message: Record<string, unknown>) {
    const target = entry.el?.contentWindow, origin = entry.show.origin;
    if (!target || !origin) return;
    try { target.postMessage({ protocol: PROTOCOL, ...message }, origin); } catch { /* the page went */ }
  }
  const hello = (entry: Entry) => post(entry, { type: "hello", width: entry.W, height: entry.H,
    fps: entry.displayed ? FRAMES.fps : 0, use: usingKey === entry.key });
  function makeFrame(entry: Entry) {
    const show = entry.show, el = document.createElement("iframe");
    el.setAttribute("sandbox", SANDBOX + (show.kind === "app" ? " allow-forms" : ""));
    el.setAttribute("allow", ALLOW);
    el.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    if (show.kind === "page") el.setAttribute("credentialless", "");
    el.setAttribute("inert", ""); el.tabIndex = -1;
    el.title = show.label + (show.viewLabel ? " · " + show.viewLabel : "");
    layoutSize(entry);
    el.style.cssText = `position:absolute;left:0;top:0;border:0;transform-origin:0 0;width:${entry.W}px;height:${entry.H}px;display:none`;
    el.dataset.key = entry.key;
    entry.displayed = false; entry.transform = ""; entry.rate = null; entry.filter = "";
    entry.status = new ScreenStatus(show.kind, performance.now(), timeouts);
    entry.gate = new MessageGate();
    el.addEventListener("load", () => {
      // the frame may have moved to another screen since (content.move): its current owner hears the load
      const owner = [...entries.values()].find(x => x.el === el);
      if (!owner) return;
      owner.loads++; el.dataset.loads = String(owner.loads);
      hello(owner);
      if (owner.status?.onLoad()) changed(owner);
    });
    entry.el = el; entry.href = show.href;
    // src only from frameAddress (resolveShows checked it again for this load), set before the frame joins the page so
    // that it never loads about:blank first
    el.src = show.href!;
    el.dataset.state = entry.status.state;
    layer.append(el);
  }
  function dropFrame(entry: Entry) {
    if (usingKey === entry.key) done(0);
    entry.el?.remove();
    entry.el = undefined; entry.status = undefined; entry.gate = undefined; entry.href = undefined; entry.displayed = false;
  }
  function stateOf(entry: Entry): SeenState {
    if (!enabled) return "off";
    if (entry.idle === "capped") return "starting";
    if (entry.idle) return entry.idle;
    return entry.status?.state ?? "starting";
  }
  function plateText(entry: Entry): PlateText {
    const s = entry.show, state = stateOf(entry);
    if (entry.idle === "capped") return { title: s.label, line: "", dim: true };
    if (state === "awaiting_click") return { title: s.label, line: "Content from " + (s.host ?? "another site") };
    if (state === "not_allowed") return { title: s.label, line: "Not allowed here" };
    if (state === "not_answering") return { title: s.label, line: "Not answering" };
    if (state === "ended" || state === "refused") return { title: s.label, line: entry.status?.text ?? "Ended" };
    if (entry.oversize) return { title: s.label, line: s.viewLabel ?? "" };
    return { title: s.label, line: "Starting…" };
  }
  function plateFor(entry: Entry, t: PlateText): ScreenLook {
    const key = JSON.stringify(t), s = sheet(entry);
    if (!entry.plate) {
      const canvas = document.createElement("canvas");
      const aspect = s && s.size[1] > 0 ? s.size[0] / s.size[1] : 16 / 9;
      canvas.width = FRAMES.plateWidth; canvas.height = Math.max(16, Math.round(FRAMES.plateWidth / aspect));
      const texture = new THREE.CanvasTexture(canvas);
      texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      entry.plate = { canvas, texture, key: "" };
    }
    if (entry.plate.key !== key) { drawPlate(entry.plate.canvas, t); entry.plate.texture.needsUpdate = true; entry.plate.key = key; }
    return { plate: entry.plate.texture };
  }
  /** What the entry's sheet draws now. */
  function look(entry: Entry): ScreenLook {
    if (!enabled || entry.idle === "off") return "builtin";
    if (entry.el && entry.status?.hole && !entry.oversize) return "hole";
    return plateFor(entry, plateText(entry));
  }
  function applyLooks() {
    for (const entry of entries.values()) {
      const l = look(entry), key = typeof l === "string" ? l : "plate:" + entry.plate?.key;
      const model = o.model(entry.instance);
      if (!model) continue;
      model.setScreenLook(entry.screen, l);
      if (lastLooks.get(entry.key) !== key) { lastLooks.set(entry.key, key); orbit?.invalidate(); }
    }
  }
  function changed(entry: Entry) {
    if (entry.el) entry.el.dataset.state = stateOf(entry);
    applyLooks(); report(); notify();
  }

  /** Resolve the scene's shows and bring the frames in line, replacing a frame only when its address changed. */
  function sync() {
    if (disposed) return;
    const shows = scene ? resolveShows(scene.content, scene.id, list, location.origin, liveStorage.typed()) : [];
    const wanted = new Map(shows.map(s => [s.key, s]));
    for (const [key, entry] of entries) if (!wanted.has(key)) {
      dropFrame(entry); entry.plate?.texture.dispose(); entries.delete(key);
      o.model(entry.instance)?.setScreenLook(entry.screen, "builtin"); lastLooks.delete(key); orbit?.invalidate();
    }
    // the nearest shows get frames (cap); shows of assets out of the view's scope count last
    const camera = orbit?.currentCamera().position;
    const distance = (s: ResolvedShow) => {
      const mesh = o.model(s.instance)?.screenMesh(s.screen);
      if (!mesh) return Infinity;
      let inScope = true;
      for (let n: THREE.Object3D | null = mesh; n; n = n.parent) if (!n.visible) inScope = false;
      const p = mesh.getWorldPosition(new THREE.Vector3());
      return (inScope ? 0 : 1e6) + (camera ? p.distanceTo(camera) : 0);
    };
    const framed = new Set(shows.filter(s => s.href).sort((a, b) => distance(a) - distance(b)).slice(0, FRAMES.maxFrames).map(s => s.key));
    const accepted = liveStorage.accepted(), typed = liveStorage.typed();
    // A frame whose show moved to another screen (content.move, a swapped view) goes with it: same page, same element,
    // no reload. Frames are never re-parented, only re-assigned.
    const pool = new Map<string, Entry>();
    const loose = (entry: Entry) => { if (entry.el && entry.href && !pool.has(entry.href)) { pool.set(entry.href, { ...entry }); entry.el = undefined; entry.status = undefined; entry.gate = undefined; entry.href = undefined; entry.displayed = false; } };
    for (const [key, entry] of entries) {
      const next = wanted.get(key);
      if (entry.el && (!next || next.href !== entry.href)) { if (usingKey === key) done(0); loose(entry); }
    }
    for (const [key, entry] of entries) if (!wanted.has(key)) {
      dropFrame(entry); entry.plate?.texture.dispose(); entries.delete(key);
      o.model(entry.instance)?.setScreenLook(entry.screen, "builtin"); lastLooks.delete(key); orbit?.invalidate();
    }
    for (const show of shows) {
      let entry = entries.get(show.key);
      if (!entry) {
        entry = { key: show.key, instance: show.instance, screen: show.screen, show, W: LIVE.layoutWidth, H: 720, transform: "",
          displayed: false, rate: null, filter: "", oversize: false, loads: 0 };
        entries.set(show.key, entry);
      }
      const previous = entry.show; entry.show = show;
      let idle: Entry["idle"];
      if (!enabled || tabGone) idle = "off";
      else if (!show.href) idle = "not_allowed";
      else if (show.kind === "page" && !accepted.includes(show.origin!) && !typed.includes(show.href)) idle = "awaiting_click";
      else if (!framed.has(show.key)) idle = "capped";
      if (usingKey === show.key && (idle || previous.href !== show.href)) done(0);
      entry.idle = idle;
      const moved = !idle && !entry.el ? pool.get(show.href!) : undefined;
      if (idle) { if (entry.el) dropFrame(entry); }
      else if (moved) {
        pool.delete(show.href!);
        Object.assign(entry, { el: moved.el, status: moved.status, gate: moved.gate, href: moved.href, loads: moved.loads, W: moved.W, H: moved.H,
          displayed: moved.displayed, transform: moved.transform, rate: moved.rate, filter: moved.filter });
        const s = sheet(entry), H = s && s.size[0] > 0 ? Math.max(1, Math.round(LIVE.layoutWidth * s.size[1] / s.size[0])) : entry.H;
        if (H !== entry.H) { entry.H = H; entry.el!.style.height = H + "px"; hello(entry); }
        entry.el!.dataset.key = entry.key; entry.el!.title = show.label + (show.viewLabel ? " · " + show.viewLabel : "");
      }
      else if (!entry.el || entry.href !== show.href) { if (entry.el) dropFrame(entry); makeFrame(entry); }
      else if (entry.el && previous.viewLabel !== show.viewLabel) entry.el.title = show.label + (show.viewLabel ? " · " + show.viewLabel : "");
    }
    for (const left of pool.values()) left.el?.remove();
    if (o.mode() !== "3d") hideAll();
    applyLooks(); report(); notify(); orbit?.invalidate();
  }

  // ---- placement after every render
  const v4 = new THREE.Vector4(), projView = new THREE.Matrix4(), corner = new THREE.Vector3(), normal = new THREE.Vector3();
  const centre = new THREE.Vector3(), toCamera = new THREE.Vector3();
  function setRate(entry: Entry, fps: number) {
    if (entry.rate === fps) return;
    const greeted = entry.status?.ready;
    entry.rate = fps;
    if (greeted) post(entry, { type: "rate", fps });
  }
  function hide(entry: Entry) {
    if (entry.el && entry.displayed) { entry.el.style.display = "none"; entry.displayed = false; }
    if (entry.el) setRate(entry, 0);
  }
  function hideAll() { for (const e of entries.values()) hide(e); }
  function place(camera: THREE.Camera, w: number, h: number) {
    if (o.mode() !== "3d") { hideAll(); return; }
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const lamps = o.lighting() === "lamps";
    let looksChanged = false;
    for (const entry of entries.values()) {
      const s = sheet(entry);
      let visible = !!s && w > 1 && h > 1;
      if (s) for (let n: THREE.Object3D | null = s.mesh; n && visible; n = n.parent) if (!n.visible) visible = false;
      const points: [number, number][] = [];
      if (visible && s) {
        s.mesh.updateWorldMatrix(true, false);
        normal.set(-1, 0, 0).transformDirection(s.mesh.matrixWorld);
        centre.copy(s.box.getCenter(centre)).applyMatrix4(s.mesh.matrixWorld);
        if ((camera as THREE.OrthographicCamera).isOrthographicCamera) camera.getWorldDirection(toCamera).negate();
        else toCamera.copy(camera.position).sub(centre);
        if (normal.dot(toCamera) <= 0) visible = false;
        for (const c of sheetCorners(s.box)) {
          if (!visible) break;
          corner.copy(c).applyMatrix4(s.mesh.matrixWorld);
          v4.set(corner.x, corner.y, corner.z, 1).applyMatrix4(projView);
          if (v4.w <= 1e-6) { visible = false; break; }
          points.push([(v4.x / v4.w + 1) / 2 * w, (1 - v4.y / v4.w) / 2 * h]);
        }
      }
      let oversize = false;
      if (visible) {
        const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) visible = false;
        else if (usingKey !== entry.key && (x1 - x0 > FRAMES.oversize * w || y1 - y0 > FRAMES.oversize * h)) { visible = false; oversize = true; }
      }
      entry.point = visible ? [points.reduce((a, p) => a + p[0], 0) / 4, points.reduce((a, p) => a + p[1], 0) / 4] : null;
      if (!entry.el) continue;
      if (oversize !== entry.oversize) { entry.oversize = oversize; looksChanged = true; }
      const matrix = visible ? homography(entry.W, entry.H, points) : null;
      if (!matrix) { hide(entry); continue; }
      if (matrix !== entry.transform) { entry.el.style.transform = matrix; entry.transform = matrix; }
      const level = lamps ? Math.max(0, o.model(entry.instance)?.screenLevel ?? 1) : 1;
      const filter = `brightness(${+(FRAMES.brightness * level).toFixed(3)})`;
      if (filter !== entry.filter) { entry.el.style.filter = filter; entry.filter = filter; }
      if (!entry.displayed) { entry.el.style.display = ""; entry.displayed = true; }
      setRate(entry, FRAMES.fps);
    }
    if (looksChanged) applyLooks();
  }

  // ---- the greeting
  function onMessage(e: MessageEvent) {
    for (const entry of entries.values()) {
      if (!entry.el || e.source !== entry.el.contentWindow) continue;
      const m = acceptMessage(e, { window: entry.el.contentWindow, origin: entry.show.origin ?? "" }, entry.gate!, performance.now());
      if (!m || !entry.status) return;
      if (m.type === "ready") { const c = entry.status.onReady(m.operable); hello(entry); if (entry.rate !== null) post(entry, { type: "rate", fps: entry.rate }); if (c) changed(entry); }
      else if (m.type === "status") { if (entry.status.onStatus(m.state, m.run, m.text)) changed(entry); }
      else if (m.type === "leave" && usingKey === entry.key) done();
      return;
    }
  }
  window.addEventListener("message", onMessage);
  const clock = setInterval(() => {
    const now = performance.now();
    for (const entry of entries.values()) if (entry.status?.tick(now)) changed(entry);
  }, FRAMES.tickMs);

  // ---- Use
  function canUse(key: string) {
    const entry = entries.get(key);
    return !framed && enabled && !!orbit && o.mode() === "3d" && !!entry?.el && !!entry.status?.hole && entry.status.operable && !!sheet(entry);
  }
  function use(key: string) {
    if (usingKey === key) return;
    if (usingKey) done(0);
    if (!canUse(key) || !orbit) return;
    const entry = entries.get(key)!, s = sheet(entry)!, el = entry.el!;
    usingKey = key;
    orbit.setUse(true);
    if (!orbit.inEye()) {
      s.mesh.updateWorldMatrix(true, false);
      const c = s.box.getCenter(new THREE.Vector3()).applyMatrix4(s.mesh.matrixWorld);
      const n = new THREE.Vector3(-1, 0, 0).transformDirection(s.mesh.matrixWorld);
      const scale = new THREE.Vector3().setFromMatrixScale(s.mesh.matrixWorld);
      restoreCamera = orbit.faceSheet(c, n, [s.size[0] * scale.y, s.size[1] * scale.z], FRAMES.useFraction, FRAMES.useGlideMs, FRAMES.useClearMetres);
    }
    el.style.zIndex = "2"; el.removeAttribute("inert"); el.removeAttribute("tabindex"); el.style.pointerEvents = "auto";
    barText.textContent = "Using " + (entry.show.viewLabel || entry.show.label);
    bar.hidden = false; dim.hidden = false;
    o.stage.dataset.liveUse = key;
    hoveredKey = null; orbit.canvas.style.cursor = "";
    el.focus({ preventScroll: true });
    post(entry, { type: "use", active: true });
    notify(); orbit.invalidate();
  }
  function done(glideMs?: number) {
    const key = usingKey;
    if (!key) return;
    usingKey = null;
    const entry = entries.get(key), el = entry?.el;
    if (entry && el) {
      post(entry, { type: "use", active: false });
      el.setAttribute("inert", ""); el.tabIndex = -1; el.style.zIndex = ""; el.style.pointerEvents = "";
    }
    bar.hidden = true; dim.hidden = true; delete o.stage.dataset.liveUse;
    orbit?.setUse(false);
    orbit?.canvas.focus({ preventScroll: true });
    restoreCamera?.(glideMs); restoreCamera = undefined;
    notify(); orbit?.invalidate();
  }
  /** The live, operable screen under a viewport point, if nothing stands in front of it. */
  function screenAt(x: number, y: number): string | null {
    if (!orbit) return null;
    const live = new Map<THREE.Object3D, string>();
    for (const entry of entries.values()) {
      if (!entry.displayed || !entry.status?.hole || !entry.status.operable) continue;
      const mesh = sheet(entry)?.mesh;
      if (mesh) live.set(mesh, entry.key);
    }
    const first = orbit.pick(x, y, [...live.keys()]);
    if (!first) return null;
    return orbit.pickAny(x, y)?.object === first.object ? live.get(first.object) ?? null : null;
  }
  function setHovered(key: string | null) {
    if (key === hoveredKey) return;
    hoveredKey = key;
    if (orbit) orbit.canvas.style.cursor = key ? "pointer" : "";
    notify();
  }
  function guard(e: Event): boolean {
    const p = e as PointerEvent;
    if (usingKey) {
      // a press on the 3D view outside the screen leaves Use; it neither selects nor orbits, and its release and
      // click are swallowed too. Moves and releases of a press that began in the frame are ignored.
      if (e.type === "pointerdown") { swallow = p.pointerId; done(); }
      return true;
    }
    if (swallow !== null) {
      if (e.type === "pointerdown") swallow = null;
      else if (["pointerup", "click", "dblclick", "contextmenu"].includes(e.type)) { if (e.type === "click") swallow = null; return true; }
    }
    if (e.type === "dblclick" && !framed) {
      const key = screenAt(p.clientX, p.clientY);
      if (key) { use(key); return true; }
    }
    if (e.type === "pointermove" && !p.buttons && p.pointerType !== "touch") {
      const x = p.clientX, y = p.clientY;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; if (!usingKey) setHovered(framed ? null : screenAt(x, y)); });
    }
    return false;
  }
  const keys = (e: KeyboardEvent) => { if (usingKey && e.key === "Escape") { e.preventDefault(); done(); } };
  window.addEventListener("keydown", keys, true);
  // A page that grabs the keyboard while no screen is in use gives it back to Synergon.
  const focusGuard = () => setTimeout(() => {
    if (!usingKey && document.activeElement instanceof HTMLIFrameElement && layer.contains(document.activeElement)) orbit?.canvas.focus({ preventScroll: true });
  });
  window.addEventListener("blur", focusGuard);
  // A tab hidden for two minutes releases its frames; they come back through Starting… when it is shown again.
  const visibility = () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) hiddenTimer = setTimeout(() => { tabGone = true; sync(); }, FRAMES.hiddenTabMs);
    else if (tabGone) { tabGone = false; sync(); }
  };
  document.addEventListener("visibilitychange", visibility);

  // ---- reports
  const schedule = new ReportSchedule(screens => {
    if (!viewer || !o.api) return true;
    void fetch(o.api + "/seen", { method: "POST", headers: { "Content-Type": "application/json", "X-Synergon": "1" },
      body: JSON.stringify(reportBody(viewer, screens)) }).catch(() => {});
    return true;
  }, LIVE.seenEveryMs, FRAMES.reportEveryMs);
  function report() {
    const screens: Reports = {};
    for (const entry of entries.values()) {
      if (entry.idle === "capped") continue;
      const state = stateOf(entry);
      screens[entry.key] = { state, ...(entry.status?.run ? { run: entry.status.run } : {}), ...(entry.show.view ? { view: entry.show.view } : {}) };
    }
    schedule.update(screens);
  }

  // ---- the API for the configurator
  const api: ContentApi = {
    state(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      const state = stateOf(entry), text = entry.status?.text;
      return { state, ...(text ? { text: (entry.show.app ? entry.show.app + ": " : "") + text } : {}),
        ...(entry.show.host ? { host: entry.show.host } : {}), operable: !framed && !!entry.status?.operable && !!entry.status.hole };
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    accept(origin) { if (framed) return; liveStorage.accept(origin); sync(); },
    retry(key) { const entry = entries.get(key); if (entry?.el) { dropFrame(entry); } sync(); },
    use, done: () => done(), using: () => usingKey,
    enabled: () => enabled,
    setEnabled(on) { enabled = on; liveStorage.setEnabled(on); if (!on) done(0); sync(); },
    hovered: () => hoveredKey,
    list: () => list,
    refresh: () => void fetchList(),
    interactive: () => !framed,
  };

  return {
    api,
    setScene,
    /** The 3D view exists: lay the frames under its canvas and follow its renders. */
    attach(next: RoomOrbit) {
      orbit = next;
      const canvas = next.canvas, host = canvas.parentElement!;
      host.insertBefore(layer, canvas);
      canvas.after(dim); host.append(bar);
      next.afterRender = place;
      next.pointerGuard = guard;
      next.onContextRestored = () => { for (const entry of entries.values()) if (entry.plate) { entry.plate.key = ""; } lastLooks.clear(); applyLooks(); };
      canvas.addEventListener("pointerleave", () => setHovered(null));
      if (local) {
        const w = window as unknown as Record<string, unknown>;
        w.__synergonLoseContext = () => next.loseContext();
        w.__synergonLiveAt = (x: number, y: number) => { const any = next.pickAny(x, y); return { screen: screenAt(x, y), any: any ? String(any.object.userData.roomInstance) + "/" + String(any.object.userData.roomMember) + ":" + any.object.name : null }; };
      }
      sync();
    },
    /** The view changed between the plan and 3D, the operator's eye or the focus scope. */
    viewChanged() {
      if (usingKey) done(0);
      if (o.mode() !== "3d") hideAll();
      setHovered(null);
    },
    /** A placed asset loaded or changed its display: draw holes and plates on it again. */
    paint() { applyLooks(); },
    setViewer(token: string) { viewer = token; schedule.resend(); report(); },
    /** Any frame on screen now? (Save picture asks for the tab then.) */
    liveVisible: () => [...entries.values()].some(e => e.displayed && e.status?.hole),
    /** For a picture without tab capture: every hole becomes a plate "<item> · <view>", drawn at once; call the
     *  returned function after reading the canvas, within the same task. */
    plates(): () => void {
      const swapped: Entry[] = [];
      for (const entry of entries.values()) {
        if (look(entry) !== "hole") continue;
        o.model(entry.instance)?.setScreenLook(entry.screen, plateFor(entry, { title: entry.show.label + (entry.show.viewLabel ? " · " + entry.show.viewLabel : ""), line: "" }));
        swapped.push(entry);
      }
      orbit?.renderNow();
      return () => { for (const entry of swapped) o.model(entry.instance)?.setScreenLook(entry.screen, look(entry)); lastLooks.clear(); applyLooks(); orbit?.invalidate(); };
    },
    /** Test hook: per screen, its state and how often its frame loaded. */
    debug: () => Object.fromEntries([...entries.values()].map(e => [e.key, { state: stateOf(e), loads: e.loads, framed: !!e.el, displayed: e.displayed,
      hole: look(e) === "hole", run: e.status?.run ?? null, href: e.href ?? null, point: e.point ?? null, operable: !!e.status?.operable }])),
    dispose() {
      disposed = true; done(0);
      clearInterval(listEvery); clearInterval(clock); clearTimeout(listTimer); clearTimeout(hiddenTimer); cancelAnimationFrame(hoverFrame);
      schedule.stop();
      window.removeEventListener("message", onMessage); window.removeEventListener("keydown", keys, true);
      window.removeEventListener("blur", focusGuard); document.removeEventListener("visibilitychange", visibility);
      for (const entry of entries.values()) { dropFrame(entry); entry.plate?.texture.dispose(); }
      entries.clear(); layer.remove(); dim.remove(); bar.remove();
    },
  };
}
export type LiveContent = ReturnType<typeof mountLiveContent>;
