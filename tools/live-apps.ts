// The apps of live screen content in server/live-apps.json, refreshed from the app itself. Local tool only: Synergon's
// server never calls an app (server/no-outbound.test.ts), so an app's item list reaches it as a reviewed commit.
//
//   bun run live-apps refresh <app id> [--from http://127.0.0.1:43100]
//
// GETs the app's `list` path from the given origin (or the configured one), reads {format: "live-surfaces/1", items}
// (an optional label is ignored), checks the items exactly as the server will at start-up, rewrites that app's `items`
// in server/live-apps.json (its id, label, origin and list stay), prints what changed, and scans the result for the
// names that must never enter the repository. Review the diff, then commit it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bannedIn } from "./banned.ts";
import { ROOT } from "./timeline.ts";
import { checkItems, checkLiveApps } from "../server/live-apps.ts";
import type { LiveItem } from "../shared/room-content.ts";

export const FILE = join(ROOT, "server", "live-apps.json");

/** The file's text with one app's items replaced; throws on a bad answer or a banned name. */
export function refreshed(text: string, appId: string, answer: unknown): { text: string; before: LiveItem[]; after: LiveItem[] } {
  const settings = checkLiveApps(JSON.parse(text), true), app = settings.apps.find(a => a.id === appId);
  if (!app) throw new Error("server/live-apps.json has no app " + appId + " (it has " + (settings.apps.map(a => a.id).join(", ") || "none") + ")");
  const a = answer as { format?: unknown; items?: unknown } | null;
  if (!a || typeof a !== "object" || a.format !== "live-surfaces/1") throw new Error("the answer is not {format: \"live-surfaces/1\", items}");
  const items = checkItems(a.items, app, "answer.items");
  const next = { ...settings, apps: settings.apps.map(x => x.id === appId ? { ...x, items } : x) };
  checkLiveApps(next, true);
  const out = JSON.stringify(next, null, 2) + "\n", banned = bannedIn(out, ROOT);
  if (banned.length) throw new Error("the new list contains " + banned.length + " name(s) that must never enter the repository; nothing written");
  return { text: out, before: app.items, after: items };
}

/** One line per added, removed or changed item and view. */
export function describeChange(before: LiveItem[], after: LiveItem[]): string[] {
  const lines: string[] = [], old = new Map(before.map(i => [i.id, i]));
  for (const item of after) {
    const was = old.get(item.id);
    if (!was) { lines.push("+ item " + item.id + " (" + item.label + "): " + item.views.map(v => v.id).join(", ")); continue; }
    old.delete(item.id);
    if (was.label !== item.label) lines.push("~ item " + item.id + " label: " + was.label + " → " + item.label);
    if (was.page !== item.page) lines.push("~ item " + item.id + " page: " + was.page + " → " + item.page);
    const views = new Map(was.views.map(v => [v.id, v.label]));
    item.views.forEach((v, n) => {
      if (!views.has(v.id)) lines.push("+ view " + item.id + "/" + v.id + " (" + v.label + ")");
      else if (views.get(v.id) !== v.label) lines.push("~ view " + item.id + "/" + v.id + " label: " + views.get(v.id) + " → " + v.label);
      if (was.views[n]?.id !== v.id && views.has(v.id)) lines.push("~ view " + item.id + "/" + v.id + " moved to place " + (n + 1));
      views.delete(v.id);
    });
    for (const v of views.keys()) lines.push("- view " + item.id + "/" + v);
  }
  for (const id of old.keys()) lines.push("- item " + id);
  return lines;
}

if (import.meta.main) {
  const args = process.argv.slice(2), from = args.indexOf("--from") >= 0 ? args[args.indexOf("--from") + 1] : undefined;
  const [command, appId] = args.filter((a, n) => a !== "--from" && args[n - 1] !== "--from");
  if (command !== "refresh" || !appId) { console.error("usage: bun run live-apps refresh <app id> [--from <origin>]"); process.exit(2); }
  try {
    const text = readFileSync(FILE, "utf8"), app = checkLiveApps(JSON.parse(text), true).apps.find(a => a.id === appId);
    if (!app?.list) throw new Error(app ? appId + " has no list path in server/live-apps.json" : "no app " + appId);
    const url = new URL(app.list, from ?? app.origin);
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("GET " + url.href + ": HTTP " + response.status);
    const { text: next, before, after } = refreshed(text, appId, await response.json());
    const changes = describeChange(before, after);
    if (!changes.length && next === text) { console.log("live-apps: " + appId + " is up to date (" + after.length + " item(s), from " + url.href + ")"); process.exit(0); }
    writeFileSync(FILE, next);
    console.log("live-apps: " + appId + " refreshed from " + url.href + " (" + after.length + " item(s)); banned-name scan: none found");
    for (const line of changes) console.log("  " + line);
    console.log("Review `git diff server/live-apps.json`, then commit it.");
  } catch (e) {
    console.error("live-apps: " + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
}
