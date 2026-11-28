// One parsed file per installed pin. Model nodes and materials belong to placements; geometry and textures belong to the file.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { nodesFromGlb, type KNode } from "../../shared/kinematics.ts";
import type { Manifest } from "../../shared/manifest.ts";
import { poseFromRest, type JointValue, type Trs } from "../../shared/pose.ts";
import type { RoomInstance, RoomLighting, RoomRelease } from "../../shared/room.ts";

export interface RoomAsset { source: THREE.Group; manifest: Manifest; nodes: KNode[] }
/** What a screen sheet draws: its built-in picture, a depth-correct hole for the live page under the canvas, or a
 *  status plate (the sheet's own material with the plate as its glowing picture, so the screen glow and lamps apply). */
export type ScreenLook = "builtin" | "hole" | { plate: THREE.Texture };
/** One hole material for every live screen: colour 0, alpha 0, written without blending, with depth (Appendix D). */
const HOLE = new THREE.MeshBasicMaterial({ color: 0, opacity: 0, transparent: false, blending: THREE.NoBlending, depthTest: true, depthWrite: true });
HOLE.name = "live-hole";
/** The material a mesh had before live content changed it (selection, plan colours and display modes read this). */
const own = (mesh: THREE.Mesh) => (mesh.userData.liveOriginal ?? mesh.material) as THREE.Material | THREE.Material[];
const ownList = (mesh: THREE.Mesh) => { const m = own(mesh); return Array.isArray(m) ? m : [m]; };
export interface PlanPart { id: string; path: string; fill: string; top: number }

export async function loadRoomAsset(release: RoomRelease): Promise<RoomAsset> {
  const [model, description] = await Promise.all([fetch(release.modelUrl), fetch(release.manifestUrl)]);
  if (!model.ok || !description.ok) throw new Error(`Cannot load ${release.label} ${release.version} (${model.status}/${description.status}).`);
  const [data, manifest]: [ArrayBuffer, Manifest] = await Promise.all([model.arrayBuffer(), description.json()]);
  if (crypto.subtle) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== manifest.glb.sha256) throw new Error(`Geometry and manifest disagree for ${release.label} ${release.version}.`);
  }
  const parsed = await new GLTFLoader().parseAsync(data, new URL(".", new URL(release.modelUrl, location.href)).href);
  return { source: parsed.scene, manifest, nodes: nodesFromGlb(new Uint8Array(data)) };
}

export function disposeRoomAsset(asset: RoomAsset) {
  const materials = new Set<THREE.Material>(), geometry = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>();
  asset.source.traverse(o => {
    if (o instanceof THREE.Mesh) {
      geometry.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) materials.add(mat);
    }
  });
  for (const mat of materials) {
    for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    mat.dispose();
  }
  for (const g of geometry) g.dispose();
  for (const t of textures) t.dispose();
}

// Project the visible sides of the actual triangles. Adjacent triangles with opposite
// directed edges cancel. The remaining contours preserve concavities, holes and separate
// solids in a mesh primitive. Nonzero winding fills overlapping surfaces on the drawing.
function planProjection(mesh: THREE.Mesh, matrix: THREE.Matrix4): {path:string; top:number} {
  const xyz = mesh.geometry.attributes.position, index = mesh.geometry.index;
  const v = new THREE.Vector3(), xs = new Float64Array(xyz.count), ys = new Float64Array(xyz.count);
  const keys: string[] = [], coordinates = new Map<string,string>();
  let top = -Infinity;
  for (let i=0;i<xyz.count;i++) {
    v.fromBufferAttribute(xyz,i).applyMatrix4(matrix);
    xs[i]=v.x; ys[i]=-v.z; top=Math.max(top,v.y);
    const key=Math.round(v.x*1e6)+","+Math.round(-v.z*1e6);
    keys.push(key);
    coordinates.set(key,v.x.toFixed(4)+","+(-v.z).toFixed(4));
  }
  const edges=new Map<string,Map<string,number>>();
  const consume=(from:string,to:string) => {
    const next=edges.get(from)!, count=next.get(to)!;
    if (count===1) { next.delete(to); if (!next.size) edges.delete(from); }
    else next.set(to,count-1);
  };
  const edge=(from:string,to:string) => {
    if (from===to) return;
    if (edges.get(to)?.has(from)) { consume(to,from); return; }
    let next=edges.get(from);
    if (!next) edges.set(from,next=new Map());
    next.set(to,(next.get(to) ?? 0)+1);
  };
  for (let i=0;i<(index?.count ?? xyz.count);i+=3) {
    const a=index?index.getX(i):i, b=index?index.getX(i+1):i+1, c=index?index.getX(i+2):i+2;
    if ((xs[b]-xs[a])*(ys[c]-ys[a])-(ys[b]-ys[a])*(xs[c]-xs[a])<=1e-11) continue;
    edge(keys[a],keys[b]); edge(keys[b],keys[c]); edge(keys[c],keys[a]);
  }
  const paths:string[]=[];
  while (edges.size) {
    const first=edges.keys().next().value!;
    let from=first;
    const points=[coordinates.get(first)!];
    do {
      const to=edges.get(from)?.keys().next().value;
      if (to===undefined) break;
      consume(from,to); from=to;
      if (from!==first) points.push(coordinates.get(from)!);
    } while (from!==first);
    if (points.length>=3) paths.push("M"+points.join("L")+"Z");
  }
  return {path:paths.join(""),top};
}

export class PlacedAsset {
  readonly holder = new THREE.Group();
  readonly modelFrame = new THREE.Group();
  readonly model: THREE.Group;
  readonly parts: THREE.Mesh[] = [];
  readonly objects = new Map<string, THREE.Object3D>();
  /** Real lights made from the lamps the model's nodes declare (generator/kit.ts LampSpec). */
  readonly lamps: THREE.Light[] = [];
  /** Area lights in front of the lit screens, and the screens' glowing materials. */
  readonly screenLights: THREE.RectAreaLight[] = [];
  private readonly screenGlow: THREE.MeshStandardMaterial[] = [];
  /** Lamp surfaces (materials named light_*) whose glow follows a lamp colour set in the scene's lighting. */
  private readonly lampGlow: THREE.MeshStandardMaterial[] = [];
  readonly rest = new Map<string, Trs>();
  planParts: PlanPart[] = [];
  private poseKey?: string;
  private planKey?: string;
  private projections=new Map<THREE.Mesh,{matrix:THREE.Matrix4;part:PlanPart}>();

  constructor(readonly asset: RoomAsset, readonly release: RoomRelease, readonly id: string) {
    this.model = asset.source.clone(true);
    this.holder.name = id;
    this.holder.add(this.modelFrame);
    this.modelFrame.add(this.model);
    const [x, y, z] = release.anchor;
    this.modelFrame.position.set(-x, -z, y);
    this.model.traverse(o => {
      if (o.userData.id) this.objects.set(o.userData.id, o);
      if (!(o instanceof THREE.Mesh)) return;
      let member: THREE.Object3D | null = o;
      while (member && !["component", "surface"].includes(member.userData.kind)) member = member.parent;
      o.userData.roomMember = member?.userData.id ?? o.name;
      o.userData.roomInstance = id;
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      o.castShadow = true;
      o.receiveShadow = true;
      this.parts.push(o);
    });
    for (const node of this.objects.values()) for (const spec of (node.userData.lamps ?? []) as LampSpec[]) {
      const light = makeLamp(spec);
      if (light) { light.userData.base = light.intensity; light.userData.colour = light.color.clone(); node.add(light); this.lamps.push(light); }
    }
    for (const mesh of this.parts) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      if (/^light_/.test(m.name)) { m.userData.lampEmissive = m.emissive.clone(); this.lampGlow.push(m); }
      if (!m.emissiveMap) continue;
      // a lit screen: an area light of its size in front of it, facing where the screen faces
      m.userData.glow = m.emissiveIntensity; this.screenGlow.push(m);
      const light = screenLight(mesh);
      if (light) { mesh.add(light); this.screenLights.push(light); }
    }
    for (const j of asset.manifest.joints) {
      const o = this.objects.get(j.id);
      if (o) this.rest.set(j.id, { t: o.position.toArray(), q: o.quaternion.toArray() });
    }
  }

  apply(i: RoomInstance,project=true) {
    this.holder.position.set(i.x, 0, -i.y);
    this.holder.rotation.y = THREE.MathUtils.degToRad(i.yaw);
    const nextPose = JSON.stringify(i.pose);
    if (this.poseKey !== nextPose) {
      this.poseKey = nextPose;
      this.pose(i.pose);
    }
    if (project && this.planKey!==nextPose) {
      this.planParts=this.plan();
      this.planKey=nextPose;
    }
  }

  private pose(values: Record<string, JointValue>) {
    for (const joint of this.asset.manifest.joints) {
      const o = this.objects.get(joint.id), rest = this.rest.get(joint.id);
      if (!o || !rest) continue;
      const trs = values[joint.id] === undefined ? rest : poseFromRest(rest, joint, values[joint.id]);
      o.position.fromArray(trs.t);
      o.quaternion.fromArray(trs.q);
    }
  }

  private plan(): PlanPart[] {
    this.holder.updateWorldMatrix(true, true);
    const inverse = this.holder.matrixWorld.clone().invert(), mat = new THREE.Matrix4();
    return this.parts.map(mesh => {
      mat.multiplyMatrices(inverse, mesh.matrixWorld);
      const cached=this.projections.get(mesh);
      if (cached?.matrix.equals(mat)) return cached.part;
      const projected = planProjection(mesh,mat);
      const source = ownList(mesh)[0] as THREE.MeshStandardMaterial;
      const color = source.color?.clone();
      if (source.userData.roomBaseColour!==undefined) color?.setHex(source.userData.roomBaseColour);
      color?.convertLinearToSRGB();
      const light = color ? Math.round(40 + (color.r * .25 + color.g * .65 + color.b * .1) * 44) : 70;
      const part = {
        id: String(mesh.userData.roomMember), ...projected,
        fill: `hsl(143,9%,${light}%)`,
      };
      this.projections.set(mesh,{matrix:mat.clone(),part});
      return part;
    }).sort((a, b) => a.top - b.top);
  }

  partVisible(member:string,hidden:ReadonlySet<string>) {
    for(let node=this.objects.get(member);node;node=node.parent??undefined)
      if(hidden.has(this.id+"/"+node.userData.id))return false;
    return !hidden.has(this.id+"/"+member);
  }
  displayColour(member:string,mode:"natural"|"parts"|"evidence"):string|undefined {
    if(mode==="natural")return;
    if(mode==="evidence") {
      const cls=this.asset.manifest.components.find(n=>n.id===member)?.class;
      const colours:Record<string,string>={measured:"#2e9e5b",vendor:"#2f7fd1",photo:"#e0a526",assumed:"#d9603b",invented:"#9a55c4"};
      return colours[cls??""]??"#8a8f98";
    }
    let value=0;
    for(const c of member)value=(value*31+c.charCodeAt(0))>>>0;
    return "hsl("+(value%360)+",52%,58%)";
  }
  applyDisplay(hidden:ReadonlySet<string>,mode:"natural"|"parts"|"evidence") {
    for(const mesh of this.parts) {
      const member=mesh.userData.roomMember;
      mesh.visible=this.partVisible(member,hidden);
      const colour=this.displayColour(member,mode);
      for(const mat of [...ownList(mesh),mesh.userData.livePlate as THREE.Material|undefined]) if(mat instanceof THREE.MeshStandardMaterial) {
        const neutral=mat.userData.roomBaseColour??=mat.color.getHex();
        if(colour)mat.color.setStyle(colour);else mat.color.setHex(neutral);
      }
    }
  }
  select(member: string | null) {
    const target = member ? this.objects.get(member) : null;
    for (const mesh of this.parts) {
      let node: THREE.Object3D | null = mesh;
      while (node && node !== target) node = node.parent;
      for (const m of [...ownList(mesh), mesh.userData.livePlate as THREE.Material | undefined]) {
        if (m instanceof THREE.MeshStandardMaterial) {
          const original = m.userData.roomBaseEmissive ??= m.emissive.getHex();
          m.emissive.setHex(node && target ? 0x176b58 : original);
        }
      }
    }
  }

  /** Switch the lamps' light on or off (their lit surfaces stay lit either way). */
  lightLamps(on: boolean) { for (const l of this.lamps) l.visible = on; }
  /** Apply the scene's lighting to this placement. `shown`: the viewer's lighting view is on (lights cast light). */
  applyLighting(l: RoomLighting, shown: boolean) {
    const own = l.instances?.[this.id], on = own?.on ?? l.lamps.on, level = own?.intensity ?? l.lamps.intensity;
    const colour = own?.colour !== undefined ? own.colour : l.lamps.colour, tint = colour ? new THREE.Color(colour) : null;
    for (const light of this.lamps) {
      light.visible = shown && on && level > 0;
      light.intensity = light.userData.base * level;
      light.color.copy(tint ?? light.userData.colour);
    }
    for (const m of this.lampGlow) m.emissive.copy(on ? (tint ?? m.userData.lampEmissive) : new THREE.Color(0));
    const screen = l.screens.on ? l.screens.intensity : 0;
    for (const m of this.screenGlow) {
      m.emissiveIntensity = m.userData.glow * screen;
      if (m.userData.livePlate) (m.userData.livePlate as THREE.MeshStandardMaterial).emissiveIntensity = m.emissiveIntensity;
    }
    this.screenLevel = screen;
    for (const light of this.screenLights) { light.visible = shown && screen > 0; light.intensity = SCREEN_NITS * screen; }
  }

  /** The screens' glow level last applied (0 when the scene's screens are off). */
  screenLevel = 1;
  /** The lit sheet of an S_ member: its mesh with a screen picture, else its first mesh. */
  screenMesh(member: string): THREE.Mesh | null {
    const meshes = this.parts.filter(m => m.userData.roomMember === member);
    return meshes.find(m => ownList(m).some(x => x instanceof THREE.MeshStandardMaterial && x.emissiveMap)) ?? meshes[0] ?? null;
  }
  /** Draw an S_ member's sheet as its built-in picture, a hole or a plate. */
  setScreenLook(member: string, look: ScreenLook) {
    const mesh = this.screenMesh(member), original = mesh && own(mesh);
    if (!mesh || !original || Array.isArray(original)) return;
    mesh.userData.liveOriginal = original;
    if (look === "builtin") { mesh.material = original; return; }
    if (look === "hole") { mesh.material = HOLE; return; }
    let plate = mesh.userData.livePlate as THREE.MeshStandardMaterial | undefined;
    if (!plate) {
      if (!(original instanceof THREE.MeshStandardMaterial)) return;
      plate = original.clone(); plate.name = original.name + "-plate";
      plate.userData = { ...original.userData };
      mesh.userData.livePlate = plate; original.userData.livePlate = plate;
    }
    if (original instanceof THREE.MeshStandardMaterial) {
      plate.emissiveIntensity = original.emissiveIntensity; plate.color.copy(original.color); plate.emissive.copy(original.emissive);
    }
    if (plate.emissiveMap !== look.plate) { plate.emissiveMap = look.plate; plate.needsUpdate = true; }
    mesh.material = plate;
  }

  dispose() {
    this.holder.removeFromParent();
    for (const l of this.lamps) if (l instanceof THREE.SpotLight) l.shadow.dispose();
    for (const mesh of this.parts) {
      for (const m of ownList(mesh)) m.dispose();
      (mesh.userData.livePlate as THREE.Material | undefined)?.dispose();
    }
  }
}

// ---- lamps: the visual light of an asset's lamps. Brightness is relative (1 = a typical desk downlight) and scaled here
// to the view's lighting; the picture shows the character of the light, not lux.
interface LampSpec { kind: "spot" | "strip"; at: [number, number, number]; dir: [number, number, number]; colour: [number, number, number]; intensity: number; angle?: number; penumbra?: number; length?: number; width?: number }
const SPOT_CANDELA = 24, STRIP_NITS = 70;
let areaLightsReady = false;
function makeLamp(spec: LampSpec): THREE.Light | null {
  // A black body of the lamp's colour temperature reads far warmer on screen than an LED of that rating looks to the eye
  // (which adapts): keep a third of the tint.
  const colour = new THREE.Color().setRGB(...spec.colour, THREE.SRGBColorSpace).lerp(new THREE.Color(0xffffff), 2 / 3);
  const at = new THREE.Vector3(...spec.at), dir = new THREE.Vector3(...spec.dir).normalize();
  if (spec.kind === "spot") {
    const light = new THREE.SpotLight(colour, spec.intensity * SPOT_CANDELA, 6, spec.angle ?? 0.35, spec.penumbra ?? 0.5, 2);
    light.position.copy(at);
    light.target.position.copy(at.clone().add(dir));
    light.add(light.target); light.target.position.copy(dir);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.0004;
    light.shadow.camera.near = 0.02; light.shadow.camera.far = 4;
    return light;
  }
  if (spec.kind === "strip" && spec.length && spec.width) {
    if (!areaLightsReady) { RectAreaLightUniformsLib.init(); areaLightsReady = true; }
    const light = new THREE.RectAreaLight(colour, spec.intensity * STRIP_NITS, spec.width, spec.length);
    light.position.copy(at);
    light.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    return light;
  }
  return null;
}

/** The light a screen throws: a cool, soft area light of the screen's size, just in front of its lit face. */
const SCREEN_NITS = 5;
function screenLight(mesh: THREE.Mesh): THREE.RectAreaLight | null {
  const box = (mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox))!;
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  // A screen sheet is flat in the node's y–z plane and faces -x (generator kit.sheet; curved sheets come close).
  if (!(size.y > 0.05 && size.z > 0.03)) return null;
  if (!areaLightsReady) { RectAreaLightUniformsLib.init(); areaLightsReady = true; }
  const light = new THREE.RectAreaLight(new THREE.Color(0xa8c4e6), SCREEN_NITS, size.z, size.y);
  light.position.copy(centre).add(new THREE.Vector3(-0.01, 0, 0));
  light.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
  light.visible = false;
  return light;
}
