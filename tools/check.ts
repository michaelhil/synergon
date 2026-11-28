// bun run check [--fast] [--build <name>] [--asset <id>]
// --asset <id> checks a further asset (assets/<id>/): the asset's own checks only (types, kit, parameters, build, determinism,
// independent reader, names, coverage, left/right, geometry, validator, motion, poses, budget, banned words, literals, and the
// two browser checks). The platform's checks (server, commands, person, deploy, live viewer) belong to the default run.
// Runs every check of the build brief (section 10) and exits non-zero if one fails.
// --fast skips the checks that need the headless browser (projection self-test, frame rate, the live viewer).
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { ROOT, timeline } from "./timeline.ts";
import { build } from "../generator/build.ts";
import { loadSpec, NAME_PATTERN } from "../generator/assemble.ts";
import { poseFromRest, type JointValue, type Trs } from "../shared/pose.ts";
import { matFromQuat } from "../shared/math.ts";
import type { Manifest } from "../shared/manifest.ts";

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const fast = args.includes("--fast"), buildFolder = opt("--build") ?? process.env.SYNERGON_BUILD_DIR, asset = opt("--asset") ?? "rig-b", own = asset !== "rig-b";
// --nested: this run is one asset's part of the default gate (the caller has done the type check, kit tests and word scan)
const nested = args.includes("--nested");
const BUDGET = { triangles: 150000, bytes: 4_000_000, primitives: 80, fps: 55 };   // the toolkit's defaults; a spec's [budget] replaces them for its asset
const t0 = performance.now();
let failures = 0, warnings = 0;
const report = (ok: boolean | "warn", name: string, summary: string, details: string[] = []) => {
  if (ok === false) failures++; if (ok === "warn") warnings++;
  console.log(`${ok === true ? "ok  " : ok === "warn" ? "warn" : "FAIL"} ${name}: ${summary}`);
  for (const d of details.slice(0, 15)) console.log("       " + d);
  if (details.length > 15) console.log(`       … and ${details.length - 15} more`);
};
const glob = (pattern: string) => new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");

// ---- 1. type check ---------------------------------------------------------------------------------
if (!nested) {
  const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", ROOT], { encoding: "utf8" });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "types", r.status === 0 ? "tsc --noEmit clean (generator, shared, server, viewer, tools, asset sources)" : `${lines.filter((l) => l.includes("error TS")).length} type error(s)`, r.status === 0 ? [] : lines);
}

if (!nested) {
  const r = spawnSync("bun", ["test", join(ROOT, "generator")], { encoding: "utf8", cwd: ROOT });
  const out = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "kit tests", r.status === 0 ? (out.find((l) => /^\s*\d+ pass\b/.test(l)) ?? "").trim() + " (known-answer tests of the geometry kit, expressions and pose function)" : "bun test generator failed", r.status === 0 ? [] : out.filter((l) => /fail|error|expect/i.test(l)));
}

// the server must never show error pages with code to visitors (R3b F4; security review S10)
if (!own) {
  // the public entry (server/room-public.ts, bundled by dist as server/server.js), not the station render harness
  const src = readFileSync(join(ROOT, "server", "room-public.ts"), "utf8"), at = src.indexOf("Bun.serve({"), serve = at < 0 ? "" : src.slice(at, at + 600);
  const ok = serve.includes("development: false") && !/development:\s*true/.test(src);
  report(ok, "server options", ok ? "server/room-public.ts passes development: false to Bun.serve" : "server/room-public.ts must pass development: false to Bun.serve (no error pages with code)");
}
// the setup script's harness (deploy/setup-server.sh against a stand-in host; about 9 s, no root, no network)
if (!own) {
  const r = spawnSync("bash", [join(ROOT, "tools", "deploy-tests", "setup-server.test.sh")], { encoding: "utf8", cwd: ROOT });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "setup script", (lines.find((l) => /^setup-server.sh test: \d+ passed/.test(l)) ?? "no summary").replace(/ \(logs in .*\)$/, "") + " (check, apply, undo, probe, restore after a hang-up or a closed output)", r.status === 0 ? [] : lines.filter((l) => l.includes("FAIL") || l.includes("log> ")));
}

// ---- 2. parameters, spec, build (a failure here stops the run) -------------------------------------
let manifest: Manifest, glbPath: string, sha: string;
const spec = loadSpec(join(ROOT, "assets", asset, "spec"));
Object.assign(BUDGET, spec.budget ?? {});
try {
  const res = await build({ asset, buildFolder, quiet: true });
  if (!res.ok) { report(false, "build", "component errors", res.messages); process.exit(1); }
  manifest = res.manifest; glbPath = res.glbPath; sha = res.sha256;
  const cc = manifest.parameter_class_counts;
  report(true, "parameters", `${Object.keys(manifest.parameters).length} complete records (${Object.entries(cc).map(([k, n]) => `${k} ${n}`).join(", ")})`);
  const warn = res.messages.filter((m) => m.startsWith("warning: ") && !m.includes(" missing: "));
  if (warn.length) report("warn", "parameters", `${warn.length} warning(s)`, warn.map((w) => w.slice(9)));
  if (manifest.parameters_unused.length) report("warn", "parameters", `${manifest.parameters_unused.length} record(s) read by nothing`, [manifest.parameters_unused.join(", ")]);
  report(true, "build", `${res.seconds.toFixed(2)} s`);
} catch (e: any) { report(false, "parameters / build", String(e.message).split("\n")[0], String(e.message).split("\n").slice(1)); process.exit(1); }

// ---- 2b. command layer and server (step 1 of the platform): unit tests, then the integration test over real HTTP.
// After the build on purpose: these tests read the built asset (assets/<asset>/build/), which a fresh checkout does not
// have (the first automatic deploy with them failed for that reason, 2026-11-24).
if (!own) for (const [name, dir, what] of [
  ["commands", "shared/commands", "validation, units, limits, per-joint stale check, undo, history cap, rebuilt asset, scene.find, measure.distance; intent commands: plain-word targets, amounts, adjust, undo, state, measure, look, MCP instructions"],
  ["server", "server", "two live clients over HTTP, stale refusal, undo by group, resume, restart, view routing, deployed guards, author ids, Host check; MCP endpoint, look and pictures"],
  ["live client", "viewer/src", "reconnect rules: backoff, one resync, wakes, no reconnect after disconnect (Leitbild's cases)"],
] as const) {
  const r = spawnSync("bun", ["test", join(ROOT, dir)], { encoding: "utf8", cwd: ROOT });
  const out = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, name, r.status === 0 ? `${(out.find((l) => /^\s*\d+ pass\b/.test(l)) ?? "").trim()} (${what})` : `bun test ${dir} failed`, r.status === 0 ? [] : out.filter((l) => /\(fail\)|error|expect/i.test(l)));
}

// ---- 3. determinism: a second build in a separate process must give the same bytes -------------------
{
  const dir = mkdtempSync(join(tmpdir(), "synergon-check-"));
  const r = spawnSync("bun", [join(ROOT, "generator", "build.ts"), "--asset", asset, "--out", dir, "--quiet", "--no-timeline"], { encoding: "utf8" });
  const sha2 = r.status === 0 ? createHash("sha256").update(readFileSync(join(dir, `${asset}.glb`))).digest("hex") : "";
  const m2 = r.status === 0 ? readFileSync(join(dir, `${asset}.manifest.json`), "utf8") : "", m1 = readFileSync(join(glbPath, "..", `${asset}.manifest.json`), "utf8");
  rmSync(dir, { recursive: true, force: true });
  report(sha2 === sha && m1 === m2, "determinism", sha2 === sha && m1 === m2 ? `two builds, same SHA-256 ${sha.slice(0, 16)}… and identical manifest` : r.status !== 0 ? "second build failed" : sha2 !== sha ? `GLB differs: ${sha.slice(0, 16)}… vs ${sha2.slice(0, 16)}…` : "manifest differs between builds", r.status !== 0 ? [r.stderr] : []);
}

// ---- 4. independent reader -------------------------------------------------------------------------
const testPoses: Record<string, JointValue[]> = {};
for (const j of manifest.joints) {
  const mid = (a: number, b: number, t: number) => a + (b - a) * t;
  testPoses[j.id] = j.type === "ball"
    ? [j.neutral, (j.neutral as number[]).map((n, i) => n + [j.upper, j.lower, j.upper * 0.5][i]), (j.neutral as number[]).map((n, i) => n + [j.lower * 0.3, j.upper * 0.7, j.lower][i])]
    : [j.lower, j.upper, j.neutral, mid(j.lower, j.upper, 0.37), mid(j.lower, j.upper, 0.81)];
}
const posesFile = join(tmpdir(), `synergon-poses-${process.pid}.json`);
writeFileSync(posesFile, JSON.stringify(testPoses));
const py = spawnSync("python3", ["-I", join(ROOT, "tools", "glb_inspect.py"), glbPath, "--poses", posesFile], { encoding: "utf8", maxBuffer: 1 << 28 });
rmSync(posesFile, { force: true });
if (py.status !== 0) { report(false, "independent reader", "tools/glb_inspect.py could not read the GLB", [py.stderr.trim()]); process.exit(1); }
const glb = JSON.parse(py.stdout) as { bytes: number; root: string; root_rotation: number[]; totals: Record<string, number>; counts: Record<string, number>; nodes: { name: string; parent: string | null; extras: any; origin: number[]; mesh?: any }[]; joints: { name: string; joint: any; moved: string[]; rest: number[][]; posed?: { value: JointValue; matrix: number[][] }[] }[] };
const node = new Map(glb.nodes.map((n) => [n.name, n]));
report(true, "independent reader", `${glb.counts.nodes} nodes, ${glb.counts.meshes} meshes, ${glb.totals.triangles} triangles re-read by tools/glb_inspect.py (Python, no shared code)`);

// ---- 5. names --------------------------------------------------------------------------------------
{
  const bad = glb.nodes.filter((n) => !NAME_PATTERN.test(n.name ?? "")).map((n) => `${n.name}: does not match ${NAME_PATTERN.source}`);
  const seen = new Set<string>(), dup = glb.nodes.filter((n) => (seen.has(n.name) ? true : (seen.add(n.name), false))).map((n) => `${n.name}: used twice`);
  const noId = glb.nodes.filter((n) => n.extras?.id !== n.name).map((n) => `${n.name}: extras.id is '${n.extras?.id}'`);
  report(!bad.length && !dup.length && !noId.length, "names", bad.length + dup.length + noId.length ? "invalid node names" : `${glb.nodes.length} node names valid, unique, equal to extras.id`, [...bad, ...dup, ...noId]);
}

// ---- 6. coverage -----------------------------------------------------------------------------------
{
  const omitted = new Map(manifest.omitted.map((o) => [o.id, o.reason])), problems: string[] = [];
  let withMesh = 0, total = 0;
  for (const [id, n] of Object.entries(spec.nodes)) {
    total++;
    const g = node.get(id);
    if (!g) { problems.push(`${id} missing: in tree, not in GLB`); continue; }
    const expectedParent = n.joints?.length ? n.joints[n.joints.length - 1] : n.parent ?? null;
    if (g.parent !== expectedParent) problems.push(`${id}: parent in GLB is ${g.parent}, spec says ${expectedParent}`);
    if (id.startsWith("D_") || n.assembly) continue;
    if (g.mesh?.triangles > 0) { withMesh++; if (omitted.has(id)) problems.push(`${id}: has a mesh but is also listed as omitted`); }
    else if (omitted.has(id)) { if (!omitted.get(id)!.trim()) problems.push(`${id}: omitted without a reason`); }
    else problems.push(`${id} missing: in tree, not in GLB, not in omitted`);
  }
  for (const j of Object.keys(spec.joints)) if (!node.get(j)?.extras?.joint) problems.push(`${j} missing: joint in spec, no joint node in GLB`);
  for (const n of glb.nodes) if (!spec.nodes[n.name] && !spec.joints[n.name]) problems.push(`${n.name}: in GLB, not in the spec`);
  report(!problems.length, "coverage", problems.length ? `${problems.length} problem(s)` : `${total} tree nodes and ${Object.keys(spec.joints).length} joints present; ${withMesh} components with geometry; ${omitted.size} omitted with a reason`, problems);
}

// ---- 7. left / right -------------------------------------------------------------------------------
{
  const single = new Set(spec.symmetry?.single ?? []), free = new Set(spec.symmetry?.free ?? []), problems: string[] = [];
  const ids = [...Object.keys(spec.nodes), ...Object.keys(spec.joints)];
  let pairs = 0;
  for (const id of ids) {
    const m = /_(L|R)(?=_|$)/.exec(id);
    if (!m) continue;
    const other = id.slice(0, m.index) + (m[1] === "L" ? "_R" : "_L") + id.slice(m.index + 2);
    if (!ids.includes(other)) { if (!single.has(id)) problems.push(`${id}: no counterpart ${other} in the spec (list it under [symmetry] single if intended)`); continue; }
    if (m[1] !== "L") continue;
    pairs++;
    const a = node.get(id), b = node.get(other);
    if (!a || !b) { problems.push(`${!a ? id : other} missing from the GLB while its counterpart exists`); continue; }
    if (!!a.mesh?.triangles !== !!b.mesh?.triangles) problems.push(`${id} / ${other}: only one of the pair has geometry`);
    if (!free.has(id) && Math.hypot(a.origin[0] - b.origin[0], a.origin[1] + b.origin[1], a.origin[2] - b.origin[2]) > 1e-5) problems.push(`${id} at (${a.origin}) and ${other} at (${b.origin}) are not mirror images`);
    if (!free.has(id) && a.mesh && b.mesh) {
      const d = Math.max(...[0, 1, 2].map((k) => (k === 1 ? Math.max(Math.abs(a.mesh.model_min[1] + b.mesh.model_max[1]), Math.abs(a.mesh.model_max[1] + b.mesh.model_min[1])) : 0)));
      if (d > 0.002 && Math.abs(a.mesh.model_max[1] - a.mesh.model_min[1] - (b.mesh.model_max[1] - b.mesh.model_min[1])) > 0.002) problems.push(`${id} / ${other}: widths differ (${(a.mesh.model_max[1] - a.mesh.model_min[1]).toFixed(4)} vs ${(b.mesh.model_max[1] - b.mesh.model_min[1]).toFixed(4)} m)`);
      else if (d > 0.002) problems.push(`${id} / ${other}: geometry is not mirrored across Y = 0 (bounds differ by ${d.toFixed(4)} m; mirror the left mesh with kit.mirrorY)`);
    }
  }
  report(!problems.length, "left/right", problems.length ? `${problems.length} problem(s)` : `${pairs} pairs present and mirrored; ${single.size} declared single-sided`, problems);
}

// ---- 8. geometry -----------------------------------------------------------------------------------
{
  const problems: string[] = [];
  for (const n of glb.nodes) if (n.mesh) {
    const m = n.mesh;
    if (m.non_finite) problems.push(`${n.name}: ${m.non_finite} non-finite value(s)`);
    if (m.degenerate) problems.push(`${n.name}: ${m.degenerate} zero-area triangle(s)`);
    if (m.bad_normals) problems.push(`${n.name}: ${m.bad_normals} normal(s) not unit length`);
    if (m.index_out_of_range) problems.push(`${n.name}: ${m.index_out_of_range} triangle(s) index past the vertex count`);
    if (!m.triangles) problems.push(`${n.name}: mesh with no triangles`);
    if (n.extras?.kind === "surface" && m.has_uv.some((u: boolean) => !u)) problems.push(`${n.name}: surface without UVs`);
  }
  const c = (a: number, b: number) => (a === b ? null : `${a} vs ${b}`);
  for (const [what, d] of [["triangles", c(glb.totals.triangles, manifest.totals.triangles)], ["bytes", c(glb.bytes, manifest.glb.bytes)], ["primitives", c(glb.totals.primitives, manifest.totals.primitives)]] as const) if (d) problems.push(`manifest and GLB disagree on ${what}: ${d}`);
  const q = glb.root_rotation ?? [0, 0, 0, 1];
  if (Math.abs(q[0] + Math.SQRT1_2) > 1e-5 || Math.abs(q[3] - Math.SQRT1_2) > 1e-5) problems.push(`root rotation is ${q}; expected the Z-up to Y-up conversion (-0.7071, 0, 0, 0.7071)`);
  report(!problems.length, "geometry", problems.length ? `${problems.length} problem(s)` : `all ${glb.counts.meshes} meshes finite, no zero-area triangles, unit normals; manifest matches the GLB`, problems);
}

// ---- 9. glTF validator -----------------------------------------------------------------------------
{
  const validator = createRequire(import.meta.url)("gltf-validator");
  const rep = await validator.validateBytes(new Uint8Array(readFileSync(glbPath)), { maxIssues: 200 });
  const msgs = rep.issues.messages.filter((m: any) => m.severity <= 1).map((m: any) => `${m.code} ${m.pointer ?? ""}: ${m.message}`);
  report(rep.issues.numErrors === 0 && rep.issues.numWarnings === 0, "glTF validator", `${rep.issues.numErrors} errors, ${rep.issues.numWarnings} warnings, ${rep.issues.numInfos} infos, ${rep.issues.numHints} hints`, msgs);
}

// ---- 10. expected motion ---------------------------------------------------------------------------
{
  const problems: string[] = [], movable = glb.nodes.filter((n) => /^[CDS]_/.test(n.name)).map((n) => n.name);
  for (const j of glb.joints) {
    const pats = (spec.motion[j.name] ?? []).map(glob), want = new Set(movable.filter((n) => pats.some((p) => p.test(n)))), got = new Set(j.moved.filter((n) => /^[CDS]_/.test(n)));
    const extra = [...got].filter((n) => !want.has(n)), lacking = [...want].filter((n) => !got.has(n));
    if (extra.length) problems.push(`${j.name}: moves ${extra.join(", ")} which the motion table does not list`);
    if (lacking.length) problems.push(`${j.name}: should move ${lacking.join(", ")} but does not`);
    for (const p of spec.motion[j.name] ?? []) if (!movable.some((n) => glob(p).test(n))) problems.push(`${j.name}: motion entry '${p}' matches no node`);
  }
  report(!problems.length, "expected motion", problems.length ? `${problems.length} problem(s)` : `${glb.joints.length} joints posed by the independent reader; each moves exactly the nodes in the motion table`, problems);
}

// ---- 11. pose conformance: shared TypeScript definition vs the independent Python one ----------------
{
  const problems: string[] = []; let n = 0, worst = 0;
  for (const j of glb.joints) {
    const mj = manifest.joints.find((x) => x.id === j.name)!;
    const rest: Trs = { t: mj.rest.t as Trs["t"], q: mj.rest.q as Trs["q"] };
    for (const p of j.posed ?? []) {
      const { t, q } = poseFromRest(rest, mj, p.value), R = matFromQuat(q);
      const mine = [[R[0], R[1], R[2], t[0]], [R[4], R[5], R[6], t[1]], [R[8], R[9], R[10], t[2]]];
      let d = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(mine[r][c] - p.matrix[r][c]));
      worst = Math.max(worst, d); n++;
      if (d > 2e-6) problems.push(`${j.name} at ${JSON.stringify(p.value)}: transforms differ by ${d.toExponential(2)}`);
    }
  }
  report(!problems.length && (n > 0 || !glb.joints.length), "pose conformance", problems.length ? `${problems.length} of ${n} test poses disagree` : `${n} test poses: shared/pose.ts (generator + viewer) and tools/glb_inspect.py agree (max difference ${worst.toExponential(1)})`, problems);
}

// ---- 11b. clearance at the joint limits (only for an asset whose spec asks for it with a [clearance] table) ---------------
if (spec.clearance) {
  const { clearance, CANNOT_SEE } = await import("./clearance.ts");
  const r = clearance(join(glbPath, ".."), asset, { min: spec.clearance.min, watch: spec.clearance.watch }), mm = (x: number) => `${Math.round(x * 1000)} mm`;
  const how = (depth: number, gap: number) => (depth > 1e-3 ? `overlap by ${mm(depth)}` : `are ${mm(gap)} apart`), was = (depth: number, gap: number) => (depth > 1e-3 ? `overlap ${mm(depth)}` : `${mm(gap)} or more`);
  const one = r.findings.map((f) => ({ locked: f.locked, text: `${f.joint} at its ${f.end} limit: ${f.a} and ${f.b} ${how(f.depth, f.gap)} (at rest: ${was(f.rest_depth, f.rest_gap)})` }));
  const many = r.corners.map((f) => ({ locked: f.locked, text: `${Object.keys(f.pose).join(" + ")} at limits: ${f.a} and ${f.b} ${how(f.depth, f.gap)} (at rest: ${was(f.rest_depth, f.rest_gap)})` }));
  const hard = [...one, ...many].filter((f) => !f.locked), soft = [...one, ...many].filter((f) => f.locked);
  report(!hard.length, "clearance", hard.length ? `${hard.length} pair(s) brought together by unlocked joints at their limits` : `unlocked joints at both limits, alone and in all ${r.cornerPoses} corner poses: no part nearer than ${mm(r.min)} to another unless it was so at rest. Sampled (tools/clearance.ts); cannot see: ${CANNOT_SEE}. Limits set from the solver cannot fail here`, hard.map((f) => f.text));
  if (soft.length) report("warn", "clearance", `${soft.length} pair(s) at limits that involve a locked joint (reported, not failed)`, soft.map((f) => f.text));
  for (const w of r.watch) if (w.gap < r.min) report("warn", "clearance", `watched gap ${w.sets[0]} against ${w.sets[1]}: ${w.gap < 0 ? `OVERLAP ${mm(-w.gap)}` : mm(w.gap)} at ${w.pose}`);
}

// ---- 12. performance budget ------------------------------------------------------------------------
{
  const t = manifest.totals, problems: string[] = [];
  if (t.triangles > BUDGET.triangles) problems.push(`${t.triangles} triangles > ${BUDGET.triangles}`);
  if (manifest.glb.bytes > BUDGET.bytes) problems.push(`${manifest.glb.bytes} bytes > ${BUDGET.bytes}`);
  if (t.primitives > BUDGET.primitives) problems.push(`${t.primitives} draw primitives > ${BUDGET.primitives} (merge parts per component and material)`);
  const top = [...manifest.components, ...manifest.surfaces].sort((a, b) => b.triangles - a.triangles).slice(0, 3).map((c) => `${c.id} ${c.triangles}`).join(", ");
  report(!problems.length, "budget", `${t.triangles} / ${BUDGET.triangles} triangles, ${t.primitives} / ${BUDGET.primitives} draw primitives, ${(manifest.glb.bytes / 1e6).toFixed(2)} / ${BUDGET.bytes / 1e6} MB; heaviest: ${top}`, problems);
}

// ---- 13. banned words ------------------------------------------------------------------------------
if (!nested) {
  // The words are stored encoded so that this file does not contain them. More can be added, one per
  // line, in private/banned-words.txt.
  const { NEVER: anywhere, VENDORS: vendors, ALLOWED, extraWords } = await import("./banned.ts");   // rig maker, customer: never; device makers: only in parameter evidence
  const extra = extraWords(ROOT);
  const skip = new Set(["private", "work", "node_modules", ".git", ".venv", ".claude"]);
  const hits: string[] = []; let files = 0;
  const allowed = ALLOWED;
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (skip.has(f)) continue;
      const p = join(dir, f), rel = relative(ROOT, p), st = statSync(p);
      // Binary files (images, the model, fonts) are scanned for the never-allowed words only: short
      // device-maker words such as a three-letter one turn up by chance in compressed bytes (a false
      // positive found on two wiki images on 2026-11-23). Text files get the full scan.
      const binary = /\.(jpe?g|png|webp|gif|glb|bin|ktx2|woff2?|ico|pdf)$/i.test(f);
      const scan = (text: string, where: string, isBinary = false) => {
        const low = text.toLowerCase().split(allowed).join("");
        for (const w of [...anywhere, ...extra]) if (low.includes(w)) hits.push(`${where}: contains banned word #${[...anywhere, ...extra].indexOf(w) + 1}`);
        if (isBinary) return;
        const evidenceOk = /^assets\/[^/]+\/params\/.*\.toml$/.test(rel) || rel.endsWith(".manifest.json");
        if (!evidenceOk) for (const w of vendors) if (new RegExp(`\\b${w}\\b`).test(low)) hits.push(`${where}: device maker name #${vendors.indexOf(w) + 1} outside a parameter evidence field`);
      };
      scan(f, `${rel} (file name)`);
      if (st.isDirectory()) walk(p);
      else if (st.size < 30_000_000) { files++; scan(readFileSync(p).toString("latin1"), rel, binary); }
    }
  };
  walk(ROOT);
  report(!hits.length, "banned words", hits.length ? `${hits.length} hit(s)` : `${files} files outside private/ and work/ scanned, none found`, hits);
}

// ---- 13b. the person's run-time numbers: every record of assets/manikin/params/runtime*.toml complete -----------------------
if (!own) {
  const { validateRuntime, countRuntime } = await import("../shared/runtime-params.ts");
  const dir = join(ROOT, "assets", "manikin", "params"), files = existsSync(dir) ? readdirSync(dir).filter((f) => /^runtime.*\.toml$/.test(f)).sort() : [];
  const problems: string[] = [], counts: string[] = [];
  for (const f of files) {
    let doc: any; try { doc = Bun.TOML.parse(readFileSync(join(dir, f), "utf8")); } catch (e: any) { problems.push(`${f}: TOML syntax error: ${e.message}`); continue; }
    problems.push(...validateRuntime(doc, f)); counts.push(`${f} ${countRuntime(doc)}`);
  }
  report(files.length ? !problems.length : "warn", "run-time parameters", files.length ? (problems.length ? `${problems.length} incomplete record(s)` : `${counts.join(", ")} records, each with value, unit, range, class, tier and evidence`) : "no assets/manikin/params/runtime*.toml", problems);
}

// ---- 13c. the manikin packages (tools/manikin-check.ts): committed binaries, so checksums instead of a second build;
// packaging records, files against PROVENANCE.json, budgets, glTF validator, licences and credits, banned names in
// every file (binaries included), no symbolic links
if (!own) for (const r of await (await import("./manikin-check.ts")).manikinChecks(ROOT)) report(r.ok, r.name, r.summary, r.details);

// ---- 14. numbers in source (advisory) ----------------------------------------------------------------
{
  const notes: string[] = [];
  const srcDir = join(ROOT, "assets", asset, "src");
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".ts"))) {
    readFileSync(join(srcDir, f), "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
      for (const m of code.matchAll(/(?<![\w.$])(\d+\.\d+|\d{3,})(?![\w.])/g)) if (m[1] !== "0.5") notes.push(`${f}:${i + 1}: literal ${m[1]}`);
    });
  }
  report(notes.length ? "warn" : true, "numbers in source", notes.length ? `${notes.length} numeric literal(s) in component code; dimensions belong in params/*.toml` : "no dimension-like literals in assets/*/src", notes);
}

// ---- 15. browser checks: projection self-test and frame rate ------------------------------------------
if (!fast) {
  try {
    const { openViewer } = await import("./render.ts");
    const v = await openViewer({ buildFolder, asset });
    const st = await v.page.evaluate("viewer.selfTest()");
    report(st.pass, "projection self-test", `${st.checked} known points over ${st.cameras.length} camera(s): worst ${Number(st.worst_px).toFixed(3)} px (tolerance ${st.tolerance_px} px)`, st.pass ? [] : st.results.filter((r: any) => r.error || r.error_px > 1).map((r: any) => JSON.stringify(r)));
    await v.page.viewport(1600, 1000);
    await v.page.evaluate("viewer.apply({ ui: '0', view: 'three_quarter' })");
    // On a CI runner WebGL runs in software (no GPU): 90 frames took two minutes at 1 fps and say nothing
    // about real viewing performance, so only the draw calls are counted there (one frame).
    const ci = Boolean(process.env.CI);
    const b = await v.page.evaluate(`viewer.benchmark(${ci ? 1 : 90})`);
    if (ci) report(true, "frame rate", `not measured on the CI runner (software rendering, no GPU); ${b.triangles} triangles, ${b.calls} draw calls in the default view`);
    else report(b.fps >= BUDGET.fps ? true : "warn", "frame rate", `${b.fps.toFixed(0)} fps at 1600 × 1000 in headless Chromium (${b.triangles} triangles, ${b.calls} draw calls in the default view)`);
    if (b.calls > BUDGET.primitives + 2) report(false, "draw calls", `${b.calls} draw calls in the default view > ${BUDGET.primitives}`);
    const errs = [...new Set(v.page.errors)];
    if (errs.length) report(false, "viewer console", `${errs.length} error(s) or warning(s)`, errs);
    await v.close();
  } catch (e: any) { report(false, "browser checks", String(e.message)); }
  // the person in the default view (the rig's budgets above are the rig's alone): it loads, and the frame rate while it idles
  if (!own && existsSync(join(ROOT, "assets", "manikin", "operator-m", "operator-m.avatar.json"))) try {
    const { openViewer } = await import("./render.ts");
    const v = await openViewer({ buildFolder, person: true });
    await v.page.viewport(1600, 1000);
    await v.page.evaluate("viewer.apply({ ui: '0', view: 'three_quarter' })");
    const st = await v.page.evaluate("viewer.person.state()"), ci = Boolean(process.env.CI);
    const idle = await v.page.evaluate(`viewer.person.still(false), viewer.person.bench(${ci ? 2 : 60}, { idle: true })`);
    const ok = st.loaded && st.shown && st.seated;
    report(ok ? (ci || 1000 / idle.median_ms >= BUDGET.fps ? true : "warn") : false, "person", ok ? `${st.package} shown and seated (${st.style}, ${st.tone} tone, person ${st.person ?? "not a baked person"}); ${ci ? "frame time not measured on the CI runner" : `${idle.median_ms} ms a frame while it idles at 1600 × 1000 (pose ${idle.person_update_ms} ms, shadow map redrawn each frame), ${idle.calls} draw calls`}` : `not shown: ${st.error ?? "unknown"}`);
    const errs = [...new Set(v.page.errors)];
    if (errs.length) report(false, "person console", `${errs.length} error(s) or warning(s)`, errs);
    await v.close();
  } catch (e: any) { report(false, "person", String(e.message)); }
  if (!own) {
  // the deploy's live-site checks and its rollback, against local stand-ins of the site (need dist/; about 90 s)
  if (existsSync(join(ROOT, "dist", "version.json"))) for (const [name, cmd, summary] of [
    ["deploy checks", ["bun", join(ROOT, "tools", "deploy-tests", "deploy-checks.ts")], /deploy checks test: .*/],
    ["deploy rollback", ["bash", join(ROOT, "tools", "deploy-tests", "rollback.test.sh")], /rollback test: .*/],
  ] as [string, string[], RegExp][]) {
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", cwd: ROOT, timeout: 300_000 });
    const out = r.stdout + r.stderr;
    report(r.status === 0, name, (summary.exec(out)?.[0] ?? "no summary") + " (tools/deploy-tests/, local stand-ins, no SSH)", r.status === 0 ? [] : out.split("\n").filter((l) => l.includes("FAIL")));
  }
  else report("warn", "deploy checks", "skipped: no dist/ (run bun run dist first)");
  for (const [name, script] of [
    ["room component controls", "room-component-controls-check.ts"],
    ["room workspace tools", "room-workspace-tools-check.ts"],
    ["live screen content", "room-live-content-check.ts"],
  ]) {
    const run = spawnSync("bun", [join(ROOT,"tools",script)], {encoding:"utf8",cwd:ROOT,timeout:process.env.CI ? 240_000 : 120_000});
    const log=(run.stdout + run.stderr).trim().split("\n");
    report(run.status===0,name,run.status===0 ? log.at(-1) ?? name : "Browser acceptance failed",run.status===0 ? [] : log.slice(-18));
  }
  // the shared scene in two real browsers (tools/live-accept.ts, about 10 s)
  // 180 s here; 360 s on a CI runner, where software rendering made the 14 steps take 165 s (GitHub, 2026-11-25)
  const r = spawnSync("bun", [join(ROOT, "tools", "live-accept.ts")], { encoding: "utf8", cwd: ROOT, timeout: process.env.CI ? 360_000 : 180_000 });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.trim());
  report(r.status === 0, "live viewer", `${lines.filter((l) => l.startsWith("ok ")).length} of ${lines.filter((l) => /^(ok |FAIL)/.test(l)).length} steps (two browsers and the command line on one local server: changes both ways, activity line and its Undo, stale refusal, link preview, view routing, no server)`, r.status === 0 ? [] : lines.filter((l) => l.startsWith("FAIL") || /error/i.test(l)));
  }
}

// ---- 16. every further asset (assets/<id>/spec/rig.toml): its own checks, as part of the default gate ---------------------
if (!own && !buildFolder) for (const id of readdirSync(join(ROOT, "assets")).sort()) {
  if (id === asset || !existsSync(join(ROOT, "assets", id, "spec", "rig.toml"))) continue;
  const r = spawnSync("bun", [join(ROOT, "tools", "check.ts"), "--asset", id, "--nested", ...(fast ? ["--fast"] : [])], { encoding: "utf8", cwd: ROOT, timeout: 300_000 });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.trim()), last = lines.at(-1) ?? "no output";
  report(r.status === 0, `asset ${id}`, last.replace(/^(all checks passed|CHECK FAILED): /, "") + ` (bun run check --asset ${id})`, r.status === 0 ? lines.filter((l) => l.startsWith("warn")) : lines.filter((l) => l.startsWith("FAIL") || l.startsWith("       ")));
}

const seconds = (performance.now() - t0) / 1000;
console.log(`${failures ? "CHECK FAILED" : "all checks passed"}: ${failures} failure(s), ${warnings} warning(s), ${seconds.toFixed(1)} s`);
timeline(failures ? "check failed" : "check", seconds, `${failures} failures, ${warnings} warnings${fast ? ", fast" : ""}${buildFolder ? `, build folder ${buildFolder}` : ""}${own ? `, asset ${asset}` : ""}`);
process.exit(failures ? 1 : 0);
