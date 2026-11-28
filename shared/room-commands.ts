import { operatorFields } from "./room-person.ts";
import { assessmentCommands } from "./assessment-commands.ts";
// HTTP, the agent guide, and MCP derive their argument contracts from this list.
import type { Schema } from "./commands/schema.ts";
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object", properties, required, additionalProperties: false,
});
const text: Schema = { type: "string", pattern: "\\S", maxLength: 512 };
const id: Schema = { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" };
const number: Schema = { type: "number" };
const version: Schema = { type: "integer", minimum: 0 };
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });
const vector: Schema = { type: "array", items: number, minItems: 3, maxItems: 3 };
const value: Schema = { anyOf: [number, vector] };
const ref = object({ instance: text, member: text }, ["instance", "member"]);
const screenRef = object({ instance: text, screen: text }, ["instance", "screen"]);
const opening = object({ offset: number, width: number }, ["offset", "width"]);
const modes = (names: string[]): Schema => ({ type: "string", enum: names });
// A content block's shape (content.set); its meaning (apps, items, views, addresses, limits) is checked by validateContent.
const word = (maxLength: number): Schema => ({ type: "string", maxLength });
const contentBlock = object({
  sources: { type: "object", additionalProperties: { anyOf: [
    object({ kind: modes(["app"]), app: word(64), item: word(64), label: word(200), run: object({ key: word(16) }, ["key"]) }, ["kind", "app", "item", "label", "run"]),
    object({ kind: modes(["page"]), url: word(2048), label: word(200) }, ["kind", "url", "label"]),
  ] } },
  shows: { type: "object", additionalProperties: { type: "object", additionalProperties: object({ source: word(64), view: word(64) }, ["source"]) } },
}, ["sources", "shows"]);
const hand = nullable({ anyOf: [object({ mode: modes(["rest"]) }, ["mode"]), object({ mode: modes(["point", "touch"]), target: text }, ["mode", "target"])] });
const foot = nullable({ anyOf: [object({ mode: modes(["floor"]) }, ["mode"]), object({ mode: modes(["on"]), target: text }, ["mode", "target"])] });
const aims = object({ look: nullable(text), left_hand: hand, right_hand: hand, left_foot: foot, right_foot: foot });
const tool = (id: string, description: string, inputSchema: Schema, edit = false) => ({ id, description, inputSchema, edit });

export const roomCommands = [
  ...assessmentCommands,
  tool("discover", "Find placements and exact releases by name. Narrow with instance and query for the placed footprint in east/north metres, asset frame, controls and joint values, limits and positive axes in room coordinates. Use an exact release pin to add or swap.", object({ query: text, instance: text })),
  tool("state", "Read the authoritative scene, its revision and the retained edits available for undo.", object({})),
  tool("instances.add", "Place one installed release at its floor anchor. Optional instance supplies a stable ID. x and y are metres; yaw is degrees. Joint seeds are SI.", object({ release: text, instance: id, label: text, x: number, y: number, yaw: number, allowAssumed: {type:"boolean"}, pose: { type: "object", additionalProperties: value } }, ["release"]), true),
  tool("instances.move", "Set the selected instance's x (east), y (north) or yaw (degrees counter-clockwise). Omitted values stay as they are.", object({ instance: text, x: number, y: number, yaw: number }, ["instance"]), true),
  tool("instances.swap", "Replace the pinned release, retaining the instance ID, placement and compatible explicit joint settings.", object({ instance: text, release: text }, ["instance", "release"]), true),
  tool("instances.remove", "Remove an instance. A seated person must first move or leave.", object({ instance: text }, ["instance"]), true),
  tool("pose.set", "Set a single instance joint in metres or radians. A ball joint takes [roll,pitch,yaw]; null clears the explicit value. Set allowAssumed to adjust a modeled joint whose range is assumed.", object({ instance: text, member: text, value: nullable(value), allowAssumed:{type:"boolean"} }, ["instance", "member", "value"]), true),
  tool("pose.apply", "Apply several joint settings on one placement as one undoable edit. Values are metres or radians, or null to restore neutral.", object({ instance: text, values: {type:"object",additionalProperties:nullable(value)}, allowAssumed:{type:"boolean"} }, ["instance","values"]), true),
  tool("person.options", "Read body controls, units, ranges, styles, presets and library postures for the selected host and operator.",object({host:text,sex:operatorFields.sex,style:operatorFields.style},["host"])),
  tool("person.set", "Seat or configure the operator at host (null removes them). Posture selection clears seated targets. Gaze, hand and foot target IDs are local to that host. Omitted aims are preserved and null clears each named aim.", object({ host: nullable(text), ...operatorFields, aims }, ["host"]), true),
  tool("person.measure", "Measure the seated eye's 3D distance to an instance-qualified target in metres.", object({ to: ref }, ["to"])),
  tool("measure.distance", "Measure 3D distance between two posed instance members. Use member 'floor' for either placement anchor.", object({ from: ref, to: ref }, ["from", "to"])),
  tool("measure.clearance", "Measure floor-plan distance from the doorway threshold to this instance's footprint, and the longest unobstructed opening along that threshold across all instances.", object({ instance: text }, ["instance"])),
  tool("lighting.set", "Set the scene's artificial lighting; omitted fields stay. ceiling: a grid of countX × countY ceiling lights (1–8 each) at height metres (null: under the ceiling), intensity 0–3, spread 0 (narrow downlight) to 1 (wide, diffuse), cct colour temperature 2200–8000 K, colour \"#rrggbb\" or null for the colour temperature. screens: their light and glow, on and intensity 0–3. lamps: the assets' own lamps (on, intensity, colour); with instance, only that asset's lamps (null clears its own setting). Viewers show it in their lighting view; values are visual, not lux. live: true for values driven by a simulation: every viewer follows at once, but the change is not an undoable edit and adds no revision (at most 10 a second per scene); omit it for design changes.", object({
    ceiling: object({ on: { type: "boolean" }, countX: { type: "integer" }, countY: { type: "integer" }, height: nullable(number), intensity: number, spread: number, cct: number, colour: nullable({ type: "string", pattern: "^#[0-9a-fA-F]{6}$" }) }),
    screens: object({ on: { type: "boolean" }, intensity: number }),
    lamps: object({ on: nullable({ type: "boolean" }), intensity: nullable(number), colour: nullable({ type: "string", pattern: "^#[0-9a-fA-F]{6}$" }) }),
    instance: text,
    live: { type: "boolean" },
  }), true),
  tool("content.list", "Read live screen content: the installation's apps with their items and views, the allowed sites, the scene's sources with their run ids, every screen of the scene's assets (or of one instance) with size, flat, facing, whether it is offered, what it shows, and what each open viewer reports (seen), plus shows waiting for a removed asset or screen.", object({ instance: text })),
  tool("content.show", "Show one of item (an app item, with app if its id is not unique), url (a web page) or source (one already in the scene) on an instance's flat screens as one undoable edit: with screen (and view for an item) on that screen; without, an item's views go to the largest screens first, then the operator's left to right, and a page to the largest screen; the reply lists assigned, skipped (with why) and unplaced views.", object({ instance: text, screen: text, item: id, app: id, url: { type: "string", maxLength: 2048 },
    source: id, view: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,64}$" } }, ["instance"]), true),
  tool("content.move", "Swap what two screens show, or move a show to a screen that shows nothing, as one undoable edit.", object({ from: screenRef, to: screenRef }, ["from", "to"]), true),
  tool("content.clear", "Give screens back their built-in picture: all of an instance's (also one no longer in the scene), one screen, or every screen showing a source; sources no screen uses any more are removed.", object({ instance: text, screen: text, source: id }), true),
  tool("content.restart", "Start a fresh run of an app source (a new key, so a new run name); undo rejoins the earlier run.", object({ source: id }, ["source"]), true),
  tool("content.set", "Replace the scene's whole content block {sources, shows} in one undoable edit, for example to copy a setup from another scene's state; expectedVersion is required.", object({ content: contentBlock }, ["content"]), true),
  tool("room.set","Set the rectangular room in metres. Door (south) and window (north) offsets measure east from the west wall.", object({ width: number, depth: number, height: number, door: opening, window: opening }), true),
  tool("scene.reset", "Reset the explicit joint settings on one placement or the whole room to their release neutrals. Placement and occupants are preserved. One undo restores all affected settings.", object({instance:text}), true),
  tool("history.list", "Read recent room edits and recorded version numbers, newest first.", object({})),
  tool("undo", "Undo a retained edit by its recorded version, or the latest applicable edit. Disjoint later edits survive.", object({ version }), true),
];

export function roomToolList() {
  return roomCommands.map(({ id, description, inputSchema, edit }) => {
    if (!("type" in inputSchema) || inputSchema.type !== "object") throw new Error("Room tools require object arguments");
    return { name: id.replaceAll(".", "_"), description,
      inputSchema: edit ? { ...inputSchema, properties: { ...inputSchema.properties, expectedVersion: { ...version, description: "Scene version these arguments were based on; detects overlapping changes." } } } : inputSchema };
  });
}
