---
title: Project log
tldr: The dated, append-only record of the project - from the owner's first request through planning, plan approval, implementation, the owner's mid-run requests, the model reviews, the viewer redesign, the usage-limit interruption and recovery, to the final fixes. Newest entries at the bottom; append, never rewrite.
status: living
updated: 2026-11-26
tags: [meta, log, history]
---

# Project log

## TL;DR

- One entry per significant event, oldest first. **Append new entries at the end**; correct an old entry only by adding a new one that says so.
- Times are **local time (CET, UTC+1)**, converted from the UTC time stamps of the project's timeline file; where no time stamp exists the entry says "time not recorded".
- 2026-11-23 is the whole history so far: about 3.5 hours of planning, then implementation from 18:15 to the reviewed model at 21:01, an interruption at about 21:03, and the final fixes by 21:51.
- Each entry links the page that has the detail.

How to add an entry: the date as a heading if it is new, then a line "**HH:MM** — what happened, why, links".
Agents finishing a piece of work add an entry here (see the [wiki conventions](README.md)).

## 2026-11-23

**Time not recorded (early afternoon; about 14:45 if the planning phase took 3.5 hours)** — The
owner's original request: check the feasibility of an open, modular workflow for modelling,
evaluating and live-testing remote-operation stations; first, a credible 3D model of one rig from
its photos; investigate and plan with a specialist agent team, including an agent taking the owner's
position and one asking "could this be simpler", then a fresh adversarial review, then present the plan
for approval. [Original request](10-request/original-request.md), [requirements](10-request/requirements.md).

**Time not recorded** — Investigation: eight specialist agents in parallel (photo evidence and
measurement, reconstruction methods, toolchain and format, decomposition and human-factors semantics,
agent process and Skill design, reuse, viewer and naming, and two hands-on trials building the same
small brief with Blender as a library and with TypeScript and three.js). 218 agent-minutes.
[Research sources](80-reference/sources.md), [options considered](20-decisions/options-considered.md).

**Time not recorded** — During the investigation the owner asked to model only "the white one with the
joysticks" (Rig B; [R-04](10-request/requirements.md)) and that the plan describe in detail how missing
data is filled, how the rig is isolated from the background, how sizes are estimated and how parts are
connected ([R-15](10-request/requirements.md) to [R-18](10-request/requirements.md)).

**Time not recorded** — Plan draft 1 (a toolkit-first plan); critiques by the owner's advocate and the
simplicity monitor; draft 2 (asset first); five fresh adversarial reviewers approved none of it (92
blocker and major findings); version 3 written against them; a closure check found 55 findings closed,
34 partly, 1 open, 2 declined with reasons. [Approved plan](30-plan/approved-plan.md#9-how-the-plan-was-made),
[F-02](60-lessons/failures-and-fixes.md#f-02) to [F-10](60-lessons/failures-and-fixes.md#f-10).

**Before 18:15** — The owner reviewed the plan: the trial model was missing the left joystick, with a
request to find out why ([F-01](60-lessons/failures-and-fixes.md#f-01)); scale figures from memory
(room 4.5 × 5.8 × 2.48 m, platform 1.5 × 1.5 m, seat 1.4 m high, head to display 1.2 m); answers:
internal test, confidentiality no concern ([D-21](20-decisions/decision-log.md#d-21)). **Plan
approved**, with the request for a full autonomous test implementation, a separate ruthless reviewer,
a complete wiki, a private GitHub repository and deployment to the owner's server
([D-22](20-decisions/decision-log.md#d-22), [deviations](30-plan/deviations.md)).

**Time not recorded** — Project name: the owner rejected the suggested names ("keep it simpler. no
german or norwegian") and chose **Synergon**; public addresses `/` for the viewer and
`/wiki` for the wiki on the owner's server ([D-23](20-decisions/decision-log.md#d-23),
[D-32](20-decisions/decision-log.md#d-32)).

**18:15** — Implementation started with three agents in parallel: infrastructure (generator, viewer,
checks, render driver, first blockout), measurement (cameras, scale closure, dimension table) and
masked photo copies for the wiki. [Agent process](40-method/agent-process.md),
[timeline](50-implementation/timeline-and-performance.md).

**Between 18:15 and 19:00** — The owner asked "why is viewer.js a js and not ts". The infrastructure
agent converted the viewer to TypeScript, bundled by Bun, sharing one pose function with the generator
([F-23](60-lessons/failures-and-fixes.md#f-23), [D-29](20-decisions/decision-log.md#d-29)).

**18:38** — Masked photos done: 11 photos, 88 masked regions, metadata removed, contact sheet and
captions in `wiki/img/photos/`.

**19:00** — First complete blockout: every component on both sides, 20 joints, 11,162 triangles, all
checks pass. [Modelling rounds](50-implementation/modeling-rounds.md#the-first-complete-blockout).

**19:03** — Measurement done: five cameras solved, scale closes within 0–2 % against purchased parts,
118 dimension records; the deck is 1.41 m front to back and the seat back top 1.28 m above the deck,
so the owner's figures conflict with the photos; the touchscreen is the 13.3-inch size.
[Measurement results](50-implementation/measurement-results.md), [D-24](20-decisions/decision-log.md#d-24),
[D-34](20-decisions/decision-log.md#d-34).

**19:05** — Round 1: three modellers in parallel (seat; pods; platform, stand and pedals), each in its
own build folder ([D-26](20-decisions/decision-log.md#d-26)).

**Before 19:21** — The owner: "in review, look at the UI. it is overcomplicated and takes a lot of
time", asking for independent interface reviews and simpler controls for a single component
([R-68](10-request/requirements.md)). Two independent interface reviews ran from about 19:21 to 19:37.
[Viewer](50-implementation/viewer.md).

**Before 19:35** — The owner: "why cant i adjust the seat? the lock is confusing for users unless there
is a way to unlock" ([R-69](10-request/requirements.md), [F-25](60-lessons/failures-and-fixes.md#f-25)).
Answered in interface review A: no lock; usable sliders tagged "assumed range" with a notice
([D-31](20-decisions/decision-log.md#d-31)).

**19:38** — A separate implementer started the viewer redesign in a copy of the viewer folder
([D-30](20-decisions/decision-log.md#d-30)).

**19:46** — Round 1 assembled by the coordinator: 30,742 triangles, 68 draw primitives, 0.77 MB, all
checks pass.

**19:48–20:14** — Independent review, round 1: **not accepted** ("a credible layout carrying a few
toy-grade parts"): 28 components accepted, 9 with minor fixes, 8 rejected; three moving parts failed
when moved; whites overexposed; eye point too high. [Modelling rounds](50-implementation/modeling-rounds.md#the-round-1-verdict),
[F-18](60-lessons/failures-and-fixes.md#f-18) to [F-22](60-lessons/failures-and-fixes.md#f-22).

**20:15–20:30** — Round 2: the same three modellers resumed with the findings for their groups:
smooth upholstery, one-piece pod legs, joystick boots that flex, a monitor arm that follows the
monitor, pedals clear of the frame, three eye points, matte materials. 28,042 triangles.

**20:40–20:42** — Viewer redesign finished: 16 controls instead of 103, the model 82.8 % of the window,
a card per selected part, exposure corrected (lit whites 244–249 → 221–231 of 255). The coordinator
ran the 53 acceptance checks (all passed), checked the page by hand and swapped the new viewer in.
[Viewer](50-implementation/viewer.md).

**20:43–21:01** — Independent review, round 2, by a fresh reviewer: **accepted after the listed fixes**:
41 accepted, 5 with minor fixes, 0 rejected; round-1 findings 24 closed, 3 partly, 1 open (the owner's
figures, which need a tape). Three small fixes required.
[Modelling rounds](50-implementation/modeling-rounds.md#the-round-2-verdict).

**About 20:45** — Documentation and publishing started with five agents in parallel: three wiki
writers, the publishing tools (wiki index, lint and site; documentation images; deployment script) and
the Skill author.

**About 21:03** — The model's usage limit was reached. Seven agents stopped mid-task: the three wiki
writers, the publishing-tools agent, the Skill author and the two modellers about to apply the round-3
fixes. Nothing was lost: every agent had written to files as it went.
[Timeline](50-implementation/timeline-and-performance.md#phases-in-order).

**21:32** — Recovery: the owner switched the session to another model. The coordinator confirmed that
the model on disk was byte-identical to the reviewed round-2 build, listed which pages and tools
existed, fixed a false positive of the banned-word check (a three-letter word matched by chance inside
two compressed JPEGs; image bytes are now scanned only for the never-allowed names), and launched fresh
agents with "continue from disk" briefs.

**21:35–21:51** — Round 3 by one agent: cup recess on both pods, flat-faced stand columns, lighter
black rubber and plastic, and the joint-limit rounding bug. Build `0b6d8248b63f`: 28,070 triangles,
67 draw primitives, 0.72 MB; all checks pass; 53 of 53 viewer acceptance checks. The coordinator
spot-checked the three places, as the round-2 reviewer had prescribed, and accepted them.
[Modelling rounds](50-implementation/modeling-rounds.md#round-3-the-final-fixes).

**21:50–21:57** — Deployment tool tried: a first run refused to deploy right after the check; a second
stopped at the distribution step on broken wiki links (pages still being written; nothing was
uploaded); a dry run then completed in 16.6 s; end-to-end runs against a local test server followed.
The web-server site file was validated on the production server and not yet installed.
[Deployment](50-implementation/deployment.md).

**From 21:35** — Wiki, second pass: the summary, glossary, this log, the implementation pages
(timeline and performance, measurement results, modelling rounds, viewer, tech stack) and the reference
pages for tools and for the Skill and agents were written from the run's records.
[Summary](00-overview/summary.md).

**About 22:20** — Results pages written (model card, gallery, critique, goal assessment,
next steps); the coordinator's final wiki pass filled every open marker, added failures F-29 to F-31 and
lessons L-51 to L-54; wiki lint clean (37 pages, 104 images, 0 errors). [Goal assessment](70-results/goal-assessment.md).

**About 21:55** — Final browser verification of the round-3 model by the coordinator (show/hide, the
selected-part card, the joystick pad, the address carrying the state). [Goal assessment](70-results/goal-assessment.md#pending-items).

**22:18** — Private GitHub repository created and the first commit (`5d673d1`) pushed, after checking
that nothing private, unmasked or personal was staged.

**22:20** — Web-server site for `mightwork.ai` installed on the production host, full configuration
validated, server reloaded; every other site on the host answered as before; certificate obtained.

**22:21** — First release deployed with `bun run deploy` in 24.8 s; all nine live checks passed.
Viewer and wiki published on the owner's production server.
[Deployment](50-implementation/deployment.md#production-state).

**About 22:30** — Wiki updated with the production state, committed, pushed and redeployed through the
same pipeline (second release; the script switched releases and re-checked the live site).

**About 23:10** — The owner chose automatic deployment. Set up: an unprivileged server account
`synergon-deploy` behind a forced-command gate that allows only the deploy script's commands inside
`/srv/synergon`; a new key stored as a GitHub secret; the server's host key pinned; a GitHub Actions
workflow running `bun run deploy --no-images` on every push to `main`. A manual deploy through the new
account worked (release `ac78fc6`). [D-37](20-decisions/decision-log.md#d-37),
[deployment](50-implementation/deployment.md#continuous-deployment-from-github).

**About 23:31** — The first automatic run refused to deploy: the check failed on the runner (favicon 404
in full Chrome; a two-minute software-rendered benchmark). Fixed and pushed.
[F-32](60-lessons/failures-and-fixes.md#f-32).

**About 23:35** — The second automatic run was refused too: Chrome did not start within 5 s on a cold
runner. Start-up limit raised to 30 s; pushed again. [F-32](60-lessons/failures-and-fixes.md#f-32).

**23:35** — The third automatic run deployed: every check passed on the runner, release
`20261123T223434Z-66c7bbd` went live in 70.1 s, all nine live checks passed, and the server's gate
allowed each of its commands. From now on every push to `main` deploys.
[Deployment](50-implementation/deployment.md#continuous-deployment-from-github).

## 2026-11-24

**Time not recorded** — The owner approved the platform plan, version 7, with an independent simplicity
monitor; step 1 (agent control) started. The monitor blocked the first design three times (undo of
"own" changes, a commit rule for only some pose paths, the release split); all three were changed
before building. [Platform plan](30-plan/platform-plan.md), [D-38](20-decisions/decision-log.md#d-38)
to [D-43](20-decisions/decision-log.md#d-43).

**Time not recorded** — Step 1 built by two builder agents in a separate worktree on top of the
manikin branch: the command layer, the server with its live channel, the viewer as a live client,
`bun run rig`, the operating Skill, the host's unit, Caddy route and setup script, and the deploy and
dist checks. A security review (four must-fix findings, eleven should-fix) and the monitor's checkpoint
review (the local server's Host check moved to cover every path) were answered before the merge.
[Viewer](50-implementation/viewer.md#the-shared-scene-platform-step-1),
[deployment](50-implementation/deployment.md), [checks](40-method/checks.md).

**Time not recorded** — On the host, the setup script's read-only check found port 4180 taken: the
server moved to 4190 ([D-45](20-decisions/decision-log.md#d-45)); host check H10 added the hiding of
the host's other applications to the unit. Host check H14 (300 live streams that never read) failed:
the kernel's TCP memory passed its pressure threshold.

**About 16:15** — The owner decided that the public site gets the platform without the person in the
seat until the new manikin is approved ([D-44](20-decisions/decision-log.md#d-44)). Step 1 was moved
onto `main` as the branch `platform-step1-main`, without any manikin file, datum, check, render set or
control; the engine keeps only the two extension points the live client uses. A harness bug found on
the way (the setup script's test read "the site file before the setup" from the latest commit, so it
would have failed after any commit with the new file) was fixed with a fixture.

**About 16:35** — Fix for H14: each live stream ends after 512 kB, its place held until its connection
is gone; 150 streams in all, 12 per network block ([D-46](20-decisions/decision-log.md#d-46)). H14 run
again on the host with the new bundle: passed (TCP memory at 49 % of the threshold, the server at
66 MB, other sites unaffected). Committed as `aec6272` on `platform-step1-main` (not pushed, not
merged): full check, 53 of 53 viewer checks, 14 of 14 two-browser steps and the deploy's dry run all
pass; the page loads one script of 733 kB. The setup on the host and the merge wait for the owner's yes.
[Next steps](90-next/next-steps.md#0-platform-step-1-the-rollout-and-after).

**Later the same day** — This wiki pass for the platform: the new [platform plan](30-plan/platform-plan.md)
page, decisions D-38 to D-46, and the viewer, deployment, tech stack, checks, tools, skills, next steps
and summary pages.

**16:17 (the Caddy change; the rest within the hour before and after)** — The host setup, with the
owner's yes, which the entries above leave out: `setup-server.sh --check` twice (the first stopped at
the taken port, the second passed every host check), then `--apply` (the system user and data folder,
Bun 1.4.0 with a matching checksum, the Caddy route installed with a backup while every other site on
the host answered as before, the unit installed and retrying every 2 s), then `--probe` (passed: Bun
serves on loopback under the unit's hardening, sees only Synergon's folders, cannot reach the internet),
then the load test H14 (failed once, passed after the fix noted above). The service now waits for the
first release that contains the server.
[The server and its host setup](50-implementation/server-and-host-setup.md#order-of-the-first-rollout).

**Later the same day** — The simplicity monitor's review before the merge: approved with changes. The
wiki still said the setup was waiting for the owner's yes; corrected on the deployment, viewer, summary,
plan and next-steps pages, and the server's part of the deployment page became a page of its own. The
unit no longer names other programs on the host: `/var/lib` is hidden whole except Synergon's data
folder, like `/srv` and `/opt`, and the probe checks all three (the changed unit is installed and
probed again before the merge). A stream that reaches its byte budget now ends with an `end` event, on
which the page reconnects at once instead of after a second. What remains: the merge and push with the
owner's yes, the check on the host after the deploy, the ten-minute idle test and the two-browser test
on the live site. [Next steps](90-next/next-steps.md#0-platform-step-1-the-rollout-and-after).

**About 17:06** — The owner said yes to the merge; `main` was pushed with platform step 1. The automatic
deploy refused it in its own check, before anything was uploaded; the live site stayed as it was. Two
causes, both only visible on a fresh checkout on Linux: the new command and server tests ran before the
build, so the built model they read did not exist yet; and the setup script's test harness used two
commands in their macOS form (`stat -f`, `sed -i ''`), so 11 of its 74 cases failed on the Ubuntu runner.
Fixed: those tests run after the build; the harness uses forms that work on both systems and prints the
end of a failed run's output; the rollback test's stand-in for `mv -T` no longer assumes macOS. Proved in
a fresh clone without a build, and with stand-ins for GNU `stat` and `sed` that reproduced exactly the 11
failures before the fix. [Checks](40-method/checks.md).

**About 17:30** — The second push (`ff90f30`) deployed: platform step 1 is live. `api/health` on
mightwork.ai reports the deployed revision; on the host the server's code answers 404 in seven
spellings (H12), the unit's exposure score is 1.4 with its limits in effect (H8) and the service is
active. The ten-minute idle test through Caddy was started.

**About 17:40** — The two-browser check on the live site, with the new `tools/live-site-check.ts`:
passed (nine lines ok, 4.4 s). A 1° turn of the monitor from the command line appeared in both pages
with the line "Claude Code · 5145 — Monitor: turn 1° right"; Undo on one page put it back in both; a
5 mm slider move in one page appeared in the other, and `history.undo` of its version put it back; a
view command reached only the named page; nothing was logged; the public scene's pose was the same
before and after (versions 0 to 4). [The server and its host
setup](50-implementation/server-and-host-setup.md#order-of-the-first-rollout).

**Evening** — The owner asked why one request ("make the backrest straight") took so long and for "a very
significant re-engineering" of agent control. Measured: six agent turns and about 30 kB read for one number;
the server answered each command in 0.3 s. A proposal (intent commands, MCP served by the server, a
generated catalogue of what each adjustment means, pictures, a smaller Skill, an agent benchmark) was written,
and the owner said "do the work here, push and deploy" ([D-47](20-decisions/decision-log.md#d-47)). Built on
the branch `agent-v2` from `platform-step1-main`: `shared/commands/intent.ts`, `server/mcp.ts`, `api/picture`,
the page's `look` and pictures, `.mcp.json`, the Skill v2, `tools/agent-docs.ts` and `tools/agent-eval.ts`
([D-48](20-decisions/decision-log.md#d-48) to [D-52](20-decisions/decision-log.md#d-52)). Tried by hand
through MCP against a local server with a real page: one `look {"view": "operator", "picture": true}` came
back with a 41 kB picture of the operator's view. The benchmark could not run: the Claude Code command line on
this machine is not signed in. [Platform plan](30-plan/platform-plan.md#step-15-agent-interface-v2-2026-11-24),
[agent interface](80-reference/agent-interface.md).

**Later** — An independent security review of the v2 diff (before any push): one must-fix, JSON-RPC
batches (a 60 kB request of 1,276 `tools/list` calls answered with 8.5 MB, counted as one request), and
four should-fixes: table lookups by names such as "constructor" ended in a 500; the content-type check
took `text/plain;x=application/json`, and locally any localhost page could post; one stranger could hold
all 20 picture slots; a viewer code was kept before it was checked. All fixed with tests
(`server/mcp.test.ts`), and from its notes: request names ending in `-<number>` are reserved for the
server, `state` no longer shows names that callers chose, and the command line writes a picture into a
fresh private folder. Kept as it is: `.mcp.json` loads the public sandbox's tools in every session of
this repository (the owner's request for fast agent control; what they return is now server-made text,
numbers and pictures from the browser the owner names).

**About 19:30** — The first push of v2 (`45c6122`) was refused by the deploy's own check before any upload: a
step-1 test expected the command list to hold exactly the eight step-1 commands, and on the Linux runner the
intent tests ran first in the same process and had registered five more (on the laptop the files ran in the
other order). The test now checks the step-1 commands among the listed ones; both orders pass.

**About 19:36** — The second push (`5e00724`) deployed: agent interface v2 is live. On mightwork.ai the MCP
endpoint answers `initialize` with the public-sandbox instructions (3,566 characters) and lists the five tools;
`state`, the refusals (no code, a foreign origin, GET, an unasked picture) behave as tested. Against a real
browser on the live site: `look {"view": "operator", "picture": true}` with its code came back with a 48 kB picture
of the operator's view (with the page's "assumed ranges" band), the code was remembered for the next `look`, and
`adjust` of the monitor's turn by 1° and `undo` of its request left the scene as found. The two-browser check of
step 1 (`tools/live-site-check.ts`) passed again, nine lines ok.

**About 20:00** — The owner asked what the browser could show about an agent's requests, "for inspectability"
and with timing, as in Leitbild but simpler. A survey of Leitbild's inspector (stored turns and model calls,
tabs, swim lanes, costs) gave the shape to keep: one list per run, each call with its offset, duration and outcome,
the request and the result on demand, fed live and kept in memory. Built ([D-53](20-decisions/decision-log.md#d-53)):
`server/trace.ts` (a record per request, the event `trace`, `api/trace`), the activity line with its line of times
and Trace, `viewer/src/trace.ts` (the list), tests in `server/trace.test.ts`. Tried in a real page: a run of an
agent shows "connect, state, adjust, look, measure" with "2.2 s on the agent's side" between calls and 1–2 ms on the
server's; a look with a picture shows how long the page took to draw and pack it (about 0.6 s in the in-app browser).

**About 20:30** — An agent run on the live site, watched by the owner in their own browser: "in my viewer i
couldn't see a change in eye point". Cause: the operator's-eye view placed the camera at the eye point as
photographed, read once from the description file, while `measure` used the eye point moved with the seat (79.6 cm
to the screen with the seat 10 cm forward and 4 cm up, against 89 cm as photographed). Fixed in the viewer: the
camera now sits on the current median eye point and aims at the current screen, and rides with the eye when the seat
moves while the view is on. Checked in headless Chromium: as photographed exactly on `D_eye_median`, with the seat
10 cm forward and 4 cm up 10 and 4 cm off it, following +5 cm of slide and −2 cm of height, unmoved by the monitor;
53 of 53 viewer checks. Still open: the eye points do not follow the backrest's recline
([viewer](50-implementation/viewer.md#known-rough-edges)). Also seen: view commands go only to the browser whose code
they name, so the owner's own browser does not follow an agent's `look` unless the agent has its code.

**About 20:40** — The owner asked to position the camera anywhere, including "show me at eye height of a 180cm
person", and to see it in their own browser ([D-54](20-decisions/decision-log.md#d-54)). Built: `look` with `eye`
and `camera`, the viewer's operator view at any sitting eye height (along the line of the model's eye points, riding
with the seat), the link parameter `eye=`, and **Follow** on the activity line (`POST api/follow`). A new assumed
parameter `seat.eye_height_per_stature` (0.455) turns a stature into a sitting eye height. Tried in a real page:
the 195 cm person's view sits 12.2 cm above the median eye; a camera 1.4 m behind, 0.9 m left and 1.3 m above the
seat looks at the monitor; Follow switches to "Following". 80 command and server tests, 53 of 53 viewer checks.


**About 20:50** — Deployed (`18e7e05`) and tried on the live site with the browser pane as the owner's browser: a
`look {"eye": {"stature_cm": 180}}` without a code was refused with `needs_viewer` and showed on the activity line
with Follow; after Follow the same request reached that browser (link `view=operator&eye=0.819`) and its picture
came back marked as from a following browser. A camera "looking at Seat" aimed at the seat's mount point on the
deck, so the picture showed mostly floor: a part named as a camera point now means its middle (the box around it
and its parts, moved with its frame).

**About 21:20** — The owner proposed a consent dialog when an agent asks for a view, with the choice stored
([D-55](20-decisions/decision-log.md#d-55)). Built: the server puts such a view to every open page as a question
(4 a minute per agent), the page shows an amber question with Allow, Always allow and No, and More → Shared scene
holds the stored choice. Tried against a local server in public mode: the question named the agent and the 180 cm
view and left the view alone; Allow showed it and the agent's next view came straight in; with Always allow a third
agent's camera view and its picture came in without a question. 36 server tests, 53 of 53 viewer checks.


## 2026-11-25

**03:50** — Wiki: new page on the manikin approaches, written from the avatar team's research and reviews of
2026-11-24 and 2026-11-25: the problem, every library weighed (commercial ones, MetaHuman included, referenced and
linked only; open ones with licence, contents, fit for ergonomics and for a web viewer; SMPL, SMPL-X and MANO
excluded by licence), what was chosen and why, recommendations, and the current state (the abstract style passed
the designer at level 3, the Unreal-mannequin class, not MetaHuman quality; the dressed style vetoed). One picture
of the raw open base mesh, rendered by the project; pictures of the manikin itself are placeholders until the owner
approves showing it. The avatar work of those two days has no log entries of its own yet.
[Manikin approaches](40-method/manikin-approaches.md).

**07:40** — Manikin: the dressed operator style passed the designer's review (after four vetoes; level 4 minus at
1.5–4 m, level 3 for the head at 1.2 m, one level under MetaHuman at working distance), joining the abstract clay
figure, which passed earlier. Final frame rate on the project laptop at a load average of 17–18 (macOS indexing,
nothing of the project's running), ruled by the owner to be the machine's quiet state: median 66 and 63 frames per
second for the dressed man and woman, 90 for the clay figure, slowest runs 53, 54 and 64. The owner closed the shoe
work as detailed enough. The manikin stays in the lab viewer and off the public site until the owner approves it.
[Manikin approaches](40-method/manikin-approaches.md).

**08:50** — Manikin v1, rig binding (MV-rig): Rig B gained seven empty reference points the seated person needs
(`D_seat_front`, `D_backrest_ref`, `D_armrest_L/R`, `D_grip_axis_L/R`, `D_heel_rest`) and three grip records derived
from its own grip shape (`pods.grip_centre`, `grip_axis_rp`, `grip_radius`); the rebuilt GLB's geometry is byte-identical,
and every check passes. `viewer/src/person/rig-binding.ts` turns the rig's points, as posed, into the seated operator's
targets, the seat and backrest contact surfaces and a report; its own numbers are in
`assets/manikin/params/runtime-rig.toml`. Seven tests (no browser) show the targets following every adjustment, no
NaN at any joint's limit, and the seated eye survey-true to under 1 mm. Findings for three people at the photographed
pose: the 0.47 m seat reaches beyond the short woman's knee crease and her feet fall 117 mm short of the pedals; the
tall heavy man's hips meet the armrest pods; all grips within reach; the monitor's top edge 96 to 235 mm above the eyes.
[Three people in Rig B](70-results/people-in-rig-b.md).

**Time not recorded (2026-11-25, forenoon)** — Manikin v1, phase 2 core (MV-core, branch `manikin-v1`): the lab's manikin code ported
into `viewer/src/person/` (loader, shape bake, drivers, dual-quaternion skinning, eyes, cloth pose, seat contact on the real cushion's
profile, styles, wardrobe, tones, the seated-operator solver), loaded as its own script after the rig is ready; every shader change
confined to the person's materials (the rig's 16 standard pictures identical to `main`'s, 0 px); idle motion only in a live view at 30
frames a second; 445 run-time numbers in `assets/manikin/params/runtime-person.toml`; new checks C-85, C-86, T10b, T44b.
[The person in the viewer](50-implementation/person-in-viewer.md).

**10:40** — Manikin v1, packing (MP): the designer-passed packages brought from the lab into `assets/manikin/`, compressed:
the dressed operator per sex with its three skin tones as texture sets on one geometry (`operator-m`, `operator-f`), the
clay figure per sex (`clay-m`, `clay-f`), the motion clips once per sex (`clips/`), the fabric weave maps once
(`shared/`); 37 MB in 116 files against about 360 MB of lab packages. The first person (dressed man, light tone)
downloads 9.33 MB as the server sends it, shape data included (the lab's: 33 MB); the dressed woman 9.66 MB, the clay
figures 5.2 MB, another tone 0.7 MB; GPU textures 42 and 44 MB per outfit (lab 106 and 113). Meshopt geometry with the
lab's data types kept, KTX2 textures, shape files re-quantised (0.02 mm body, 0.04 mm garments) and meshopt-encoded.
The designer's key shots C1, B1, F1, F5 rendered by the lab's own packet renderer from the lab packages and from the
packed copy: mean difference 0.1 to 0.7 of 255 for the dressed operator (PSNR 43 to 55 dB; 99.9 % of pixels within
18 of 255), 0.003 to 0.03 for the clay figure; nothing visible side by side at 1:1 (two renders of the lab package
are byte-identical, so every difference is the compression's). One first choice was visibly wrong and was changed:
ETC1S on the props' occlusion-roughness-metal maps turned the headset's rails bright (now UASTC). The lab's copy of the clay style inside the dressed packages is left out: the clay figure is its own package.
Provenance per package (`PROVENANCE.json`), `assets/manikin/CREDITS.md` (the CC-BY shirt and trousers, CMU terms),
the README's licence section, the lab's build code in `tools/manikin-build/` (Mac only), the asset contract's new
section 14, and `tools/manikin-check.ts` in `bun run check` (checksums instead of a rebuild, budgets, validator,
licences, banned names in every file, no symlinks). Tools: glTF-Transform 4.5.1, meshoptimizer 1.1.1 (in
`tools/manikin-build/`'s own `package.json`, not the root's, so the deploy never installs them), KTX-Software 4.4.2 toktx
unpacked into `work/tools/ktx/` without installing.
[Asset contract](40-method/asset-contract.md#14-character-assets-the-manikin).

**Time not recorded (2026-11-25, later)** — Person module adapted to MP's final packages (tones with their glTF factors, per-sex fold maps,
renumbered vertices) and extended for the panel, the commands and the review renderer: sex swap keeping tone, wardrobe and pose; clips on
demand (relaxed stand, walk); place, anchor, pick, definition and a change event. [The person in the viewer](50-implementation/person-in-viewer.md).


**Time not recorded (2026-11-25, later)** — Manikin v1, phase 3: the person's commands (MC).
- **Commands.** `person.set` (preset P5 woman, P50 man, P95 man, or a package preset; sex, style, tone, glasses, headset, body controls by id; the cap is always worn), `person.pose` (operating, relaxed stand, the pose library) and `person.clear`. They have the pose commands' conventions: validation, the stale check with the person as one key, undo by version and by request, the server-made author, the live channel.
- **Agents.** One MCP tool, `person`, and `measure {"person": ...}`. The MCP instructions got one rule line: 4,079 of 4,096 characters on the public sandbox.
- **Queries.** `person.report` gives eye (both eyes), sight lines with a gaze cone (`assets/manikin/params/runtime-queries.toml`), reach and clearances. The server computes them without a browser: it reads the packages' manifests and the GLBs' skeletons and runs the person's own solver and the rig binding. For the three presets the numbers agree with [Three people in Rig B](70-results/people-in-rig-b.md).
- **Format.** The scene format holds the person; scene data from before is converted with its history.
- **look's eye.** With a person seated, the operator's view and a stature use the person's solved eye (`eye_point`, carried in `D_eye_median`'s frame on the page). The stature ratio is the fallback.
- **Tests.** New tests in `shared/commands/person.test.ts`, `server/server.test.ts` and `server/mcp.test.ts`. `tools/live-accept.ts` step 10 compares the server's eye with the page's drawn eye (3 mm). Six person cases were added to the agent benchmark.

[The person's commands](50-implementation/person-commands.md).

**Time not recorded (2026-11-25, later)** — Manikin v1, phase 5 (MPK): `tools/person-packet.ts` renders the designer's shot list in
the product viewer with the real rig and the product's light (one frozen viewer build per run, no shared scene), the same ids, persons,
azimuths, distances and lenses; seated shots on the rig binding, standing shots beside the rig with the figure turned; line-ups as
series; product views (default, operator's eye, front, left); passes dressed, clay and tones; `manifest.json`, `metrics.json`
(penetration from a CPU read-back of the person's vertices against the rig's triangles, hands on the real levers, shoes on the pedals,
eye against the survey, the binding's findings, frame time per set) and a `--self-test`. First quick packet (50 images, 13 sheets):
the operator's eye view puts the camera inside the person's head; the hand skin lies 8 to 11 mm inside the real levers for every
person; the short woman's legs end 117 mm short of the pedals at the rig's neutral seat; the tall heavy man's left thigh is 7 mm
into the left pod; a standing person's eyes keep the seated gaze point; a still could depend on the shot before through the seat
contact's sink map. Packets in the main checkout's `work/manikin-v1-packets/` (not committed).
[The person in the viewer](50-implementation/person-in-viewer.md#the-designers-packet-in-the-product-phase-5).
- **Later the same day.**
  - The percentile presets are now the package's own (Small woman (stature P5), Median man, Tall man (stature P95)) with their exact values, and the default person is the Median man. The lab's tall heavy test body stays reachable as `M95H`.
  - The page fills a control that a body leaves out with the package's default.
  - With `person=off` the page leaves the person alone.
  - An undo stack works: a change and its undo cancel in the stale check.

**About 1 h 45 min (2026-11-25, later)** — Manikin v1, phase 4: the person panel (MU).
- **Panel.** A click on the person, or on its new row at the end of the parts list, opens it in the part card's place, in the same style. It holds three presets (Short woman P5, Median man P50, Tall man P95), sex, stature and weight, the 36 survey measures under "More measurements" (in SD, with the size that results), Dressed operator or Clay figure, skin tone, glasses and headset. It has Undo and "Back to <preset>".
- **Shared.** Each change is shown at once and recorded as `person.set` through live.ts's sender. A slider drag is one change, and Undo is `history.undo` of the page's group. Without a server the page keeps its own undo list.
- **Selection.** The person gets the faint selection line, through the engine's new `outlineExtra`. `interact.ts` asks `hooks.click` before picking the rig. While the pointer rests on the person, the tip names it.
- **Credits.** While the dressed operator is shown, a line for the CC BY shirt and trousers stays at the bottom left of the view and goes into saved pictures. More, Credits shows `assets/manikin/CREDITS.md`.
- **Keyboard and screens.** Keyboard and screen-reader names work, and on a phone the panel is a bottom sheet.
- **Cost.** 26 kB in the person's script, which loads after the page is ready. The scripts before ready are 764 of 800 kB (T10).
- **Checks.** T60 to T67 and T46p in `tools/ui-accept.ts`. Every page now waits for the person before its test, and `find` avoids pixels behind the person. T46 runs with `person=off`. T46p gives the frame rate with the person shown, at 1600 × 1000, next to the load average: 61 and 60 fps at load 4.4. 65 of 65 passed then.
- **Undo.** Since MC's change, a change and its undo cancel each other in the scene, so Undo after Undo is plain `history.undo`.
- **Presets.** Agreed through the coordinator: they are the package's own, with exact values, in the panel and in the commands.

[The person panel](50-implementation/person-panel.md).

**12:50** — Manikin v1, rig binding (MV-rig): clearances for every body. A preset or slider body that is not a baked
person had no collision capsules; `tools/person-capsules.ts` now fits the lab's own capsule measurement on the clay
bodies linearly in the shape weights, and `viewer/src/person/body-fit.ts` gives trunk, thigh, shin and forearm capsules
for any body (against the ten baked fits: thighs within 4.8 mm, arms 3.1, heel 0.1; trunk sections half within 3.7 mm,
up to 18 mm where later helper joints hold the skin). The P95 man preset (1.870 m, 96.6 kg) meets the pod shells by
16–17 mm. The hands get the real lever's radius along its axis (`grip.profile`, from the rig's own lever geometry, within
1 mm of the mesh). [Three people in Rig B](70-results/people-in-rig-b.md).
  - Clearances for every body: the server passes the package manifest and the shape weights to the binding, which derives capsules for bodies that are not baked persons. (The rig's generator code is not in the server bundle: the binding reads the pods' shapes from the rig's description file.)

**13:40** — Manikin v1, rig binding (MV-rig): the grip centre moved from the slim neck (where the solver had closed the
fist, 8–20 mm into the real lever) to the middle of the handle section a hand wraps (`pods.grip_centre`, `grip_axis_rp`,
`grip_radius`, new `grip_hold_span`, all derived from the grip's shape records). The lever's radius along the handle axis
is now written by the rig's build into the description file (a datum's `profile` in the spec, on `D_grip_axis_L/R`), so
the viewer and the server read it as data; the binding no longer imports generator code. Geometry byte-identical.

**14:40** — Manikin v1, rig binding (MV-rig): the pods' inner sides are contact surfaces. Two more empty points,
`D_pod_inner_L/R`, on the trays' inner edges; the build writes how far each pod shell stands out toward the seat along the
pod and over which height (a datum's `surface` in the spec), and the binding hands them to the contact layer as `pod_L`,
`pod_R` beside the seat and the backrest, so a wide thigh presses against the pod instead of passing through it. The
clash figures stay in the report. Geometry byte-identical.

**14:55** — Manikin v1, review packet tool (MPK): where the real rig hides what a designer's camera is meant to show
(F6 inside the monitor stand, F7's lap, F8's neck, F9's feet, I5's reach), `tools/person-packet.ts` now measures the
subject through the rig and takes the nearest clear camera (a few degrees, or tens of centimetres nearer) or hides only
the parts in front of the subject for that shot, says so in the caption and keeps both cameras with the reason in
`manifest.json` (`camera_fit`). Hand shots aim at the palm centre (`anchor("hand_centre_L|R")`). D1, E16 and E17 were
off-frame because the viewer's orbit keeps its look-at point within ±1.5 m; the tool now moves the look-at point along
the same line of sight into that box. [The person in the viewer](50-implementation/person-in-viewer.md).

**15:01** — MV-core, after MPK's full packet (full-01): standing soles were still 6–9 mm under the floor in A_POSE in both styles
because the joint rule keeps the ankle at its rest height while A_POSE rolls the foot onto its sole's edge (the old T10h tried only
feet-flat poses); a standing body now also puts its lowest skinned sole point on the floor. `place()` puts the soles on what is
under the spot, the deck top over the platform and `D_floor` elsewhere, so figures beside the rig no longer float 200 mm up. The
pods' inner sides from the rig binding are hard shells in the contact, and the seat's roll of displaced tissue stops at them (it had
pushed even the median man's thighs 9 mm into the pods): M50_HEAVY 12.5 → 0.7 mm, M95H 9.5 → 2.5 mm, measured as drawn
(`viewer.person.shells()`). `anchor("hand_centre_L|R")` added. T10h extended, T10j new; the rig's 16 pictures still differ from
`main` by 0 px. [The person in the viewer](50-implementation/person-in-viewer.md), [checks](40-method/checks.md).

**16:00** — MV-core, the designer's REVIEW-11 (conditional pass for the owner's preview). The "web across the men's lap" in the
operator's own view was the person's own nose and cheeks cut by the near plane, not the seat's roll (it stayed with every contact
term off) and not the groin: the person is no longer drawn within 0.15 m of its own eyes in that view. The iris now follows the
skin tone (the eye kept its first tone's iris colours). The fingers lie on the handle's measured cross-section: the rig's profile
is the largest radius at each height, 10 mm more than the handle's front, so the fingers had wrapped air; the index rests on the
handle within 1 mm. A person-only look: a soft key from the camera side, crease shading baked per vertex, 10 % less skin saturation,
seen by the person's materials only (`viewer.person.look(on)`). Re-rendered: `work/manikin-v1-packets/full-03`.
[The person in the viewer](50-implementation/person-in-viewer.md#fixes-from-the-designers-review-11-2026-11-25).

**Time not recorded (2026-11-25, evening)** — Person panel: T62 failed at the branch head, for two reasons.
- **Pick.** After `viewer.person.set` the person's skeleton stands in its rest pose until the next drawn frame, for 20 to 40 ms, and live.ts re-applies the shared person about 150 ms after the page is ready. A pick or `anchor` in that gap finds a standing person, so the test clicked above the seated head. The panel now draws that frame before it picks.
- **Records.** Two quick changes in a row could have the second refused as stale, because the page's first change had not yet come back over the live channel. The panel now records its changes one at a time, each based on its own last recorded version too.

[The person panel](50-implementation/person-panel.md).

## 2026-11-25 (later)

**Time not recorded** — The project is named Synergon: a new name, a subdomain of its own (`synergon.mightwork.ai`, live from the first Synergon release) and the wiki at `synergon.mightwork.ai/wiki`. Every current file, address, format identifier and setting was renamed; the old modelling "workspace" is now a "build folder", and "workspace" means the shared, public workspaces being built. [D-56](20-decisions/decision-log.md#d-56).

**Time not recorded** — Workspaces, built and tested on this machine, not yet on the public site ([D-57](20-decisions/decision-log.md#d-57)). The server keeps many shared scenes instead of one: an index in `workspaces.sqlite` and one folder per workspace, each with its own history, undo, live view, activity line, Follow, consent and agent address; a deleted one is moved aside, never removed by the server; idle ones are dropped from memory after 10 minutes; creation is rate-limited on the public site ([workspaces on the server](50-implementation/workspaces.md)). The page: a landing at `/` that loads no 3D code, the viewer at `/workspaces/<id>` with a workspace menu in its top bar, and a Manage page ([the viewer](50-implementation/viewer.md#workspaces-on-the-page)). An independent design review ruled the first landing "a form, not a product"; it now opens with a sentence on what Synergon is for and a still picture of the rig with the seated person. The deploy's live check now lists the workspaces and opens one workspace's live stream; the rollback test's stand-in server answers both.

**Time not recorded (evening)** — Synergon is live at <https://synergon.mightwork.ai/>, with the wiki at `/wiki/`, workspaces and the manikin. The move ran as one batch on the owner's yes. GitHub's runner checked the branch first (a new check-only workflow, `check.yml`) and found three things the development machine did not: the live test ran past its time limit while each page loaded the person in software rendering, the build's own browser check read the landing before its list had come, and two time limits were tight. On the host: the new account, gate, service (port 4191), Caddy site and certificate, with the host-only setting that hides the other applications' settings. The earlier shared scene was converted (version 51, 51 changes, the default person added) and placed as the workspace "Playground" (`/workspaces/a850cb15-6246-4ce4-b8e5-7055d4650ab2`) before the first release: `998bd07` from this machine, then `2f12241` from GitHub once `main` took the branch. On the live site the two-browser check and the ten-minute idle test passed; the check first found that the command line got no workspace (Bun does not pass on a variable set after the start), a timing race in reading the activity line, and a page statement on what is stored that still said "only the pose" and "no names" (it now names the workspace's name and the person). Then the earlier address was retired: everything of the old layout archived on the owner's machine, `mightwork.ai` answering 404 for every address, the old service, deploy account, gate, folders, setting and test files removed from the host, the old GitHub secret deleted, the environment `production` limited to `main`, and the repository renamed `michaelhil/synergon`. [Deployment](50-implementation/deployment.md), [D-56](20-decisions/decision-log.md#d-56), [D-57](20-decisions/decision-log.md#d-57).


**Time not recorded** — Added seated gaze, pointing, touch, resting hands and named foot positions on the `person-aims` branch. Existing workspaces retain their format. The shared solver follows the moved rig, and the command reports gaze alignment and gaps when the hand falls short. The three body presets were rendered from the right side of the rig and from the operator's eye. [D-58](20-decisions/decision-log.md#d-58), [the person's commands](50-implementation/person-commands.md#seated-targets).

**Time not recorded** — Reworked the viewer around direct selection. The left panel holds the workspace selector, Components, controls for the selected component or person, and utility icons. Components starts closed. The panel snaps shut when dragged left and reopens when a component or person is selected in the view. The same panel is a drawer on narrow screens. Camera presets, the operator’s eye and reset sit over the lower-right corner. The cards focus on adjustments and can pop out over the view on desktop. The eyes in Components handle visibility, and the rig’s keyboard shortcuts and double-click still work. Agent connection and request tools live under Settings. [The viewer](50-implementation/viewer.md), [the person panel](50-implementation/person-panel.md).

**Time not recorded** — Component clicks open movable controls when the workspace panel is closed. Shift-click opens another controls card. Routine activity and request history open from Trace in the workspace footer. [The viewer](50-implementation/viewer.md).

**Time not recorded** — Overlapping controls cards retain their order as focus moves and cards close. On phones, shared-scene prompts keep their full width and floating cards open below them. [The viewer](50-implementation/viewer.md).

## 2026-11-26

**00:38** — The homepage now identifies the shared operator station and links directly to the agent guide and workspace directory before JavaScript runs. Agents can start with the homepage alone, resolve a workspace by name and discover its controls over HTTP. A fresh agent starting at an isolated homepage asked which of three workspaces to use, then set the operator’s grip and gaze and measured the distance to the screen. [Remote commands](80-reference/remote-commands.md).

**00:48** — A second homepage-only trial found “Michael”, set a female avatar and verified her gaze at the small screen. Asking for her own left foot exposed an erroneous foot-to-pedal match. Target resolution now distinguishes a component's name from its association tags. The agent guide explains shared and per-viewer state and links to the data model and eligible [seated targets](50-implementation/person-commands.md#seated-targets).

**06:55** — The homepage and agent guide describe Synergon’s purpose as the layout, design and evaluation of work environments and identify the remote operator’s station as its first example. [Product overview](00-overview/summary.md).

## 2026-11-26 · Multi-asset room editor for local trial

The local editor opens a saved room, places independent copies of stations and displays, and exposes the same qualified scene operations to the UI, HTTP, MCP and CLI. The furnished trial and empty workspace creation use a fresh room store. [Room layout and agent interfaces](50-implementation/room-layout.md)

## 2026-11-26 · Portable projects and room camera tools

Local projects now hold named scenes, recovery versions, Markdown notes and saved assessments. Embedded, linked and mixed packages use exact release pins. A clean installation can restore a measured layout and replay its saved run offline. Room workspaces also offer a measured operator's-eye camera, pictures, shareable views and a recorded edit trace. [Portable room projects](50-implementation/portable-projects.md) and [Room camera and workspace tools](50-implementation/room-layout.md#camera-and-workspace-tools)


## 2026-11-26 · Integrated room workspaces and assessment

The public room editor combines placement, direct component picking and operator controls in one panel. An independent interaction review caught avatar picks passing through to the seat and a grouped reset that failed to reopen. Room editing, offline project transfer, assessment replay and preservation of existing single-station workspaces were exercised on disposable installations. [Room layout](50-implementation/room-layout.md) · [Assessment criteria](85-standards/workstation-screening.md) · [Public deployment](50-implementation/deployment.md)


Room sliders and direction pads now move geometry during a drag and record one shared edit at release. The view heading switches between the full room and one placed asset. Asset names and plan feature captions start hidden and can be enabled in Settings. [Working on one asset](50-implementation/room-layout.md#focus-on-one-asset)


A homepage-only agent found the two placed stations, edited the seat on one, and placed a third parallel rig on a disposable installation. Scoped discovery now returns joint directions in room coordinates, current values, the release's coordinate convention and placed footprint corners. [Remote asset placement and adjustment](50-implementation/room-layout.md#place-or-adjust-an-asset-remotely)

**15:54** — Added compact sliders with editable values to the [room inspector](50-implementation/room-layout.md). Dragging previews the change, and Return or moving focus saves a typed value.

**16:21** — Cancelling a stature drag restores the seated operator even when the viewer is still updating the avatar. The room control check exercises that timing explicitly.

## 2026-11-27 · Operator desk: a wiki section for the site's collaborators

A new section, [Operator desk](75-operator-desk/overview.md), explains the second object built with the modelling method to people outside the project: the verdict on feasibility in three parts, [the steps with their intermediate pictures](75-operator-desk/how-it-was-done.md), [how each size is known and how the phone's measuring app did](75-operator-desk/measurements-and-accuracy.md), [what three reviews and two audits found and what changed in the method](75-operator-desk/review-and-lessons.md), a [photo guide](75-operator-desk/photo-guide.md) with the 15 images the result rests on, and [three questions and ten tape readings for the site](75-operator-desk/questions-for-the-site.md). Sizes are stated as unverified throughout. The 17 published photographs are masked copies (screens filled, labels and logos covered, surroundings cropped, key lettering blurred, no metadata) under `img/operator-desk/photos/`; the masks stay private and the tool that applies them is a working file outside the published tree. Model pictures are renders under `img/operator-desk/`. One pointer was added to [Next steps](90-next/next-steps.md#3-the-skill-on-a-second-different-object) and one row to the layout table of [How this wiki works](README.md).

## 2026-11-27 · Homepage story and simpler workspace switching

The homepage now has a carousel of five captioned screenshots that tells the story from photos to a measured model, a seated operator, a room and an assessment, and an **Open a workspace** list of the existing workspaces in place of the link to the management page. In a room, the workspace menu lists every workspace instead of offering a directory page, and one **2D / 3D** switch in the view controls replaces the Plan and 3D buttons in the panel ([room editor](50-implementation/room-layout.md)). An independent UX review led to a clearer selected state on the switch, a visible step marker on phones and tighter crops of two slides.


## 2026-11-27 · Homepage: AI control and wiki slides, a top bar

The carousel has two more slides: an agent adjusting Station A through the workspace's agent address, with the Activity list showing each change, and the wiki. Each links on (agent guide, wiki). **Open a workspace** moved into a new bar at the top of the homepage, with **Wiki** at its right. Both agent guides (`/llms.txt` for rooms and the station guide) now open by saying they are written for AI agents acting on a user's requests, with examples. The local server now opens `/wiki/` itself (it answered "Invalid page" before).

## 2026-11-27 · How-to: working with Synergon through an AI agent

New page [How to work with Synergon through an AI agent](80-reference/agent-how-to.md): seven steps with screenshots and example requests for Claude Code or Codex, including what the Agent guide is and how to point an agent at it, the optional MCP connection, watching changes in Activity, and undo. The homepage's AI control slide now links only to this page.

## 2026-11-27 · Workspace → Project → Scene; the single-station product retired

The owner asked for one hierarchy, Workspace → Project → Scene, with a Workspaces menu that cascades to projects and scenes, a furnished scene in one click for new users, and everything deprecated removed. A design draft was reviewed by an independent UX reviewer and a "could this be simpler" monitor; their recommendations were merged into binding decisions ([D-60](20-decisions/decision-log.md#d-60)). What changed:

- **One store and one API on both installations.** Workspaces are listed in `projects/workspaces.json`; projects name their workspace; scenes live in project folders. The retired room database is migrated once at start (the oldest "Control room" becomes the example in "Examples"; the others go to "Earlier layouts"; on the public site into an unlisted workspace "Earlier rooms"); every scene keeps its ID, revision and undo. Scene API at `/api/scenes/{id}/…`; `/api/room` is gone. The public sandbox lists only its shared workspace and refuses file, version and transfer commands.
- **Viewer.** One selector (`viewer/src/hierarchy.ts`) in the homepage bar and the editor's panel head; "New …" asks only for a name; Open viewer reopens the last scene or creates one on the click; scenes open in 3D; "Whole scene" / "Show one asset". A UX check of the result found eight issues (public default names revealing a count, the phone bar, migrated "Control room › Control room", copy, touch targets, note position); all were fixed.
- **Retired.** The public single-station workspaces, their viewer, API and guide; `tools/room-routes.ts`; the generated station agent docs and their check; the station-only tools `live-site-check`, `live-idle-test`, `agent-eval`, `ui-accept`. The station viewer and server remain only as the internal render tool of the asset toolkit.
- **Agents.** `/llms.txt` explains the hierarchy and creation commands; `bun run rig` takes `--scene`; the operating Skill is version 3; `.mcp.json` reads `SYNERGON_SCENE_MCP`.
- **Wiki.** New [workspaces, projects and scenes](50-implementation/workspaces-projects-scenes.md); rewritten [remote commands](80-reference/remote-commands.md), [how-to](80-reference/agent-how-to.md) (one opening prompt: goal, Agent guide, scene), [scene editor](50-implementation/room-layout.md), [deployment](50-implementation/deployment.md), glossary and summary; the station pages are marked retired.

## 2026-11-27 · Open demo, and a breadcrumb with Play

The owner found the homepage still confusing and asked for an **Open demo** link that always opens a fresh, reset default scene, no "Open viewer", and a header breadcrumb of the selected workspace, project and scene with a **Play** button that opens the selected scene. The server gained `demo.open`: each browser gets its own demo scene in an unlisted workspace "Demo", reset to the furnished default (new revision, empty undo) every time it is opened, so a visitor never resets another's demo and only the first demo of a browser counts against the creation limit. The homepage breadcrumb starts filled with the visitor's last real scene; choosing a scene from its menu still opens it directly. The automatic creation of a furnished workspace for new visitors was removed. See [workspaces, projects and scenes](50-implementation/workspaces-projects-scenes.md#the-demo).

## 2026-11-27 · Process content on the control-room screens

The owner found the black screens of the operator desk, the wall display and the freestanding display poor for the 3D effect and asked for generic, abstract content reminiscent of process displays, similar to but not the same as the rig's. `generator/textures.ts` now draws six lit pictures in code (no text, no photo pixels): two plant mimics (tanks with levels, pumps, valves, a heat exchanger, pipes, lamps, an alarm list and a trend strip), two trend layouts (curves with limit lines, tiles and bar gauges), a site overview for the wall display (zones, a network of units, small trends) and a control panel for the desk's touch panel. Each screen of the desk shows a different one. Only the pictures a model uses go into its file; the rig's model is byte-identical. Because the three assets' files changed, both installations now keep earlier asset builds so scenes pinned to them still open; earlier builds are marked retained and hidden from **Add object** ([scene editor](50-implementation/room-layout.md#ownership-and-persistence)).

## 2026-11-28 · Lamps light the 3D view (step 1 of lighting)

The owner asked how feasible a lighting simulation in the browser is, for example the operator desk's downlights and its LED strip, and chose step 1: visible lighting, not lux. Assets can now declare lamps (`c.kit.lamp`, [asset contract](40-method/asset-contract.md#6-what-a-component-module-exports)); the operator desk's canopy has two downlights (assumed 40° beam, assumed 4000 K) and its light strip, with invented relative brightness. The viewer makes them real lights: spot lights with soft shadows and an area light for the strip. A lamp button in the view controls (lower right, shown when a scene has lamps) dims the room and darkens the background so the lamps' light shows; a one-time note says it shows where light falls, not lux. An independent UX check had found that a "daylight and lamps" setting showed nothing (daylight swamps the lamps) and that a select hidden in Settings would not be found; both were dropped for the single toggle. The picture shows the character of the light, not lux; measured illuminance on the desk would be step 2 (a server-side calculation from lamp data the photos do not give).

## 2026-11-28 · Scene lighting: ceiling grid, screen light, lamp colours, all controllable from outside

The owner asked for screens that give light, a generic room lighting system (an X × Y grid of ceiling lights with height, intensity, spread, colour temperature and colour) and for all colour to be controllable from outside so that a simulation can change it on events. Lighting is now part of the scene (`lighting` in the scene document, absent = defaults) and changed with one undoable command, `lighting.set`, the same for the panel, agents and scripts; every open viewer follows live. The viewer builds the ceiling grid from spot lights, puts a soft area light in front of every lit screen, and applies brightness and colour to the assets' lamps, their lit surfaces included. The lamp button now shows the whole lighting view. Controls: Room envelope › Lighting, and **Lamps** in the card of an asset that has lamps. See [scene editor › lighting](50-implementation/room-layout.md#lighting).

An independent UX check found that simulation-driven colours would fill the undo history; `lighting.set` now takes `live: true` for such values (shown and stored, no revision, no undo entry, at most 10 a second per scene). It also asked for the whole drawing to darken in the lighting view (no seam under the heading), an "Own colour" checkbox with the colour in use shown in the swatch, discs that mark the ceiling lights, and a dot on the lamp button when the lighting changes while a viewer shows daylight; all done. Drawing the ceiling lights in the 2D plan is left for later.

## 2026-11-28 · No freeze on the lamp button; a central progress card; movable while the operator loads

The owner reported that the app stalled when the lamp button was clicked, and asked for a central progress indicator with a close button while the viewer opens and loads the operator, with the view movable meanwhile. Cause: switching the lighting view changes the number of lights, and three.js then builds new shaders for every material on the main thread before the next frame. The renderer now builds those shaders in the background (`compileAsync`) for the lighting view, for a changed ceiling grid and for the operator figure, and keeps drawing the current state until they are ready. Measured in the headless check browser: with the default 3 × 2 grid the lamp click went from one 355 ms freeze to one 50 ms task; the operator's arrival from 329 ms to 113 ms. An 8 × 8 grid (64 light sources) blocked for 12 seconds on its first lit frame, because every light source costs every pixel of every frame: a grid now uses at most 12 real light sources (a denser grid is lit by a coarser one of the same total brightness with wider beams, and every fixture still shows its disc); with 8 × 8 the click now costs 58 and 142 ms. An independent UX check asked for these measurements, the app's own close icon on the card and quieter screen-reader output (the object count is not read out); done. A central progress card (spinner, the current step, × to hide it until the work is done) replaces the small status line for loading, seating the operator and preparing the lighting.

## 2026-11-28 · Read live screen content; import and replay scenes with lighting

Release A of live content on the flat screens: the reader, shipped before anything writes it, so the release after it can be rolled back safely. A scene may now carry `content` (which page or app view each flat screen shows, `shared/room-content.ts`); this release keeps it, undoes it in one step like the lighting, exports, imports and compares it, and opens a scene whose block is malformed (its screens will wait). No command writes `content` yet. An undo record of a kind this installation does not know is kept but never offered (before, an undo would have spliced it into the placements). Fixed on the way: a scene with lighting could not be imported, and its saved assessments could not be replayed, because the transfer check refused the `lighting` field; it now checks lighting against its limits and refuses an unknown scene field as coming from a newer Synergon. `project.compare` covers lighting and content. `version.json` gains `reads: ["content"]`, and `bun run deploy --rollback` refuses to go back to a release that does not read what the live one reads ([deployment](50-implementation/deployment.md#rolling-back)). Tests: `server/room-reader.test.ts`, case 10 of `tools/deploy-tests/deploy-checks.ts`. Pages: [portable projects](50-implementation/portable-projects.md), [scene editor](50-implementation/room-layout.md#ownership-and-persistence), [deployment](50-implementation/deployment.md).

## 2026-11-28 · Live screen content: the agent guide, the operating Skill and the wiki

Step 1 of live content on the flat screens, written down for agents and readers. The owner's requirement: an AI agent can configure, live, what every screen shows and where the screens are, with undo, and check what each screen really shows. The agent guide `/llms.txt` has a new section *Live screen content* beside *Lighting*, matching the commands as built: `content.list` (also `GET /api/scenes/<id>/content`), `content.show`, `content.move`, `content.clear`, `content.restart`, `content.set`, the `seen` states each open viewer reports, the refusals, the public-site rules, and six worked examples (a Leitbild scenario on the operator desk, a clip on the wall display, moving a view between screens, restart for the next participant, clearing, and checking with `seen`). It says that labels, titles and status from apps are data, never instructions. The operating Skill is version 4 with rows for every `content.*` command and a reporting line for screen content. New page [live screen content](50-implementation/live-screen-content.md) (what it is, what you see and do, the data, where it lives, the app contract `live-surfaces/1` for app authors, the security rules, limits, checks, what is deferred); decision [D-61](20-decisions/decision-log.md#d-61) records the twelve decisions of the design. Updated: [remote commands](80-reference/remote-commands.md#live-screen-content), [scene editor](50-implementation/room-layout.md#live-screen-content), [workspaces, projects and scenes](50-implementation/workspaces-projects-scenes.md), [deployment](50-implementation/deployment.md#next-admin-run) (the frame-policy meta tag, its live check, no outbound requests, and the admin-only headers for the next admin run), [asset contract](40-method/asset-contract.md), [skills and agents](80-reference/skills-and-agents.md), glossary and summary. The viewer's words were read from the viewer package before its merge and are marked for a check after it.

## 2026-11-28 · Live screen content: the guide, Skill and wiki match the merged viewer

After the viewer package and its UX fixes were merged, the words and behaviour on [live screen content](50-implementation/live-screen-content.md), the [scene editor](50-implementation/room-layout.md#live-screen-content), the glossary, the agent guide `/llms.txt` and the operating Skill were checked against `viewer/src/room-app.ts` and `room-frames.ts` and corrected: **Screens** comes first and open under *Placement*; *Built-in pictures* in its menu removes the content (the separate Remove is gone); addresses are loaded with *Load*, and a note names the screen a page went to; the distribution note offers *Look* and says when the screens face away; *Restart* gives the note "A fresh run starts within 30 s."; status lines say *Live*, *This view could not start.* (with *Retry*) and *The scenario has ended.* (with *Restart*), and an app's own reason appears only when it reads as a plain sentence; a page from another site shows "Select it, then press Show" on the screen and *Content from <host>* with *Show* on its card; a screen card offers *Spread over all N screens of <asset>*; *Use* is left by *Done*, a click outside or Esc; screens out of view go live first and pause only afterwards. The guide gained a short "What the user sees" paragraph so an agent can tell the user which button to press. The browser check's 22 steps are listed. The local frame policy no longer lists `[::1]` (Chrome rejects it).
