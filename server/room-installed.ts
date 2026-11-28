import { configureOperator,operatorOptions } from "./room-person-controls.ts";
// Exact-release resolver shared by the local editor, portable projects and the production runtime.
// All geometry, measurements and downloads are derived from the same verified file inventory.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join,posix } from "node:path";
import { verifyReleaseFiles } from "./room-release-files.ts";
import type { Manifest } from "../shared/manifest.ts";
import { componentAdjustments } from "../shared/component-adjustments.ts";
import { assetFromFiles, labelOf } from "../shared/commands/core.ts";
import { defaultPerson, seated } from "../shared/commands/person.ts";
import type { AssetInfo } from "../shared/commands/registry.ts";
import { quatRotate } from "../shared/math.ts";
import { roomVector } from "../shared/room.ts";
import { worldFrames } from "../shared/kinematics.ts";
import { readPackage, type PersonPackage } from "../shared/person-model.ts";
import type { RoomCatalog, RoomInstance, RoomPoint, RoomRelease } from "../shared/room.ts";
import { LIVE, type SurfaceInfo } from "../shared/room-content.ts";

type Payload = Map<string, Buffer>;
type Embedded = { pin: string; files: Record<string,string> };
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const pinFormat = /^([a-z0-9][a-z0-9._-]{0,95})@([a-zA-Z0-9][a-zA-Z0-9._-]{0,95})#([0-9a-f]{64})$/;
const required = (files: Payload, path: string) => {
  const data = files.get(path);
  if (!data) throw new Error("Release is missing " + path);
  return data;
};
const safePath = (s: string) => s.length <= 320 && s.split("/").every(p => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p));
const relative = (p: number[], a: RoomPoint): RoomPoint => [p[0]-a[0], p[1]-a[1], p[2]-a[2]];

/** The S_ screens of a GLB with their node-local extents, from the POSITION accessors' min and max (mandatory in
 *  glTF) over all primitives of the node's own mesh. A screen node without a mesh is not a content target. */
function screenExtents(glb: Buffer) {
  const length = glb.readUInt32LE(12), gltf = JSON.parse(glb.subarray(20, 20 + length).toString());
  const out: { id: string; min: RoomPoint; max: RoomPoint }[] = [];
  for (const node of gltf.nodes ?? []) {
    if (typeof node.name !== "string" || !node.name.startsWith("S_") || node.mesh === undefined) continue;
    const min: RoomPoint = [Infinity, Infinity, Infinity], max: RoomPoint = [-Infinity, -Infinity, -Infinity];
    for (const p of gltf.meshes?.[node.mesh]?.primitives ?? []) {
      const a = gltf.accessors?.[p.attributes?.POSITION];
      if (!Array.isArray(a?.min) || !Array.isArray(a?.max)) continue;
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.min[k]); max[k] = Math.max(max[k], a.max[k]); }
    }
    if ([...min, ...max].every(Number.isFinite)) out.push({ id: node.name, min, max });
  }
  return out;
}

export function releaseInventory(payload: Payload) {
  const entries = [...payload].filter(([p]) => p !== "inventory.json").map(([path,bytes]) => {
    if (!safePath(path)) throw new Error("Invalid release path " + path);
    return { path, sha256: hash(bytes) };
  }).sort((a,b) => a.path < b.path ? -1 : 1);
  const bytes = Buffer.from(JSON.stringify(entries));
  return { bytes, digest:hash(bytes) };
}

function prepareSource(pin:string, payload:Payload) {
  const identity = pinFormat.exec(pin);
  if (!identity) throw new Error("Invalid release pin " + pin);
  const [, asset, version, digest] = identity, inventory = releaseInventory(payload);
  if (inventory.digest !== digest || (payload.has("inventory.json") && !inventory.bytes.equals(required(payload,"inventory.json"))))
    throw new Error("Release inventory or file digest mismatch for " + pin);
  verifyReleaseFiles(payload);
  const manifest: Manifest & {redistributable?:boolean; rights?:{redistributable?:boolean}} = JSON.parse(required(payload,"manifest.json").toString());
  const glb = required(payload,"model.glb");
  if (manifest.schema !== "synergon-manifest/1" || manifest.asset !== asset || hash(glb) !== manifest.glb.sha256 || manifest.glb.bytes !== glb.length)
    throw new Error("Geometry, manifest or asset identity mismatch for " + pin);
  const packages: Record<string,PersonPackage> = {};
  for (const id of ["operator-m","operator-f","clay-m","clay-f"]) {
    const base = "manikin/" + id + "/", json = payload.get(base + id + ".avatar.json");
    if (!json) continue;
    const avatar = JSON.parse(json.toString());
    const poses = avatar.posesFile ? JSON.parse(required(payload,posix.join(base,avatar.posesFile)).toString()) : undefined;
    packages[id] = readPackage(id, avatar, required(payload,posix.join(base,avatar.glb)), poses);
  }
  const person = defaultPerson(packages);
  if (asset === "rig-b" && !person) throw new Error(pin + " is missing its seated operator dependency");
  const people = person ? {packages,defaultPerson:person} : null;
  const info: AssetInfo = {...assetFromFiles(manifest,glb),releaseDigest:digest,people};
  const anchor = manifest.datums.find(d=>d.id === "D_floor")?.origin as RoomPoint;
  if (!Array.isArray(anchor) || anchor.length !== 3 || !anchor.every(Number.isFinite)) throw new Error(pin + " requires a floor anchor");
  const {min,max} = manifest.totals.bbox;
  if (![min,max].every(p=>p.length === 3 && p.every(Number.isFinite)) || min.some((v,i)=>v>max[i])) throw new Error("Invalid release bounds for " + pin);
  const base = "/library/" + digest + "/";
  const adjustments=componentAdjustments(manifest);
  const release: RoomRelease = { id:pin,label:manifest.title,kind:people?"station":manifest.datums.some(d=>d.id==="D_desk_surface")?"desk":"display",asset,version,digest,
    modelUrl:base+"model.glb",manifestUrl:base+"manifest.json",anchor,frame:manifest.conventions?.frame,seat:!!people,
    ...(asset === "wall-display" ? {variant:"wall"} : asset === "floor-display" ? {variant:"freestanding"} : {}),
    members:[...manifest.components,...manifest.surfaces,...manifest.datums,...manifest.joints].map(n=>({
      id:n.id,...(adjustments.has(n.id) ? {controls:adjustments.get(n.id)} : {}),label:people || n.id.startsWith("J_") ? labelOf(info,n.id) : "label" in n ? n.label : n.id,
      kind:n.id.startsWith("D_") ? "datum" : n.id.startsWith("J_") ? "joint" : "part" })),
    joints:manifest.joints.map(({id,type,axis,lower,upper,neutral,locked,evidence})=>({id,label:labelOf(info,id),type,axis,lower,upper,neutral,locked,assumed:evidence==="assumed"})),
    footprint:{min:[min[0]-anchor[0],min[1]-anchor[1]],max:[max[0]-anchor[0],max[1]-anchor[1]]},
  };
  payload.set("inventory.json",inventory.bytes);
  return { release,info,payload,screens:screenExtents(glb),redistributable:manifest.redistributable !== false && manifest.rights?.redistributable !== false };
}
type Source = ReturnType<typeof prepareSource>;

function makeCatalog(sources:Map<string,Source>): RoomCatalog {
  const resolve = (instance:RoomInstance) => {
    const s = sources.get(instance.release);
    if (!s) throw new Error("Install the pinned release " + instance.release);
    return s;
  };
  return {releases:[...sources.values()].map(s=>s.release), point(instance,member) {
    const {info,release} = resolve(instance), frame = worldFrames(info.nodes,instance.pose)[member];
    if (!frame) throw new Error("Unknown member " + member + " on " + instance.id);
    return relative(frame.t,release.anchor);
  },jointAxesInRoom(instance,joints) {
    const frames=worldFrames(resolve(instance).info.nodes,instance.pose);
    const axes:Record<string,RoomPoint>={};
    for (const joint of joints) {
      const axis=joint.axis, frame=frames[joint.id];
      if (axis?.length===3 && frame)
        axes[joint.id]=roomVector(instance.yaw,quatRotate(frame.q,[axis[0],axis[1],axis[2]]));
    }
    return axes;
  },configureOperator(instance,state,patch) {
    return configureOperator(resolve(instance).info,state,patch);
  },operatorOptions(instance,state) {
    return operatorOptions(resolve(instance).info,state);
  },defaultPerson(instance) {
    const people = resolve(instance).info.people;
    if (!people) throw new Error("This release has no seat");
    return structuredClone(people.defaultPerson);
  },eye(instance,state) {
    const {info,release} = resolve(instance);
    return relative(seated(info,state,instance.pose).eyes.mid,release.anchor);
  },surfaces(instance) {
    // A screen's sheet lies in its node's y–z plane and faces −x: size is [y, z] of the mesh's local extent, flat when
    // its x extent is under LIVE.flatDepth. facing is in the room frame, centre in the posed asset frame.
    const {info,release,screens} = resolve(instance), frames = worldFrames(info.nodes,instance.pose);
    const labels = new Map(release.members.map(m=>[m.id,m.label]));
    return screens.flatMap(({id,min,max}): SurfaceInfo[] => {
      const frame = frames[id];
      if (!frame) return [];
      const extent = max.map((v,k)=>v-min[k]), middle = max.map((v,k)=>(v+min[k])/2) as RoomPoint;
      const offset = quatRotate(frame.q,middle), facing = roomVector(instance.yaw,quatRotate(frame.q,[-1,0,0]));
      return [{ screen:id, label:(labels.get(id) ?? id).replace(/\s*:\s*lit area$/i,""), size:[extent[1],extent[2]],
        flat:extent[0] < LIVE.flatDepth, facing, centre:relative(frame.t.map((v,k)=>v+offset[k]),release.anchor) }];
    });
  }};
}

export function createRoomLibrary(options: {retainPayload?:boolean} = {}) {
  const sources = new Map<string,Source>(), files:Payload = new Map();
  const catalog = makeCatalog(sources);
  const commit = (source:Source) => {
    const r=source.release;
    if (sources.has(r.id)) return;
    sources.set(r.id,source);catalog.releases.push(r);
    if (options.retainPayload === false) { source.payload.clear(); return; }
    const base="/library/"+r.digest+"/";
    for (const [name,bytes] of source.payload) files.set(base+name,bytes);
  };
  const known = (pin:string) => {
    const s=sources.get(pin);
    if (!s) throw new Error("Install the exact release " + pin);
    return s;
  };
  if (options.retainPayload !== false) catalog.transfer = {
    describe(pin) {return {redistributable:known(pin).redistributable};},
    pack(pin) {
      const s=known(pin);
      if (!s.redistributable) throw new Error(pin + " must be linked from an approved installation");
      return Object.fromEntries([...s.payload].map(([p,b])=>[p,b.toString("base64")]));
    },
    prepare(entries:Embedded[]) {
      const union = new Map(sources), staged:Source[]=[];
      for (const {pin,files:encoded} of entries) {
        const payload:Payload = new Map();
        for (const [p,b64] of Object.entries(encoded)) {
          if (!safePath(p) || typeof b64 !== "string") throw new Error("Invalid embedded release file");
          const bytes=Buffer.from(b64,"base64");
          if (bytes.toString("base64") !== b64) throw new Error("Invalid file encoding for " + p);
          payload.set(p,bytes);
        }
        required(payload,"inventory.json");
        const s=prepareSource(pin,payload);
        if (!s.redistributable) throw new Error(pin+" has restricted embedded files; link the installed release");
        union.set(pin,s);staged.push(s);
      }
      return {catalog:makeCatalog(union),commit() { for (const s of staged) commit(s); }};
    },
  };
  return {catalog,files,install(pin:string,payload:Payload) {commit(prepareSource(pin,payload));}};
}

export function loadInstalledRoomLibrary(descriptors:Pick<RoomRelease,"id"|"digest">[], directory:string, options: {retainPayload?:boolean} = {}) {
  const library=createRoomLibrary(options);
  for (const {id,digest} of descriptors) {
    if (pinFormat.exec(id)?.[3] !== digest || !digest) throw new Error("Invalid installed release descriptor " + id);
    const root=join(directory,digest), inventory=readFileSync(join(root,"inventory.json"));
    if (hash(inventory)!==digest) throw new Error("Invalid installed inventory " + id);
    const payload:Payload = new Map([["inventory.json",inventory]]);
    for (const f of JSON.parse(inventory.toString())) {
      if (typeof f.path !== "string" || !safePath(f.path)) throw new Error("Invalid installed release filename");
      payload.set(f.path,readFileSync(join(root,f.path)));
    }
    library.install(id,payload);
  }
  return library;
}
