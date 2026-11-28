---
title: Summary
tldr: Synergon supports work environment layout, design and evaluation, organised as Workspace → Project → Scene. Its first example is a photo-estimated remote operator’s station with an adjustable rig and a seated person, placed in scenes that people and AI agents edit together.
status: living
updated: 2026-11-28
tags: [overview, summary, results]
---

# Summary

Synergon is organised as **Workspace → Project → Scene** ([workspaces, projects and scenes](../50-implementation/workspaces-projects-scenes.md)). A scene holds a room, its placed assets and optionally a seated operator; the scene editor supports independent placements, component and operator editing, and modular ergonomic screening. Projects carry scenes, named versions and assessment records, and on a local installation transfer between installations. [Scene editor](../50-implementation/room-layout.md) · [Portable projects](../50-implementation/portable-projects.md) · [Screening criteria](../85-standards/workstation-screening.md)


**Live screen content** (2026-11-28, step 1, on the branch `live-surfaces`, not yet released): the flat screens of a scene's assets can show a live web page instead of their built-in picture, such as the displays of a Leitbild scenario on the operator desk or a YouTube clip on the wall display. People choose it on the object or the screen and operate a screen with *Use*; AI agents configure what every screen shows, move views between screens, restart and clear, all live and undoable, and read back what each open viewer reports. The curved rig monitors follow in step 2. [Live screen content](../50-implementation/live-screen-content.md)

Synergon is a tool for the layout, design and evaluation of work environments. Its first example is a seated remote operator’s station. The [platform plan](../30-plan/platform-plan.md) covers ergonomic assessment and layouts containing multiple assets.

## TL;DR

- **Asked:** can a credible, adjustable 3D model of a real teleoperation rig be built from photos alone, with a reusable method for later assets; then a full test implementation with a browser viewer, a wiki and a deployment.
- **Built:** a model of Rig B with 46 parts that have shape, 20 joints and 14 reference points, generated from 305 parameter records by code; 28,070 triangles, 0.72 MB; a browser viewer to turn, hide and adjust every part; 20 automatic checks; an Agent Skill for the next asset.
- **Shown:** an independent reviewer that never saw the builders' notes accepted the model after two rounds (41 of 46 parts accepted, 5 with minor fixes, none rejected); the three small fixes it required were then made. Every joint moves to both limits without tearing or collision.
- **Not shown:** that the sizes are right. They are photo estimates with stated ranges, unchecked against any tape. All three of the owner's remembered figures conflict with the photos, and the seat's five adjustments are assumed, not seen.
- **Platform step 1** (2026-11-24, [plan](../30-plan/platform-plan.md)): Claude Code can move parts and steer a browser's view through `bun run rig`; every open viewer shows each change at once with who made it and an Undo; one small server keeps the shared scene, the same program on the laptop and on mightwork.ai. Built and checked on the branch `platform-step1-main`; live on mightwork.ai since 2026-11-24 (host setup and merge with the owner's yes; the two-browser check on the live site passed). The public site has it without the manikin until the owner approves it.
- **Agent interface v2** (2026-11-24, [D-47](../20-decisions/decision-log.md#d-47)): an agent does an everyday request in one tool call, in plain words ("make the backrest straight"), through five MCP tools the server itself offers, locally and on mightwork.ai; it can ask a browser for a picture of its view. What every adjustment means is generated into the tools' descriptions, the Skill and the wiki.
- **Remote commands** gained scoped discovery, structured receipts and aim updates that preserve other aims on 2026-11-26. [Remote commands guide](../80-reference/remote-commands.md)
- **Cost:** about 3.5 hours of planning with 16 agents, then 2 h 46 min to the reviewed model with 14 agent runs; 12.3 agent-hours and 9.4 million tokens in those two phases.

New here? Read this page, then the [index](../index.md). Terms are in the [glossary](glossary.md).

## What was asked

A human-factors and ergonomics researcher asked whether an open, modular environment for modelling,
evaluating and live-testing remote-operation stations is feasible, starting with "a credible 3D model
of that rig, using just the pictures" (eleven phone photos), with the model decomposed into parts that
can be measured again, moved and assessed later. After approving the plan, the owner asked for a full
test implementation: a rotatable, zoomable, high-quality model in a browser with every component
switchable, a separate ruthless reviewer that "will not accept a micky-mouse version", a complete wiki,
a private GitHub repository and deployment to the owner's server. The owner's words are on
[The owner's requests](../10-request/original-request.md); the 69 requirements derived from them are on
[Requirements](../10-request/requirements.md).

## What exists now

![The model of Rig B from the rear right, render](../img/model/rig-b-view-rear-right.jpg)
*The model of Rig B (render, neutral pose): platform, seat, two armrest pods with joysticks, touchscreen on an arm, monitor stand with a curved monitor, pedal set.*

![Masked photo 2530, the model through the same solved camera, and the model's outlines on the photo](../img/matched/rig-b-photo-2530-strip.jpg)
*Left: photo 2530 (rear right), masked. Middle: the model rendered through the camera solved for that photo. Right: the model's outlines on the photo. Layout and proportions agree within a few centimetres sideways; depth along this line of sight cannot be checked from this photo.*

![The browser viewer with the monitor selected and its card open](../img/viewer/viewer-after-monitor-card.jpg)
*The viewer: six group rows, the selected monitor's card with one height slider and one pad for turn and tilt, and a strip offering the way back to the photographed state.*

| Deliverable | What it is | Where |
|---|---|---|
| The asset | one model file (GLB) and one description file (JSON) with the component tree, joints and their limits, reference frames, and every parameter with its source, class and range | built from `assets/rig-b/`; [asset contract](../40-method/asset-contract.md) |
| The source | 305 parameter records, a spec of the tree, one code module per component group; a real measurement replaces an estimate with no code change | `assets/rig-b/params/`, `spec/`, `src/` |
| The viewer | a static web page; the same page makes every image the agents judge | [viewer](../50-implementation/viewer.md) |
| The checks | 20 checks on every build, 53 acceptance checks of the viewer page | [checks](../40-method/checks.md) |
| The method | measuring from photos, filling gaps honestly, decomposition, the agent process | [pipeline](../40-method/pipeline.md) |
| The Skill | `modeling-3d-assets-from-references` 0.1.0 and three agent definitions | [skills and agents](../80-reference/skills-and-agents.md) |
| The platform, step 1 | commands, a server with a live channel and undo, the viewer as a live client, `bun run rig`, the operating Skill, the host's service and setup script | [platform plan](../30-plan/platform-plan.md), [deployment](../50-implementation/deployment.md) |
| Live screen content | web pages and app views (Leitbild) on the scene's flat screens, operable with *Use*, configured by people and agents with the `content.*` commands | [live screen content](../50-implementation/live-screen-content.md) |
| This wiki | request, decisions, plan, method, implementation, lessons, results, reference | [index](../index.md) |

## The verdict in plain words

| Question | Answer | How it is known |
|---|---|---|
| Is the model credible to someone who knows the rig? | **Yes.** Round 2: "the model is no longer a toy in any view"; 41 accepted, 5 accepted with minor fixes, 0 rejected; the three required fixes were made in round 3 and spot-checked | *judgment* of two independent reviewer agents (round 1 rejected 8 of 45 parts) and of the coordinator; no person has judged it yet |
| Is it modular? | **Yes.** 53 named nodes for parts and assemblies, in five groups; any part or group can be hidden, shown alone or addressed by name | *tested*: coverage and naming checks, viewer acceptance checks |
| Is it parametric? | **Yes.** Every size is a parameter record; the build refuses a record without source, class, range and evidence; a value in `measured.toml` overrides an estimate without code changes | *tested* |
| Is it articulated? | **Yes.** 20 joints: seat (5), armrests (2), joysticks (4), touchscreen (2), monitor (3), pedals (3), pedal tray (1); each moves exactly the parts it should, and nothing tears or collides at the limits | *tested* (motion check) and *judgment* of the round-2 reviewer with its own collision scripts |
| Can it be viewed in a browser? | **Yes**, at 60 fps on the build machine, with a link that reproduces any view | *tested* on one Apple M2, headless; other devices *not verified* |
| Are the sizes right? | **Not known.** They are photo estimates with ranges: two-view lengths typically ±1 cm (±0.6–3 cm), single-view typically ±2 cm (±0.5–6 cm), the rest assumed. Scale closes within 0–2 % against purchased parts. Depth along the main photos' line of sight cannot be checked at all | *measured* where stated; **not verified** against a tape |
| Do the owner's figures hold? | **No, all three conflict with the photos:** platform 1.50 × 1.41 m, not 1.5 × 1.5; seat back top 1.28 m above the deck (1.48 above the floor), not 1.4; 1.2 m fits headrest to screen, not eye to screen (about 0.89–1.05 m). The model follows the photos and keeps the owner's figures on record | *measured* on two rigs; a tape must settle it ([measurement results](../50-implementation/measurement-results.md#the-owners-three-figures)) |
| Are the adjustments real? | **Partly.** Joystick, pedal and touchscreen motion is seen in photos; armrest and monitor motion is inferred; the five seat adjustments and the pedal tray are **assumed** (usable, marked "assumed range") | recorded per joint in the description file |
| Is it ready for ergonomic evaluation? | **Not yet.** Viewing distance, reach and posture results depend on the unchecked sizes and on the assumed seat ranges | *judgment*; see the [goal assessment](../70-results/goal-assessment.md) |

The numbers below are those of the final, published build (SHA-256 `0b6d8248b63f…`).

## The numbers that matter

| Measure | Value | Source |
|---|---|---|
| Triangles | 28,070 (budget 150,000) | description file, round-3 build |
| Model file | 719,872 bytes (0.72 MB; budget 4 MB); description file 0.22 MB | same |
| Draw primitives | 67 (budget 80) | same |
| Nodes, joints, reference frames | 89 nodes, 20 joints, 14 reference frames | same |
| Parameter records by class | 305: measured 3, vendor 22, photo 80, assumed 179, invented 21 | same |
| Parameter records by tier | critical 33 (31 of them measured, vendor or photo), layout 96, cosmetic 176 | same |
| Photo measurements | 118 dimension records: 26 two-view, 60 single-view, 20 assumed, 7 recorded gaps, 3 owner, 2 vendor | [measurement results](../50-implementation/measurement-results.md) |
| Build time | 0.19 s median (full build) | [timeline and performance](../50-implementation/timeline-and-performance.md#tool-performance) |
| All checks | 4.2 s median, 20 checks | same |
| Viewer | 16 controls by default; model 82.8 % of the window; 53 acceptance checks pass; ready in 0.2 s locally; 60 fps | [viewer](../50-implementation/viewer.md) |
| Planning | 16 agents, 336 agent-minutes, 4.48 M tokens, about 3.5 h elapsed | [timeline and performance](../50-implementation/timeline-and-performance.md#every-agent-run) |
| Implementation to the reviewed model | 14 agent runs (11 agents), 402 agent-minutes, 4.93 M tokens, 2 h 46 min elapsed | same |
| Round 3 and the second documentation pass | 4 agent runs (after a usage-limit interruption stopped seven agents), 96 agent-minutes, 1.67 M tokens | same |
| All reported agent runs | 34 runs, 834 agent-minutes (13.9 h of agent work), 11.1 M tokens, in about 7.5 h elapsed from first request to deployment | same |

All figures come from one Apple M2 machine and one run of the project on 2026-11-23.

## Where to look next

| If you want | Read |
|---|---|
| What was asked, in the owner's words | [The owner's requests](../10-request/original-request.md), [Requirements](../10-request/requirements.md) |
| Why it was done this way | [Decision log](../20-decisions/decision-log.md), [Options considered](../20-decisions/options-considered.md), [Approved plan](../30-plan/approved-plan.md), [Deviations](../30-plan/deviations.md), [Platform plan](../30-plan/platform-plan.md) |
| How an asset is made | [Pipeline](../40-method/pipeline.md), [Measuring from photos](../40-method/measuring-from-photos.md), [Filling gaps](../40-method/filling-gaps.md), [Decomposition](../40-method/decomposition.md), [Asset contract](../40-method/asset-contract.md), [Agent process](../40-method/agent-process.md), [Checks](../40-method/checks.md) |
| What happened and how long it took | [Modelling rounds](../50-implementation/modeling-rounds.md), [Measurement results](../50-implementation/measurement-results.md), [Viewer](../50-implementation/viewer.md), [Timeline and performance](../50-implementation/timeline-and-performance.md), [Tech stack](../50-implementation/tech-stack.md), [Deployment](../50-implementation/deployment.md), [The server and its host setup](../50-implementation/server-and-host-setup.md), [Project log](../log.md) |
| What was learned | [Lessons learned](../60-lessons/lessons-learned.md), [Failures and fixes](../60-lessons/failures-and-fixes.md), [Patterns](../60-lessons/patterns.md), [Ideas](../60-lessons/ideas.md) |
| The result and its critique | [Model card](../70-results/rig-b-model-card.md), [Goal assessment](../70-results/goal-assessment.md) |
| What to do next | [Next steps](../90-next/next-steps.md); the most useful single action is a tape measurement of the ten values listed in [measurement results](../50-implementation/measurement-results.md#the-most-useful-tape-measurements) |
| To continue the work as an agent | `CLAUDE.md` at the repository root, then [Skills and agents](../80-reference/skills-and-agents.md) and the [tool reference](../80-reference/tools.md) |

## Current status

As of 2026-11-25 (the model's rows unchanged since 2026-11-23, about 22:00 local time):

| Item | Status |
|---|---|
| Model | round 3 done: the three fixes required by the round-2 reviewer and a joint-limit bug; all checks pass; spot-checked by the coordinator |
| Viewer | redesigned, 53 of 53 acceptance checks (one of them a skip; see [viewer](../50-implementation/viewer.md#the-redesign)) |
| Wiki | 39 pages on the platform branch (37 published on main); lint clean; published with the viewer |
| Skill | version 0.1.0; not yet tested on a second object |
| Tape measurements, seat make and model, which adjustments exist | requested, not received |
| GitHub repository | <https://github.com/michaelhil/synergon> (renamed on 2026-11-25; GitHub keeps a redirect from the earlier address); **public**, as GitHub reports it since its creation on 2026-11-23, although the request and [D-33](../20-decisions/decision-log.md#d-33) said private: the owner decides |
| Public site | <https://synergon.mightwork.ai/>, live since 2026-11-25 (first release `998bd07` from this Mac, then `2f12241` from GitHub); since 2026-11-27 it serves only Workspace → Project → Scene (the single-station workspaces such as the Playground are retired); the earlier address answers 404; every push to `main` deploys automatically ([D-37](../20-decisions/decision-log.md#d-37)) |
| Public wiki | <https://synergon.mightwork.ai/wiki/>, live since 2026-11-25 |
| Platform step 1 (agent control) | live on the public site since 2026-11-24 (commit `ff90f30`): the server's health check reports the deployed revision, the checks on the host after the release passed, and the two-browser check on the live site passed and left the public scene as it found it. Open: the result of the ten-minute idle test, the owner's own trial, the re-forecast of the later steps ([next steps](../90-next/next-steps.md#0-platform-step-1-the-rollout-and-after)) |
| Remote commands | Scene commands over HTTP, MCP (`/api/scenes/<id>/mcp`) and `bun run rig`, plus creation of workspaces, projects and scenes; the agent guide `/llms.txt` explains the hierarchy ([remote commands](../80-reference/remote-commands.md), [how-to](../80-reference/agent-how-to.md)) |
| Workspaces | since 2026-11-27 the top of Workspace → Project → Scene, the same on both installations; the earlier single-station workspaces (2026-11-25 to 2026-11-27, [D-57](../20-decisions/decision-log.md#d-57)) are retired ([workspaces, projects and scenes](../50-implementation/workspaces-projects-scenes.md)) |
| Live screen content | step 1 (2026-11-28): Release A (the reader) is on `main`; the server, viewer and agent guide are built on the branch `live-surfaces` and are released after Leitbild's side is deployed and the live gates pass ([live screen content](../50-implementation/live-screen-content.md)) |
| Manikin | live since 2026-11-25 (the dressed operator by default, the clay figure one click away), after the designer's pass and the owner's local preview ([D-44](../20-decisions/decision-log.md#d-44), [the person in the viewer](../50-implementation/person-in-viewer.md)) |
