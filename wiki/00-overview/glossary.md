---
title: Glossary
tldr: Plain-language meanings of every technical term this wiki uses - from asset contract, blockout and camera solve to tier, triangulate and build folder - in one alphabetical table, each with the page where it matters most.
status: living
updated: 2026-11-28
tags: [overview, glossary, reference]
---

# Glossary

## TL;DR

- One alphabetical table. Each term has a plain meaning and, where useful, the page that uses it most.
- "Left" and "right" always mean the **operator's** left and right, never the image's ([L-50](../60-lessons/lessons-learned.md#l-50)).
- The model frame: **X forward** (from the operator toward the main display), **Y to the operator's left**, **Z up**; metres and radians; origin at the centre of the platform deck's top surface.
- How a value is known is written in italics on the pages: *tested* (run on the machine), *measured* (with the number), *judgment*, *not verified*.
- Identifiers such as R-01, D-01 or F-01 are explained in the [wiki conventions](../README.md).

## Terms

| Term | Meaning | See |
|---|---|---|
| Active area | The part of a screen that shows a picture. Modelled as its own thin surface (`S_` node) so a simulator can show live video on it | [asset contract](../40-method/asset-contract.md) |
| Adjustment | A movement a person sets before or between uses (seat slide, monitor height, armrest position). One of three kinds of variable; compare *design parameter* and *runtime control* | [asset contract](../40-method/asset-contract.md#10-three-kinds-of-variable) |
| Adversarial review | A review by fresh agents told to find flaws, with no access to the authors' reasoning. Used on the plan's second draft | [approved plan](../30-plan/approved-plan.md#9-how-the-plan-was-made) |
| Agent | An AI model instance given a task, tools (files, shell, browser) and a brief. In this project every agent was a Claude model run by Claude Code | [agent process](../40-method/agent-process.md) |
| Agent definition | A file in `.claude/agents/` that fixes a role's instructions and tools, so the role can be started the same way each time | [skills and agents](../80-reference/skills-and-agents.md) |
| Agent harness | The software that runs agents and reports, when each finishes, its duration, tokens and tool calls. The only trusted source of agent time | [timeline and performance](../50-implementation/timeline-and-performance.md) |
| Anthropometric | About human body sizes (stature, sitting eye height, reach). Used here for the small, median and large eye points | [standards](../80-reference/standards.md) |
| Assembly | A node of the tree that groups parts and has no shape of its own (for example the seat assembly) | [decomposition](../40-method/decomposition.md) |
| Asset | The deliverable 3D object: a model file (GLB) plus its description file, built from parameter files and code | [pipeline](../40-method/pipeline.md) |
| Asset contract | The written specification every asset must meet: units, axes, names, parameter records, joints, reference frames, file conventions, budgets | [asset contract](../40-method/asset-contract.md) |
| Asset definition and instance | A definition describes reusable rig geometry and capabilities. An instance is one placement in a workspace. Each current workspace has one implicit rig instance. | [Remote command design](../50-implementation/remote-command-design.md#data-model-and-evolution) |
| Assumed | A size class: a value chosen without a measurement (by eye from a photo, or taken from another rig of the same product). Carries a range where possible | [filling gaps](../40-method/filling-gaps.md) |
| Assumed adjustment, assumed range | A movement no photo shows (for example the seat's slide). It is in the model and usable in the viewer, tagged "assumed range" with a notice; the description file records it as assumed | [viewer](../50-implementation/viewer.md) |
| Ball joint | A joint that turns about three axes, given as roll, pitch and yaw (the touchscreen arm) | [decomposition](../40-method/decomposition.md) |
| Basis | For assumed or photo values: how exactly the value was obtained (two-view, single-view, by eye, cross-instance) | [filling gaps](../40-method/filling-gaps.md) |
| Bellows | The pleated rubber boot round the base of a joystick | [modelling rounds](../50-implementation/modeling-rounds.md) |
| Bevel | A narrow slanted strip along an edge so that it catches light; costs two triangles per edge | |
| Blend | An overlay that mixes a render and a photo 50 : 50. Nearly useless on dark parts; component outlines work better | [patterns](../60-lessons/patterns.md#p-12) |
| Blockout | A first version of the whole object in simple solids of the right size and place, with every component, both sides and all joints, before any shaping | [modelling rounds](../50-implementation/modeling-rounds.md#the-first-complete-blockout) |
| Budget | Fixed upper limits for the model: 150,000 triangles, 4 MB, 80 draw primitives; build well under 5 s | [asset contract](../40-method/asset-contract.md) |
| Build | Running the generator: parameter files and code become the model file and the description file (about 0.2 s) | [tool reference](../80-reference/tools.md) |
| Build folder | A separate output folder per agent (`work/<name>/`) so parallel builds and renders do not overwrite each other; set with `--build` or `SYNERGON_BUILD_DIR` | [tool reference](../80-reference/tools.md#build-folders-and-environment-variables) |
| Build hash | The SHA-256 fingerprint of the model file. Ties a render, a review and a deployed copy to exactly one build | |
| Bundle adjustment | A calculation that adjusts camera positions, camera settings and 3D points together until the points' projections match the picked pixels as closely as possible | [measuring from photos](../40-method/measuring-from-photos.md) |
| By eye | A basis: a proportion judged in a photo, with no measurement behind it and no range claimed | [measurement results](../50-implementation/measurement-results.md#counts-per-class) |
| Cage (faceted cage) | A kit operation that builds an angular shell (seat back, pod fairing) from named corner points and flat faces, with soft chamfers between the faces | [generator note](../../generator/README.md) |
| Camera solve, solved camera | Finding where a photo was taken from, which way the camera pointed and its focal length, in the model frame. With it, the model can be drawn exactly as the photo saw it | [measuring from photos](../40-method/measuring-from-photos.md) |
| Check | A script that verifies one property of every build (coverage, geometry, determinism, budgets and so on); 20 run in `bun run check` | [checks](../40-method/checks.md) |
| Chord | The straight width of a curved monitor from edge to edge, as makers list it; shorter than the length along the curve (the arc) | [measurement results](../50-implementation/measurement-results.md#corrections-the-modellers-made-later) |
| Class (size class, provenance class) | How a value is known, in order of trust: measured, vendor, photo, assumed, invented. A component takes the least certain class among the non-cosmetic values it uses | [filling gaps](../40-method/filling-gaps.md) |
| Closure check | In planning: a final fresh agent checking that the adversarial reviewers' findings were actually dealt with | [patterns](../60-lessons/patterns.md#p-04) |
| Closure, scale closure | After fixing the scale on one large feature, measuring other parts of known size in the same frame to see whether they come out right. Here: within 0–2 % | [measurement results](../50-implementation/measurement-results.md#scale-and-closure) |
| Component | A named part of the model with its own node (`C_…`), for example the seat pan or the left joystick lever | [decomposition](../40-method/decomposition.md) |
| Contact sheet | One image with six standard views of the model and a footer with its counts and any omitted parts | [tool reference](../80-reference/tools.md#render-sets) |
| Coordinator | The main session: writes briefs, makes rulings, assembles and checks results, writes notes. It modelled nothing | [agent process](../40-method/agent-process.md) |
| Cosmetic, critical, layout | See *tier* | |
| Coverage check | A check that every component of the tree is either built or listed as omitted with a reason. Exists because a whole side of the rig was once missing | [checks](../40-method/checks.md#c-08) |
| Cross-instance | A basis: measured on another rig of the same product, because the reference rig does not show it | [filling gaps](../40-method/filling-gaps.md) |
| Datum, reference frame | A named point with its own axes (`D_…`) that later work measures from: floor, seat references, eye points, grip points, pedal faces, emergency stop | [decomposition](../40-method/decomposition.md#reference-frames) |
| Deck | The flat top surface of the platform the station stands on. Its plane, rectangle and width fix the model frame and the scale | [measurement results](../50-implementation/measurement-results.md) |
| Description file, manifest | The JSON file beside the model file: tree, joints with limits, reference frames, every parameter with class, range and evidence, counts, the model file's hash | [asset contract](../40-method/asset-contract.md) |
| Design parameter | A number baked into the geometry (a length, a curvature, an outline). Changing it needs a rebuild (0.2 s) | [asset contract](../40-method/asset-contract.md#10-three-kinds-of-variable) |
| Detectability | How many pixels a given error (here 50 mm) would move a point in a photo. Near zero along the line of sight, which is why some positions cannot be checked | [measurement results](../50-implementation/measurement-results.md#what-cannot-be-checked-from-the-photos) |
| Determinism | Building twice gives byte-identical files. Checked on every run | [checks](../40-method/checks.md#c-05) |
| Deviation | A difference between what the approved plan said and what was done, numbered V-1 onward | [deviations](../30-plan/deviations.md) |
| Dimension table | The measurement stage's output: one record per needed dimension with value, range, class, basis, tier and evidence (118 records) | [measurement results](../50-implementation/measurement-results.md) |
| Draw call, draw primitive | One instruction to the graphics chip to draw one piece of the model with one material. Fewer is faster; the model has 67 | [asset contract](../40-method/asset-contract.md) |
| Drill | A planned test of re-adjustability: change parameters, enter a measured value, swap a purchased part, and rebuild. Not yet run | [ideas](../60-lessons/ideas.md#i-18) |
| Emergency stop (E-stop) | The red mushroom button on the right pod | |
| Evidence (text) | The sentence in each parameter record saying where the value comes from | [filling gaps](../40-method/filling-gaps.md) |
| Expected-motion table | A list in the spec of which nodes each joint must move. A check poses every joint and compares | [checks](../40-method/checks.md#c-12) |
| Exposure, tone curve | How bright the rendered picture is and how bright colours are compressed so that whites do not clip | [viewer](../50-implementation/viewer.md#the-exposure-correction) |
| Eye point | A reference frame where an operator's eyes would be: three of them (small woman, median adult, tall man), derived from the seat reference | [measurement results](../50-implementation/measurement-results.md#the-owners-three-figures) |
| Focal length | The camera setting that decides how wide the picture is; in pixels here (about 1515 px in the working frame) | [measuring from photos](../40-method/measuring-from-photos.md) |
| Functional surface | A surface that matters for use and has its own node (`S_…`), such as a screen's active area | [asset contract](../40-method/asset-contract.md) |
| Gate | In the plan: a point where the owner approves before work continues. In this run replaced by reviewer rounds | [deviations](../30-plan/deviations.md) |
| Gauge features | The features used to define the frame and scale (here the deck). They match the photos by construction, so they never count as evidence that anything is right | [patterns](../60-lessons/patterns.md#p-06) |
| Generator | The project's TypeScript code that turns parameter files into the model | [pipeline](../40-method/pipeline.md) |
| GLB, glTF | glTF is the open standard file format for 3D scenes; GLB is its single-file binary form. Read by browsers, game engines and Blender | [options considered](../20-decisions/options-considered.md) |
| Grip point | A reference frame on a joystick grip where the palm rests; used for reach | [decomposition](../40-method/decomposition.md) |
| Group | One of five sets of components: platform, seat, pods, stand, pedals. Each had its own modeller | [decomposition](../40-method/decomposition.md#groups) |
| Headless | A browser run without a window, driven by a script. Every render and page test here is made that way | [tool reference](../80-reference/tools.md) |
| Hold-out (points) | Points a person picks and keeps away from the builders, used afterwards to test the model. Planned, not done in this run | [ideas](../60-lessons/ideas.md#i-02) |
| ID colours | A render in which each component has its own flat colour, to check which part is which | [tool reference](../80-reference/tools.md#render-sets) |
| Independent reader | `tools/glb_inspect.py`: Python code that reads the model file without sharing any code with the writer, so the writer's mistakes cannot hide | [patterns](../60-lessons/patterns.md#p-14) |
| Invented | The least certain class: a value with no source at all, used as a modelling device (a gap between two surfaces, a pocket depth); only allowed for cosmetic values | [filling gaps](../40-method/filling-gaps.md) |
| Item, view (live content) | An item is one thing an app offers to Synergon's screens, such as a Leitbild scenario; its views are the pages it can show (a dashboard, a map). Ids and labels are the app's neutral words | [live screen content](../50-implementation/live-screen-content.md) |
| Joint | A node between two parts that lets the child move: revolute (turns about one axis), prismatic (slides along one axis), ball (turns about three). Has limits and a neutral value | [decomposition](../40-method/decomposition.md#joints) |
| Kit | The project's own small library of shape operations (box, extrude, revolve, loft, sweep, cage …) | [generator note](../../generator/README.md) |
| Landmark | A point that can be recognised in photos (a screw, a corner) and picked to measure from | [measuring from photos](../40-method/measuring-from-photos.md) |
| Left/right check | A check that every left part has a right counterpart (unless marked single) and that the two mirror each other | [checks](../40-method/checks.md#c-09) |
| Limits, neutral | The lowest and highest values a joint may take, and the value it has as photographed | [asset contract](../40-method/asset-contract.md) |
| Live screen content | A live web page shown on a flat screen of the 3D scene instead of its built-in picture: an app's view or any allowed page. Stored in the scene; every open viewer follows changes at once | [live screen content](../50-implementation/live-screen-content.md) |
| Locked | A joint the description file marks as not to be moved without saying so explicitly; used for assumed adjustments. People can still move them in the viewer, with a notice | [viewer](../50-implementation/viewer.md) |
| Loft | A kit operation that skins a surface through a series of cross-sections; used for cushions, grips and columns | |
| Look sample | In the plan: one finished component shown to the owner before the rest is shaped. Not done as a gate in this run | [deviations](../30-plan/deviations.md) |
| Matched view, photo-matched | The model rendered through a photo's solved camera, so that it can be compared with the photo; also with outlines drawn on the (masked) photo | [patterns](../60-lessons/patterns.md#p-12) |
| Measured | The most certain class: a value measured on the real rig. Here only the owner's three verbal figures | [measurement results](../50-implementation/measurement-results.md#the-owners-three-figures) |
| Mesh | The triangles of one part. A node may carry one mesh | |
| Milestone images | Images saved at the end of each step so the history can be shown later | [patterns](../60-lessons/patterns.md#p-20) |
| Model card | A one-page summary of an asset: what it is, how sure its sizes are, deviations, review verdicts | [model card](../70-results/rig-b-model-card.md) |
| Model frame | The coordinate system of the asset: metres, X forward, Y to the operator's left, Z up, origin at the centre of the deck's top | [asset contract](../40-method/asset-contract.md) |
| Mount frame | Where and how a part sits on its parent, written in the spec as small formulas over parameters | [decomposition](../40-method/decomposition.md) |
| Node | One named element of the model's tree: a component (`C_`), joint frame (`J_`), reference frame (`D_`) or surface (`S_`) | [asset contract](../40-method/asset-contract.md#3-names) |
| Omitted list | The list of components deliberately not built, each with a reason; printed on every contact sheet. Empty for Rig B | [checks](../40-method/checks.md#c-08) |
| Operator's eye | A view from the median eye point, as the operator would see the station | [viewer](../50-implementation/viewer.md) |
| Parameter record | One number (or list) with its value, unit, range, class, basis, tier and evidence, in `assets/rig-b/params/*.toml` | [filling gaps](../40-method/filling-gaps.md) |
| Parametric | Built from named numbers that can be changed, so the model can be rebuilt with new sizes without touching the code | [requirements](../10-request/requirements.md) |
| Pedal set | The three foot pedals on a tray with a heel plate, in front of the seat | |
| Photo (class) | A value measured in the photos: two-view or single-view | [filling gaps](../40-method/filling-gaps.md) |
| Planted error | A deliberate mistake of known size put into a model to test whether a reviewer finds it. Planned, not done | [ideas](../60-lessons/ideas.md#i-01) |
| Playbook | Part of the Skill holding knowledge for one type of object (here seated stations), as opposed to universal rules | [skills and agents](../80-reference/skills-and-agents.md) |
| Pod | One of the two armrest units beside the seat: a white shell, a black top plate with a joystick and buttons, and an armrest pad. They move with the seat | [decomposition](../40-method/decomposition.md) |
| Pose, pose function | A set of joint values; the one shared piece of code (`shared/pose.ts`) that turns a joint value into a movement, used by both generator and viewer | [viewer](../50-implementation/viewer.md#from-javascript-to-typescript-with-one-pose-function) |
| Progressive discovery | Look up only the capabilities and targets needed for a task. | [Remote commands](../80-reference/remote-commands.md#discover-only-what-the-task-needs) |
| Project | The middle level: a named set of scenes with its record, named versions and saved assessments, which can be exported to another installation | [portable projects](../50-implementation/portable-projects.md) |
| Provenance | Where a value comes from; recorded as class, basis and evidence | [filling gaps](../40-method/filling-gaps.md) |
| Range (±) | The interval meant to contain the true value about nine times in ten; a judgment, not a computed confidence interval. No range may exclude a derivation not shown wrong | [measuring from photos](../40-method/measuring-from-photos.md#the-three-honest-classes-and-what--means) |
| Render | An image of the model made by the viewer page | [tool reference](../80-reference/tools.md#render-sets) |
| Residual | How far, in pixels, a point predicted by the solved camera lands from where it was picked in the photo. Small residuals on features *not* used in the solve are evidence | [measurement results](../50-implementation/measurement-results.md#cameras-solved-and-their-residuals) |
| Reviewer (independent) | An agent that did not build the model, makes its own renders and measurements, does not read the builders' notes, and gives a verdict per component | [patterns](../60-lessons/patterns.md#p-15) |
| Rig A, B, C1, C2 | Neutral names for the photographed stations: A in a van, B the reference rig that was modelled, C1 and C2 in a control room | [wiki conventions](../README.md) |
| Round | One pass of shaping by the modellers followed by a review. Three rounds were run | [modelling rounds](../50-implementation/modeling-rounds.md) |
| Run (live content) | One running copy of an app item, shared by all screens that show it. Its name is worked out from the scene's id and a random key; *Restart* draws a new key, Undo brings the old run back | [live screen content](../50-implementation/live-screen-content.md) |
| Runtime control | A movement made during use, such as joystick deflection or pedal travel; would be driven by a signal in a simulator | [asset contract](../40-method/asset-contract.md#10-three-kinds-of-variable) |
| Scale | The factor that turns photo measurements into metres; here set by the deck width of 1.50 m | [measurement results](../50-implementation/measurement-results.md#scale-and-closure) |
| Scene | The lowest level and the thing you edit: a room, its placed assets and optionally a seated operator, with its own revision and undo. Opens at /workspaces/{scene} | [workspaces, projects and scenes](../50-implementation/workspaces-projects-scenes.md) |
| Seat index point | A standardised reference point of a seat defined by ISO 5353 with a test device. Not available here; the model carries estimated seat references instead | [standards](../80-reference/standards.md) |
| Seat reference (estimated) | Two reference frames where the seat surface meets the backrest: one fixed on the pedestal, one that moves with every seat adjustment | [standards](../80-reference/standards.md#what-the-asset-carries-instead) |
| Shape points | Named 3D points measured from the photos to support outlines and profiles (215 of them) | [measuring from photos](../40-method/measuring-from-photos.md) |
| Show (live content) | What one screen shows: a source (an app item or a web page) and, for an app item, a view. The scene's `content` holds its sources and shows | [live screen content](../50-implementation/live-screen-content.md) |
| Signature features | Three to five features that make a part recognisable; a modeller writes them down before shaping | [agent process](../40-method/agent-process.md#the-modellers-loop) |
| Single-view | A basis: one sight line from one photo, made to meet an assumed plane (a deck, a symmetry plane). The assumption is stated in the evidence | [filling gaps](../40-method/filling-gaps.md) |
| Skill (Agent Skill) | A folder of instructions (`SKILL.md` plus references) that an agent loads for a kind of task; here `modeling-3d-assets-from-references` | [skills and agents](../80-reference/skills-and-agents.md) |
| Spec | `assets/rig-b/spec/rig.toml`: the component tree, mount frames, joints, reference frames and the check tables | [asset contract](../40-method/asset-contract.md#5-the-spec-specrigtoml) |
| Status plate | What a live screen shows while its page is not showing: *Starting…*, *Not answering*, *Content from <site>* and so on, never something else | [live screen content](../50-implementation/live-screen-content.md) |
| Structure from motion | A method that finds matching features across overlapping photos and solves the cameras and some 3D points together; used once, to seed the cameras | [measuring from photos](../40-method/measuring-from-photos.md) |
| Subagent | An agent started by another agent (here by the coordinator) for one part of the work, with its own brief, returning a report | [agent process](../40-method/agent-process.md) |
| Tier | How much a value matters: critical (changes reach, posture or vision results), layout (clearances, fit, recognition), cosmetic (appearance only) | [filling gaps](../40-method/filling-gaps.md#the-tier-how-much-a-value-matters) |
| Timeline | The file in which every tool and agent appends one line per step with a time stamp and measured seconds | [timeline and performance](../50-implementation/timeline-and-performance.md) |
| Token | The unit in which AI models read and write text (roughly three quarters of a word). Token counts measure how much work an agent did | [timeline and performance](../50-implementation/timeline-and-performance.md#every-agent-run) |
| Tool call | One action by an agent: reading a file, running a command, rendering | [timeline and performance](../50-implementation/timeline-and-performance.md#every-agent-run) |
| Triangle | The smallest piece of a 3D surface; the model's size is counted in triangles (28,070) | |
| Triangulate | Find a point in 3D where sight lines from two photos meet | [measuring from photos](../40-method/measuring-from-photos.md) |
| Two-view | A basis: a point triangulated from two photos whose sight lines meet within a few pixels; the most reliable photo measurement | [filling gaps](../40-method/filling-gaps.md) |
| Use (a live screen) | Operating the page on a screen: double-click it or press *Use*; the view turns to the screen and clicks, drags and keys go to the page until *Done*. Never saved, never seen by others | [live screen content](../50-implementation/live-screen-content.md) |
| Vendor | A class: a value from a maker's published data (monitor size, pedal pitch) | [filling gaps](../40-method/filling-gaps.md) |
| Viewer | The web page that shows the model to people and makes every render for the agents | [viewer](../50-implementation/viewer.md) |
| Viewer report (seen) | What an open browser says each live screen shows (a closed state such as showing or awaiting_click, with the run and view). Agents read it in `content.list` to check a change; it is a report, not proof | [live screen content](../50-implementation/live-screen-content.md) |
| Workspace | The top level of the hierarchy Workspace → Project → Scene: a named collection of projects. (Before 2026-11-27 the word meant one shared scene; that product is retired.) | [workspaces, projects and scenes](../50-implementation/workspaces-projects-scenes.md) |
