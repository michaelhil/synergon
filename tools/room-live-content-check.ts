// Live screen content in two real browsers against a local server and the fake app page (tools/live-provider.ts):
// frames over the desk's screens, the stacking that keeps the room orbiting, Use (click, drag and wheel reach the
// page, square on and at an oblique angle in the operator's eye view), the three ways out, a second browser following
// agent commands without reloading frames, Restart and Undo, the loading rule, Not answering, the viewers' reports,
// the Settings switch, Save picture without tab capture, and a lost graphics context. Prints `ok <step>` or
// `FAIL <step>: …`; exit code 1 on any failure.
//   bun tools/room-live-content-check.ts
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser, type Page } from "./render.ts";
import { serveRoom } from "./room-serve.ts";
import { startLiveProvider } from "./live-provider.ts";

const t0 = performance.now();
const temp = mkdtempSync(join(tmpdir(), "synergon-live-content-"));
const provider = startLiveProvider({ port: 0 });
const views = ["one", "two", "three", "four", "five", "map"].map(id => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));
const apps = [{ id: "fake", label: "Fake", origin: provider.url.origin, items: [
  { id: "demo", label: "Demo item", page: "/app?run={run}&item={item}&view={view}", views },
  { id: "silent", label: "Silent item", page: "/silent?run={run}&item={item}&view={view}", views: [{ id: "one", label: "One" }] },
  { id: "broken", label: "Broken item", page: "/refused?run={run}&item={item}&view={view}", views: [{ id: "map", label: "Map" }] },
] }];
// serveRoom's `apps` option belongs to the server package; older servers ignore it
const service = await (serveRoom as (o: object) => ReturnType<typeof serveRoom>)({ port: 0, dataDir: temp, apps });
const site = service.url.origin;
const browsers = [await Browser.launch(), await Browser.launch()];
let failures = 0;
const step = (ok: boolean, what: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  return ok;
};
/** CI runners draw WebGL in software, several times slower than a desktop: every wait stretches there. */
const SLOW = process.env.CI ? 4 : 1;
async function until<T>(page: Page, expr: string, ms = 8000): Promise<T | null> {
  const end = Date.now() + ms * SLOW;
  while (Date.now() < end) {
    const v = await page.evaluate(expr).catch(() => null);
    if (v) return v as T;
    await Bun.sleep(60);
  }
  return null;
}
const sleep = (ms: number) => Bun.sleep(ms);
/** Waits for the element, then clicks it; a missing element fails the step that checks its effect, not the whole run. */
async function press(page: Page, expr: string): Promise<void> {
  if (await until(page, `!!(${expr})`)) await page.evaluate(`(${expr}).click()`);
  else console.error("live screen content: not found to click: " + expr.slice(0, 120));
}
const debug = (p: Page) => p.evaluate("window.__synergonLive ? window.__synergonLive() : {}") as Promise<Record<string, {
  state: string; loads: number; framed: boolean; displayed: boolean; hole: boolean; run: string | null; href: string | null; point: [number, number] | null; operable: boolean }>>;
/** Page px of a frame's layout point (u, v): through the frame's own transform. */
const framePoint = (p: Page, key: string, u: number, v: number) => p.evaluate(`(() => {
  const f = document.querySelector('.rv-frames iframe[data-key="${key}"]'); if (!f) return null;
  const m = new DOMMatrix(f.style.transform), q = m.transformPoint(new DOMPoint(${u}, ${v}, 0, 1)), r = f.parentElement.getBoundingClientRect();
  return [r.left + q.x / q.w, r.top + q.y / q.w]; })()`) as Promise<[number, number] | null>;
const sheetPoint = async (p: Page, key: string) => {
  const d = (await debug(p))[key], r = await p.evaluate("(() => { const b = document.querySelector('.rv-orbit').getBoundingClientRect(); return [b.left, b.top]; })()") as [number, number];
  return d?.point ? [r[0] + d.point[0], r[1] + d.point[1]] as [number, number] : null;
};
/** A point on a live screen that nothing stands in front of (a grid over the frame, tested by the page's own pick). */
async function aim(p: Page, key: string, u0 = 0.5, v0 = 0.5): Promise<[number, number] | null> {
  const size = await p.evaluate(`(() => { const f = document.querySelector('.rv-frames iframe[data-key="${key}"]'); return f ? [parseFloat(f.style.width), parseFloat(f.style.height)] : null; })()`) as [number, number] | null;
  if (!size) return null;
  const tries: [number, number][] = [[u0, v0]];
  for (const v of [0.5, 0.65, 0.8, 0.35, 0.2]) for (const u of [0.5, 0.35, 0.65, 0.2, 0.8]) tries.push([u, v]);
  for (const [u, v] of tries) {
    const q = await framePoint(p, key, u * size[0], v * size[1]);
    if (q && (await p.evaluate(`document.elementFromPoint(${q[0]}, ${q[1]}) === document.querySelector('.rv-orbit canvas') && window.__synergonLiveAt(${q[0]}, ${q[1]}).screen`)) === key) return q;
  }
  return null;
}
/** Select a scene object from the panel's list (closing a docked component card first). */
async function objectRow(p: Page, name: string) {
  await p.evaluate(`document.querySelector('.rm-scroll [title="Close component controls"]')?.click()`);
  const row = `[...document.querySelectorAll('.rm-object-row')].find(b => b.textContent.includes(${JSON.stringify(name)}))`;
  if (!await until(p, `!!${row}`, 4000)) throw new Error("no row " + name + " in the panel: " + await p.evaluate("document.querySelector('.rm-scroll')?.innerText.slice(0, 400)"));
  await press(p, `${row}`);
}
const view = async (p: Page, name: string) => {
  await press(p, `document.querySelector('[aria-label="Views"]')`);
  await until(p, `[...document.querySelectorAll('.rw-choice')].some(b => b.textContent.startsWith('${name}'))`, 3000);
  await press(p, `[...document.querySelectorAll('.rw-choice')].find(b => b.textContent.startsWith('${name}'))`);
  await Bun.sleep(500);
};
const mouse = (p: Page, type: string, x: number, y: number, extra: object = {}) =>
  p.call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
async function click(p: Page, x: number, y: number, count = 1) {
  for (let c = 1; c <= count; c++) { await mouse(p, "mousePressed", x, y, { clickCount: c }); await mouse(p, "mouseReleased", x, y, { clickCount: c }); }
}
async function drag(p: Page, from: [number, number], to: [number, number], steps = 8) {
  await mouse(p, "mouseMoved", from[0], from[1], { buttons: 0, button: "none" });
  await mouse(p, "mousePressed", from[0], from[1]);
  for (let i = 1; i <= steps; i++) await mouse(p, "mouseMoved", from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps);
  await mouse(p, "mouseReleased", to[0], to[1]);
}
const wheel = (p: Page, x: number, y: number, deltaY: number) => p.call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
const key = async (p: Page, k: string, code: number) => {
  await p.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k.length === 1 ? "Key" + k.toUpperCase() : k, windowsVirtualKeyCode: code });
  await p.call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k.length === 1 ? "Key" + k.toUpperCase() : k, windowsVirtualKeyCode: code });
};
const events = async () => (await (await fetch(provider.url.origin + "/events")).json() as { events: { type: string; page: string; view: string; target?: string }[] }).events;
const clearEvents = () => fetch(provider.url.origin + "/events", { method: "DELETE" });
const transforms = (p: Page) => p.evaluate("JSON.stringify([...document.querySelectorAll('.rv-frames iframe')].map(f => f.style.transform))") as Promise<string>;
const using = (p: Page) => p.evaluate("document.querySelector('.rv-stage').dataset.liveUse || null") as Promise<string | null>;
const loads = async (p: Page) => Object.values(await debug(p)).reduce((n, e) => n + e.loads, 0);

try {
  const workspaces = (await (await fetch(site + "/api/workspaces")).json() as { workspaces: { id: string }[] }).workspaces;
  const tree = await (await fetch(site + "/api/workspaces/" + workspaces[0]!.id)).json() as { projects: { scenes: { id: string }[] }[] };
  const sceneId = tree.projects[0]!.scenes[0]!.id, api = site + "/api/scenes/" + sceneId;
  const command = async (id: string, args: object) => await (await fetch(api + "/command", { method: "POST",
    headers: { "content-type": "application/json", "x-synergon": "1" }, body: JSON.stringify({ id, args }) })).json() as { ok: boolean; version: number; result: any; error?: any };
  const contentList = async () => await (await fetch(api + "/content")).json() as { screens: { instance: string; screen: string; seen: { viewer: string; state: string; run?: string }[] }[] };
  const A = await browsers[0]!.page(site + "/workspaces/" + sceneId + "?liveTimeouts=fast");
  await A.viewport(1280, 860);
  const ready = "!!document.querySelector('.rv-orbit canvas') && document.querySelectorAll('.rv-orbit-tag').length >= 5 && !!window.__synergonLive";
  if (!await until(A, ready, 30_000)) throw new Error("the scene did not open in 3D");
  await A.evaluate("window.__keys = []; addEventListener('keydown', e => __keys.push(e.key))");

  // 1. Operator desk › Screens › Fake › Demo item: five frames, Starting…, then holes; the keyboard panel keeps its picture
  await objectRow(A, "Operator desk");
  await until(A, `[...document.querySelectorAll('summary')].some(s => s.textContent.startsWith('Screens'))`);
  await A.evaluate(`(() => { const s = [...document.querySelectorAll('summary')].find(s => s.textContent.startsWith('Screens')); s.parentElement.open = true;
    const pick = document.querySelector('select[aria-label="Screens"]'); pick.value = 'item:fake/demo'; pick.dispatchEvent(new Event('change')); })()`);
  const starting = await until<Record<string, { state: string }>>(A, `(() => { const d = window.__synergonLive(); const k = Object.keys(d).filter(k => k.startsWith('desk-a/')); return k.length === 5 && k.some(x => d[x].state === 'starting') ? d : null; })()`, 6000);
  const desk = ["S_big_screen_L", "S_big_screen_R", "S_small_screen_1", "S_small_screen_2", "S_small_screen_3"].map(s => "desk-a/" + s);
  const live = await until(A, `(() => { const d = window.__synergonLive(); return ${JSON.stringify(desk)}.every(k => d[k]?.state === 'showing' && d[k].hole) && !d['desk-a/S_keyboard_touch']; })()`, 10_000);
  const notice = await A.evaluate("document.querySelector('.rm-notice')?.innerText || ''") as string;
  step(!!starting && !!live && (await A.evaluate("document.querySelectorAll('.rv-frames iframe').length")) === 5 && /Demo item on 5 screens of Operator desk/.test(notice) && /Undo/.test(notice),
    "Screens › Demo item: five frames, Starting… then live holes, keyboard panel kept, notice with Undo", notice.replace(/\s+/g, " "));
  // D1: the desk faces away in the opening view, so these screens went live out of sight (the fake app, like Leitbild,
  // says live only after drawing, which rate 0 stops); only after that were they told rate 0
  const unseen = await A.evaluate(`(() => { const d = window.__synergonLive(); return ${JSON.stringify(desk)}.every(k => !d[k].displayed); })()`);
  const rates = (await events()).filter(e => e.type === "message:rate").map(e => (e as unknown as { fps: number }).fps);
  step(!!live && unseen && rates.includes(0), "screens out of sight still go live, and are told rate 0 only afterwards", `rates ${rates.join(",")}`);
  // D2: the notice's Undo undoes the edit it announced, by its recorded version; another edit hides the notice
  await A.evaluate(`window.__sent = []; const f0 = window.fetch; window.fetch = (u, o) => { if (o?.body) __sent.push(String(o.body)); return f0(u, o); }`);
  await press(A, `[...document.querySelectorAll('.rm-notice button')].find(b => b.textContent === 'Undo')`);
  const undone = await until(A, `Object.keys(window.__synergonLive()).filter(k => k.startsWith('desk-a/')).length === 0`, 4000);
  const undoBody = JSON.parse((await A.evaluate(`__sent.find(b => b.includes('"undo"')) || 'null'`)) as string) as { args?: { version?: unknown } } | null;
  await A.evaluate(`(() => { const s = [...document.querySelectorAll('summary')].find(s => s.textContent.startsWith('Screens')); s.parentElement.open = true;
    const pick = document.querySelector('select[aria-label="Screens"]'); pick.value = 'item:fake/demo'; pick.dispatchEvent(new Event('change')); })()`);
  const again = await until<string>(A, `(() => { const t = document.querySelector('.rm-notice:not([hidden])')?.innerText || ''; return /on 5 screens/.test(t) ? t : null; })()`, 6000);
  // the desk faces away in this view: the notice says so and offers Look, which turns the view to the desk
  await press(A, `[...document.querySelectorAll('.rm-notice button')].find(b => b.textContent === 'Look')`);
  const looked = await until(A, `document.querySelector('.rv-stage').dataset.focusedAsset === 'desk-a' && (() => { const d = window.__synergonLive(); return ${JSON.stringify(desk)}.some(k => d[k]?.displayed); })()`, 6000);
  step(!!again && /face away/.test(again) && !!looked, "after a distribution out of sight the notice says the screens face away, and Look turns the view to them", (again ?? "").replace(/\s+/g, " "));
  const other = (await command("state", {})).result.scene.instances.find((i: { id: string }) => i.id === "station-b");
  await command("instances.move", { instance: "station-b", x: other.x + 0.01 });
  const hidden = await until(A, `document.querySelector('.rm-notice').hidden`, 3000);
  await until(A, `(() => { const d = window.__synergonLive(); return ${JSON.stringify(desk)}.every(k => d[k]?.state === 'showing'); })()`, 10_000);
  step(!!undone && typeof undoBody?.args?.version === "number" && !!again && !!hidden,
    "the notice's Undo undoes the announced edit by its version; a later edit hides the notice", JSON.stringify(undoBody));
  // see the desk's screens (Look focused the desk already)
  if (!await A.evaluate(`document.querySelector('.rv-stage').dataset.focusedAsset === 'desk-a'`)) {
    await press(A, `document.querySelector('[aria-label="View scope"]')`);
    await until(A, `document.querySelector('[aria-label="Focus on Operator desk"]')`);
    await press(A, `document.querySelector('[aria-label="Focus on Operator desk"]')`);
  }
  await until(A, `(() => { const d = window.__synergonLive(); return ${JSON.stringify(desk)}.every(k => d[k]?.displayed); })()`, 8000);
  await sleep(400);
  await A.screenshot(join(temp, "desk.png"));

  // 2. stacking: the canvas above the layer, the layer no stacking context, every frame inert
  const stacking = await A.evaluate(`(() => { const c = document.querySelector('.rv-orbit canvas'), l = document.querySelector('.rv-frames'), cs = getComputedStyle(c), ls = getComputedStyle(l);
    return { canvas: cs.zIndex + '/' + cs.position, layer: [ls.zIndex, ls.transform, ls.opacity, ls.filter, ls.pointerEvents].join('/'), before: l.nextElementSibling === c,
      inert: [...l.querySelectorAll('iframe')].every(f => f.hasAttribute('inert') && f.tabIndex === -1 && getComputedStyle(f).zIndex === 'auto') }; })()`);
  step(stacking.canvas === "1/relative" && stacking.layer === "auto/none/1/none/none" && stacking.before && stacking.inert, "stacking: canvas z-index 1, layer without a stacking context, frames inert", JSON.stringify(stacking));

  // 3. an orbit drag that starts on a hole moves the camera and reaches no page
  const bigL = desk[0]!, centre = (await sheetPoint(A, bigL))!;
  await clearEvents();
  const before3 = await transforms(A);
  await drag(A, centre, [centre[0] + 60, centre[1] + 15]);
  await sleep(400);
  const pageEvents3 = (await events()).filter(e => /pointer|click|wheel|drag/.test(e.type));
  step(before3 !== await transforms(A) && pageEvents3.length === 0, "an orbit drag over a live screen orbits the room; the page hears nothing", `${pageEvents3.length} page events`);

  // 4. double-click the big left screen: Use; click, drag and wheel reach the page; the camera does not move
  const target = (await aim(A, bigL))!;
  await click(A, target[0], target[1], 2);
  const entered = await until(A, `document.querySelector('.rv-stage').dataset.liveUse === '${bigL}'`, 3000);
  await sleep(700);
  const settled = await transforms(A);
  await clearEvents();
  const button = (await framePoint(A, bigL, 140, 144))!;
  await sleep(350);
  await click(A, button[0], button[1]);
  const mapFrom = (await framePoint(A, bigL, 700, 380))!, mapTo = (await framePoint(A, bigL, 820, 440))!;
  await drag(A, mapFrom, mapTo, 10);
  await wheel(A, mapTo[0], mapTo[1], -240);
  await sleep(500);
  const e4 = (await events()).filter(e => e.view === "one");
  const got = (t: string) => e4.some(e => e.type === t && (t !== "click" || e.target === "ack"));
  const bar = await A.evaluate("document.querySelector('.rv-use-bar')?.innerText || ''") as string;
  step(!!entered && got("click") && got("pointerdown") && got("drag") && got("wheel") && settled === await transforms(A) && /Using One/.test(bar),
    "Use by double-click: the page gets the click, a map drag and the wheel; the room camera stays", e4.map(e => e.type).join(","));

  // 5. three ways out; afterwards keys reach Synergon and every frame is inert again
  async function outAndKeys(how: string) {
    const left = await until(A, `!document.querySelector('.rv-stage').dataset.liveUse`, 3000);
    await sleep(450);
    await A.evaluate("window.__keys = []");
    await key(A, "k", 75);
    const keys = await A.evaluate("window.__keys.join('')");
    const inert = await A.evaluate(`[...document.querySelectorAll('.rv-frames iframe')].every(f => f.hasAttribute('inert') && f.tabIndex === -1 && !f.style.zIndex)`);
    return step(!!left && keys === "k" && inert, "leave Use by " + how + ": keys reach Synergon, frames inert", `keys ${JSON.stringify(keys)}`);
  }
  await press(A, `document.querySelector('.rv-use-done')`);
  await outAndKeys("Done");
  // open the big screen's card first, so that a selecting click would be seen
  await A.evaluate(`(() => { const pick = document.querySelector('select[aria-label="Selected component"]'); if (pick) { pick.value = 'S_big_screen_L'; pick.dispatchEvent(new Event('change')); } })()`);
  await until(A, `document.querySelector('.rm-component-card[data-component="S_big_screen_L"]')`, 3000);
  const restBefore = await transforms(A);
  const t5 = (await aim(A, bigL))!;
  await click(A, t5[0], t5[1], 2);
  await until(A, `document.querySelector('.rv-stage').dataset.liveUse`, 3000); await sleep(600);
  const corner = await A.evaluate("(() => { const r = document.querySelector('.rv-orbit').getBoundingClientRect(); return [r.left + 30, r.bottom - 40]; })()") as [number, number];
  await drag(A, corner, [corner[0] + 80, corner[1] - 20]);
  const outside = await outAndKeys("a press on the 3D view");
  await sleep(300);
  step(outside && restBefore === await transforms(A) && !!await A.evaluate(`document.querySelector('.rm-component-card[data-component="S_big_screen_L"]')`),
    "the press that leaves Use neither orbits nor selects");
  await click(A, t5[0], t5[1], 2);
  await until(A, `document.querySelector('.rv-stage').dataset.liveUse`, 3000); await sleep(600);
  await key(A, "Escape", 27);   // focus is in the page; the fake app sends leave for an Esc it did not use
  await outAndKeys("the page's leave (Esc in the page)");

  // 4b. oblique: Use in the operator's eye view keeps the view; the wall display seen from the seat, at its own angle
  await command("content.show", { instance: "wall-display", screen: "S_screen", item: "demo", app: "fake", view: "map" });
  await A.evaluate(`document.querySelector('[aria-label="Return to whole scene"]')?.click()`);
  await until(A, `!document.querySelector('.rv-stage').dataset.focusedAsset`, 5000);
  await press(A, `document.querySelector('[aria-label="Operator’s eye"]')`);
  await until(A, `document.querySelector('.rv-orbit').dataset.camera === 'operator'`, 8000);
  const ts = "wall-display/S_screen";
  await until(A, `(() => { const d = window.__synergonLive()['${ts}']; return d && d.displayed && d.hole; })()`, 8000);
  await sleep(400);
  const tsPoint = await aim(A, ts);
  const obliqueShot = join(temp, "oblique.png");
  await A.screenshot(obliqueShot);
  let oblique = false, detail4b = "touchscreen not in view";
  if (tsPoint) {
    await click(A, tsPoint[0], tsPoint[1], 2);
    const inUse = await until(A, `document.querySelector('.rv-stage').dataset.liveUse === '${ts}'`, 3000);
    await sleep(450);
    const keep = await transforms(A);
    await clearEvents();
    const b = (await framePoint(A, ts, 140, 144))!, m0 = (await framePoint(A, ts, 640, 400))!, m1 = (await framePoint(A, ts, 760, 470))!;
    await click(A, b[0], b[1]); await drag(A, m0, m1, 10); await wheel(A, m1[0], m1[1], 200);
    await sleep(500);
    const ev = (await events()).filter(e => e.view === "map");
    const skew = await A.evaluate(`(() => { const f = document.querySelector('.rv-frames iframe[data-key="${ts}"]'); const m = new DOMMatrix(f.style.transform); return Math.abs(m.m12) + Math.abs(m.m21) + Math.abs(m.m14) + Math.abs(m.m24); })()`) as number;
    oblique = !!inUse && ev.some(e => e.type === "click" && e.target === "ack") && ev.some(e => e.type === "drag") && ev.some(e => e.type === "wheel") && keep === await transforms(A) && skew > 1e-3;
    detail4b = ev.map(e => e.type).join(",") + "; skew " + skew.toFixed(4);
    await A.evaluate(`document.querySelector('.rv-use-done')?.click()`);
    await until(A, `!document.querySelector('.rv-stage').dataset.liveUse`, 2000);
  }
  step(oblique, "Use at an oblique angle (operator's eye, the wall display): click, drag and wheel reach the page; the view is kept", detail4b);
  await press(A, `document.querySelector('[aria-label="Operator’s eye"]')`);
  await until(A, `document.querySelector('.rv-orbit').dataset.camera !== 'operator'`, 3000);

  // 6. a second browser follows content.move and instances.move within 2 s; no frame reloads in either
  const B = await browsers[1]!.page(site + "/workspaces/" + sceneId);
  await B.viewport(1280, 860);
  if (!await until(B, ready, 30_000)) throw new Error("the second browser did not open the scene");
  // the west view shows all five desk screens
  await view(A, "Left"); await view(B, "Left");
  await until(B, `(() => { const d = window.__synergonLive(); return ${JSON.stringify(desk)}.every(k => d[k]?.state === 'showing'); })()`, 10_000);
  const loadsA = await loads(A), loadsB = await loads(B), hrefs = await debug(B);
  const t6 = Date.now();
  await command("content.move", { from: { instance: "desk-a", screen: "S_big_screen_L" }, to: { instance: "desk-a", screen: "S_big_screen_R" } });
  const followed = await until(B, `(() => { const d = window.__synergonLive(); return d['desk-a/S_big_screen_L']?.href === ${JSON.stringify(hrefs["desk-a/S_big_screen_R"]!.href)} && d['desk-a/S_big_screen_R']?.href === ${JSON.stringify(hrefs[bigL]!.href)}; })()`, 2000);
  const tMove = Date.now() - t6;
  const deskBefore = await transforms(A);
  const state = await command("state", {});
  const deskRow = state.result.scene.instances.find((i: { id: string }) => i.id === "desk-a");
  await command("instances.move", { instance: "desk-a", x: deskRow.x - 0.3 });
  const movedA = await until(A, `JSON.stringify([...document.querySelectorAll('.rv-frames iframe')].map(f => f.style.transform)) !== ${JSON.stringify(deskBefore)}`, 2000);
  await sleep(300);
  step(!!followed && !!movedA && await loads(A) === loadsA && await loads(B) === loadsB,
    "a second browser follows content.move within 2 s; instances.move moves the frames; no frame reloads", `${tMove} ms; loads A ${loadsA}→${await loads(A)}, B ${loadsB}→${await loads(B)}`);

  // 7. Restart gives a new run; Undo brings the old one back
  const runBefore = (await debug(A))[bigL]!.run;
  await A.evaluate(`document.querySelector('[aria-label="Return to whole scene"]')?.click()`);
  await until(A, `!document.querySelector('.rv-stage').dataset.focusedAsset`, 5000);
  await objectRow(A, "Operator desk");
  const restart = `[...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.startsWith('Screens'))?.querySelector('.rm-live-actions button')`;
  if (!await until(A, `!!${restart}`, 4000)) throw new Error("no Restart in Operator desk › Screens: " + await A.evaluate("document.querySelector('.rm-scroll').innerText.slice(0, 600)"));
  await press(A, `${restart}`);
  const restarted = await until<string>(A, `(() => { const r = window.__synergonLive()['${bigL}']?.run; return r && r !== ${JSON.stringify(runBefore)} ? r : null; })()`, 6000);
  const told = await until<string>(A, `(() => { const t = document.querySelector('.rm-notice:not([hidden])')?.innerText || ''; return /Restarted Demo item/.test(t) ? t : null; })()`, 4000);
  await press(A, `[...document.querySelectorAll('.rm-notice button')].find(b => b.textContent === 'Undo')`);
  const back = await until(A, `window.__synergonLive()['${bigL}']?.run === ${JSON.stringify(runBefore)}`, 6000);
  step(!!restarted && !!told && !!back, "Restart: a new run on every screen and a notice; its Undo: the old run again", `${runBefore} → ${restarted}; ${(told ?? "").replace(/\s+/g, " ")}`);

  // 8. a page from another origin waits for Show; after Show and a reload it loads at once; a silent app page is Not answering
  const wall = "wall-display/S_screen";
  await command("content.show", { instance: "wall-display", url: provider.url.origin + "/page" });
  const waits = await until(A, `window.__synergonLive()['${wall}']?.state === 'awaiting_click' && !window.__synergonLive()['${wall}'].framed`, 4000);
  await objectRow(A, "Wall display");
  await until(A, `document.querySelector('select[aria-label="Selected component"]')`);
  await A.evaluate(`(() => { const pick = document.querySelector('select[aria-label="Selected component"]'); pick.value = 'S_screen'; pick.dispatchEvent(new Event('change')); })()`);
  const plate = await until<string>(A, `(() => { const s = document.querySelector('.rm-component-card .rm-live-status'); return s && s.innerText; })()`, 4000);
  await A.evaluate(`[...document.querySelectorAll('.rm-component-card .rm-live-status button')].find(b => b.textContent === 'Show')?.click()`);
  const shown = await until(A, `window.__synergonLive()['${wall}']?.state === 'showing'`, 6000);
  await A.call("Page.reload");
  await until(A, ready, 30_000);
  const atOnce = await until(A, `window.__synergonLive()['${wall}']?.framed && window.__synergonLive()['${wall}'].state !== 'awaiting_click'`, 6000);
  await command("content.show", { instance: "display-a", item: "silent", app: "fake" });
  const silent = await until(A, `window.__synergonLive()['display-a/S_screen']?.state === 'not_answering'`, 8000);
  step(!!waits && /Content from localhost/.test(plate ?? "") && !!shown && !!atOnce && !!silent,
    "another site waits with Content from … and Show, then loads at once after a reload; a silent app page is Not answering", plate ?? "");
  // a refused view: Synergon's own sentence (never the app's raw error text), Retry reloads that screen, Restart stays
  await command("content.show", { instance: "station-b", screen: "S_ts_screen", item: "broken", app: "fake" });
  await until(A, `window.__synergonLive()['station-b/S_ts_screen']?.state === 'refused'`, 6000);
  await objectRow(A, "Station B");
  await until(A, `document.querySelector('select[aria-label="Selected component"]')`);
  await A.evaluate(`(() => { const pick = document.querySelector('select[aria-label="Selected component"]'); pick.value = 'S_ts_screen'; pick.dispatchEvent(new Event('change')); })()`);
  const refusedLine = await until<string>(A, `(() => { const s = document.querySelector('.rm-component-card .rm-live-status'); return s && /could not start/.test(s.innerText) ? s.innerText : null; })()`, 4000);
  const loads0 = (await debug(A))["station-b/S_ts_screen"]?.loads ?? 0;
  await A.evaluate(`document.querySelector('.rv-frames iframe[data-key="station-b/S_ts_screen"]').dataset.mark = '1'`);
  await press(A, `[...document.querySelectorAll('.rm-component-card .rm-live-status button')].find(b => b.textContent === 'Retry')`);
  const reloaded = await until(A, `(() => { const f = document.querySelector('.rv-frames iframe[data-key="station-b/S_ts_screen"]'); return f && !f.dataset.mark && window.__synergonLive()['station-b/S_ts_screen'].state === 'refused'; })()`, 6000);
  const plainSentence = !!refusedLine && !/AJAX|Error|503|\/map/.test(refusedLine) && /Retry/.test(refusedLine) && /Restart/.test(refusedLine);
  step(plainSentence && !!reloaded, "a refused view says \"This view could not start.\" with Retry (reloads the screen) and Restart; no raw app error", `${(refusedLine ?? "").replace(/\s+/g, " ")}; loads before ${loads0}`);
  await command("content.clear", { instance: "station-b" });

  // 9. content.list: seen showing from both browsers with the app's run id
  const runNow = (await debug(B))[bigL]!.run;
  let seen: { viewer: string; state: string; run?: string }[] = [];
  for (let n = 0; n < 40; n++) {
    seen = (await contentList()).screens.find(s => s.instance === "desk-a" && s.screen === "S_big_screen_L")?.seen ?? [];
    if (seen.filter(s => s.state === "showing" && s.run === runNow).length >= 2) break;
    await sleep(150);
  }
  step(seen.filter(s => s.state === "showing" && s.run === runNow).length >= 2, "content.list shows seen: showing from both browsers with the app's run id", JSON.stringify(seen));

  // 10. the Settings switch removes every frame and reports off
  await press(A, `document.querySelector('[aria-label="Settings"]')`);
  await until(A, `[...document.querySelectorAll('.rw-check')].some(e => e.textContent === 'Live screen content')`);
  await press(A, `[...document.querySelectorAll('.rw-check')].find(e => e.textContent === 'Live screen content').querySelector('input')`);
  const gone = await until(A, `document.querySelectorAll('.rv-frames iframe').length === 0`, 3000);
  let off = false;
  for (let n = 0; n < 30 && !off; n++) {
    const s = (await contentList()).screens.find(s => s.instance === "desk-a" && s.screen === "S_big_screen_L")?.seen ?? [];
    off = s.some(x => x.state === "off") && s.some(x => x.state === "showing");
    if (!off) await sleep(150);
  }
  step(!!gone && off, "Settings › Live screen content off: no frames, and this browser reports off");
  await press(A, `[...document.querySelectorAll('.rw-check')].find(e => e.textContent === 'Live screen content').querySelector('input')`);
  await A.evaluate(`document.querySelector('[aria-label="Close settings"]')?.click()`);

  // 11. Save picture without tab capture: live screens become plates, never transparent holes
  // B (another browser) has not accepted the site: it waits, and is accepted through the card, as a person would
  const waitsB = await until(B, `window.__synergonLive()['${wall}']?.state === 'awaiting_click'`, 4000);
  await view(B, "Front");
  await objectRow(B, "Wall display");
  await until(B, `document.querySelector('select[aria-label="Selected component"]')`);
  await B.evaluate(`(() => { const pick = document.querySelector('select[aria-label="Selected component"]'); pick.value = 'S_screen'; pick.dispatchEvent(new Event('change')); })()`);
  await until(B, `[...document.querySelectorAll('.rm-live-status button')].some(b => b.textContent === 'Show')`, 3000);
  await press(B, `[...document.querySelectorAll('.rm-live-status button')].find(b => b.textContent === 'Show')`);
  await until(B, `(() => { const d = window.__synergonLive()['${wall}']; return d && d.displayed && d.hole; })()`, 6000);
  await sleep(300);
  const wallPoint = (await debug(B))[wall]?.point;
  await B.call("Page.setDownloadBehavior", { behavior: "allow", downloadPath: temp });
  await press(B, `document.querySelector('[aria-label="Save picture"]')`);
  const saved = await until<string>(B, `(() => { const t = document.querySelector('.rm-notice')?.innerText || ''; return /Room picture saved/.test(t) ? t : null; })()`, 15_000);
  let png: string | undefined;
  for (let n = 0; n < 50 && !png; n++) { png = readdirSync(temp).find(f => f.endsWith(".png") && !["desk.png", "oblique.png"].includes(f)); if (!png) await sleep(100); }
  let pixel: number[] | null = null;
  if (png && wallPoint) {
    const b64 = readFileSync(join(temp, png)).toString("base64");
    pixel = await B.evaluate(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const stage = document.querySelector('.rv-stage').getBoundingClientRect(), orbit = document.querySelector('.rv-orbit').getBoundingClientRect(), k = img.width / stage.width;
      const px = Math.round((orbit.left - stage.left + ${wallPoint[0]}) * k), py = Math.round((orbit.top - stage.top + ${wallPoint[1]}) * k + 0.12 * 0);
      const d = x.getImageData(px - 20, py + 25, 1, 1).data; return [...d]; })()`);
  }
  step(!!waitsB && !!saved && /shown as labels/.test(saved) && !!pixel && pixel[3] === 255 && pixel[0]! < 90 && pixel[1]! < 90,
    "Save picture without tab capture: live screens saved as labelled plates (opaque), with the note", `pixel ${JSON.stringify(pixel)}; ${saved}`);

  // 12. a lost graphics context: the 3D view comes back with the environment and plates
  await view(A, "Front");
  const silentKey = "display-a/S_screen";
  await until(A, `(() => { const d = window.__synergonLive()['${silentKey}']; return d && d.state === 'not_answering' && d.point; })()`, 8000);
  await sleep(300);
  const sample = () => A.evaluate(`(() => { const c = document.querySelector('.rv-orbit canvas'), x = document.createElement('canvas'); x.width = c.width; x.height = c.height;
    const g = x.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, x.width, x.height).data; let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0 && (d[i] + d[i + 1] + d[i + 2]) > 30) lit++;
    const p = window.__synergonLive()['${silentKey}']?.point, k = c.width / c.clientWidth, q = p ? g.getImageData(Math.round(p[0] * k), Math.round(p[1] * k), 1, 1).data : null;
    return { lit, plate: q ? [...q] : null }; })()`) as Promise<{ lit: number; plate: number[] | null }>;
  const before12 = await sample();
  await A.screenshot(join(temp, "context-before.png"));
  await A.evaluate("window.__synergonLoseContext()");
  await sleep(300);
  const after12 = await sample();
  await A.screenshot(join(temp, "context-after.png"));
  const dark = (q: number[] | null) => !!q && q[3] === 255 && q[0]! < 70 && q[1]! < 70 && q[2]! < 80;
  step(after12.lit > before12.lit * 0.9 && dark(before12.plate) && dark(after12.plate), "lost graphics context: the view is drawn again with its environment and plates",
    `lit samples ${before12.lit} → ${after12.lit}; plate ${JSON.stringify(before12.plate)} → ${JSON.stringify(after12.plate)}`);

  // 13. nothing logged
  const errs = [...new Set([...A.errors, ...B.errors])];
  step(errs.length === 0, "no errors or warnings in either browser", errs.join(" | "));
  console.log(`screens: ${join(temp, "desk.png")}, ${obliqueShot}`);
} catch (e) {
  step(false, "run", e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  for (const b of browsers) await b.close();
  service.close(); provider.close();
  if (!process.env.KEEP) rmSync(temp, { recursive: true, force: true });
}
console.log(`live screen content: ${failures ? failures + " failure(s)" : "all steps passed"} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
