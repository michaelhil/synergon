import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { effectiveLighting } from "../../shared/room.ts";
import { cctColour } from "../../shared/light-colour.ts";
/** Brightness of one ceiling light (visual; scaled so that the room reads alike for any grid and spread). */
const CEILING_CANDELA = 9;
/** The most real light sources a ceiling grid uses; a denser grid is approximated (see buildCeiling). */
const MAX_CEILING_LIGHTS = 12;
/** The marker of a ceiling light in the lighting view: a disc 0.3 m across. */
const fixture = new THREE.CylinderGeometry(.15, .15, .02, 24);
import { doorClearance } from "../../shared/room-geometry.ts";
import { roomPoint, type RoomDimensions, type RoomPoint } from "../../shared/room.ts";
import type { CameraPreset, OrbitCamera, RoomViewLink } from "./room-camera-state.ts";
import type { Drawing, RoomViewCallbacks } from "./room-plan-renderer.ts";
import { roomDirectGrab } from "./room-direct-grab.ts";

const world = ([x,y,z]: RoomPoint) => new THREE.Vector3(x,z,-y);
const unlit = (color: number) => new THREE.LineBasicMaterial({color});
function line(points: THREE.Vector3[], color: number) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), unlit(color));
}
function clearObjects(parent: THREE.Group) {
  parent.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
  parent.clear();
}
function box(group: THREE.Group, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number) {
  if (Math.min(sx,sy,sz) <= 0) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sz, sy), new THREE.MeshStandardMaterial({ color, roughness:.91 }));
  mesh.position.set(x+sx/2,z+sz/2,-y-sy/2);
  mesh.receiveShadow = true;
  group.add(mesh);
}
type Wall = "north" | "east" | "south" | "west";

export class RoomOrbit {
  readonly renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
  private readonly scene = new THREE.Scene();
  private readonly room = new THREE.Group();
  private readonly wallGroups = new Map<Wall,THREE.Group>();
  private readonly furniture = new THREE.Group();
  private readonly overlay = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,2000);
  private readonly eyeCamera = new THREE.PerspectiveCamera(62,1,.015,2000);
  private eyeActive = false;
  private eyeDirection=new THREE.Vector3(0,0,-1);
  private eyeLook={yaw:0,pitch:0,fov:62};
  private eyeDrag?:{id:number;x:number;y:number;yaw:number;pitch:number};
  private gridVisible = true;
  private readonly controls: OrbitControls;
  private readonly shadow = new THREE.DirectionalLight(0xffffff, 2.3);
  private readonly sky = new THREE.HemisphereLight(0xebf1f3,0x9da697,1.12);
  private lighting = "day";
  private environment: THREE.WebGLRenderTarget;
  private readonly tags = document.createElement("div");
  private readonly pointer = new THREE.Vector2();
  private readonly ray = new THREE.Raycaster();
  private drawing?: Drawing;
  private lastRoom = "";
  private awaitingFocusedModel = false;
  private pendingOperatorFit?:{id:string;camera:string;preset:CameraPreset};
  private width = 1;
  private height = 1;
  private halfWidth = 4;
  private halfHeight = 4;
  private frame = 0;
  private visible = true;
  private down?: [number,number];
  private grab?: {pointer:number;x:number;y:number;moved:boolean;plan:NonNullable<ReturnType<typeof roomDirectGrab>>};
  /** Live screen content: called at the end of every render with the camera and the renderer's own integer size. */
  afterRender?: (camera: THREE.Camera, width: number, height: number) => void;
  /** Live screen content: sees every canvas pointer, wheel and click event first (capture phase, registered before
   *  any other listener); returns true to swallow it. */
  pointerGuard?: (e: Event) => boolean;
  /** Called after the graphics context came back and the scene was rebuilt. */
  onContextRestored?: () => void;
  private using = false;
  private clearColour = 0xeeeee8;
  private lost = false;
  private glide = 0;

  constructor(private host: HTMLElement, private callbacks: RoomViewCallbacks) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setClearColor(this.clearColour);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = .87;
    this.renderer.domElement.setAttribute("aria-label","Orbiting 3D room layout");
    // focus returns here after a live screen was used (room-frames.ts)
    this.renderer.domElement.tabIndex = -1;
    for (const type of ["pointerdown","pointermove","pointerup","click","dblclick","wheel","contextmenu"]) {
      this.renderer.domElement.addEventListener(type, e => {
        if (this.pointerGuard?.(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, { capture: true, passive: false });
    }
    this.tags.className = "rv-orbit-tags";
    host.append(this.renderer.domElement,this.tags);
    this.scene.add(this.room,this.furniture,this.overlay,this.sky,this.shadow,this.shadow.target);
    this.environment = this.buildEnvironment();
    this.scene.environmentIntensity = .62;
    // A lost graphics context (a GPU reset, or pages with maps running their own WebGL) comes back with the
    // environment, shadows and textures rebuilt instead of a blank view.
    this.renderer.domElement.addEventListener("webglcontextlost", e => {
      e.preventDefault(); this.lost = true; cancelAnimationFrame(this.frame); this.frame = 0;
    });
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      // the renderer's own state starts again: an opaque background, then the environment
      this.renderer.setClearColor(this.clearColour, 1);
      this.environment.dispose(); this.environment = this.buildEnvironment();
      this.renderer.shadowMap.needsUpdate = true;
      this.scene.traverse(o => {
        const materials = o instanceof THREE.Mesh || o instanceof THREE.Line ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of materials) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.needsUpdate = true;
          m.needsUpdate = true;
        }
      });
      this.onContextRestored?.();
      this.invalidate();
    });
    this.shadow.castShadow = true;
    this.shadow.shadow.mapSize.set(2048,2048);
    this.shadow.shadow.bias = -.00018;
    this.shadow.shadow.normalBias = .008;
    this.controls = new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.minZoom = .1; this.controls.maxZoom = 30;
    this.controls.maxPolarAngle = Math.PI*.48;
    this.controls.minPolarAngle = .015;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("change", this.invalidate);
    this.camera.position.set(-5,6,7);
    this.controls.update();
    this.renderer.domElement.addEventListener("pointerdown", e => { if (e.isPrimary && e.button === 0) this.down = [e.clientX,e.clientY]; });
    const canvas=this.renderer.domElement;
    canvas.addEventListener("pointerdown",e=>{
      if (!this.callbacks.onAdjust || !this.drawing?.member || this.eyeActive || this.using || this.grab || e.button!==0 ||
          !e.isPrimary || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const hit=this.hit(e);
      const plan=hit && roomDirectGrab(this.drawing,hit,this.camera,this.width,this.height);
      if (!plan) return;
      this.grab={pointer:e.pointerId,x:e.clientX,y:e.clientY,moved:false,plan};
      this.controls.enabled=false;canvas.style.cursor="grabbing";canvas.setPointerCapture(e.pointerId);
    },true);
    canvas.addEventListener("pointermove",e=>{
      const grab=this.grab;
      if (!grab || e.pointerId!==grab.pointer) return;
      const dx=e.clientX-grab.x,dy=e.clientY-grab.y;
      if (!grab.moved && Math.hypot(dx,dy)<4) return;
      grab.moved=true;
      const r=canvas.getBoundingClientRect();
      grab.plan.move(dx,dy,e.clientX-r.left,e.clientY-r.top);
      this.invalidate();
    });
    canvas.addEventListener("pointerdown",e=>{
      if(!this.eyeActive || this.using || e.button!==0)return;
      this.eyeDrag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:this.eyeLook.yaw,pitch:this.eyeLook.pitch};canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove",e=>{
      const drag=this.eyeDrag;if(!drag || e.pointerId!==drag.id || !this.eyeActive)return;
      const yaw=drag.yaw-(e.clientX-drag.x)*.004;
      this.eyeLook.yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));
      this.eyeLook.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,drag.pitch+(e.clientY-drag.y)*.004));
      this.applyEyeLook();
    });
    canvas.addEventListener("wheel",e=>{
      if(!this.eyeActive)return;e.preventDefault();this.eyeLook.fov=Math.max(22,Math.min(95,this.eyeLook.fov+e.deltaY*.035));this.applyEyeLook();
    },{passive:false});
    canvas.addEventListener("pointerup",()=>{this.eyeDrag=undefined;});
    canvas.addEventListener("pointercancel", () => { this.down = undefined; this.eyeDrag=undefined;this.finishGrab(false); });
    canvas.addEventListener("lostpointercapture",e=>{
      if (this.grab?.pointer===e.pointerId) {this.down=undefined;this.finishGrab(false);}
    });
    this.renderer.domElement.addEventListener("pointerup", e => {
      if (!e.isPrimary) return;
      if (this.grab?.pointer===e.pointerId && this.finishGrab(true)) {this.down=undefined;return;}
      if (!this.down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1]); this.down = undefined;
      if (moved > 4 || !this.drawing) return;
      const hit=this.hit(e)?.object;
      for(let node:THREE.Object3D|null|undefined=hit;node;node=node.parent) {
        if(node.userData.roomOperator) { callbacks.onSelect(node.userData.roomOperator,"@operator",e.shiftKey);return; }
      }
      callbacks.onSelect(hit?.userData.roomInstance ?? this.drawing?.focused ?? null, hit?.userData.roomMember, e.shiftKey);
    });
  }

  private buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer), studio = new RoomEnvironment();
    const target = pmrem.fromScene(studio,.04);
    this.scene.environment = target.texture;
    studio.dispose(); pmrem.dispose();
    return target;
  }
  /** The canvas the view draws into. */
  get canvas() { return this.renderer.domElement; }
  /** The camera of the current view (the room's orbit camera, or the operator's eye). */
  currentCamera(): THREE.Camera { return this.eyeActive ? this.eyeCamera : this.camera; }
  inEye() { return this.eyeActive; }
  /** The renderer's own size in CSS px (frames are placed in this space, never from getBoundingClientRect). */
  size(): [number, number] { return [this.width, this.height]; }
  /** The first of `objects` under a viewport point (client px), or null. */
  pick(x: number, y: number, objects: THREE.Object3D[]) {
    if (!objects.length) return null;
    const bounds=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((x-bounds.left)/bounds.width*2-1,1-(y-bounds.top)/bounds.height*2);
    this.ray.setFromCamera(this.pointer,this.currentCamera());
    return this.ray.intersectObjects(objects,false)[0] ?? null;
  }
  /** The nearest visible mesh of the room or its objects under a viewport point. */
  pickAny(x: number, y: number) {
    return this.hit({clientX:x,clientY:y} as PointerEvent) ?? null;
  }
  /** Draw now (a picture is taken from the canvas in the same task). */
  renderNow() {
    if (this.lost || !this.drawing) return;
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.draw();
  }
  /** While a live screen is used: no orbit, no direct grab, no eye drag. */
  setUse(on: boolean) {
    if (on) this.finishGrab(false);
    this.using = on; this.eyeDrag = undefined;
    this.controls.enabled = !on && !this.eyeActive;
  }
  /** Turn the room camera, within `ms`, to look square at a screen: from `normal` onto `centre`, the sheet
   *  (`size`, metres) filling `fraction` of the stage. Things more than `clear` metres in front of the sheet are not
   *  drawn meanwhile, so nothing stands between the eye and the screen. Returns how to go back. */
  faceSheet(centre: THREE.Vector3, normal: THREE.Vector3, size: [number, number], fraction: number, ms: number, clear: number) {
    const before = { ...this.cameraState(), near: this.camera.near, far: this.camera.far };
    const distance = Math.max(4, clear * 2), to = centre.clone().addScaledVector(normal.clone().normalize(), distance);
    const width = this.camera.right - this.camera.left, height = this.camera.top - this.camera.bottom;
    const zoom = Math.max(this.controls.minZoom, Math.min(fraction * width / size[0], fraction * height / size[1]));
    this.animate(to, centre, zoom, ms, () => { this.camera.near = distance - clear; this.camera.far = distance + 200; });
    return (glideMs = ms) => {
      this.animate(new THREE.Vector3().fromArray(before.position), new THREE.Vector3().fromArray(before.target), before.zoom, glideMs, () => {
        this.camera.near = before.near; this.camera.far = before.far;
      }, () => this.restoreCamera(before));
    };
  }
  private animate(position: THREE.Vector3, target: THREE.Vector3, zoom: number, ms: number, atEnd: () => void, finish?: () => void) {
    cancelAnimationFrame(this.glide);
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone(), z0 = this.camera.zoom, start = performance.now();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      const k = reduce || ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms), e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(p0, position, e); this.controls.target.lerpVectors(t0, target, e);
      this.camera.zoom = z0 + (zoom - z0) * e;
      this.camera.up.set(0, 1, 0); this.camera.lookAt(this.controls.target);
      if (k >= 1) { atEnd(); finish?.(); }
      this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
      this.invalidate();
      if (k < 1) this.glide = requestAnimationFrame(step); else this.glide = 0;
    };
    step();
  }
  /** Test hook (local installations): lose the graphics context and get it back. */
  loseContext(): Promise<void> {
    const ext = this.renderer.getContext().getExtension("WEBGL_lose_context");
    if (!ext) return Promise.reject(new Error("WEBGL_lose_context is not available"));
    return new Promise(resolve => {
      this.renderer.domElement.addEventListener("webglcontextrestored", () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), { once: true });
      ext.loseContext(); setTimeout(() => ext.restoreContext(), 120);
    });
  }

  private hit(e:PointerEvent) {
    this.furniture.updateWorldMatrix(true,true);
    const bounds=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX-bounds.left)/bounds.width*2-1,1-(e.clientY-bounds.top)/bounds.height*2);
    this.ray.setFromCamera(this.pointer,this.eyeActive?this.eyeCamera:this.camera);
    const meshes:THREE.Mesh[]=[];
    const collect=(obj:THREE.Object3D)=>{if(obj instanceof THREE.Mesh)meshes.push(obj);};
    this.furniture.traverseVisible(collect);this.room.traverseVisible(collect);
    return this.ray.intersectObjects<THREE.Mesh>(meshes,false)[0];
  }
  private finishGrab(commit:boolean,scene=this.drawing?.scene) {
    const grab=this.grab;
    if (!grab) return false;
    this.grab=undefined;
    if (!commit) this.down=undefined;
    const {plan}=grab,values=commit && grab.moved ? plan.changes() : {};
    plan.restore(scene);
    this.controls.enabled=!this.eyeActive && !this.using;
    this.renderer.domElement.style.cursor="";
    if (this.renderer.domElement.hasPointerCapture(grab.pointer)) this.renderer.domElement.releasePointerCapture(grab.pointer);
    this.invalidate();
    if (Object.keys(values).length) this.callbacks.onAdjust?.(plan.instance,values,plan.version);
    return grab.moved;
  }
  show(on: boolean) { if(!on)this.finishGrab(false); this.visible = on; this.host.hidden = !on; if (on) this.invalidate(); }
  update(d: Drawing) {
    if (this.grab && (d.scene.version!==this.grab.plan.version || d.selected!==this.grab.plan.instance || d.member!==this.grab.plan.member)) {
      this.down=undefined;this.finishGrab(false,d.scene);
    }
    const previous=this.drawing;
    const scopeChanged=(previous?.focused??null)!==(d.focused??null);
    const instance=d.scene.instances.find(i=>i.id===d.focused);
    const priorInstance=previous?.scene.instances.find(i=>i.id===d.focused);
    const releaseChanged=!!priorInstance && priorInstance.release!==instance?.release;
    this.drawing = d;
    this.room.visible = !d.focused;
    // Switching the lighting view changes the number of lights, which needs new shaders: they are built in the background
    // first (prepareLighting), and the view keeps drawing the current state meanwhile.
    const want = d.lighting === "lamps";
    if (want !== this.litShown && !this.preparing) this.prepareLighting(want);
    if ((this.litShown ? "lamps" : "day") !== this.lighting) {
      // Lamps: the room's own light is dimmed and the background darkened, so the assets' lamps show where light falls.
      this.lighting = this.litShown ? "lamps" : "day";
      const dim = this.lighting === "lamps";
      this.sky.intensity = dim ? .07 : 1.12; this.shadow.intensity = dim ? .2 : 2.3; this.scene.environmentIntensity = dim ? .05 : .62;
      this.clearColour = dim ? 0x262b28 : 0xeeeee8; this.renderer.setClearColor(this.clearColour);
      this.host.closest(".rv-stage")?.classList.toggle("rv-dim", dim);
      this.host.closest(".rm-drawing")?.classList.toggle("rm-drawing-dim", dim);
    }
    if(scopeChanged)this.finishGrab(false);
    const key = JSON.stringify(d.scene.room), first = !this.lastRoom;
    if (this.lastRoom !== key) { this.lastRoom = key; this.buildRoom(d.scene.room); }
    this.buildCeiling(d);
    for (const model of d.models.values()) {
      if (model.holder.parent !== this.furniture) this.furniture.add(model.holder);
      model.holder.visible=!d.focused || model.id===d.focused;
      model.select(model.id === d.selected ? d.member : null);
      model.applyLighting(effectiveLighting(d.scene), this.litShown);
    }
    const row = d.scene.instances.find(i => i.id === d.selected), rel = d.releases.find(r => r.id === row?.release);
    clearObjects(this.overlay);
    if (!d.focused && row && rel) {
      const {min,max} = rel.footprint;
      const footprint = [[min[0],min[1]],[max[0],min[1]],[max[0],max[1]],[min[0],max[1]],[min[0],min[1]]];
      this.overlay.add(line(footprint.map(([x,y]) => world(roomPoint(row,[x,y,.016]))),0x13705f));
    }
    if (d.measurement) this.overlay.add(line(d.measurement.points.map(world),0x13705f));
    else if (!d.focused && row && rel && d.scene.instances.every(i=>d.releases.some(r=>r.id===i.release))) {
      const gap = doorClearance(d.scene,row,d.releases);
      const shown = gap.metres > .0005 ? gap : gap.opening;
      this.overlay.add(line(shown.points.map(([x,y]) => world([x,y,.022])),0x13705f));
    }
    const modelReady=!!(d.focused && d.models.has(d.focused));
    if (first || scopeChanged || releaseChanged || (this.awaitingFocusedModel && modelReady)) this.fit();
    else if(instance && priorInstance && (instance.x!==priorInstance.x || instance.y!==priorInstance.y)) {
      const delta=world([instance.x-priorInstance.x,instance.y-priorInstance.y,0]);
      this.camera.position.add(delta);this.controls.target.add(delta);this.controls.update();
    }
    this.awaitingFocusedModel=!!d.focused && !modelReady && (scopeChanged || releaseChanged || this.awaitingFocusedModel);
    this.invalidate();
  }
  resize(w: number,h: number) {
    if (w!==this.width || h!==this.height) this.finishGrab(false);
    this.width=w; this.height=h;
    // the canvas's CSS size is the renderer's own integer size, so live frames placed in it register with the picture
    this.renderer.setSize(w,h,true);
    this.eyeCamera.aspect=w/h; this.eyeCamera.updateProjectionMatrix();
    this.frustum(); this.invalidate();
  }
  private frustum() {
    const ratio = Math.max(.1,this.width/this.height);
    const extent = Math.max(this.halfHeight,this.halfWidth/ratio)*1.12;
    this.camera.top = extent; this.camera.bottom = -extent;
    this.camera.left = -ratio*extent; this.camera.right = ratio*extent;
    this.camera.updateProjectionMatrix();
  }
  cameraState():OrbitCamera {
    return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),zoom:this.camera.zoom,halfWidth:this.halfWidth,halfHeight:this.halfHeight};
  }
  restoreCamera(state:OrbitCamera) {
    this.awaitingFocusedModel=false;this.pendingOperatorFit=undefined;
    this.leaveEye(); this.halfWidth=state.halfWidth;this.halfHeight=state.halfHeight;
    this.camera.position.fromArray(state.position);this.controls.target.fromArray(state.target);this.camera.zoom=state.zoom;
    this.controls.update();this.frustum();this.invalidate();
  }
  showGrid(visible:boolean) {
    this.gridVisible=visible;
    this.room.traverse(o=>{if(o.name==="room-grid")o.visible=visible;});
    this.invalidate();
  }
  operatorReady(id:string) {
    const pending=this.pendingOperatorFit;
    if (!pending || pending.id!==id || this.drawing?.focused!==id)return;
    this.pendingOperatorFit=undefined;
    if(!this.grab && !this.eyeActive && pending.camera===JSON.stringify(this.cameraState()))this.fit(pending.preset);
  }
  lookState(){return {...this.eyeLook};}
  restoreLook(state:NonNullable<RoomViewLink["look"]>) { this.eyeLook={...state};this.applyEyeLook(); }
  private applyEyeLook() {
    const direction=this.eyeDirection, yaw=Math.atan2(direction.x,-direction.z)+this.eyeLook.yaw;
    const pitch=Math.max(-Math.PI/2+.001,Math.min(Math.PI/2-.001,Math.asin(THREE.MathUtils.clamp(direction.y,-1,1))+this.eyeLook.pitch));
    const delta=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    this.eyeCamera.up.set(0,1,0);this.eyeCamera.lookAt(this.eyeCamera.position.clone().add(delta));
    this.eyeCamera.fov=this.eyeLook.fov;this.eyeCamera.updateProjectionMatrix();this.eyeCamera.updateMatrixWorld();this.invalidate();
  }
  eye(from:RoomPoint,to:RoomPoint) {
    this.finishGrab(false);
    const p=world(from),target=world(to);
    if (p.distanceToSquared(target)<1e-12)throw new Error("The operator’s eye and look target coincide.");
    if(!this.eyeActive)this.eyeLook={yaw:0,pitch:0,fov:62};
    this.eyeActive=true;this.controls.enabled=false;
    this.eyeCamera.position.copy(p);this.eyeDirection.copy(target).sub(p).normalize();this.applyEyeLook();
    this.host.dataset.camera="operator";this.invalidate();
  }
  leaveEye() { this.eyeActive=false;this.eyeDrag=undefined;this.controls.enabled=!this.using;delete this.host.dataset.camera;this.invalidate(); }
  fit(preset:CameraPreset="overview") {
    this.finishGrab(false);
    if (!this.drawing) return;
    this.leaveEye();
    this.furniture.updateMatrixWorld(true);
    const { width:w, depth:d, height:h } = this.drawing.scene.room;
    const focus=this.drawing.scene.instances.find(i=>i.id===this.drawing!.focused);
    let bounds:THREE.Box3,waitForOperator=false;
    if (focus) {
      const model=this.drawing.models.get(focus.id);
      bounds=new THREE.Box3();
      if (model) {
        bounds.expandByObject(model.model);
        const operator=model.modelFrame.children.find(o=>o.visible && o.userData.roomOperator===focus.id);
        if(operator) bounds.expandByObject(operator);
        else waitForOperator=this.drawing.scene.person?.host===focus.id;
      }
      // Provide a usable starting frame while this release streams in. Its exact mesh supplies the final fit.
      if(bounds.isEmpty()) {
        const rel=this.drawing.releases.find(r=>r.id===focus.release);
        const radius=rel?Math.max(.15,...rel.footprint.min.map(Math.abs),...rel.footprint.max.map(Math.abs)):1;
        bounds.set(world([focus.x-radius,focus.y+radius,0]),world([focus.x+radius,focus.y-radius,radius*2]));
      }
    } else {
      bounds=new THREE.Box3(new THREE.Vector3(0,0,-d),new THREE.Vector3(w,h,0));
      for (const model of this.drawing.models.values()) bounds.expandByObject(model.model);
    }
    const center = bounds.getCenter(new THREE.Vector3()), longest = bounds.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    const dirs:Record<CameraPreset,RoomPoint>={overview:[.76,.92,1.12],front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,.000001]};
    this.controls.minPolarAngle=.000001;this.controls.maxPolarAngle=Math.PI*.5;
    const assetDirs:Record<CameraPreset,RoomPoint>={overview:[-.74,.55,.6],front:[1,0,0],back:[-1,0,0],left:[0,0,-1],right:[0,0,1],top:[.000001,1,0]};
    const direction=focus?new THREE.Vector3(...assetDirs[preset]).applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(focus.yaw)):new THREE.Vector3(...dirs[preset]);
    this.camera.position.copy(center).addScaledVector(direction.normalize(),longest*1.7);
    this.camera.near = Math.max(.001,longest*.001); this.camera.far = Math.max(100,longest*6);
    this.camera.zoom=1;
    this.controls.update(); this.camera.updateMatrixWorld(true);
    let ex=0,ey=0;
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
      const v = new THREE.Vector3(x,y,z).applyMatrix4(this.camera.matrixWorldInverse);
      ex=Math.max(ex,Math.abs(v.x)); ey=Math.max(ey,Math.abs(v.y));
    }
    this.halfWidth = ex; this.halfHeight = ey;
    this.pendingOperatorFit=focus && waitForOperator ? {id:focus.id,camera:JSON.stringify(this.cameraState()),preset} : undefined;
    this.frustum(); this.invalidate();
  }

  /** The scene's grid of ceiling lights, lit in the lighting view only. Rebuilt when its settings or the room change. */
  private readonly ceiling = new THREE.Group();
  private ceilingKey = "";
  private buildCeiling(d: Drawing) {
    if (!this.ceiling.parent) this.scene.add(this.ceiling);
    const c = effectiveLighting(d.scene).ceiling, r = d.scene.room, shown = this.litShown && c.on && c.intensity > 0 && !d.focused;
    this.ceilingWanted = shown;
    this.ceiling.visible = shown && !this.ceilingPending;
    const key = JSON.stringify([c, r.width, r.depth, r.height]);
    if (key === this.ceilingKey) return;
    this.ceilingKey = key;
    for (const old of [...this.ceiling.children]) {
      old.removeFromParent();
      if (old instanceof THREE.SpotLight) old.dispose();
      if (old instanceof THREE.Mesh) (old.material as THREE.Material).dispose(); // the shared marker material: disposing twice is harmless
    }
    // Spread: 0 a narrow downlight (15° half angle, a sharp edge), 1 a wide diffuse light (80°, a soft edge).
    const angle = THREE.MathUtils.degToRad(15 + 65 * c.spread), penumbra = .25 + .75 * c.spread;
    const colour = c.colour ? new THREE.Color(c.colour) : new THREE.Color().setRGB(...cctColour(c.cct), THREE.SRGBColorSpace).lerp(new THREE.Color(0xffffff), 2 / 3);
    const height = c.height ?? r.height - .02, per = CEILING_CANDELA * c.intensity * (1 + 2 * c.spread) / Math.sqrt(c.countX * c.countY / 6);
    // every fixture gets its disc ...
    const marker = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: colour, emissiveIntensity: 1.4 });
    for (let i = 0; i < c.countX; i++) for (let j = 0; j < c.countY; j++) {
      const disc = new THREE.Mesh(fixture, marker);
      disc.position.set((i + .5) * r.width / c.countX, height + .01, -(j + .5) * r.depth / c.countY);
      this.ceiling.add(disc);
    }
    // ... but at most MAX_CEILING_LIGHTS real light sources: a denser grid is lit by a coarser one of the same total
    // brightness with wider beams (each light source costs every pixel of every frame).
    let lx = c.countX, ly = c.countY;
    while (lx * ly > MAX_CEILING_LIGHTS) { if (lx >= ly) lx--; else ly--; }
    const share = (c.countX * c.countY) / (lx * ly), wide = Math.min(THREE.MathUtils.degToRad(80), angle * Math.sqrt(share));
    for (let i = 0; i < lx; i++) for (let j = 0; j < ly; j++) {
      const x = (i + .5) * r.width / lx, y = (j + .5) * r.depth / ly;
      const light = new THREE.SpotLight(colour, per * share, height * 3, wide, share > 1 ? Math.max(penumbra, .6) : penumbra, 2);
      light.position.set(x, height, -y);
      light.target.position.set(x, 0, -y);
      this.ceiling.add(light, light.target);
    }
    // a new grid while lit: build its shaders in the background, and show it when they are ready
    if (shown && this.renderer.extensions.has("KHR_parallel_shader_compile")) {
      this.ceiling.visible = true;
      const pending = this.ceilingPending = key, ready = this.background(this.scene)!;
      this.ceiling.visible = false;
      void ready.catch(() => {}).finally(() => {
        if (this.ceilingPending !== pending) return;
        this.ceilingPending = ""; this.ceiling.visible = this.ceilingWanted; this.invalidate();
      });
    }
  }
  private litShown = false;
  private preparing = false;
  private ceilingPending = "";
  private ceilingWanted = false;
  private activeCamera() { return this.eyeActive ? this.eyeCamera : this.camera; }
  /** Shaders can be built in the background only where the browser supports it (KHR_parallel_shader_compile); elsewhere
   *  objects are drawn at once, as before. */
  private background(objects: THREE.Object3D, target?: THREE.Scene): Promise<unknown> | null {
    if (!this.renderer.extensions.has("KHR_parallel_shader_compile")) return null;
    return this.renderer.compileAsync(objects, this.activeCamera(), target ?? null);
  }
  /** Build the shaders for the lighting view (or daylight) in the background, then switch to it. */
  private prepareLighting(want: boolean) {
    const d = this.drawing; if (!d) return;
    this.preparing = true;
    if (want) this.callbacks.onBusy?.("lighting", "Preparing the lighting.");
    const l = effectiveLighting(d.scene), c = l.ceiling;
    const apply = (shown: boolean) => {
      for (const model of d.models.values()) model.applyLighting(l, shown);
      this.ceiling.visible = shown && c.on && c.intensity > 0 && !d.focused;
    };
    apply(want);
    const ready = this.background(this.scene);
    apply(this.litShown);
    if (!ready) { this.preparing = false; this.litShown = want; this.callbacks.onBusy?.("lighting", null); return; }
    void ready.catch(() => {}).finally(() => {
      this.preparing = false; this.litShown = want; this.callbacks.onBusy?.("lighting", null);
      if (this.drawing) this.update(this.drawing);
    });
  }
  /** Build an object's shaders in the background before it is first drawn (the seated operator). */
  async prepare(object: THREE.Object3D) {
    const was = object.visible;
    object.visible = true;
    const ready = this.background(object, this.scene);
    object.visible = false;
    if (ready) await ready.catch(() => {});
    object.visible = was;
  }
  private buildRoom(r: RoomDimensions) {
    clearObjects(this.room); this.wallGroups.clear();
    const {width:w, depth:d, height:h, door, window:win} = r;
    const longest = Math.max(w,d,h);
    // Openings have plan dimensions only. Heights below are cutaway drawing conventions.
    const t = Math.min(.10,Math.min(w,d)*.018), sill=h*.34, head=h*.77, doorHead=h*.82;
    const base = 0xd5d6ce, plaster=0xb8c1bd, trim=0x899b96;
    box(this.room,-t,-t,-.075,w+2*t,d+2*t,.075,base);
    for (const n of ["north","east","south","west"] as const) { const g = new THREE.Group(); this.wallGroups.set(n,g); this.room.add(g); }
    const north = this.wallGroups.get("north")!, east=this.wallGroups.get("east")!, south=this.wallGroups.get("south")!, west=this.wallGroups.get("west")!;
    const horizontal = (g:THREE.Group,a:number,b:number,y:number,z:number,height:number) => box(g,a,y,z,b-a,t,height,plaster);
    horizontal(north,0,win.offset,d,0,h);
    horizontal(north,win.offset+win.width,w,d,0,h);
    horizontal(north,win.offset,win.offset+win.width,d,0,sill);
    horizontal(north,win.offset,win.offset+win.width,d,head,h-head);
    horizontal(south,0,door.offset,-t,0,h);
    horizontal(south,door.offset+door.width,w,-t,0,h);
    horizontal(south,door.offset,door.offset+door.width,-t,doorHead,h-doorHead);
    box(east,w,0,0,t,d,h,plaster); box(west,-t,0,0,t,d,h,plaster);
    const sash=t*.34;
    for (const z of [sill,head-sash]) box(north,win.offset,d,z,win.width,t,sash,trim);
    for (const x of [win.offset,win.offset+win.width/2-sash/2,win.offset+win.width-sash]) box(north,x,d,sill,sash,t,head-sill,trim);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.width,head-sill),new THREE.MeshStandardMaterial({color:0x99bcb4,transparent:true,opacity:.27,roughness:.3,side:THREE.DoubleSide,depthWrite:false}));
    glass.position.set(win.offset+win.width/2,(sill+head)/2,-d-t/2); north.add(glass);
    for (const [a,b] of [[0,door.offset],[door.offset+door.width,w]]) this.room.add(line([world([a,0,.006]),world([b,0,.006])],0x728176));
    this.room.add(line([world([0,0,.006]),world([0,d,.006]),world([w,d,.006]),world([w,0,.006])],0x728176));
    const arc: THREE.Vector3[] = [];
    for (let i=0;i<=32;i++) { const angle=i*Math.PI/64; arc.push(world([door.offset+door.width*Math.cos(angle),door.width*Math.sin(angle),.007])); }
    this.room.add(line(arc,0x9aaa99),line([world([door.offset,0,.008]),arc[arc.length-1]],0x627965));
    const step = Math.max(1,Math.ceil(longest/30));
    const grid=new THREE.Group();grid.name="room-grid";grid.visible=this.gridVisible;this.room.add(grid);
    for (let x=step;x<w;x+=step) grid.add(line([world([x,0,.002]),world([x,d,.002])],0xbec7bc));
    for (let y=step;y<d;y+=step) grid.add(line([world([0,y,.002]),world([w,y,.002])],0xbec7bc));
    this.shadow.target.position.set(w/2,0,-d/2);
    this.shadow.position.copy(this.shadow.target.position).add(new THREE.Vector3(-longest,longest*1.8,longest*.6));
    Object.assign(this.shadow.shadow.camera,{left:-longest,right:longest,top:longest,bottom:-longest,near:.01,far:longest*5});
    this.shadow.shadow.camera.updateProjectionMatrix();
  }
  invalidate = () => {
    if (this.frame || !this.visible || this.lost) return;
    this.frame = requestAnimationFrame(() => {
      this.frame=0;
      if (!this.visible || !this.drawing) return;
      this.draw();
    });
  };
  private draw() {
    {
      if (!this.drawing) return;
      const camera=this.eyeActive?this.eyeCamera:this.camera;
      const {room:r,instances} = this.drawing.scene, cam=camera.position;
      for (const [side,g] of this.wallGroups) {
        g.visible = side === "south" ? cam.z < 0 : side === "north" ? cam.z > -r.depth : side === "west" ? cam.x > 0 : cam.x < r.width;
      }
      this.renderer.render(this.scene,camera);
      this.afterRender?.(camera,this.width,this.height);
      const labels = document.createDocumentFragment();
      for (const i of instances) {
        const model = this.drawing.models.get(i.id);
        if (!model || !model.holder.visible) continue;
        const h = model.asset.manifest.totals.bbox.max[2]-model.release.anchor[2];
        const v = world([i.x,i.y,h+.09]).project(camera);
        if (v.z < -1 || v.z > 1) continue;
        const tag=document.createElement("span"); tag.className="rv-orbit-tag"; tag.textContent=i.label;
        tag.dataset.instance=i.id;
        if (this.drawing.selected === i.id) tag.setAttribute("data-active","");
        tag.style.left=((v.x+1)*this.width/2)+"px"; tag.style.top=((1-v.y)*this.height/2)+"px"; labels.append(tag);
      }
      this.tags.replaceChildren(labels);
    }
  }
  dispose() {
    this.finishGrab(false);
    this.visible=false; cancelAnimationFrame(this.frame); cancelAnimationFrame(this.glide);
    this.controls.dispose(); clearObjects(this.room); clearObjects(this.overlay);
    this.shadow.shadow.dispose(); this.environment.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.tags.remove();
  }
}
