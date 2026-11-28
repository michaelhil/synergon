---
title: Scene editor
tldr: Arrange a scene's room, edit its assets and operator, and discover the same instance-qualified controls through HTTP, MCP or the CLI.
status: living
updated: 2026-11-28
tags: [implementation, viewer, server, assets]
---

# Scene editor

## TL;DR

Open the Synergon homepage or run `bun run serve` for a local installation. The homepage tells the story in seven slides (photos, model, person, room, assessment, AI control, wiki). Choose **Open demo** for a freshly reset, furnished demo scene, or pick a workspace, project and scene from the breadcrumb **Workspaces ▾ › Projects ▾ › Scenes ▾** in the bar at the top and press **Play** (it starts filled with your last scene); **Wiki** at the right of that bar opens this wiki. In the editor the head of the left panel shows `Workspace ▾ › Project ▾` and the scene's name, each with its list and **New …** ([workspaces, projects and scenes](workspaces-projects-scenes.md)). The view title **Whole scene ▾** shows one asset on its own when you choose it. The **2D / 3D** switch at the left of the view controls in the lower right changes between the floor plan and the 3D view. A fresh installation also creates the furnished **Control room**. The local room store lives under `work/room-layout`. Set `--data <folder>` and `--port <number>` to run another independent installation.

## Arrange and measure

Use **Add object** to select a release. Drag an object in plan, use its rotation handle or enter exact placement in the left panel. Select a part to inspect its station's adjustments. Change the release to swap the selected placement. **Plan** shows dimensions, **3D** opens the orbit view, and **Fit** frames the room. The **Measure** tab compares qualified points and the selected object's projected footprint with the doorway. One operator can occupy a station. The furnished room pairs two north-facing stations with a shared wall display. The display's adjustable mount sets its height, and the station monitors' own joints set their heights. The freestanding screen faces the pair from the east side.

A scene uses a rectangular floor with east and north coordinates measured from its southwest corner. Door and window offsets are measured east from the west wall. Positive yaw turns east towards north. Every asset declares a floor anchor. Rig B's deck origin sits 0.20 m above that anchor. Doorway approach is the shortest distance from the threshold to one rotated bounding footprint. The unblocked opening is the longest continuous interval at the threshold after subtracting every footprint. A doorway measurement includes the defining points and edges. These are plan projections, including overhanging features.

## Edit a component or operator

Click a part in either view to open its controls in the left panel. For overlapping geometry, select the station in the object list and expand **Components** to choose the part by name. The inspector names the station it edits, so the same seat on a second station has its own settings. A fixed part offers **Object placement**.

In 3D, select a movable component and drag it to adjust the joint along its visible direction of travel. Release to commit the movement as one edit. Drag empty space to orbit. Sliders and two-axis pads preview movement as you drag. Release to share one undoable edit. Escape cancels the preview. Click the value beside a slider to type a precise number. Return or leaving the field saves it. Escape cancels an unfinished edit. The room dimensions, object placement, joint adjustments and operator body measurements use the same controls. Component cards display lengths in millimetres and angles in degrees. Joysticks and adjustable screens also have an expandable two-axis pad with keyboard arrow controls. **Reset component** restores the selected part's controls to neutral. Room undo restores each pad gesture or reset in one step.

Click the operator in 3D, the operator tag in Plan, or choose **Operator** in Components. Set the person's body, posture, appearance, gaze or limb targets. **Operating** uses the host's seat and joystick geometry. Eye measurements use this posture.

Drag the left divider to resize the panel or drag it to the edge to collapse. With the panel closed, picking a component opens a movable inspector. Shift-click opens another inspector for comparison. Use the header icons to pop out, dock or close a card.

## Focus on one asset

Open **Full room** above the drawing and choose an asset, or click the station name above a component's controls. The viewer frames the asset in 3D with its attached operator. Pick and adjust its components as in the full room. These edits apply to the same placed asset. Other viewers keep their own camera and scope.

In the view heading, **Full room** returns to your previous camera and selection. The adjacent asset name switches directly to another asset. **Plan** returns to the full floor plan. A shared view link preserves the focused asset.

Asset labels start hidden. Turn on **Object labels** in the left panel’s **Settings** to show object names and plan feature captions. Dimensions, active measurements and the operator marker remain available when labels are hidden.

## Agent entry point

The homepage links to `/llms.txt`, the guide written for AI agents acting on their user's requests. The same paths work locally and on the public site. Substitute the scene's ID for `{id}`.

| Operation | Interface |
|---|---|
| Find a scene | GET `/api/workspaces`, then GET `/api/workspaces/{workspace}` for its projects and scenes |
| Read the scene revision and objects | GET `/api/scenes/{id}/state` |
| Read revision, live viewers, workspace and project | GET `/api/scenes/{id}/meta` |
| Resolve names or inspect one placement | GET `/api/scenes/{id}/discover?query=monitor` or supply `instance` |
| Inspect installed pins or command schemas | GET `/api/catalog` or GET `/api/commands` |
| Run one operation | POST `/api/scenes/{id}/command` with JSON, `X-Synergon: 1`, `id`, `args` and optional `expectedVersion` |
| Read what the screens show and what each viewer reports | GET `/api/scenes/{id}/content` (= `content.list`) |
| Subscribe or reconnect | GET `/api/scenes/{id}/live` for authoritative scene snapshots |
| Use MCP | JSON-RPC at `/api/scenes/{id}/mcp`; set `SYNERGON_SCENE_MCP` to that full address for the repository configuration |
| Create workspaces, projects and scenes | POST `/api/projects/command` ([remote commands](../80-reference/remote-commands.md#create-and-rename)) |
| Use the command line | `bun run rig discover '{"query":"monitor"}' --scene <scene link>` |

## Place or adjust an asset remotely

Start with the homepage's agent guide. An unfiltered scene discovery returns the room dimensions, current revision, placed instances with their positions and yaws, and the installed release IDs. Narrow discovery with `instance` and `query` before editing.

| Intent | Command and arguments |
|---|---|
| Find a seat adjustment on a particular station | `discover {"instance":"station-b","query":"seat"}`. A part lists its associated controls. |
| Interpret a joint's direction | `discover {"instance":"station-b","query":"J_seat_slide"}`. Read its current `value`, limits, unit by joint type, and `axisRoom` in east/north/up coordinates. The release's authored `frame` describes its forward direction. |
| Move that seat 20 mm from a neutral setting of zero | `pose.set {"instance":"station-b","member":"J_seat_slide","value":0.02,"allowAssumed":true}`. Supply the discovery revision as `expectedVersion`. Values are absolute. |
| Place another copy | `instances.add` with the source instance's exact `release`, a fresh `instance` ID, `label`, and `x`, `y`, `yaw`. Supply initial joint settings in `pose` when required. |
| Check placement | Scoped `discover` includes `footprintRoom`, the four corners of the release's floor-plan bounding box at the saved placement. Compare it with room boundaries and other objects. `measure.clearance` screens the doorway threshold. |

For a prismatic joint the positive room axis gives its direction of travel. For a revolute joint it is the positive right-hand rotation axis. The room axis includes the placement yaw and current parent-joint rotations. A ball joint's three angles use its own mount frame.

## Ownership and persistence

A release identifies its asset, version and SHA-256 digest of its ordered file inventory. Model geometry, manifest and operator package dependencies belong to the release. Fetch `inventory.json` next to its model URL to inspect file digests. An instance owns its placement and joint overrides. Address a point with an instance and its local member ID. The operator carries an explicit host and host-local targets. Each viewer owns its own camera and selection.

An accepted edit writes the scene and its undo record together in one atomic file write in the project folder. Pass the revision on which an edit is based to detect overlapping changes. The receipt gives the recorded version for targeted undo. Changes to separate placements can proceed independently. A scene's screen content (`content`: which page or app view each flat screen shows, [live screen content](#live-screen-content)) is kept, undone in one step like the lighting, transferred and compared; a malformed block leaves the scene openable. An undo record of a kind this installation does not know (from a newer release) is kept but never offered for undo. Reconnect reads the current snapshot. An unsupported scene format or unavailable pin identifies what must be supplied. When an asset changes, both installations keep its earlier builds (the public server in its library archive, a local installation in `<data>/library-archive`), so a scene pinned to an earlier build still opens; earlier builds are marked retained and are not offered under **Add object**, and the release picker labels them "earlier build". **Swap release** moves a placed asset to the current build. 

## Lighting

A scene has its own artificial lighting, saved with the scene and changed with one command, `lighting.set`, so people, agents and a later simulation all control it the same way and every open viewer follows at once. It is shown in the **lighting view**: the lamp button in the view controls dims the daylight and darkens the background. Editing any lighting control switches the lighting view on.

| Part | Controls (Room envelope › Lighting) | Command fields |
|---|---|---|
| Ceiling lights | On; lights across and along (1–8 each, evenly spaced); height (default: just under the ceiling); brightness; spread (narrow downlight to wide, diffuse); colour temperature (2200–8000 K); colour (replaces the temperature) | `ceiling: {on, countX, countY, height, intensity, spread, cct, colour}` |
| Screens | Screens glow and give light; brightness (also how bright they glow) | `screens: {on, intensity}` |
| Asset lamps | On, brightness, colour for every asset's own lamps (a desk's downlights and light strip); per asset in its card under **Lamps** | `lamps: {on, intensity, colour}`, with `instance` for one asset |

A design change is an undoable edit. A simulation sends its values with `"live": true`: every viewer follows at once and the value is stored, but it is not an undoable edit and adds no revision, so it never buries a person's own edits (at most 10 a second per scene). For example `{"instance":"desk-a","lamps":{"colour":"#ff2a1a"},"live":true}` for an alarm: the lit strip and its light both turn red. A viewer in daylight sees a dot on the lamp button when the lighting changes; small discs mark the ceiling lights in the lighting view. Switching the lighting view or changing the grid builds the new shaders in the background ("Preparing the lighting."), so the view never freezes. A grid uses at most 12 real light sources: a denser grid shows every fixture but is lit by a coarser grid of the same total brightness. Values are visual (relative brightness), not lux; lights cast no shadows except an asset's own downlights.

## Live screen content

The flat screens of the placed assets can show a live web page instead of their built-in picture: the views of a Leitbild scenario, or any allowed page such as a YouTube clip ([live screen content](live-screen-content.md)). The scene stores which screen shows what, so Undo, versions and transfer apply and every open viewer follows at once. <!-- check against viewer -->

| Where | What |
|---|---|
| An object's panel › **Screens** (beside *Lamps*, for an asset with offered screens) | *Shows*: *Built-in pictures*, an app's items, or *Web address…*; an item's views go to the asset's screens, largest first. Then *Restart* and *Remove* and one status line |
| A screen's card | *Shows* (one screen), *View* (for an app item), one status line with at most one action (*Retry*, *Restart*, *Show*), and *Use* |
| The screen itself | the page, laid over the screen; a status plate (*Starting…*, *Not answering*, *Content from …*, …) when it is not showing; double-click to **use** it (operate the page), *Done* to leave |
| Settings | **Live screen content**: off for this browser only; phones start with it off |

Agents use `content.list`, `content.show`, `content.move`, `content.clear`, `content.restart` and `content.set` ([remote commands](../80-reference/remote-commands.md#live-screen-content)). Curved screens (the rig's monitors) and panels that face up keep their built-in picture in this release.

<a id="camera-and-workspace-tools"></a>

## Camera and scene tools

**Views** in the lower-right corner of the drawing offers an overview, four elevations and a top view. The **lamp** button beside it switches the lighting view on: the daylight is dimmed so the scene's [lighting](#lighting) shows; it is a picture, not a lux calculation. **Operator’s eye** uses the seated eye and its named look target from the same measurement command as the assessment engine. Drag to turn your head and scroll to zoom. Changing the station pose or placement updates the eye position. Select **Operator’s eye** again to return to orbit. Click the operator in 3D or the operator tag in plan to open the station's operator controls.

The panel footer holds **Copy view link**, **Save picture**, **Trace** and **Settings**. A view link opens this scene with its plan centre and zoom or its 3D camera, selected object and component. Pictures are PNGs of the visible plan or 3D drawing; with live screens in view, Chrome and Edge ask once to share the tab so the picture includes them, and elsewhere they appear as labelled plates ([live screen content](live-screen-content.md#what-you-see-and-do)). Trace lists recorded layout edits newest first. Settings controls object labels, the floor grid, colours and component visibility. **Agent access** gives the scene MCP endpoint.

**Reset all** restores neutral joint settings, component visibility and the camera. Undo restores the affected joint settings. To transfer a layout and saved versions to a colleague, see [Portable room projects](portable-projects.md).


## Assessment and private projects

The **Assessment** tab loads the screening module on demand. Choose a profile, identify the task and scene targets, and open each finding for its source, applicability and measurement. The evaluator uses the same posed scene and exact asset releases as the viewer. See [workstation and doorway screening](../85-standards/workstation-screening.md).

The local [project directory](portable-projects.md) organizes scenes and named versions, and can package their exact asset releases and saved assessments for another installation.
