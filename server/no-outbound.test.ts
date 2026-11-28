// Synergon's server never calls out (decision 3 of live screen content): no app, no site, no other host is ever asked
// for anything by server code, so a slow or hostile app cannot slow, break or steer it. App lists reach the server as
// committed configuration (server/live-apps.json, refreshed by the local tool tools/live-apps.ts). This test scans
// every server source file (not the tests) for the ways a Bun program opens a connection.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SERVER = import.meta.dir;
/** Files exempt from the scan, with the reason. No server code is. */
const ALLOWED: Record<string, string> = {
  "test-support.ts": "a helper of the tests (their live-stream reader), never part of a server",
};
/** An import (static, dynamic or require) of a Node networking module. */
const module = (names: string) => new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)["'](?:node:)?(?:${names})["']`);
const PATTERNS: [string, RegExp][] = [
  ["a fetch( call", /(?<![.\w$])fetch\s*\(/],
  ["connect(", /(?<![\w$])connect\s*\(/],
  ["node:net", module("net")],
  ["node:http", module("http")],
  ["node:https", module("https")],
  ["node:tls / node:dgram / node:http2", module("tls|dgram|http2")],
  ["WebSocket(", /WebSocket\s*\(/],
];
/** A method or interface member named fetch (a request handler), not a call. */
const DEFINITION = /(?:function\s+|async\s+)fetch\s*\(|^\s*fetch\s*\(\s*\w+\s*:/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : sources(p);
    return /\.(ts|js|mjs)$/.test(f) && !/\.test\.(ts|js)$/.test(f) ? [p] : [];
  });
}

test("no server source opens an outbound connection", () => {
  const hits: string[] = [];
  const files = sources(SERVER);
  expect(files.length).toBeGreaterThan(10);
  for (const file of files) {
    const name = relative(SERVER, file);
    if (ALLOWED[name]) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, n) => {
      for (const [what, re] of PATTERNS) {
        if (!re.test(line)) continue;
        if (what === "a fetch( call" && DEFINITION.test(line) && !re.test(line.replace(DEFINITION, ""))) continue;
        hits.push(name + ":" + (n + 1) + " " + what + ": " + line.trim().slice(0, 120));
      }
    });
  }
  expect(hits).toEqual([]);
});

test("the scan finds what it is for", () => {
  const flagged = (line: string) => PATTERNS.some(([what, re]) => re.test(line) && !(what === "a fetch( call" && DEFINITION.test(line) && !re.test(line.replace(DEFINITION, ""))));
  for (const bad of ['await fetch("https://leitbild.app/api")', "const r = fetch(url, { method: \"POST\" });", 'import net from "node:net";',
    'import { request } from "node:https";', "Bun.connect({ hostname, port })", "new WebSocket(address)", 'await import("node:http")'])
    expect(flagged(bad)).toBe(true);
  for (const fine of ["async function fetch(req: Request): Promise<Response> {", "  async fetch(req, s) {", "  fetch(req: Request, ip: string): Promise<Response>;",
    "return api.fetch(inner);", "const response = await api.fetch(inner);"])
    expect(flagged(fine)).toBe(false);
});
