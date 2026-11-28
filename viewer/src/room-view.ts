// Local camera and selection never write to the room. A pointer gesture commits one placement through the caller's scene writer.
import { disposeRoomAsset, loadRoomAsset, PlacedAsset, type RoomAsset } from "./room-assets-renderer.ts";
import { RoomPlan, type Drawing, type Lighting, type RoomMeasurement, type RoomViewCallbacks } from "./room-plan-renderer.ts";
import type { RoomOrbit } from "./room-orbit-renderer.ts";
import { mountLiveContent } from "./room-frames.ts";
import type { RoomAvatar } from "./room-person-renderer.ts";
import type { CameraPreset, RoomViewLink } from "./room-camera-state.ts";
import type { RoomInstance, RoomPoint, RoomRelease, RoomScene } from "../../shared/room.ts";
import type { JointValue } from "../../shared/pose.ts";

export type { RoomMeasurement, RoomPlacement, RoomViewCallbacks } from "./room-plan-renderer.ts";
export type RoomViewMode = "plan" | "3d";
export function mountRoomView(host: HTMLElement, callbacks: RoomViewCallbacks, options: { api?: string } = {}) {
  const stage = document.createElement("div"); stage.className="rv-stage rv-no-labels";
  const orbitHost=document.createElement("div"); orbitHost.className="rv-orbit"; orbitHost.hidden=true;
  const status=document.createElement("div"); status.className="rv-status"; status.setAttribute("role","status"); status.hidden=true;
  // The central progress card: what is loading or being prepared. The view stays movable meanwhile; X hides the card
  // until the work in progress is done.
  // Screen readers hear each new step, not every object count (the count is aria-hidden).
  const progressText=document.createElement("span"); progressText.setAttribute("role","status"); progressText.setAttribute("aria-live","polite");
  const progressCount=document.createElement("span"); progressCount.className="rv-progress-count"; progressCount.setAttribute("aria-hidden","true");
  const progressClose=document.createElement("button"); progressClose.type="button"; progressClose.className="rv-progress-close";
  progressClose.setAttribute("aria-label","Hide progress"); progressClose.title="Hide progress";
  progressClose.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const progress=document.createElement("div"); progress.className="rv-progress"; progress.hidden=true;
  progress.append(Object.assign(document.createElement("span"),{className:"rv-spinner"}),progressText,progressCount,progressClose);
  const busy=new Map<string,[string,string]>(); let progressDismissed=false;
  const setBusy=(key:string,message:string|null,count="")=>{
    if (message) busy.set(key,[message,count]); else busy.delete(key);
    if (!busy.size) progressDismissed=false;
    const [text,n]=[...busy.values()].at(-1) ?? ["",""];
    if (progressText.textContent!==text) progressText.textContent=text;
    progressCount.textContent=n; progress.hidden=!text || progressDismissed;
  };
  progressClose.onclick=()=>{progressDismissed=true;progress.hidden=true;};
  host.append(stage);
  const plan=new RoomPlan(stage,callbacks);
  stage.append(orbitHost,status,progress);
  const assets=new Map<string,RoomAsset>(), fetching=new Set<string>(), failures=new Map<string,string>();
  const models=new Map<string,PlacedAsset>();
  // live screen content: pages laid over the flat screens (room-frames.ts)
  const live=mountLiveContent({stage,api:options.api,model:id=>models.get(id),mode:()=>mode,lighting:()=>lighting});
  if (["127.0.0.1","localhost","[::1]"].includes(location.hostname)) (window as unknown as Record<string,unknown>).__synergonLive=live.debug;
  let posePreview:{instance:string;values:Record<string,JointValue>}|undefined;
  let poseFrame=0;
  let boundPreview=false;
  function applyPose(model:PlacedAsset,instance:RoomInstance) {
    const values=posePreview?.instance===instance.id ? posePreview.values : undefined;
    const posed=values ? {...instance,pose:{...instance.pose,...values}} : instance;
    model.apply(posed,mode==="plan");
    return posed;
  }
  function paintPoses(previewOnly=false) {
    if (!scene || disposed) return;
    for (const item of scene.instances) {
      const model=models.get(item.id);
      if (!model) continue;
      const posed=applyPose(model,item);
      if (scene.person?.host===item.id && (posed!==item || boundPreview)) {
        if (mode==="3d" && !loadingPerson) person?.previewPose(model,posed,scene.person);
        boundPreview=posed!==item;
      }
    }
    if (previewOnly && mode==="3d") orbit?.invalidate();
    else paint();
  }
  function schedulePose() {
    if (!poseFrame && !disposed) poseFrame=requestAnimationFrame(()=>{poseFrame=0;paintPoses(true);});
  }
  let scene:RoomScene | undefined, releases:RoomRelease[]=[];
  const hiddenParts = new Set<string>();
  let grid=true, labels=false, eye=false, lighting:Lighting="day";
  let colours:"natural"|"parts"|"evidence"="natural";
  const cameraChanged=()=>stage.dispatchEvent(new Event("room-camera-change",{bubbles:true}));
  const leaveEye=()=>{live.viewChanged();eye=false;orbit?.leaveEye();if(personKey && scene?.person)person?.show(true);cameraChanged();};
  let focused:string|null=null, paintedScope:string|null=null, focusEpoch=0;
  let roomReturn:RoomViewLink|undefined;
  const shownInstances=()=>focused ? scene?.instances.filter(i=>i.id===focused)??[] : scene?.instances??[];
  let selected:string|null=null, member:string|null=null, measurement:RoomMeasurement|null=null;
  let mode:RoomViewMode="plan", orbit:RoomOrbit|undefined, disposed=false;
  let orbitLoading:Promise<void>|undefined;
  let person:RoomAvatar|undefined, loadingPerson=false, personKey="", requestedPerson="", personEpoch=0, personWaiting=false;
  const notice = (message?:string) => { status.textContent=message ?? ""; status.hidden=!message; };
  const report = (e:unknown) => {
    const message=e instanceof Error ? e.message : String(e);
    notice(message); callbacks.onError?.(message);
  };
  function statusLine() {
    if (!scene) return;
    for (const i of shownInstances()) if (failures.has(i.release)) { notice(failures.get(i.release)); return; }
    const missing=shownInstances().filter(i => !models.has(i.id)).length, total=shownInstances().length;
    setBusy("objects", missing ? "Loading the scene." : null, missing ? (total-missing) + " of " + total : "");
    setBusy("operator", personWaiting && mode === "3d" ? "Seating the operator. You can already move the view." : null);
    notice();
  }
  function size() {
    const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
    plan.resize(w,h); orbit?.resize(w,h);
  }
  const observer=new ResizeObserver(size); observer.observe(stage);

  function paint() {
    if (!scene || disposed) return;
    const showMeasurement=!focused || measurement?.instances?.every(id=>id===focused);
    const data:Drawing={scene,releases,models,focused,selected,member,measurement:showMeasurement?measurement:null,hiddenParts,colours,lighting};
    for(const model of models.values())if(!focused || model.id===focused)model.applyDisplay(hiddenParts,colours);
    if (mode === "plan") plan.update(data);
    if (orbit && (mode==="3d" || focused!==paintedScope)) {orbit.update(data);paintedScope=focused;}
    live.paint();
  }

  async function syncPerson() {
    const seated=scene?.person, obj=scene?.instances.find(i=>i.id===seated?.host), model=obj && models.get(obj.id);
    const key=(mode==="3d" && orbit && seated && model && obj && (!focused || obj.id===focused)) ? JSON.stringify([model.release.id,obj.id,obj.pose,seated.state]) : "";
    if (key!==requestedPerson) { requestedPerson=key; personEpoch++; }
    if (!key) { person?.hide(); personKey=""; personWaiting=false;delete stage.dataset.seatedHost;delete stage.dataset.operatorPosture; return; }
    if (loadingPerson || personKey===key || !orbit || !seated || !model || !obj) return;
    const epoch=personEpoch;
    const current=()=>!disposed && personEpoch===epoch;
    // Rebinding hides and mutates the current avatar. If this job is superseded,
    // even returning to the previous key needs a fresh bind before it is visible.
    personKey="";
    loadingPerson=true; personWaiting=true; person?.hide(); statusLine();
    let error:unknown;
    try {
      const {RoomAvatar}=await import("./room-person-renderer.ts");
      if (!current()) return;
      person ??= new RoomAvatar(orbit.renderer);
      await person.seat(model,obj,seated,current);
      // build the figure's shaders in the background, so the first frame with it does not freeze the view
      const figure=person.object();
      if (current() && figure && orbit) await orbit.prepare(figure);
      if (current()) { personKey=key; stage.dataset.seatedHost=obj.id; stage.dataset.operatorPosture=seated.state.posture;person.show(!eye);orbit?.operatorReady(obj.id); }
    } catch (e) { if (current()) { personKey=key; error=e; } }
    finally {
      loadingPerson=false; personWaiting=false;
      if (!disposed) {
        if (personKey!==requestedPerson) void syncPerson();
        statusLine(); if (error) report(error); orbit?.invalidate();
      }
    }
  }

  function assetsChanged() {
    if (!scene || disposed) return;
    for (const [id,model] of models) {
      if (!scene.instances.some(i=>i.id===id && i.release===model.release.id)) { model.dispose(); models.delete(id); }
    }
    for (const i of scene.instances) {
      let model=models.get(i.id);
      if (!model) {
        const rel=releases.find(r=>r.id===i.release);
        if (!rel) { failures.set(i.release,"Missing installed release " + i.release); continue; }
        const source=assets.get(rel.id);
        if (!source) {
          if (!fetching.has(rel.id) && !failures.has(rel.id)) {
            fetching.add(rel.id);
            void loadRoomAsset(rel).then(loaded => { if (disposed) disposeRoomAsset(loaded); else assets.set(rel.id,loaded); })
              .catch(e=>{
                if(disposed)return;
                failures.set(rel.id,String(e instanceof Error ? e.message : e));
                if(shownInstances().some(i=>i.release===rel.id))report(e);
              })
              .finally(()=>{ fetching.delete(rel.id); assetsChanged(); });
          }
          continue;
        }
        model=new PlacedAsset(source,rel,i.id); models.set(i.id,model);
      }
      applyPose(model,i);
    }
    if (!scene.person) {delete stage.dataset.seatedHost;delete stage.dataset.operatorPosture;}
    paint(); void syncPerson(); statusLine();
  }

  async function switchView(next:RoomViewMode) {
    if (disposed) return;
    if(next==="plan")leaveEye();
    mode=next; live.viewChanged(); plan.cancel(); plan.svg.style.display=mode==="plan" ? "block" : "none";
    stage.dataset.view=mode; orbitHost.hidden=mode!=="3d";
    orbit?.show(mode==="3d");
    if (next==="3d" && !orbit) {
      orbitLoading ??= (async()=>{
        setBusy("3d","Opening the 3D view.");
        try {
          const {RoomOrbit}=await import("./room-orbit-renderer.ts");
          if (disposed) return;
          orbit=new RoomOrbit(orbitHost,{...callbacks,onBusy:setBusy});
          live.attach(orbit);
          orbit.show(mode==="3d");orbit.showGrid(grid);size();
        } catch(e) {
          if (!disposed) { mode="plan";stage.dataset.view=mode;orbitHost.hidden=true;plan.svg.style.display="block";report(e); }
        } finally {orbitLoading=undefined;setBusy("3d",null);}
      })();
      await orbitLoading;
    }
    paintPoses(); void syncPerson(); statusLine();
  }
  function cameraState():RoomViewLink {
    return { mode,selected,member,plan:plan.cameraState(),...(focused?{focused}:{}),...(labels?{labels:true}:{}),
      ...(mode==="3d" && orbit?{orbit:orbit.cameraState(),eye,...(eye?{look:orbit.lookState()}:{})}:{}) };
  }
  async function focusAsset(id:string|null,exitMode?:RoomViewMode) {
    if (!scene || disposed || id===focused)return;
    if (id && !scene.instances.some(i=>i.id===id))throw new Error("This object is no longer in the room.");
    const epoch=++focusEpoch;
    if (id && !focused) {
      roomReturn=cameraState();
      // Plan and orbit keep distinct navigation. Preserve the inactive room orbit too.
      if (orbit)roomReturn.orbit=orbit.cameraState();
    }
    const previous=roomReturn;
    leaveEye();focused=id;
    if (id) {
      if (selected!==id)member=null;
      selected=id;stage.dataset.focusedAsset=id;
      await switchView("3d");
      if(epoch!==focusEpoch || disposed)return;
      if(mode!=="3d") {await focusAsset(null,"plan");return;}
    } else {
      delete stage.dataset.focusedAsset;roomReturn=undefined;
      await switchView(exitMode??previous?.mode??"plan");
      if(epoch!==focusEpoch || disposed)return;
      const item=scene.instances.find(i=>i.id===previous?.selected);
      selected=item?.id??null;
      const validMember=item && (previous?.member==="@operator" ? scene.person?.host===item.id :
        releases.find(r=>r.id===item.release)?.members.some(m=>m.id===previous?.member));
      member=validMember?previous!.member:null;
      size();
      if(previous?.plan)plan.restoreCamera(previous.plan);
      if(previous?.orbit)orbit?.restoreCamera(previous.orbit);
      paint();
    }
    callbacks.onFocusChange?.(focused,mode,selected,member??undefined);
    stage.dispatchEvent(new CustomEvent("room-focus-change",{bubbles:true,detail:{
      restoreEye:!id && mode==="3d" && previous?.eye,look:previous?.look
    }}));
  }
  const setView=(next:RoomViewMode)=>focused && next==="plan" ? focusAsset(null,"plan") : switchView(next);
  stage.dataset.view=mode;
  return {
    previewPose(instance:string,values:Record<string,JointValue>) {posePreview={instance,values};schedulePose();},
    clearPosePreview() {if (posePreview) {posePreview=undefined;schedulePose();}},
    setScene(next:RoomScene,catalog:RoomRelease[]) {
      if (disposed) return;
      scene=next; releases=catalog;
      live.setScene(next);
      if(focused && !scene.instances.some(i=>i.id===focused))void focusAsset(null);
      if (selected && !scene.instances.some(i=>i.id===selected)) { selected=null; member=null; measurement=null; }
      assetsChanged();
    },
    select(id:string|null,memberId?:string) {
      selected=focused??id; member=!focused || focused===id?memberId??null:null; paint();
    },
    setView, focusAsset, focusedAsset:()=>focused,
    getView():RoomViewMode { return mode; },
    setMeasurement(value:RoomMeasurement|null) { measurement=value; paint(); },
    fit() { leaveEye(); if (mode==="plan") plan.fit(); else orbit?.fit(); },
    preset(preset:CameraPreset) {leaveEye();orbit?.fit(preset);},
    eye(from:RoomPoint,to:RoomPoint) {
      if(!orbit || mode!=="3d") throw new Error("Open the 3D view to use the operator’s eye.");
      live.viewChanged();orbit.eye(from,to);eye=true;person?.hide();cameraChanged();
    },
    leaveEye,
    cameraState,
    restoreLook(state:NonNullable<RoomViewLink["look"]>) {orbit?.restoreLook(state);},
    restoreCamera(state:RoomViewLink){size();if(state.plan)plan.restoreCamera(state.plan);if(state.orbit)orbit?.restoreCamera(state.orbit);},
    releases(){return releases;},
    display(){return {grid,labels,colours,lighting};},
    /** True when a shown asset has lamps (the Settings switch is offered only then). */
    hasLamps(){return [...models.values()].some(m=>m.lamps.length>0);},
    /** How many lamps a placed asset has (0 until its model has loaded). */
    lampCount(instance:string){return models.get(instance)?.lamps.length ?? 0;},
    setDisplay(next:{grid:boolean;labels:boolean;colours:"natural"|"parts"|"evidence";lighting:Lighting}){
      grid=next.grid;labels=next.labels;colours=next.colours;lighting=next.lighting;paint();
      stage.classList.toggle("rv-no-grid",!grid);stage.classList.toggle("rv-no-labels",!labels);orbit?.showGrid(grid);
    },
    components(instance:string){
      const i=scene?.instances.find(i=>i.id===instance),release=releases.find(r=>r.id===i?.release);
      return (release?.members??[]).filter(m=>m.kind==="part" || /^[CS]_/.test(m.id)).map(m=>({id:m.id,label:m.label,visible:!hiddenParts.has(instance+"/"+m.id)}));
    },
    setComponentVisible(instance:string,member:string,visible:boolean){
      const key=instance+"/"+member;if(visible)hiddenParts.delete(key);else hiddenParts.add(key);paint();
    },
    showAllComponents(){
      if(focused) {for(const key of hiddenParts)if(key.startsWith(focused+"/"))hiddenParts.delete(key);}
      else hiddenParts.clear();paint();
    },
    async picture(){if(shownInstances().some(i=>failures.has(i.release)))throw new Error("Resolve the missing asset before saving its picture.");
      if(shownInstances().some(i=>!models.has(i.id)) || personWaiting)throw new Error("The scene is still loading. Try again after its assets appear.");
      const withLive=mode==="3d" && live.liveVisible();
      const {roomPicture}=await import("./room-picture.ts");return roomPicture(stage,mode,withLive?{plates:()=>live.plates()}:undefined);},
    /** Live screen content (room-frames.ts): states, Use and the Settings switch for the configurator. */
    content:live.api,
    /** The viewer token from the scene's live stream (for the reports of what this viewer shows). */
    setViewer(token:string){live.setViewer(token);},
    dispose() {
      if (disposed) return;
      disposed=true;cancelAnimationFrame(poseFrame); personEpoch++; observer.disconnect(); plan.cancel(); person?.dispose(); live.dispose();
      for (const model of models.values()) model.dispose();
      orbit?.dispose();
      for (const asset of assets.values()) disposeRoomAsset(asset);
      stage.remove(); assets.clear(); models.clear();
    },
  };
}
