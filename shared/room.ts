import type { OperatorOptions,OperatorPatch } from "./room-person.ts";
// The scene is Z-up. x grows east, y north, and positive yaw turns east towards north.
// Placement uses the release's declared floor anchor. Joint settings use metres/radians.
import type { ProjectTransfer } from "./project.ts";
import type { PersonState } from "./commands/doc.ts";
import type { JointValue, JointType } from "./pose.ts";
import type { SceneContent, SurfaceInfo } from "./room-content.ts";

export const ROOM_SCHEMA = "synergon-room/1" as const;

export interface RoomOpening { offset: number; width: number }
export interface RoomDimensions {
  width: number; depth: number; height: number;
  door: RoomOpening;   // south wall, offset from west
  window: RoomOpening; // north wall, offset from west
}
export interface RoomInstance {
  id: string;
  label: string;
  release: string;
  x: number; y: number; yaw: number;
  pose: Record<string, JointValue>;
}
export interface RoomPerson { host: string; state: PersonState }
export interface RoomScene {
  schema: typeof ROOM_SCHEMA;
  id: string;
  name: string;
  version: number;
  room: RoomDimensions;
  instances: RoomInstance[];
  person: RoomPerson | null;
  /** The scene's artificial lighting; absent means DEFAULT_LIGHTING. Changed with lighting.set (people, agents, simulations). */
  lighting?: RoomLighting;
  /** What the scene's flat screens show (pages and app views); absent means nothing. Kept, undone, transferred and
   *  compared like `lighting`; a malformed block leaves the scene openable and only makes its screens wait. */
  content?: SceneContent;
}
/** Artificial lighting of a scene, shown when a viewer switches the lighting view on (daylight dimmed). Visual, not lux. */
export interface RoomLighting {
  /** A grid of ceiling lights: countX across the room (east), countY along it (north), at height metres above the floor
   *  (null: just under the ceiling). spread 0 is a narrow downlight, 1 a wide diffuse light. */
  ceiling: { on: boolean; countX: number; countY: number; height: number | null; intensity: number; spread: number; cct: number; colour: string | null };
  /** Lit screens of the assets also light their surroundings. intensity also sets how bright the screens glow. */
  screens: { on: boolean; intensity: number };
  /** The assets' own lamps (a desk's downlights and light strip). colour replaces the lamps' colour when set. */
  lamps: { on: boolean; intensity: number; colour: string | null };
  /** Per placed asset: its lamps' on, intensity and colour, overriding `lamps`. */
  instances?: Record<string, { on?: boolean; intensity?: number; colour?: string | null }>;
}
export const DEFAULT_LIGHTING: RoomLighting = {
  ceiling: { on: true, countX: 3, countY: 2, height: null, intensity: 1, spread: 0.6, cct: 4000, colour: null },
  screens: { on: true, intensity: 1 },
  lamps: { on: true, intensity: 1, colour: null },
};
export const LIGHTING_LIMITS = { count: [1, 8], intensity: [0, 3], spread: [0, 1], cct: [2200, 8000], height: 1.5 } as const;
/** The scene's lighting with every field present. */
export function effectiveLighting(scene: Pick<RoomScene, "lighting">): RoomLighting {
  const l = scene.lighting;
  return { ceiling: { ...DEFAULT_LIGHTING.ceiling, ...l?.ceiling }, screens: { ...DEFAULT_LIGHTING.screens, ...l?.screens },
    lamps: { ...DEFAULT_LIGHTING.lamps, ...l?.lamps }, ...(l?.instances ? { instances: l.instances } : {}) };
}
export interface RoomRef { instance: string; member: string }
export type RoomPoint = [number, number, number];
export interface RoomMember { id: string; label: string; controls?: string[]; kind?: "datum" | "part" | "joint" }
export interface RoomJoint {
  id: string; label?: string; type: JointType; lower: number; upper: number;
  neutral: JointValue; locked?: boolean; assumed?: boolean;
  /** Signed unit axis in the joint mount frame. Ball joints use three angles. */
  axis?: number[] | null;
}
export interface RoomRelease {
  id: string; label: string; kind: "station" | "display" | "desk";
  asset: string; version: string; digest: string; modelUrl: string; manifestUrl: string;
  anchor: RoomPoint; variant?: string; frame?: string;
  members: RoomMember[]; joints: RoomJoint[];
  footprint: { min: [number, number]; max: [number, number] }; seat?: boolean;
  /** An earlier build kept so that scenes pinned to it still open; not offered for new placements. */
  retained?: boolean;
}
export interface RoomCatalog {
  transfer?: ProjectTransfer;
  releases: RoomRelease[];
  /** Positions in the posed asset frame measured from its declared floor anchor. */
  point(instance: RoomInstance, member: string): RoomPoint;
  jointAxesInRoom?(instance: RoomInstance, joints: RoomJoint[]): Record<string,RoomPoint>;
  configureOperator?(instance:RoomInstance, prior:PersonState, patch:OperatorPatch):PersonState;
  operatorOptions?(instance:RoomInstance, state:PersonState):OperatorOptions;
  defaultPerson?(instance: RoomInstance): PersonState;
  eye?(instance: RoomInstance, state: PersonState): RoomPoint;
  /** The release's S_ screens with their posed size, flatness and facing (live screen content). */
  surfaces?(instance: RoomInstance): SurfaceInfo[];
}

export function roomVector(yaw:number, local:RoomPoint): RoomPoint {
  const angle=yaw*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  return [c*local[0]-s*local[1],s*local[0]+c*local[1],local[2]];
}

export function roomPoint(instance: Pick<RoomInstance, "x" | "y" | "yaw">, local: RoomPoint): RoomPoint {
  const [x,y,z]=roomVector(instance.yaw,local);
  return [instance.x+x, instance.y+y, z];
}
