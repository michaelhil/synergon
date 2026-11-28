---
title: The asset contract
tldr: What an asset must satisfy - units, axes, names, parameter records, spec, component modules, materials, GLB, description file, posing and budgets for the rig; and, in section 14, for a character asset (the manikin) - axes, joint names, skins, shape files, compression, budgets and credits.
status: living
updated: 2026-11-28
tags: [contract, format, glb, manifest, parameters]
---

# The asset contract

## TL;DR

- An asset is **source** (`params/*.toml`, `spec/rig.toml`, `src/*.ts`) and **compiled output** (`<asset>.glb` + `<asset>.manifest.json`). Only the source is edited.
- Metres and radians; right-handed; **Z up, X forward, Y to the operator's left**; origin at the centre of the deck's top surface. The GLB's root node converts to glTF's Y-up once.
- Names follow `^(C|J|D|S)_[a-z0-9]+(_([a-z0-9]+|[LR]))*$` and are stable identifiers.
- One definition of joint posing: `shared/pose.ts`. Consumers either import it or reproduce `rest · motion(neutral)⁻¹ · motion(value)`.
- Schema identifiers are `synergon-manifest/1` and `synergon-glb/1`. Items marked **provisional** may change before version 2.
- Sections 1 to 13 are the rig's rules and stay as they are. A **character asset** (the manikin, `assets/manikin/`) follows section 14 instead: glTF's Y-up, game joint names, skins and morphs, committed compressed binaries with checksums.

This page is what tools and later phases bind to. It describes the code as it is (*verified by
reading the code and the built manifest of round 2*). Terms are in the
[glossary](../00-overview/glossary.md).

## 1. Files of an asset

```
assets/<asset>/
  params/devices.toml        purchased parts (maker's data)
  params/<group>.toml        one file per group named in the spec; all must exist
  params/measured.toml       optional; real measurements; read last
  spec/rig.toml              tree, mounts, joints, datums, expected motion, left/right table
  src/<group>.ts             one module per group
  src/lib/<group>-*.ts       optional helpers of a group
  build/<asset>.glb          compiled; not committed
  build/<asset>.manifest.json
```

The asset name is fixed to `rig-b` in `check`, `render`, `serve` and `dist` (**provisional**:
`build` accepts `--asset`, the other tools do not yet).

## 2. Units, axes, origin

| Item | Rule |
|---|---|
| Units | metres, radians everywhere after loading. Parameter files may be written in `m`, `mm`, `cm`, `in`, `rad`, `deg`, or the unitless `1`, `ratio`, `count`; the loader converts once |
| Handedness and axes | right-handed; Z up; X forward, from the operator toward the main display; Y to the operator's left |
| Origin | centre of the platform deck's top surface (z = 0 is the deck top; the room floor is at `D_floor`) |
| Left and right | always the **operator's** left and right |
| Rotations | `rpy` = roll about X, pitch about Y, yaw about Z, composed as `Rz(yaw)·Ry(pitch)·Rx(roll)`; quaternions are written x, y, z, w |
| Component meshes | authored in the component's own frame (the node origin). A moving part's node origin lies on its physical axis of motion |
| glTF | glTF is Y-up. The root node carries the only conversion, rotation quaternion (−0.7071, 0, 0, 0.7071): `x_gltf = x, y_gltf = z, z_gltf = −y`. Every node below the root is in the model frame |

Note for consumers: some engines mirror glTF files on import to fit a left-handed world. The model
is right-handed; check left and right after import (the emergency stop is on the operator's right).

## 3. Names

```
^(C|J|D|S)_[a-z0-9]+(_([a-z0-9]+|[LR]))*$
```

| Prefix | Kind | Carries a mesh |
|---|---|---|
| `C_` | component, or assembly (a component node without a mesh) | components yes, assemblies no |
| `J_` | joint frame | no |
| `D_` | reference frame (datum) | no |
| `S_` | functional surface: the lit area of a screen | yes, with texture coordinates |

- `_L` / `_R` mark the side and may be followed by an index or word: `C_pod_button_L_1`, `J_joy_L_roll`.
- Lower-case letters, digits and underscores only (some importers alter anything else).
- A name is a stable identifier: unique in the asset, equal to `extras.id` in the GLB, never reused
  for something else. Retire a name, do not recycle it.
- The component passed to a module learns its side from the name: `L` if it matches `_L(_|$)`, `R`
  if `_R(_|$)`, otherwise none.

## 4. Parameter records

One record per independent number or list.

```toml
[seat.back_top_z]            # key = <table>.<name>; inline form is equally valid
value = 1.28                 # finite number, or a (nested) list of numbers
unit = "m"                   # m | mm | cm | in | rad | deg | 1 | ratio | count
range = 0.03                 # optional; ± in the same unit; non-negative
class = "photo"              # measured | vendor | photo | assumed | invented
basis = "by_eye"             # optional; user | by_eye | cross_instance | symmetry | convention | standard_default
tier = "critical"            # critical | layout | cosmetic
evidence = "One photo ray on the symmetry plane …"
```

| Rule | Effect |
|---|---|
| `value`, `unit`, `class`, `tier`, `evidence` missing or empty | build stops; every bad record is listed |
| value not numeric, unknown unit, unknown class or tier, negative range | build stops |
| a bare value instead of a record; a table mixing record fields with sub-tables | build stops |
| `assumed` without `basis`; basis not in the list; unknown field | warning |
| a `.toml` file in `params/` that is neither `devices`, a group, nor `measured` | warning, file ignored |
| a group file missing | build stops |
| **Load order** | `devices.toml`, the group files in the order of the spec's `groups`, `measured.toml`. A later record with the same key replaces the earlier one; the manifest notes `replaces` |
| Key prefixes | free: a group file may define keys under any table name (`touchscreen.*` in `pods.toml`) |
| Lists | a list is converted element by element; shape lists should be proportions or coordinates in a stated frame |

How values, ranges and classes are chosen: [Filling gaps](filling-gaps.md).

## 5. The spec (`spec/rig.toml`)

```toml
asset = "rig-b"
title = "Rig B"
groups = ["platform", "seat", "pods", "stand", "pedals"]

[nodes.C_stand_shelf]
parent = "C_stand"                       # exactly one node has no parent: the root
group = "stand"                          # required for every C_ node below the root
label = "Stand shelf"
pos = ["<expr>", "<expr>", "<expr>"]     # pose in the parent, or in the node's last joint frame
rpy = ["0", "stand.shelf_tilt", "0"]
joints = ["J_a", "J_b"]                  # joint frames between parent and node, outermost first
assembly = true                          # the node has no mesh of its own
tags = ["structure"]
# on a D_ node only: the radius of a component about the datum's z axis, written into the description file
profile = { of = "C_joy_lever_L", span = "pods.grip_profile_span", step = "pods.grip_profile_step", hold = "pods.grip_hold_span" }

[joints.J_mon_tilt]
type = "revolute"                        # revolute | prismatic | ball
axis = [0, 1, 0]                         # in the joint frame; not used for ball
pos = ["<expr>", "<expr>", "<expr>"]     # mount frame of the joint in its parent (or previous joint)
rpy = ["0", "0", "0"]
lower = "-stand.monitor_tilt_range"
upper = "stand.monitor_tilt_range"
neutral = "stand.monitor_tilt"           # ball: a list [roll, pitch, yaw]
kind = "adjustment"                      # adjustment | control
evidence = "inferred"                    # seen | inferred | assumed
locked = false
signal = "joy_L.x"                       # required when kind = "control"

[motion]
J_mon_tilt = ["C_stand_monitor", "S_mon_screen"]     # * is a wildcard

[symmetry]
single = ["C_pod_estop_R"]               # ids that exist on one side only
free = ["C_stand_column_L"]              # pairs (by left id) whose positions are not mirrored
```

**Expressions** (`pos`, `rpy`, `lower`, `upper`, `neutral`): arithmetic over parameter keys in SI
units. Operators `+ - * /`, parentheses, unary minus; functions `sin cos tan asin acos atan atan2
sqrt abs min max`; the constant `pi`; list indexing `pods.button_xy_L[2][0]`. The result must be
finite. To move a part, change the parameter, not the spec.

**Validation at load** (build stops otherwise): exactly one root; node names match the pattern and
start with `C_`, `D_` or `S_`; joint names start with `J_`; parents exist and are listed **before**
their children; no parent loops; `pos` and `rpy` have three entries; every joint is defined, used
by exactly one node, has a valid type, kind, evidence and a boolean `locked`, an axis of three
numbers unless it is a ball, a `signal` if it is a control, and an entry in `[motion]`; `[motion]`
lists only joints. When the build evaluates the expressions it also requires `lower ≤ upper` and,
except for ball joints, `lower ≤ neutral ≤ upper`.

## 6. What a component module exports

`assets/<asset>/src/<group>.ts` (the function body is illustrative):

```ts
import type { Ctx, GroupModule } from "../../../generator/assemble.ts";

export const components: GroupModule["components"] = {
  C_stand_shelf: (c: Ctx) => {
    const k = c.kit, [sx, sy] = c.arr("stand.shelf_size"), t = c.p("stand.shelf_thickness");
    return k.part("shell_white", k.translate(k.extrude(k.roundedRectOutline(sx, sy, c.p("stand.shelf_radius"), 8), t), [0, 0, -t]));
  },
};
export const omitted = { C_x: "reason it is left out on purpose" };   // optional
```

| Item | Contract |
|---|---|
| `components` | a function per node id of this group that should have a mesh (`C_` components and `S_` surfaces) |
| Function input `c` | `id`; `side` (`"L"`, `"R"`, `null`); `sy` (+1 for left and unsided, −1 for right); `p(key)` a number; `arr(key)` a list; `kit` the geometry kit |
| Function output | one `Part` or a list: `{ material, mesh }` with `mesh = { positions, normals, uvs?, indices }` in the component's own frame |
| Materials | a key of the palette (section 7); anything else stops the build |
| Merging | parts of one component with the same material are merged; **each remaining part is one draw primitive** |
| Surfaces | every part of an `S_` node needs texture coordinates in 0–1 (`kit.sheet`, `kit.arcSheet`): u = 0 at the operator's left (+Y), v = 0 at the top; the face looks toward −X in its own frame. Every `S_` surface is also a target for [live screen content](../50-implementation/live-screen-content.md): its size, flatness (thinner than 2 mm) and facing come from the mesh and the posed node frame, and in step 1 only flat surfaces not facing up are offered |
| Left and right | write the left part and mirror the **mesh** (`kit.mirrorY`) for the right; frames are never mirrored |
| Numbers | no dimensions in code; read them with `c.p` / `c.arr`. Every read is recorded against the component (a surface's reads count toward its parent component; reads by the node's mount and joint expressions count too) |
| `omitted` | id → reason. A node with neither a function nor a reason is reported "missing" and fails `check` and `dist` |
| Mesh validity, checked at build for every part | finite positions and texture coordinates; at least one triangle; normals of unit length (±0.001); indices in range; no zero-area triangle; no triangle wound against its normals; not collapsed to a line or point |
| Partial builds | `--only <group>` imports only that group's module; the frame tree, joints and datums are still built from the spec |

The kit's operations are listed in `generator/README.md` (box, rounded box, cylinder, tube, sphere,
extrude, revolve, loft, arc sweep, tube along a path, faceted cage, prism, screen sheets, outlines,
transforms). Kit primitives sit on z = 0 and grow upward, centred in x and y.

**Lamps.** A component function may also return lamps with `c.kit.lamp({...})` beside its parts: a `spot` (position,
direction, half beam angle, soft edge) or a `strip` (a lit rectangle of a length and width facing a direction), each
with a colour (`c.kit.cctColour(kelvin)`) and a relative visual brightness (1 = a typical desk downlight). Their numbers
are parameter records like any other (beam, colour temperature: usually assumed; brightness: invented, cosmetic). The
viewer turns them into real lights; they show the character of the light, not lux.

## 7. Materials palette

Defined in `generator/materials.ts`; colours are written in sRGB and converted to linear values in
the GLB. **As of round 2** (values were retuned once after the first review):

| Key | Colour (sRGB) | Metallic | Roughness | Use |
|---|---|---|---|---|
| `shell_white` | `#f1f1ee` | 0 | 0.42, clearcoat 0.25 (roughness 0.3) | moulded shells, rim, columns, shelf, monitor arm |
| `leather_black` | `#2a2b2f` | 0 | 0.60 | upholstery: cushions, armrest pads, headrest |
| `plastic_black` | `#141516` | 0 | 0.82 | plates, housings, grips, pedal frame |
| `panel_dark` | `#2a2d33` | 0 | 0.75 | dark inset panels |
| `deck_dark` | `#1f2228` | 0 | 0.85 | deck panels |
| `rubber_black` | `#0c0c0d` | 0 | 0.97 | bellows, pedal pads |
| `metal_dark` | `#3a3c40` | 1 | 0.58 | dark metal: mechanisms, pedal arms |
| `metal_bright` | `#c9cbd0` | 1 | 0.28 | bezels, key switch |
| `glass_black` | `#050506` | 0 | 0.30 | screen bezels, unlit glass |
| `estop_red` | `#c8171b` | 0 | 0.40 | emergency stop head |
| `estop_yellow` | `#e9bd16` | 0 | 0.50 | emergency stop base |
| `screen_main` | black, emissive image 1024 × 256 px | 0 | 0.60 | main monitor's lit area |
| `screen_touch` | black, emissive image 512 × 256 px | 0 | 0.60 | touchscreen's lit area |

The two screen images are generated by code (neutral tiles, no photo content, no text) and embedded
as PNG. No logos, decals or text anywhere on the model.

## 8. The GLB

| Aspect | Convention |
|---|---|
| Container | binary glTF 2.0, one file, one buffer; `asset.generator = "synergon generator"`; `asset.extras = { asset, schema: "synergon-glb/1", frame }` |
| Scene | one scene, one root node (`C_rig`) |
| Nodes | one node per component, assembly, joint frame, reference frame and surface; `name` = id; only `translation` and `rotation` are used (no scale, no matrix); zero translation and identity rotation are omitted |
| Hierarchy | parent → joint frames (outermost first) → node. A joint is a node, not an animation or skin |
| Stored pose | every joint at its `neutral` value. Controls neutral; adjustments as photographed |
| Meshes | at most one mesh per node, named `<id>__mesh`; one primitive per material; triangles (`mode` 4); attributes `POSITION`, `NORMAL`, and `TEXCOORD_0` only where the part has texture coordinates; indices 16-bit, or 32-bit above 65,535 vertices |
| Materials | named by palette key; metallic-roughness model; `KHR_materials_clearcoat` on `shell_white` (listed in `extensionsUsed`); screens have `emissiveTexture` with factor 1 |
| Textures | PNG, embedded; linear filtering with mipmaps; clamped |
| Precision | positions, normals, texture coordinates and translations rounded to 1e-6, quaternions to 1e-7, stored as 32-bit floats |
| Determinism | no timestamps, no random identifiers: the same source gives the same bytes |
| Not used | animations, skins, cameras, lights, Draco or meshopt compression, multiple scenes |

`extras` on each node:

| Node kind | `extras` |
|---|---|
| component, assembly, surface | `{ id, kind: "component" \| "surface", group, class, label, assembly?: true }` |
| joint | `{ id, kind: "joint", joint: { type, axis, lower, upper, neutral, unit, kind, evidence, locked, signal } }` |
| reference frame | `{ id, kind: "datum", label }` |
| a component with lamps | the component's extras plus `lamps: [{ kind: "spot" \| "strip", at, dir, colour, intensity, angle?, penumbra?, length?, width? }]` in the node's frame (metres, Z up) |

A consumer that reads only the GLB can therefore find and pose every joint without the manifest.

## 9. The description file (`<asset>.manifest.json`)

Schema `synergon-manifest/1`. Types are in `shared/manifest.ts`. All positions, boxes and axes are in
the model frame at the neutral pose.

| Field | Type | Content |
|---|---|---|
| `schema` | string | `"synergon-manifest/1"` |
| `asset`, `title` | string | asset id (`rig-b`) and display title |
| `conventions` | object of strings | plain-language statements of `units`, `frame`, `gltf`, `names`, `joints`, `positions`, `classes` |
| `build` | `{ partial, only }` | `partial` is true for an `--only` build; `only` lists the groups built |
| `groups` | string[] | group names, in spec order |
| `components` | object[] | every `C_` node, assemblies and root included (53 as of round 2); see below |
| `surfaces` | object[] | every `S_` node, same record shape with `kind: "surface"` (2) |
| `joints` | object[] | every joint (20); see below |
| `datums` | object[] | every `D_` node (23 since 2026-11-25): `id`, `parent`, `label`, `origin`, `x_axis`, `z_axis`; where the spec gives a `profile`, also `profile` ([t, radius] pairs: the named component's mesh cut across the datum's z axis, t from its origin; the grip handles') and `hold` (a parameter list copied beside it); where it gives a `surface`, also `surface` ([x, height, y from, y to]: how far the named component stands out along the datum's z at each x within `band` along y, the y range where it stands within `edge` of that height; the pods' inner sides), `band` and `edge` |
| `motion` | object | the spec's expected-motion table, unchanged |
| `omitted` | `{ id, reason }[]` | components left out on purpose (empty as of round 2) |
| `missing` | string[] | nodes with neither mesh nor reason; must be empty |
| `not_built` | string[] | nodes skipped by a partial build |
| `materials` | object | per palette key: `color` (sRGB, 3 numbers), `metallic`, `roughness`, `note`. The whole palette, used or not; clearcoat and texture are **not** listed here (**provisional**) |
| `parameters` | object | every resolved record by key (303); see below |
| `parameter_class_counts` | object | records per class |
| `parameters_unused` | string[] | keys read by nothing |
| `totals` | object | `triangles`, `vertices`, `primitives`, `nodes`, `meshes`, `materials`, `textures`, `bbox { min, max }` |
| `glb` | object | `file`, `bytes`, `sha256` of the GLB written with this manifest |

Component and surface record:

| Field | Content |
|---|---|
| `id`, `kind` | node id; `"component"` or `"surface"` |
| `group` | group name; `null` for the root |
| `parent` | parent **node** id (joint frames in between are not named here); `null` for the root |
| `label` | plain label from the spec |
| `tags` | tags from the spec (**provisional** vocabulary; see [Decomposition](decomposition.md)) |
| `assembly` | true if the node has no mesh by design |
| `class` | least certain class among the non-cosmetic parameters the node reads; `null` if it reads none |
| `class_counts` | number of parameters read, per class |
| `params` | sorted keys of the parameters read |
| `triangles`, `primitives`, `materials` | size of its mesh; palette keys, one per primitive |
| `bbox` | `{ min, max }` of its mesh; `null` without a mesh |
| `origin` | position of the node origin |

Joint record:

| Field | Content |
|---|---|
| `id`, `node` | joint id; name of its node in the GLB (the same) |
| `parent` | the node, or the previous joint of the chain, that this joint frame hangs on |
| `child` | the node that this joint chain carries |
| `type` | `revolute`, `prismatic` or `ball` |
| `axis` | unit vector in the joint frame; `null` for a ball |
| `lower`, `upper` | limits; for a ball, how far each of roll, pitch, yaw may deviate from its neutral |
| `neutral` | value stored in the GLB; a number, or `[roll, pitch, yaw]` for a ball |
| `unit` | `"rad"` or `"m"` |
| `kind` | `adjustment` (set up before use) or `control` (moved during use) |
| `evidence` | `seen`, `inferred` or `assumed` |
| `locked` | true: a script may not move it without `force` |
| `signal` | stable name a simulator binds to; `null` for adjustments |
| `rest` | `{ t, q }`: the stored node transform in its parent frame, at neutral |
| `origin` | position of the joint frame |

Parameter record: `key`; `value` (SI); `unit` (`m`, `rad` or `1`); `given` and `given_unit` (as
written in the file); `range` (SI, optional); `class`; `basis` (optional); `tier`; `evidence`;
`source` (file name); `replaces` (file whose record this one replaced, optional).

## 10. Three kinds of variable

| Kind | Example | Where it lives | To change it |
|---|---|---|---|
| Design parameter | deck length, column spacing, monitor curvature, a shell outline | parameter record; baked into geometry and mount frames | edit the record, rebuild (0.13 s) |
| Adjustment | seat slide, monitor height and tilt, armrest pad position | joint with `kind: "adjustment"`; its limits and neutral are parameters | pose the joint node; no rebuild. Changing limits or the photographed value is a design-parameter change |
| Runtime control | joystick deflection, pedal travel | joint with `kind: "control"` and a `signal` name | pose the joint node from the signal |

Not yet in the contract (**provisional**, planned): on/off and lit states of buttons, key switch and
emergency stop (they are nodes without joints or state today); named poses stored with the asset.

## 11. The shared pose definition

`shared/pose.ts` is the single definition, imported by the generator (to write the GLB at neutral)
and by the viewer (to pose).

```
joint node transform(value) = mount · motion(value)
mount          = pose(pos, rpy) of the joint frame in its parent
motion(value)  = revolute:  rotation about axis by value, right-hand rule
                 prismatic: translation along axis by value
                 ball:      Rz(yaw)·Ry(pitch)·Rx(roll), value = [roll, pitch, yaw]

to pose a loaded GLB:   transform(value) = rest · motion(neutral)⁻¹ · motion(value)
limits:                 lower ≤ value ≤ upper;  ball: lower ≤ valueᵢ − neutralᵢ ≤ upper for each i
```

For revolute and prismatic joints `motion(neutral)⁻¹ · motion(value)` equals `motion(value −
neutral)`. For a ball joint it does not in general; use the formula above. (The manifest's
`conventions.joints` sentence describes the short form and is imprecise for ball joints; the code
and this page are authoritative.)

**Conformance test.** `tools/glb_inspect.py` is a second implementation in Python that shares no
code with the generator. On every `bun run check` it poses each joint at five values (lower, upper,
neutral, 37 % and 81 % of the range; three values for a ball), 96 poses in all as of round 2, and
its 3 × 4 matrices must agree with `shared/pose.ts` within 2e-6 (largest difference seen: 2.4e-8).
A third consumer must pass the same comparison.

## 12. Budgets

Enforced by `bun run check` (C-14, C-18, C-19):

| Quantity | Limit | As of round 2 |
|---|---|---|
| Triangles, whole asset | ≤ 150,000 | 28,042 |
| GLB size | ≤ 4 MB | 0.72 MB |
| Draw primitives in the GLB | ≤ 80 | 67 |
| Draw calls of a still default view in the viewer | ≤ limit + 2 | 68 |
| Frame rate at 1600 × 1000, headless | ≥ 55 fps (warning below) | 60 fps (the display rate caps it) |
| Build time | "well under 5 s" (brief) | 0.13–0.2 s |

## 13. What is provisional

| Item | Why it may change |
|---|---|
| `D_eye_provisional` | an alias of `D_eye_median`, kept for older references; remove at version 2 |
| Tag vocabulary | nine flat words; an assessment phase will need role, body part, priority |
| Screen surfaces | their normal, size and curvature are in the parameters, not in dedicated manifest fields |
| States of buttons, key switch, emergency stop; named poses | not modelled |
| `materials` in the manifest | no clearcoat or texture information |
| Asset name | hard-wired as `rig-b` outside `build` |
| Evidence for `photo` values | free text; a link to a measurement record is planned |
| `evidence: assumed` ⇒ `locked: true` | true in the data, not enforced by the spec loader |
| Per-component mesh export (OBJ) and batch export of frames for many poses | planned for assessment tools; not implemented |

## 14. Character assets (the manikin)

The manikin is a second kind of asset: a skinned, morphed character in glTF's own frame, built on a Mac in the avatar
lab and committed as compressed binaries (the owner's decision 3 of 2026-11-25). Sections 1 to 13 do not apply to it;
this section does. Where the lab's package format (`work/avatar-lab/FORMAT.md` v0.5) and this section differ, this
section is the product's rule. Who builds what: [tools/manikin-build/README.md](../../tools/manikin-build/README.md);
the libraries and the choice behind it: [Manikin approaches](manikin-approaches.md).

### 14.1 Files

```
assets/manikin/
  CREDITS.md                       every third-party part, its author and licence; the CC-BY credit line to show
  params/packaging.toml            compression settings and budgets (records as in section 4); owner: packing
  params/runtime*.toml             the viewer's run-time numbers; owner: the viewer
  operator-m/, operator-f/         the dressed operator (VD/REVIEW-10), one per sex
    <name>.avatar.json             the manifest (lab format v0.4/0.5, plus tones, encoding, provenance, packaging)
    <name>.glb                     skeleton, skinned meshes, GPU morph targets, materials, the default tone's textures
    <name>.shape.bin               the body's shape file;  <name>.wear.shape.bin: garments', props' and hair's
    maps/mask_*.png, cover_*.png   body-hide masks and cover maps (PNG: the viewer combines them on a canvas)
    maps/*.ktx2                    the posed fold map of the seated trousers
    tones/<tone>/*.ktx2            what another skin tone replaces (skin albedo, skin ORM, lash and brow texture)
    poses.json, PROVENANCE.json
  clay-m/, clay-f/                 the clay figure (VD/REVIEW-08), one per sex: manifest, GLB, shape file, poses
  clips/m/<person>/<clip>.glb      motion clips baked per packet person, shared by operator-m and clay-m (f the same)
  shared/maps/*.ktx2               the fabric weave detail maps both sexes use
```

Every path inside a manifest is relative to the manifest. A package's `PROVENANCE.json` lists every file it uses (its
own and `../shared/...`) with bytes and SHA-256, the lab package and repository revision it came from with the
checksums of the lab files read, its sources with licences, the build and pack commands and settings, and its
budget reading. Nothing else may be in a package folder, and nothing may be a symbolic link.

### 14.2 Units, axes and the rotation into the rig

| Item | Rule |
|---|---|
| Units | metres; joint rotations in the manifest's `dofs` in degrees (lab format) |
| Axes | glTF's: **+Y up, +Z the way the character faces, +X the character's left**; right-handed |
| Origin | between the feet: soles on y = 0 (the dressed packages are lifted by the 28 mm shoe sole, `rest.soleHeight`), pelvis on x = z = 0 in the rest pose |
| Rest pose | the authored A-pose (`rest.pose`, `rest.note`); unit scale on every joint |
| Into the rig's model frame (Z up, X forward, Y to the operator's left; section 2) | `x_rig = z_char`, `y_rig = x_char`, `z_rig = y_char`: a rotation of 120° about (1, 1, 1), quaternion (x, y, z, w) = (0.5, 0.5, 0.5, 0.5); then a translation to the seat |
| In the viewer's Y-up world, under the rig's root node (which turns the rig's Z-up into Y-up, section 8) | a rotation of +90° about +Y, quaternion (0, 0.7071, 0, 0.7071): the character's +Z (forward) becomes +X (the rig's forward), its +X (left) becomes −Z (the rig's left) |

Left and right are the character's own; seated in the rig they are the operator's (section 2), the same side.

### 14.3 Joint names

One skeleton per package, shared by every skinned mesh: **102 joints**, Unreal-mannequin names in lower case with
sides `_l` / `_r`, unique across joints, meshes and materials (three.js renames duplicates).

| Group | Joints |
|---|---|
| Trunk and head | `root`, `pelvis`, `spine_01` … `spine_05`, `neck_01`, `neck_02`, `head` |
| Arms (each side) | `clavicle`, `upperarm`, `lowerarm`, `hand`; fingers `thumb_01…03`, `index_metacarpal`, `index_01…03`, and the same for `middle`, `ring`, `pinky` |
| Legs (each side) | `thigh`, `calf`, `foot`, `ball` |
| Twist joints (driven, never animated) | `upperarm_twist_01`, `_02`, `lowerarm_twist_01`, `_02`, `thigh_twist_01`, `_02`, `calf_twist_01`, `_02` on each side, at about one and two thirds of the segment; the manifest's `drivers` (type `twist`) say how |
| Helper joints (driven, 16) | `knee_front`, `glute`, `hip_belly`, `groin`, `armpit_chest`, `armpit_arm`, `shoulder_front`, `lap_thigh` on each side: they hold volume where skin folds |
| Eyes | `eye_l`, `eye_r`, and the lids `eyelid_upper_l`, `eyelid_lower_l`, `eyelid_upper_r`, `eyelid_lower_r` (the manifest's `eyes` block) |

The manikin uses none of the rig's `C_/J_/D_/S_` names. The degrees of freedom a person can be posed by are the
manifest's `dofs` (ids such as `shoulder_l.flex`, `elbow_r.flex`); clinical angles map onto them by `packet.angles`.

### 14.4 Skins

| Attribute | Content |
|---|---|
| `JOINTS_0`, `WEIGHTS_0` | a complete four-influence set (a least-squares fit), for any glTF reader; three.js renormalises it |
| `_JOINTS8_0`, `_JOINTS8_1` (unsigned byte), `_WEIGHTS8_0`, `_WEIGHTS8_1` (float) | **the eight influences** the viewer skins with, in every pass; the eight weights of a vertex sum to exactly 1 |
| `_DQS` (float, 0 … 1) | the dual-quaternion mask: 0 linear blending, 1 dual-quaternion skinning, mixed in between (shoulders, hips, knees, wrists, twist zones); garments and shoes carry the mask of the body under them |
| `_SRC` (float, integer values) | on every mesh whose shape is baked on the CPU: the row of its vertex in the shape file (vertices split at UV seams share a row) |

Rest transforms are translation and rotation only; at most 256 joints (`JOINTS_0` stays unsigned byte).

### 14.5 Morph targets and shape data

- **Body shape is baked on the CPU** from the shape files when a body control moves (manifest `shape.bake`): positions
  and normals of the listed meshes are rewritten, normals on the source topology. 40 shape components per sex,
  driven by `shape.model` from the survey controls (`shape.controls`; stature, weight and 36 more dimensions);
  joints follow by `shape.jointDeltas`; read-backs are `shape.measures`. Control and measure ids are the lab's
  (`eyeheightsitting`, `buttockkneelength`, `poplitealheight`, …) and must not be renamed: the rig binding reads them.
- **Shape files** (`encoding: "meshopt"` in the bake entry): two meshopt vertex streams. `base` (`stride` 12): float32
  x, y, z per row. `deltas` (`stride` 8): int16 x, y, z and a zero per row, all rows of target 0, then target 1, and so
  on. Decode each with `MeshoptDecoder.decodeGltfBuffer(target, count, stride, bytes, "ATTRIBUTES")`; a delta in metres
  is `int16 / 32767 × targetScale[k]`, as in the lab's uncompressed layout (`quantisation` gives the step: 0.02 mm for
  the body, 0.04 mm for garments, props and hair).
- **GPU morph targets** are left to what the CPU bake does not cover: pose correctives `pc_*` (the clay figure's wrists),
  the trousers' cloth correctives `cloth_trousers_*` (driven by the manifest's `clothCorrectives`), and the shape
  components `pc00` … `pc39` of the meshes the bake does not list (eyeballs, tear line, lashes, the clay figure's shoe
  last). Names in `mesh.extras.targetNames`; at most 40 per mesh.

### 14.6 Materials, tones and styles

- The material name selects the viewer's recipe, as in the lab: `skin*`, `eye*`, `lashes*`, `hair*`, `cloth*`,
  `prop*`, `glasses*`, `clay*`; the manifest's `materials` block holds what glTF cannot say (skin micro-normal, iris
  colours, cloth detail maps and their scale, clear coat).
- Textures are KTX2 (`KHR_texture_basisu`): colour maps ETC1S (sRGB), normal maps and the props' occlusion-roughness-
  metal maps UASTC (linear), occlusion-roughness maps without metal ETC1S; mipmaps in the file, box-filtered. Masks
  and covers stay PNG.
- **Tones** (`tones` block, dressed packages): one geometry, three skin tones (`light` the default, `medium`, `dark`).
  A tone names the KTX2 files that replace a texture (`"<material>.<slot>"` → file; none for the default tone, whose
  textures are the GLB's), the complete manifest entries of the materials it changes (replace, do not merge), and the
  glTF factors that differ (`gltfMaterials`, given for every tone, the default included).
- **Styles**: a dressed package has one style, `dressed`; the clay figure is its own package (`clay-<sex>`, style
  `clay`) on the same skeleton, joint names, dofs and shape controls, so a switch keeps pose and body. The lab's copy
  of the clay style inside the dressed packages is left out.
- One outfit, as the designer passed it: work shirt, work trousers, safety trainer and cap always worn; glasses and
  headset optional; the collar band (in the lab merged into the trainer's mesh, one draw call fewer); the women's hair under the cap. Colourways are factors on neutral
  textures. Nothing outside this set is packaged.

### 14.7 Compression

Geometry: `EXT_meshopt_compression` without filters; every attribute keeps its lab data type (the viewer reads and
rewrites positions, normals, `_SRC`, `_DQS` and the eight-influence weights in JavaScript); values are rounded onto
power-of-two grids first (positions 2⁻¹⁶ m, the grids in `packaging.toml`). No `KHR_mesh_quantization`: it folds a
transform into the inverse bind matrices, which the viewer recomputes when the body shape changes. Vertices are in
fetch order (the manifest's vertex indices, `clothCorrectives.girth.probe`, are renumbered with them), triangles of
opaque meshes in vertex-cache order. Clips: meshopt with the quaternion filter (16 bits) and the exponential filter
(20 bits) for root and pelvis translation. The viewer needs three's `MeshoptDecoder` and `KTX2Loader` with the basis
transcoder (`basis_transcoder.js`, `.wasm`).

### 14.8 Budgets

Checked by `bun run check` (`tools/manikin-check.ts`) against `assets/manikin/params/packaging.toml`:

| Quantity | Limit | As packed, 2026-11-25 |
|---|---|---|
| First person's download (dressed man, light tone), as the server sends it | ≤ 10 MB | 9.33 MB (9.60 MB on disk) |
| Any other person | ≤ 10 MB | dressed woman 9.66 MB; clay man 5.19 MB, clay woman 5.20 MB |
| Another tone | ≤ 2 MB | 0.70–0.74 MB |
| Motion clips of one sex, all | ≤ 8 MB, one clip loaded when played | men 2.99 MB (32 files), women 2.14 MB (26) |
| Triangles of the most an outfit can draw | ≤ 120,000 | 72,771 (dressed man), 74,544 (woman), 112,574 / 112,736 (clay) |
| Draw calls of the same | ≤ 12 | 11, 12, 4, 4 |
| GPU texture memory per outfit, upper bound | ≤ 128 MB | 41.9 MB, 43.8 MB (the lab's uncompressed packages: 106 and 113 MB) |

### 14.9 Credits and checks

The work shirt and the work trousers are CC BY 4.0 and must be credited wherever the dressed manikin is shown (the
line is in `CREDITS.md`); the motion clips carry the CMU motion-capture terms and credit line. `bun run check` fails
on: a file that differs from its `PROVENANCE.json` checksum, or is unlisted, or is a symbolic link; a manifest naming
a missing file; a budget broken; a glTF validator error or warning the provenance does not accept as inherited from
the lab; a package or source without a licence, or a CC-BY author missing from `CREDITS.md`; a banned name in any file
or file name, binaries included. The committed binaries are exempt from the determinism check (section 8): they are
built on a Mac from the lab and are verified by checksum instead of rebuilt.
