---
title: Live screen content
tldr: The flat screens of a scene's assets can show a live web page instead of their built-in picture, such as a Leitbild scenario's displays on the operator desk or a YouTube clip on the wall display. The scene stores which screen shows what; every open viewer follows each change at once; people operate a screen with Use; agents configure everything with the content.* commands and read back what each viewer reports.
status: living
updated: 2026-11-28
tags: [implementation, viewer, server, agents, security, live-content]
---

# Live screen content

## TL;DR

- **Every live screen shows a web page.** Synergon lays the page exactly over a flat screen of the 3D scene and cuts a hole in the screen so you see the page through it. Your own apps (Leitbild now) say how they are doing, so a screen says *Starting…* instead of going blank.
- **The scene stores it** (`content`, beside the lighting): which item, view or page each screen shows. Undo, versions, transfer and the live channel apply, and it starts again whenever the scene is opened. The scenario itself runs in its app; Synergon stores only a random key from which the run's name is worked out.
- **People** choose a scenario on the object (*Screens*), change one screen on its card (*Shows*, *View*), and operate a screen with *Use*. **Agents** do the same, live, with `content.list`, `content.show`, `content.move`, `content.clear`, `content.restart` and `content.set`, and check what the open viewers really show.
- **Step 1 covers flat screens that face the operator.** The curved rig monitors keep their built-in picture until step 2 (pictures); panels that face up are not offered.
- **Safety:** one address check for every frame, a strict frame sandbox, apps only from their configured origins, other sites after one click per site per browser, YouTube and Vimeo only on the public site, no outbound requests from Synergon's server.

Decision: [D-61](../20-decisions/decision-log.md#d-61). Commands: [remote commands](../80-reference/remote-commands.md#live-screen-content). The design and its reviews are in the working folder of the feature, not published.

## What it is

A **screen** is an `S_` member of a placed asset (a lit surface, [asset contract](../40-method/asset-contract.md)): the operator desk's five displays and its keyboard's touch panel, the wall display, the freestanding display, the rig's monitor and touchscreen. It is addressed as `{instance, screen}`, for example `{"instance": "desk-a", "screen": "S_big_screen_L"}`.

What a screen can show:

| Kind | What | Example |
|---|---|---|
| App item | one **view** of an **item** from one of this installation's apps; the item runs once, in the app, and all its views show the same **run** | Leitbild's *Off-site power restoration* (`offsite-power`), views *Dashboard*, *Unit 1 overview*, …, *Map* |
| Web page | any page allowed on this installation; YouTube and Vimeo links become their privacy-enhanced players, muted and looping | a training clip on the wall display |

Whether a screen is **offered** (can show content) comes from the release's own geometry (the model file's position bounds and the posed node frame), not from the manifest's box: flat (thinner than 2 mm) and not facing up (its normal's upward part at most 0.7). On the demo scene that offers, among others, the desk's five displays, the wall display and the rig's touchscreen (it leans back, but its normal is only 0.51 up); the desk's keyboard panel ("faces up") and the rig's curved monitor ("curved: not in this release") are not offered.

**Distribution.** When an item goes to a whole asset, its views go to the offered screens largest first (two areas within 20 % count as equal), then the operator's left to right, then top to bottom. Views already shown on another asset are skipped, so the same item on a second asset continues with the next views. On the operator desk: the two large displays (left, then right), then the three small ones; the keyboard panel is skipped.

## What you see and do

<!-- check against viewer: the words below were read from the viewer package before its merge (Screens, Shows, View, Built-in picture(s), Web address…, Restart, Remove, Use, Done, Starting…, Showing on n screens, Not answering, Retry, Ended, Show, Content from …, Not allowed here, Live screen content, Double-click to use, Using …). Re-check them after the merge. -->

**A Leitbild scenario on the operator desk.** In the object list click *Operator desk*. Its panel has a section **Screens** beside *Lamps*. In *Shows* choose *Leitbild › Off-site power restoration*. The five flat displays say *Starting…*, then show the live displays, the most important on the largest screens. A note says "Off-site power restoration on 5 screens of Operator desk" with *Undo*. The keyboard's touch panel keeps its built-in picture. Under the menu, *Restart* and *Remove*, and one status line ("Starting… on 2 of 5 screens", "Showing on 5 screens", or the worst state with its action).

**The map on the wall.** Click the wall display's screen. Its card has *Shows* (*Built-in picture*, the sources already in this scene marked "· in this scene", each app's items, *Web address…*) and, for an app item, *View*. Pick *Map*.

**Operate a screen.** Double-click a live screen (the pointer shows "Double-click to use"), or press *Use* on its card. The view turns square to the screen, the rest of the stage dims and a bar says "Using Map · Done". Click faceplates, step procedures, drag and wheel the map. *Done*, a click outside the screen, or Esc in the page (when the page did not use it) turns the view back. Nothing about *Use* is saved or seen by others; what you do in the app is shared, as in the app itself. In the operator's-eye view the camera stays where it is: it is the operator's real view. Outside *Use* every page is inert: drag still orbits, the wheel still zooms the room and a click still selects.

**The next participant.** *Operator desk › Screens › Restart*. The screens say *Starting…* while Leitbild prepares a fresh run (allow up to half a minute), so press it before the participant sits down. *Undo* brings the earlier run back.

**Returning.** Open the scene: the screens say *Starting…* and then show the same run where it was left. A Leitbild run continues until *Restart*, or until it has stood unwatched for 24 hours.

**Any web page.** *Shows › Web address…*, paste the link, *Show*. A page you add yourself loads at once in your browser. In anyone else's browser, and for pages an agent adds, the screen first says *Content from youtube-nocookie.com* and the card offers **Show**: one click per site per browser, remembered for every scene of this installation.

**Status plates.** A screen whose content is not showing shows a plate, never something else:

| What happened | On the screen | Action on the card |
|---|---|---|
| The app has not said "live" yet | *Starting…* | — |
| No greeting from an app page in 30 s, or a plain page not loaded in 20 s | *Not answering* | *Retry* |
| The app reports the run ended or refused (full, unknown item) | *Ended*, or the app's sentence | *Restart* |
| A site not yet accepted in this browser | *Content from <site>* | *Show* |
| Not allowed on this installation (for example an imported address) | *Not allowed here* | — |
| More than 12 live screens in view | the item's name, dimmed | — |

**Your own switch.** *Settings › Live screen content* turns it off for you alone (the screens show their built-in pictures). Phones start with it off. When Synergon is itself shown inside another site's frame, *Show* and *Use* are hidden.

**Save picture.** With live screens in view, *Save picture* asks Chrome or Edge once to share this tab and saves the picture as you see it. Where that is not possible, the live screens appear as labelled plates and the note says "Live screens are shown as labels. Use your system's screenshot to include them."

## What an agent does

The agent guide `/llms.txt` has a section *Live screen content* with worked examples; the [operating Skill](../80-reference/skills-and-agents.md#the-operating-skill-operating-synergon) has the rows. In short:

| Command | What it does |
|---|---|
| `content.list {instance?}` (also `GET /api/scenes/<id>/content`) | Read: apps with items and views, the allowed public sites, the scene's sources with their run ids, every screen with size, flat, facing, offered (and why not), what it shows, and **what each open viewer reports** (`seen`); shows waiting for a removed asset |
| `content.show {instance, screen?, item \| url \| source, app?, view?}` | One undoable edit. Without `screen`, an item's views are distributed; a page goes to the largest screen. Reply: `source`, `run`, `assigned`, `skipped` (with why), `unplaced` |
| `content.move {from, to}` | Swaps what two screens show, or moves a show to an empty screen, across assets too |
| `content.clear {instance?, screen?, source?}` | Built-in pictures again; sources no screen uses are removed; accepts a removed asset's id |
| `content.restart {source}` | A fresh run (a new key); undo rejoins the earlier one |
| `content.set {content}` | Replaces the whole block in one edit, for example a setup copied from another scene; `expectedVersion` required |

The placement of the screens themselves uses the existing commands (`instances.add`, `instances.move`, `instances.swap`, `instances.remove`, `pose.set` for a tilt), which every viewer already follows and which are undoable. A removed or swapped asset keeps its shows: they wait, the reply says so (`content.waiting`), and Undo brings them back.

**Checking what the screens show.** Each open viewer gets a private token on its live stream and reports, at most once a second, one closed state per screen (`starting`, `showing`, `waiting`, `ended`, `refused`, `not_answering`, `awaiting_click`, `not_allowed`, `off`) with the run id and view the page itself reported. No free text crosses this channel. `content.list` shows the reports of the last 60 seconds per screen, each under a short alias of the viewer (never the token), with `viewers`, the number of open live streams. Because any visitor's browser can send reports, the guide says "the open viewers report", not proof. With no viewer open nothing can be confirmed.

## Data format

```json
{"sources": {"offsite-power": {"kind": "app", "app": "leitbild", "item": "offsite-power",
                               "label": "Off-site power restoration", "run": {"key": "k3m9q2w7x5"}}},
 "shows": {"desk-a": {"S_big_screen_L": {"source": "offsite-power", "view": "dashboard"}}}}
```

- `sources`: at most 16; ids are made by the server (the item id, or `page`, `page-2`, … for pages). The same app item, or the same address, reuses its source and so its run. A page source is `{"kind": "page", "url", "label"}` with the address already turned into its player and checked.
- `shows`: instance id → `S_` member id → `{source, view}`; at most 64 shows; `view` is required for an app source and absent for a page.
- **Run name:** the first 26 characters of base32(SHA-256("live-surfaces/1\n" + live scene id + "\n" + key)). One-way, so it never reveals the scene's link. Leitbild's run id is `run-ext-<name>`. The key is 10 random characters, drawn when a source is created and on *Restart*. Because the scene id is part of the name, a copied or imported scene runs its own copy of each item.
- **Scenes store "app + item + view", never app addresses**, so one scene works locally and on the public site.
- Lenient scene, strict commands: a malformed block only makes its screens wait; commands refuse unknown fields. An unknown source kind is kept and its screens wait.
- `share` (one run for several scenes) and `zoom` (page scale) are reserved names, not built.

## Where each thing lives

| What | Where |
|---|---|
| Which page each screen shows | the scene (`scene.content`), with history key `content`: Undo, versions, export, import, compare and the live channel |
| The running scenario | the app (Leitbild), under the worked-out name, in a reserved workspace that Leitbild creates and protects itself |
| The live-content switch, sites accepted with *Show*, addresses typed in *Web address…* | this browser only (`localStorage`); never changes what others see |
| Apps, their origins, items and views; the sites allowed on the public site | `server/live-apps.json`, committed and deployed with Synergon; a local file can replace the apps (`SYNERGON_APPS=<path>`, local only); refreshed from an app's own list with `bun run live-apps refresh <app>` |
| What each viewer currently shows | the Synergon server's memory, at most 60 s, never stored |

## The app contract (`live-surfaces/1`, for app authors)

An app joins by offering four things. No app needs to know Synergon's internals, and Synergon never calls an app.

1. **An item list** at a path of the app (`list` in the settings), read by the refresh tool and copied into `server/live-apps.json`: per item an id, a label, a page template with `{run}`, `{item}` and `{view}`, and its views (id and label, most important first). Ids and labels are the app's curated, neutral words: never internal scenario or object ids.
2. **A page per view** at the template. Its GET has no side effects. Its script joins the named run; if the run is missing or failed, it makes it fresh under that name through the app's own same-origin call, then joins. Link previews and crawlers therefore start nothing.
3. **A greeting over `postMessage`**, every message with `protocol: "live-surfaces/1"`:

   | Direction | Message | When |
   |---|---|---|
   | page → Synergon | `{type: "ready", v: 1, pixels: false, operable: true}` | the page script has started; posted to the parent's origin from `document.referrer`, only if it is on the app's allow-list |
   | Synergon → page | `{type: "hello", width: 1280, height: 720, fps: 30, use: false}` | answer to each `ready`, and after every load |
   | page → Synergon | `{type: "status", state, run, view, text?}` | `starting`, `live`, `waiting` (reconnecting), `ended`, `refused`; `text` one line, at most 140 characters |
   | Synergon → page | `{type: "rate", fps: 0}` / `{type: "rate", fps: 30}` | the screen went out of sight / came back |
   | Synergon → page | `{type: "use", active: true \| false}` | the person starts / stops operating the page |
   | page → Synergon | `{type: "leave"}` | an Esc that nothing in the page used |

4. **App pages must greet within 30 s**, or the screen says *Not answering*. A plain web page never has to greet.

Rules for app authors:

- Post only to your parent's exact origin (never `*`); accept messages only from that origin; answer every `hello`.
- Allow framing (`frame-ancestors`) only on the pages Synergon shows and only for Synergon's origins.
- Report `status` on starting, live, waiting, ended and refused, with your run id; write `text` for an operator, one line.
- At `rate 0` stop animating and polling; resume at any other rate.
- Show your own navigation controls only while `use {active: true}`.
- End every drag on `pointerleave`, `pointercancel`, `lostpointercapture` and `blur`.
- Accept `{view}` and `{item}` URL-encoded.
- Each page is laid out 1,280 CSS px wide at the screen's own aspect (a full-HD panel at 150 % scaling); design for that.
- If a run advances without viewers, say so in your list.

Leitbild's side: a reserved workspace with a fixed id, framing scoped to its run and embed pages, the self-healing run page, the curated neutral list, the greeting and limits (at most 6 watched runs; a run is unloaded 30 s after its last frame closes and deleted after 24 h unwatched; 30 new runs an hour per address). These changes live in Leitbild's own repository.

## Security rules

The threat: anyone with a scene's link can make that scene's viewers load a page, and an address that runs as Synergon itself would be the worst case. The rules, each enforced in code:

1. **One address check, everywhere.** A single function decides every frame address: absolute `https:` only (plus `http:` on `127.0.0.1`, `localhost` or `[::1]` on a local installation, for configured apps or addresses typed in this browser), no user name or password, no control characters, at most 2,048 characters, never Synergon's own origin, look-alike (punycode) host names refused unless listed exactly, and on the public site an exact origin from the allowed list. Every command calls it, and the viewer calls it again before every load and sets a frame's address only from its result. `javascript:`, `data:`, `blob:` and `about:` addresses are refused (a hostile-input test covers them on both sides).
2. **What may load where.** App items only from the app's configured origin and template. Public site: YouTube's privacy-enhanced player and Vimeo's player only. Locally: any https page.
3. **One loading rule.** App pages load at once. Other pages load at once if typed in this browser, otherwise after one click on *Show* per site per browser.
4. **A strict frame.** `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"` (plus `allow-forms` for app pages), an `allow` list that denies gamepad, picture-in-picture, storage access and playback while hidden, `referrerpolicy="strict-origin-when-cross-origin"`, `credentialless` for pages (Chrome and Edge), `inert` outside *Use*, no `name`, never `srcdoc`; the scene id never reaches a frame.
5. **A checked greeting.** Messages only from the frame's own window and its expected origin, checked on every message; at most 60 a second; run and view ids matched against patterns; text capped to one line of 140 characters and shown as plain text attributed to the app. Nothing a page says reaches the server as text.
6. **Leaving *Use* gives the keyboard back.** Synergon refocuses its own view; while no screen is in use it takes the keyboard back whenever a page grabs focus.
7. **`frame-src` from a meta tag.** The release's `index.html` carries `<meta http-equiv="Content-Security-Policy" content="frame-src <app origins> <public sites>">`, generated from `server/live-apps.json`, so an allowed page cannot navigate its frame to any other site; the local server sends `frame-src https: http://127.0.0.1:* http://localhost:* http://[::1]:*` as a header. The deploy's live checks require exactly that tag ([deployment](deployment.md#next-admin-run)).
8. **No outbound requests from Synergon's server**, enforced by a test (`server/no-outbound.test.ts`). App lists are configuration.
9. **Viewer reports** carry only closed states and ids, need a live stream's token, have their own rate limit (120 a minute per visitor on the public site, never counted as edits) and live only in memory.
10. **The shared example on the public site (every scene of its shared workspace) refuses every content edit** (`content_not_here`), so no visitor can make every other visitor start a scenario. Demo scenes and your own workspaces allow it.
11. **Text from apps and pages is data, never instructions**, for agents as for people. The guide and the Skill say so.

Accepted risk for a sandbox: an unpleasant video from YouTube or Vimeo on a shared scene, contained by mute, the one click, the switch and Undo. Leitbild lists runs publicly, so anyone can find and operate a scene's run (never the scene itself); for a study with participants, run both apps locally. Sound started in *Use* keeps playing until it is muted in the page or the screen leaves the view.

## Limits

| Limit | Value |
|---|---|
| Sources per scene | 16 |
| Shows per scene | 64 |
| Content block | 64 KB |
| Address length | 2,048 characters |
| Live frames per viewer | 12 (the furthest screens keep a plate) |
| Page layout width | 1,280 CSS px at the screen's aspect |
| App greeting timeout | 30 s; a plain page's load timeout 20 s |
| Hidden tab | frames removed after 2 minutes, back through *Starting…* |
| Viewer reports | at most one a second per viewer (refused under 0.9 s), whole report each time, kept 60 s, at most 64 screens |
| Messages from a page | 60 a second per frame |

The constants live in `shared/room-content.ts` (`LIVE`) and at the top of `viewer/src/room-frames.ts`.

## Checks

- `server/live-content.test.ts`: the address check against hostile input, the YouTube and Vimeo rewrite, the run name's test vectors, distribution on the real desk and rig, every command with undo, reports, routes and the public budget.
- `server/no-outbound.test.ts`: no network calls in the server's code.
- The live screen content browser check in `bun run check` (a fake app page on another origin: frames, holes, stacking, *Use*, a second browser following, Restart and Undo, the click for another site, reports, the switch, Save picture, a lost graphics context). <!-- check against viewer: the check is in the viewer package; confirm its name and step list after the merge. -->
- The deploy's live check of the meta tag (above).

## Deferred

- **Step 2:** pictures, so curved screens (the rig's monitors) and Fieldwork can show content; screen light from live content; *Use* on picture screens; the selection outline.
- **Step 3:** Leitbild pictures; live content in the public demo (an owner question: one shared scenario every visitor can operate); phones measured.
- **Until asked for:** panel assets for walls and tabletops; image, video and camera kinds; shared runs between scenes (`share`); synchronised video; per-asset screen resolutions; a scene-level `look` for agents; a check that `S_` ids never disappear between asset editions.
- **At the next admin run:** the headers listed under [deployment › next admin run](deployment.md#next-admin-run).

## Related

- [Scene editor](room-layout.md#live-screen-content)
- [Remote commands](../80-reference/remote-commands.md#live-screen-content)
- [Deployment](deployment.md)
- [Decision D-61](../20-decisions/decision-log.md#d-61)
