// The scene editor. The same command endpoint and event stream serve the UI and remote clients.
import { API, apiRoot, publicSite, sceneURL } from './room-paths.ts';
import { h, link } from './dom.ts';
import { action, brand, displayNumber, field, icon, iconAction, section, select, wirePanel, type Glyph } from './room-controls.ts';
import { sliderRow, type SliderSpec, type Drag } from "./room-slider.ts";
import { componentCard, componentPanel, floatingCard, placeFloatingCard, replaceComponentCard, type BeginPoseGesture } from './room-component-card.ts';
import {mountRoomWorkspaceTools} from './room-workspace-tools.ts';
import { roomScope } from './room-scope.ts';
import { mountRoomView } from './room-view.ts';
import { readRoomViewLink } from './room-camera-state.ts';
import { DEMO_WORKSPACE, firstNote, forgetScene, hierarchy, lastScene, openDemo, rememberScene, rememberWorkspace, type Place } from './hierarchy.ts';
import { cctColour } from '../../shared/light-colour.ts';
import { effectiveLighting, type RoomInstance, type RoomJoint, type RoomLighting, type RoomPoint, type RoomRef, type RoomRelease, type RoomScene } from '../../shared/room.ts';
import {roomOperatorControls} from './room-operator-controls.ts';
import { embeddable, frameAddress, type AppSource, type SceneContent } from '../../shared/room-content.ts';
import { liveStorage, screenKey } from './room-content.ts';

type PanelTab = 'layout' | 'measure' | 'assessment';
type Args = Record<string, unknown>;
interface Receipt<T> { ok: boolean; version: number; recorded: number | null; result: T }
interface Distance { metres: number; from: RoomRef & { point: RoomPoint }; to: RoomRef & { point: RoomPoint } }
interface Span { metres: number; edges: [string, string] }
interface Clearance extends Span { opening: Span }
const shortRelease = (release: RoomRelease) => release.label + ' · v' + release.version + (release.retained ? ' (earlier build)' : '');
const distanceFormat = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false });
const metres = (n: number) => distanceFormat.format(n) + ' m';
/** Menu labels drop the modeller's ": lit area" suffix. */
const plainLabel = (label: string) => label.replace(/:\s*lit area$/i, '');

class RoomApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(url: string, body?: Args): Promise<T> {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Synergon': '1', 'X-Synergon-Client': 'person' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false || json === null) {
    const error = json?.error;
    throw new RoomApiError([error?.message || 'The server could not complete the request.', error?.hint].filter(Boolean).join(' '), response.status);
  }
  return json as T;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
/** A page of its own: the start screen, a missing scene or an error. */
function page(title: string, ...content: (Node | string | false)[]) {
  document.title = title.replace(/\.$/, '') + ' · Synergon';
  document.body.replaceChildren(h('main', 'rm-directory', brand(), h('div', 'rm-directory-main rm-start', h('h1', null, title), ...content)));
}
/** "Open demo": this browser's demo scene, reset to the furnished default on the click (never on a GET), and opened. */
function startButton(label: string, ...beside: Node[]) {
  const error = h('p', 'rm-error'); error.hidden = true; error.setAttribute('role', 'alert');
  const start = action(label, () => {
    start.disabled = true; error.hidden = true; start.querySelector('span')!.textContent = 'Opening the demo…';
    void openDemo().then(scene => location.replace(sceneURL(scene))).catch(e => {
      error.textContent = errorText(e); error.hidden = false; start.disabled = false; start.querySelector('span')!.textContent = label;
    });
  }, undefined, 'rm-primary rm-start-button');
  return h('div', 'rm-start-actions', h('div', 'rm-start-row', start, ...beside), error);
}
export async function startRoomApp() {
  document.body.className = 'room-app'; document.documentElement.classList.remove('page');
  // Earlier public links: /workspaces/room/{id} is now /workspaces/{id}; the retired directory went to the homepage.
  let path = location.pathname.replace(/\/+$/, '');
  const earlier = /^\/workspaces\/room(\/.*)?$/.exec(path);
  if (earlier) { path = '/workspaces' + (earlier[1] ?? ''); history.replaceState(history.state, '', path + location.search + location.hash); }
  if (path === '/workspaces' && new URLSearchParams(location.search).has('list')) { location.replace('/'); return; }
  const id = path.startsWith('/workspaces/') ? decodeURIComponent(path.slice('/workspaces/'.length)) : '';
  document.body.replaceChildren(h('main', 'rm-loading', brand(), h('p', null, 'Opening your scene…')));
  try {
    if (!id) {
      const last = await lastScene();
      if (last) { location.replace(sceneURL(last)); return; }
      page('Start with the demo', h('p', 'rm-help rm-start-text', 'A furnished control room in 3D. Move, adjust and measure anything in it; it resets each time you open it.'),
        startButton('Open demo', link('Homepage', '/', 'rm-link')));
      return;
    }
    const [scene, { releases }, where, isPublic] = await Promise.all([request<RoomScene>(apiRoot(id) + '/state'), request<{ releases: RoomRelease[] }>(API + '/catalog'),
      request<Omit<Place, 'scene'>>(apiRoot(id) + '/meta'), publicSite()]);
    // A demo scene is never the "last scene" and never joins the browser's list of workspaces.
    const demo = where.workspace.id === DEMO_WORKSPACE;
    if (!demo) { rememberScene(scene.id); rememberWorkspace(where.workspace.id); }
    editor(scene, releases, { workspace: where.workspace, project: where.project, scene: { id: scene.id, name: scene.name } }, isPublic, demo);
  } catch (error) {
    if (id && error instanceof RoomApiError && [400, 404].includes(error.status)) {
      forgetScene(id);
      page('This scene no longer exists.', h('p', 'rm-help rm-start-text', 'Its link may be mistyped, or the scene was removed.'), startButton('Open demo', link('Homepage', '/', 'rm-link')));
      return;
    }
    page('Scene unavailable', h('p', 'rm-error', errorText(error)), action('Try again', () => location.reload()));
  }
}

/** Choose an unoccupied starting position inside the room when space permits. Placement remains editable. */
function initialPlacement(scene: RoomScene, asset: RoomRelease, releases: Map<string, RoomRelease>) {
  const { width, depth } = scene.room;
  const bounds = (item: RoomInstance) => {
    const footprint = releases.get(item.release)?.footprint;
    if (!footprint) return [item.x, item.y, item.x, item.y];
    const angle = item.yaw * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const corners = [footprint.min[0], footprint.max[0]].flatMap(x => [footprint.min[1], footprint.max[1]].map(y => [item.x + x * cos - y * sin, item.y + x * sin + y * cos]));
    return [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))];
  };
  const boxes = scene.instances.map(bounds), { min, max } = asset.footprint;
  for (const fy of [.55, .3, .75, .15, .9]) for (const fx of [.35, .65, .5, .18, .82]) {
    const x = Number((width * fx).toFixed(2)), y = Number((depth * fy).toFixed(2));
    const west = x + min[0], east = x + max[0], south = y + min[1], north = y + max[1];
    if (west < 0 || east > width || south < 0 || north > depth) continue;
    if (boxes.every(([w, s, e, n]) => east + .15 < w || west - .15 > e || north + .15 < s || south - .15 > n)) return { x, y };
  }
  return { x: width / 2, y: depth / 2 };
}

function editor(first: RoomScene, releases: RoomRelease[], where: Place, isPublic: boolean, demo: boolean) {
  let scene = first, selected: string | null = null, member = '', tab: PanelTab = 'layout', library = false;
  let mode: 'plan' | '3d' = 'plan', measurementToken = 0, chosenRelease = releases.find(r => !r.retained)?.id ?? '', newLabel = '';
  let undoable = scene.version > 0, undoToken = 0, addId = '';
  const api = apiRoot(scene.id), byRelease = new Map(releases.map(r => [r.id, r]));
  const expanded = new Set<string>(), chosenJoints = new Map<string, string>();
  const from: RoomRef = { instance: '', member: 'floor' }, to: RoomRef = { instance: '', member: 'floor' };
  const current = () => scene.instances.find(i => i.id === selected);
  const pane = h('aside', 'rm-panel'); pane.id = 'room-controls'; pane.setAttribute('aria-label', 'Scene panel');
  const hide = iconAction('Collapse panel', () => {}, 'collapse'), open = iconAction('Open scene panel', () => {}, 'expand');
  open.classList.add('rm-reopen'); open.setAttribute('aria-controls', pane.id);
  const resize = h('div', 'rm-grip');
  // Workspace › Project on a muted first line, the scene as the panel's heading.
  const selector = hierarchy({ place: 'editor', here: where, renamed: s => { if (s.id === scene.id) { scene = { ...scene, name: s.name }; document.title = s.name + ' · Synergon'; } } });
  const home=brand();home.classList.add('rm-home-symbol');
  const railTop=h('div','rm-brand-row',home,selector.node,hide);
  const scroll = h('div', 'rm-scroll'), stage = h('div', 'room-viewport'), live = h('span', 'rm-live', 'Connecting');
  const scope = roomScope(focusAsset);
  const viewHelp = h('span', 'rm-view-help');
  const versionText = h('span', 'rm-version');
  const stageFoot = h('footer', 'rm-stage-foot', viewHelp, h('div', 'rm-status', live, versionText));
  const notice = h('div', 'rm-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  const drawing = h('main', 'rm-drawing', scope.node, stage, stageFoot, notice);
  drawing.style.isolation='isolate';
  drawing.tabIndex=-1;
  const tabs = h('div', 'rm-tabs');
  const layoutTab = action('Layout', () => changeTab('layout'), 'layers'), measureTab = action('Measure', () => changeTab('measure'), 'measure');
  const assessTab = action('Assessment', () => changeTab('assessment'));
  tabs.append(layoutTab, measureTab, assessTab);
  // One toggle in the view controls switches the drawing between the 2D plan and the 3D view.
  const modeButton = (label: string, target: typeof mode, name: string) => {
    const b = h('button', 'rm-mode-option', label); b.type = 'button'; b.title = name; b.setAttribute('aria-label', name);
    b.onclick = () => { if (mode !== target) void setMode(target); }; return b;
  };
  const plan2d = modeButton('2D', 'plan', '2D plan'), view3d = modeButton('3D', '3d', '3D view');
  const modeToggle = h('div', 'rm-mode-toggle', plan2d, view3d);
  modeToggle.setAttribute('role', 'group'); modeToggle.setAttribute('aria-label', 'View');
  const fit = iconAction('Fit room to view', () => view.fit(), 'fit');
  const undo = iconAction('Undo latest change', () => void write('undo', {}), 'undo');
  const toolbar=h('div','rm-workspace-toolbar');
  const nav=h('div','rm-panel-foot',fit,undo);
  pane.append(railTop,tabs,scroll,h('footer','rm-panel-tools',nav,toolbar));
  const shell = h('div', 'rm-shell', pane, resize, drawing, open); document.body.replaceChildren(shell);
  wirePanel(shell, pane, resize, open, hide);
  let placementVersion = scene.version;
  let scopeBefore: string|null=null, roomTab: PanelTab | undefined;
  const view = mountRoomView(stage, {
    onFocusChange: (id,nextMode,instance,part) => {
      if(id && !scopeBefore) roomTab=tab;
      scopeBefore=id;
      mode=nextMode;
      for (const [frame,ref] of popouts) frame.hidden=!!id && ref.instance!==id;
      if (tab==='assessment') assessment?.deactivate();
      tab='layout';library=false;
      syncMode();
      choose(instance ?? id,part);
      if (!id && roomTab) {const restore=roomTab;roomTab=undefined;if(restore!==tab) changeTab(restore);}
      workspaceTools.refresh();
    },
    onSelect: (id, part, additional) => { pickComponent(id, part, additional); },
    onAdjust: (id,values,version) => {
      const item=scene.instances.find(i=>i.id===id), release=item && byRelease.get(item.release);
      const assumed=release?.joints.some(j=>j.assumed && j.locked && Object.hasOwn(values,j.id));
      void write('pose.apply',{instance:id,values,...(assumed?{allowAssumed:true}:{})},version);
    },
    onPlace: (id, placement) => { void write('instances.move', { instance: id, ...placement }, placementVersion).then(ok => { if (!ok) view.setScene(scene, releases); }); },
    onError: message => tell(message, true),
  }, { api: apiRoot(first.id) });
  stage.addEventListener('pointerdown', () => { placementVersion = scene.version; }, true);
  async function focusAsset(id:string|null) {
    try { await view.focusAsset(id); }
    catch(error) { tell(errorText(error),true); }
  }
  function syncMode() {
    const focused=view.focusedAsset();
    scope.update(scene,focused,mode);
    const fitLabel=focused?'Fit asset to view':'Fit room to view';
    fit.title=fitLabel;fit.setAttribute('aria-label',fitLabel);
    modeToggle.dataset.mode = mode;
    plan2d.setAttribute('aria-pressed', String(mode === 'plan')); view3d.setAttribute('aria-pressed', String(mode === '3d'));
    viewHelp.textContent = mode === 'plan' ? 'Drag to place or pan · Scroll to zoom' : 'Drag to orbit · Scroll to zoom';
  }
  async function setMode(next: typeof mode) {
    await view.setView(next);
    mode=view.getView();syncMode();
  }
  let assessment: ReturnType<typeof import('./assessment-panel.ts').createAssessmentPanel> | undefined;
  let assessmentLoading = false;
  async function loadAssessment() {
    if (assessmentLoading) return;
    assessmentLoading = true;
    try {
      const { createAssessmentPanel } = await import('./assessment-panel.ts');
      assessment = createAssessmentPanel({workspaceId: first.id, apiRoot: api, getScene: () => scene, showMeasurement: value => view.setMeasurement(value)});
      if (tab === 'assessment') renderPanel();
    } catch (error) {
      if (tab === 'assessment') scroll.replaceChildren(h('p', 'rm-error', 'Assessment could not open. ' + errorText(error)),
        action('Retry', () => void loadAssessment()));
    } finally { assessmentLoading = false; }
  }
  function changeTab(next: typeof tab) { if (tab === 'assessment' && next !== tab) assessment?.deactivate(); tab = next; library = false; renderPanel(); }
  let docked: { instance:string; part:string } | null = null;
  const popouts = new Map<HTMLElement,{instance:string;part:string}>();
  const fitPopouts=new ResizeObserver(()=>{for (const frame of popouts.keys()) placeFloatingCard(frame);});
  fitPopouts.observe(drawing);
  let primaryPopup:HTMLElement|undefined;
  let poseGesture:{card:HTMLElement;accept:(next:RoomScene)=>void;cancel:()=>void}|undefined;
  function poseGestureFor(item:RoomInstance,part:string,popup?:HTMLElement):BeginPoseGesture {
    return (card,joints,reset)=>{
      poseGesture?.cancel();
      const started=scene.version;
      const signature=(i:RoomInstance)=>JSON.stringify(joints.map(j=>i.pose[j.id] ?? j.neutral));
      const initial=signature(item);
      let committing=false;
      function stop(revert:boolean,refresh=true) {
        if (poseGesture!==active) return;
        poseGesture=undefined;delete card.dataset.poseGesture;view.clearPosePreview();
        if(revert)reset();
        if (refresh && scene.version!==started && card.isConnected) {
          const replacement=cardFor(item.id,part,popup);
          if (replacement) replaceComponentCard(card.parentElement!,replacement);
        }
      }
      const active={card,cancel:()=>stop(true),accept:(next:RoomScene)=>{
        const target=next.instances.find(i=>i.id===item.id && i.release===item.release);
        if (target && signature(target)===initial) return;
        // accept() will rebuild this card from the new authoritative snapshot.
        stop(!committing,false);
        if (!committing) tell('This adjustment changed in another edit. The latest values are shown.',true);
      }};
      poseGesture=active;card.dataset.poseGesture='';
      return {
        update(values) {if (poseGesture===active) view.previewPose(item.id,values);},
        commit(values) {
          if (poseGesture!==active) return;
          if (joints.every(j=>JSON.stringify(values[j.id])===JSON.stringify(item.pose[j.id] ?? j.neutral))) {stop(true);return;}
          committing=true;
          const assumed=joints.some(j=>j.locked && j.assumed);
          const entries=Object.entries(values);
          const single=entries.length===1;
          const args=single ? {instance:item.id,member:entries[0][0],value:entries[0][1]} : {instance:item.id,values};
          void write(single?'pose.set':'pose.apply',{...args,...(assumed?{allowAssumed:true}:{})},scene.version).then(ok=>stop(!ok));
        },
        cancel:active.cancel,
      };
    };
  }
  function raisePopup(frame:HTMLElement) {
    const ref=popouts.get(frame);
    if (!ref) return;
    popouts.delete(frame); popouts.set(frame,ref);
    let order=4;
    for (const card of popouts.keys()) card.style.zIndex=String(order++);
  }
  function clearPopup(frame:HTMLElement) {
    cancelLayoutDrag?.();
    if (poseGesture && frame.contains(poseGesture.card)) poseGesture.cancel();
    const focused=frame.contains(document.activeElement);
    fitPopouts.unobserve(frame);
    popouts.delete(frame); frame.remove(); if (primaryPopup === frame) primaryPopup=undefined;
    if (focused) ([...popouts.keys()].at(-1) ?? drawing).focus({preventScroll:true});
  }
  function dockPopup(frame:HTMLElement) {
    const ref=popouts.get(frame);
    if (!ref) return;
    clearPopup(frame);
    if (pane.inert) open.click();
    choose(ref.instance,ref.part);
    scroll.querySelector<HTMLElement>('.rm-card-head button')?.focus({preventScroll:true});
  }
  // Layout and body drags only preview locally. Save once on release against the starting revision.
  let cancelLayoutDrag:(()=>void)|undefined;
  function sceneSlider(f:SliderSpec, key:string, save:(value:number)=>Promise<boolean>, change:(draft:RoomScene,n:number)=>void) {
    const field=sliderRow(f,save,(read,reset)=>{
      cancelLayoutDrag?.();
      let frame=0;
      const cancel=()=>{
        cancelAnimationFrame(frame);
        if(cancelLayoutDrag!==cancel)return;
        cancelLayoutDrag=undefined;reset();view.setScene(scene,releases);
      };
      cancelLayoutDrag=cancel;
      const gesture:Drag={
        update(){
          if(!frame && cancelLayoutDrag===cancel)frame=requestAnimationFrame(()=>{
            frame=0;if(!field.row.isConnected){cancel();return;}
            const draft=structuredClone(scene);change(draft,read());view.setScene(draft,releases);
          });
        },
        commit(){
          if(cancelLayoutDrag!==cancel)return;
          cancelAnimationFrame(frame);cancelLayoutDrag=undefined;
          const n=read();
          if(n===f.value){reset();view.setScene(scene,releases);return;}
          void save(n).then(ok=>{if(!ok && !cancelLayoutDrag){reset();view.setScene(scene,releases);}});
        },
        cancel
      };
      return gesture;
    },key+"/"+f.key);
    return field.row;
  }
  function bodySlider(item:RoomInstance,base:number,f:SliderSpec) {
    return sceneSlider(f,item.id+"/body",n=>write("person.set",{host:item.id,body:{[f.key]:n}},base),
      (draft,n)=>{if(draft.person?.host===item.id)draft.person.state.body[f.key]=n;});
  }
  function cardFor(instance:string, part:string, popup?:HTMLElement):HTMLElement|null {
    const item=scene.instances.find(i=>i.id===instance), release=item && byRelease.get(item.release);
    if (!item || !release) return null;
    const base=scene.version;
    const close=()=>{if (popup) clearPopup(popup);else {docked=null;choose(instance);}};
    const pop=popup ? undefined : ()=>{docked=null;openPopup(instance,part,false);renderPanel();};
    const dock=popup ? ()=>dockPopup(popup) : undefined;
    function addScopeLink(card:HTMLElement) {
      const owner=card.querySelector<HTMLElement>('.rm-kicker');
      if (owner && view.focusedAsset()!==item!.id) {
        const link=h('button','rm-card-scope',item!.label,icon('next'));
        link.type='button';link.title='Focus on '+item!.label;link.setAttribute('aria-label',link.title);
        link.onclick=()=>void focusAsset(instance);owner.replaceChildren(link);
      }
      return card;
    }
    if (part === '@operator' && scene.person?.host === instance) {
      const card=componentPanel('Operator',item,part,close,pop,dock);
      const fields=roomOperatorControls({item,release,scene,apiRoot:api,write,bodySlider:f=>bodySlider(item,base,f),embedded:true,details});
      card.append(fields);return addScopeLink(card);
    }
    if (!release.members.some(m=>m.id===part)) return null;
    return addScopeLink(componentCard({item,release,part,close,pop,dock,beginGesture:poseGestureFor(item,part,popup),
      screen:screenControls(item,part),
      edit:(joint,value)=>write('pose.set',{instance,member:joint.id,value,...(joint.locked && joint.assumed ? {allowAssumed:true} : {})},base),
      apply:values=>write('pose.apply',{instance,values,...(release.joints.some(j=>j.assumed && j.locked && Object.hasOwn(values,j.id))?{allowAssumed:true}:{})},base),
      placement:()=>{if (popup) clearPopup(popup); if (shell.classList.contains('rm-panel-closed')) open.click(); choose(instance);},
    }));
  }
  function openPopup(instance:string,part:string,additional:boolean) {
    if (!additional && primaryPopup) clearPopup(primaryPopup);
    const frame=floatingCard(drawing,popouts.size);
    const card=cardFor(instance,part,frame);
    if (!card) {frame.remove();return;}
    frame.replaceChildren(card);popouts.set(frame,{instance,part});
    frame.setAttribute('aria-label',card.getAttribute('aria-label') ?? card.querySelector('h2')?.textContent ?? 'Controls');
    frame.addEventListener('focusin',()=>raisePopup(frame));
    frame.addEventListener('pointerdown',()=>raisePopup(frame));
    fitPopouts.observe(frame);
    frame.focus({preventScroll:true});
    if (!additional) primaryPopup=frame;
  }
  function hasInspector(item:RoomInstance | undefined, part:string | undefined) {
    if (!item || !part) return false;
    if (part === '@operator') return scene.person?.host === item.id;
    return byRelease.get(item.release)?.members.some(m=>m.id===part) ?? false;
  }
  function pickComponent(id:string|null,part?:string,additional=false) {
    const item=scene.instances.find(i=>i.id===id);
    if (!item || !part || !hasInspector(item,part)) {choose(id);return;}
    if (additional || shell.classList.contains('rm-panel-closed')) {
      selected=item.id;member=part;view.select(item.id,part);openPopup(item.id,part,additional);return;
    }
    choose(item.id,part);
  }
  function choose(id: string | null, part = '') {
    id ??= view.focusedAsset();
    selected = id; member = part;
    docked = id && part ? {instance:id,part} : null;
    if (docked) { if (tab === 'assessment') assessment?.deactivate(); tab='layout'; scroll.scrollTop=0; }
    if (tab === 'layout') library = false;
    view.select(selected, member || undefined); renderPanel();
  }
  function tell(message: string, error = false, undoable = false) {
    notice.classList.toggle('rm-error', error); notice.classList.remove('rm-notice-top'); notice.setAttribute('role', error ? 'alert' : 'status');
    const undoNow = undoable ? action('Undo', () => { notice.hidden = true; void write('undo', {}); }, undefined, 'rm-text-action') : null;
    notice.replaceChildren(h('span', null, message), ...(undoNow ? [undoNow] : []), iconAction('Dismiss message', () => { notice.hidden = true; }, 'close'));
    notice.hidden = false;
  }
  function command<T>(id: string, args: Args, expectedVersion?: number) {
    return request<Receipt<T>>(api + '/command', { id, args, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
  }
  async function write(id: string, args: Args, base = scene.version) {
    try {
      const reply = await command(id, args, base);
      if (reply.version > scene.version) accept(await request<RoomScene>(api + '/state'));
      notice.hidden = true;
      return true;
    } catch (error) { tell(errorText(error), true); return false; }
  }
  /** A content command: its result, or null after saying why it was refused. */
  async function contentWrite<T>(id: string, args: Args): Promise<T | null> {
    try {
      const reply = await command<T>(id, args, scene.version);
      if (reply.version > scene.version) accept(await request<RoomScene>(api + '/state'));
      notice.hidden = true;
      return reply.result;
    } catch (error) { tell(errorText(error), true); return null; }
  }
  function afterTyping(container:HTMLElement,refresh:()=>void) {
    const row=container.querySelector<HTMLElement>('[data-typing]');
    if(!row){refresh();return;}
    if(row.dataset.refreshPending)return;
    row.dataset.refreshPending="1";
    row.addEventListener("room-edit-end",()=>queueMicrotask(()=>{if(row.isConnected)refresh();}),{once:true});
  }
  function accept(next: RoomScene) {
    if (next.id !== scene.id || next.version < scene.version) return;
    // A rename and live lighting values (a simulation's) keep the revision: take the name and the lighting only.
    if (next.version === scene.version) {
      if (next.name !== scene.name) { scene = { ...scene, name: next.name }; selector.scene(next.name); document.title = next.name + ' · Synergon'; }
      if (JSON.stringify(next.lighting) !== JSON.stringify(scene.lighting)) {
        scene = { ...scene, lighting: next.lighting }; view.setScene(scene, releases); lightingChanged();
        if (selected === null) afterTyping(scroll, renderPanel);
      }
      return;
    }
    if (JSON.stringify(next.lighting) !== JSON.stringify(scene.lighting)) queueMicrotask(lightingChanged);
    cancelLayoutDrag?.();
    scene = next;
    poseGesture?.accept(next);
    if (selected && !current()) { selected = null; member = ''; }
    if (member && !hasInspector(current(),member)) member='';
    for (const [frame, ref] of [...popouts]) {
      const card=cardFor(ref.instance,ref.part,frame);
      if (!card) clearPopup(frame);
      else if (!frame.querySelector('[data-typing]')) replaceComponentCard(frame,card);
      else afterTyping(frame,()=>{
        const latest=cardFor(ref.instance,ref.part,frame);
        if(latest)replaceComponentCard(frame,latest);
      });
    }
    if (docked && !hasInspector(scene.instances.find(i=>i.id===docked!.instance),docked.part)) docked=null;
    view.setScene(scene, releases); view.select(selected, member || undefined); afterTyping(scroll,renderPanel); workspaceTools.refresh(); void updateUndo();
  }
  async function updateUndo() {
    const n = ++undoToken, v = scene.version;
    if (!v) { undo.disabled = true; return; }
    try {
      const r = await command<{ undoable: number[] }>('state', {});
      if (n === undoToken && r.version === scene.version) { undoable = r.result.undoable.length > 0; undo.disabled = !undoable; }
    } catch { /* undo remains available if the server is reconnecting */ }
  }
  const stream = new EventSource(api + '/live');
  stream.addEventListener('snapshot', event => {
    try { accept(JSON.parse((event as MessageEvent<string>).data) as RoomScene); }
    catch (error) { tell('Could not read the latest layout. ' + errorText(error), true); }
  });
  // the token this viewer reports what its screens show with (live screen content, GET …/content's `seen`)
  stream.addEventListener('viewer', event => {
    try { const token = JSON.parse((event as MessageEvent<string>).data)?.viewer; if (typeof token === 'string') view.setViewer(token); } catch { /* an older server */ }
  });
  stream.onopen = () => { live.textContent = 'Live'; live.classList.add('rm-connected'); };
  stream.onerror = () => { live.textContent = 'Reconnecting'; live.classList.remove('rm-connected'); };
  window.addEventListener('pagehide', event => { cancelLayoutDrag?.();poseGesture?.cancel(); if (!event.persisted) { stream.close(); view.dispose(); } });
  window.addEventListener('keydown', e => {
    if (e.key==='Escape' && !e.defaultPrevented && !e.altKey && !e.ctrlKey && !e.metaKey && !document.querySelector('dialog[open]')) {
      if (matchMedia('(max-width: 700px)').matches && pane.contains(e.target as Node)) return;
      const focused=(e.target as HTMLElement)?.closest?.<HTMLElement>('.rm-floating-card');
      const frame=focused ?? [...popouts.keys()].filter(el=>!el.hidden).at(-1);
      if (frame) { e.preventDefault();clearPopup(frame);return; }
    }
    if (e.defaultPrevented || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (!undo.disabled) undo.click(); }
  });
  function details(key: string, label: string, children: Node[], hint?: string) {
    const box = h('details', 'rm-disclosure', h('summary', null, h('span', null, label), hint && h('small', null, hint), icon('chevron')), h('div', 'rm-disclosure-body', ...children));
    box.open = expanded.has(key);
    box.addEventListener('toggle', () => {
      if (box.isConnected) { if (box.open) expanded.add(key); else expanded.delete(key); }
    });
    return box;
  }
  function renderPanel() {
    cancelLayoutDrag?.();
    const position = scroll.scrollTop, focus = (document.activeElement as HTMLElement | null)?.dataset.focus;
    layoutTab.setAttribute('aria-pressed', String(tab === 'layout')); measureTab.setAttribute('aria-pressed', String(tab === 'measure'));
    assessTab.setAttribute('aria-pressed', String(tab === 'assessment'));
    undo.disabled = !undoable || !scene.version;
    scope.update(scene,view.focusedAsset(),mode);
    versionText.textContent = 'Revision ' + scene.version; document.title = scene.name + ' · Synergon';
    selector.scene(scene.name);
    view.setMeasurement(null); ++measurementToken;
    if (tab === 'assessment') {
      if (assessment) scroll.replaceChildren(assessment.render());
      else { scroll.replaceChildren(h('p','rm-help','Opening assessment…')); void loadAssessment(); }
    } else if (tab === 'measure') scroll.replaceChildren(measurePanel());
    else if (docked) {
      const card=cardFor(docked.instance,docked.part);
      if (card) replaceComponentCard(scroll,card);
      else {docked=null;renderPanel();return;}
    } else if (view.focusedAsset() && current()) {
      const item=current()!, release=byRelease.get(item.release);
      if (release) scroll.replaceChildren(...inspect(item,release,true));
    } else if (library) scroll.replaceChildren(libraryPanel());
    else {
      const rows = h('div', 'rm-object-list');
      rows.append(objectRow('room', 'Room envelope', '', selected === null, () => choose(null)));
      for (const item of scene.instances) {
        const asset = byRelease.get(item.release);
        rows.append(objectRow(asset?.kind ?? 'display', item.label, asset?.label ?? '', selected === item.id, () => choose(item.id)));
      }
      const add = action('Add object', () => { addId = ''; library = true; renderPanel(); }, 'plus', 'rm-primary rm-wide');
      const list = section('Scene objects', rows, add);
      const item = current(), release = item && byRelease.get(item.release);
      scroll.replaceChildren(list, ...(item && release ? inspect(item, release) : roomProperties()));
    }
    if (poseGesture && (!poseGesture.card.isConnected || poseGesture.card.closest('[hidden],[inert]'))) poseGesture.cancel();
    scroll.scrollTop = position;
    if (focus) {
      // Operator controls are populated after the avatar's cached definitions resolve.
      const restore = () => {
        if (document.activeElement !== document.body) return;
        const target = [...scroll.querySelectorAll<HTMLElement>('[data-focus]')].find(el => el.dataset.focus === focus);
        target?.focus({preventScroll:true});
      };
      restore();
      queueMicrotask(restore);
    }
  }
  function objectRow(glyph: Glyph, name: string, info: string, active: boolean, run: () => void) {
    const btn = action(name, run, glyph, 'rm-object-row'); btn.setAttribute('aria-pressed', String(active));
    if (info) { btn.title = info; }
    if (active) btn.append(h('i', 'rm-selected-dot')); return btn;
  }
  function libraryPanel() {
    const panel = h('div', 'rm-section');
    panel.append(h('div', 'rm-section-head', h('h2', 'rm-heading', 'Add object'), iconAction('Close object library', () => { library = false; renderPanel(); }, 'close')));
    if (!releases.length) { panel.append(h('p', 'rm-help', 'No installed releases are available.')); return panel; }
    const picker = h('div', 'rm-library-list');
    for (const r of releases.filter(r => !r.retained)) {
      const row = action(r.label, () => { chosenRelease = r.id; renderPanel(); }, r.kind, 'rm-library-row');
      row.setAttribute('aria-pressed', String(chosenRelease === r.id)); row.querySelector('span')!.append(h('small', null, (r.kind === 'station' ? 'Operator station' : r.kind === 'desk' ? 'Operator desk' : 'Display') + ' · v' + r.version));
      if (chosenRelease === r.id) row.append(icon('check')); picker.append(row);
    }
    const asset = byRelease.get(chosenRelease)!;
    const base = asset.kind === 'station' ? 'Station' : asset.kind === 'desk' ? 'Desk' : 'Display';
    let no = 1; while (scene.instances.some(i => i.label === base + ' ' + no)) no++;
    const automaticName = base + ' ' + no;
    const input = h('input'); input.type = 'text'; input.maxLength = 80; input.value = newLabel; input.placeholder = automaticName;
    input.dataset.focus = 'library-label'; input.addEventListener('input', () => { newLabel = input.value; });
    const submit = h('button', 'rm-button rm-primary rm-wide', icon('plus'), 'Add to room'); submit.type = 'submit';
    const form = h('form', 'rm-library-form', field('Instance name', input), submit);
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (submit.disabled) return; submit.disabled = true;
      // Keep this identity across a retry if the first reply was interrupted.
      addId ||= 'item-' + crypto.randomUUID();
      const id = addId, before = scene.version;
      if (scene.instances.some(i => i.id === id) || await write('instances.add', { instance: id, label: newLabel.trim() || automaticName, release: asset.id, ...initialPlacement(scene, asset, byRelease) }, before)) {
        addId = ''; newLabel = ''; library = false; choose(id);
      }
      submit.disabled = false;
    });
    panel.append(picker, form); return panel;
  }
  function roomProperties() {
    const { room, version } = scene;
    const dims = h('div','rm-slider-list');
    for(const key of ['width','depth','height'] as const) {
      const value=room[key], low=key==='width'?Math.max(...[room.door,room.window].map(o=>o.offset+o.width)):.01;
      dims.append(sceneSlider({key,label:{width:'Width',depth:'Depth',height:'Height'}[key],value,unit:'m',step:.01,
        low,high:Math.max(low+.01,2*value),min:key==='width'?low:undefined},'room',
        n=>write('room.set',{[key]:n},version),(draft,n)=>{draft.room[key]=n;}));
    }
    const shell=section('Room dimensions',dims);
    for(const [key,name,wall] of [['door','Doorway','South wall'],['window','Window','North wall']] as const) {
      const opening=room[key], sliders=h('div','rm-slider-list');
      for(const axis of ['offset','width'] as const){
        const low=axis==='offset'?0:Math.min(.01,opening.width);
        const high=room.width-opening[axis==='offset'?'width':'offset'];
        sliders.append(sceneSlider({key:axis,label:axis==='offset'?'Offset':'Width',value:opening[axis],unit:'m',step:.01,
          low,high,min:axis==='offset'?0:undefined,max:high},'room/'+key,
          n=>write('room.set',{[key]:{...opening,[axis]:n}},version),(draft,n)=>{draft.room[key][axis]=n;}));
      }
      shell.append(details('room/'+key,name,[h('p','rm-help',wall+' · offset from west corner'),sliders],metres(opening.width)));
    }
    return [shell, lightingProperties()];
  }
  // ---- lighting: part of the scene (lighting.set), so agents and simulations can drive it too. Editing it switches this
  // viewer's lighting view on, where the daylight is dimmed and the lights show.
  /** The lighting changed (here or elsewhere): if this viewer is in daylight, mark the lamp button. */
  function lightingChanged() { if (view.display().lighting !== 'lamps') drawing.dispatchEvent(new Event('rv-lighting-changed')); }
  function showLighting() {
    if (view.display().lighting === 'lamps') return;
    view.setDisplay({ ...view.display(), lighting: 'lamps' }); drawing.dispatchEvent(new Event('rv-lighting'));
  }
  function lightingWrite(patch: Args) { showLighting(); return write('lighting.set', patch, scene.version); }
  function lightingSlider(key: string, label: string, value: number, unit: string, step: number, low: number, high: number,
    patch: (n: number) => Args, apply: (n: number, l: RoomLighting) => void, scope = 'lighting') {
    return sceneSlider({ key, label, value, unit, step, low, high, min: low, max: high }, scope, n => lightingWrite(patch(n)),
      (draft, n) => { const l = effectiveLighting(draft); apply(n, l); draft.lighting = l; showLighting(); });
  }
  function toggle(label: string, on: boolean, change: (on: boolean) => void) {
    const box = h('input'); box.type = 'checkbox'; box.checked = on; box.onchange = () => change(box.checked);
    return h('label', 'rm-check', box, label);
  }
  /** A colour that follows the colour temperature unless "Own colour" is ticked. The swatch always shows the colour in use. */
  function colourField(label: string, own: string | null, inUse: string, change: (colour: string | null) => void) {
    const input = h('input'); input.type = 'color'; input.value = own ?? inUse; input.disabled = !own; input.setAttribute('aria-label', label);
    input.onchange = () => change(input.value);
    const box = h('input'); box.type = 'checkbox'; box.checked = !!own; box.onchange = () => change(box.checked ? input.value : null);
    return h('div', 'rm-colour-row', h('span', 'rm-adjust-name', label), input, h('label', 'rm-check', box, 'Own colour'));
  }
  /** The colour a colour temperature shows in the lighting view (a third of the black-body tint, as the viewer draws it). */
  const tempColour = (kelvin: number) => '#' + cctColour(kelvin).map(v => Math.round((v + 2 * (1 - v) / 3) * 255).toString(16).padStart(2, '0')).join('');
  function lightingProperties() {
    const l = effectiveLighting(scene), c = l.ceiling, roomHeight = scene.room.height;
    const ceiling = h('div', 'rm-slider-list',
      lightingSlider('countX', 'Lights across', c.countX, '', 1, 1, 8, n => ({ ceiling: { countX: Math.round(n) } }), (n, x) => { x.ceiling.countX = Math.round(n); }),
      lightingSlider('countY', 'Lights along', c.countY, '', 1, 1, 8, n => ({ ceiling: { countY: Math.round(n) } }), (n, x) => { x.ceiling.countY = Math.round(n); }),
      lightingSlider('height', 'Height', c.height ?? roomHeight, 'm', .01, 1.5, roomHeight,
        n => ({ ceiling: { height: n >= roomHeight - .005 ? null : n } }), (n, x) => { x.ceiling.height = n >= roomHeight - .005 ? null : n; }),
      lightingSlider('intensity', 'Brightness', c.intensity, '', .05, 0, 3, n => ({ ceiling: { intensity: n } }), (n, x) => { x.ceiling.intensity = n; }),
      lightingSlider('spread', 'Spread', c.spread, '', .05, 0, 1, n => ({ ceiling: { spread: n } }), (n, x) => { x.ceiling.spread = n; }),
      lightingSlider('cct', 'Colour temperature', c.cct, 'K', 50, 2200, 8000, n => ({ ceiling: { cct: Math.round(n) } }), (n, x) => { x.ceiling.cct = Math.round(n); }));
    const screens = h('div', 'rm-slider-list',
      lightingSlider('screens', 'Brightness', l.screens.intensity, '', .05, 0, 3, n => ({ screens: { intensity: n } }), (n, x) => { x.screens.intensity = n; }));
    const lamps = h('div', 'rm-slider-list',
      lightingSlider('lamps', 'Brightness', l.lamps.intensity, '', .05, 0, 3, n => ({ lamps: { intensity: n } }), (n, x) => { x.lamps.intensity = n; }));
    return section('Lighting',
      h('p', 'rm-help', 'Shown in the lighting view (the lamp button below the drawing). Visual only, not lux.'),
      details('lighting/ceiling', 'Ceiling lights', [toggle('On', c.on, on => void lightingWrite({ ceiling: { on } })), ceiling,
        h('p', 'rm-help', 'Spread: 0 is a narrow downlight, 1 a wide, diffuse light.'),
        colourField('Colour', c.colour, tempColour(c.cct), colour => void lightingWrite({ ceiling: { colour } }))], c.on ? c.countX + ' × ' + c.countY : 'Off'),
      details('lighting/screens', 'Screens', [toggle('Screens glow and give light', l.screens.on, on => void lightingWrite({ screens: { on } })), screens], l.screens.on ? 'On' : 'Off'),
      details('lighting/lamps', 'Asset lamps', [toggle('On', l.lamps.on, on => void lightingWrite({ lamps: { on } })), lamps,
        colourField('Colour', l.lamps.colour, tempColour(4000), colour => void lightingWrite({ lamps: { colour } }))], l.lamps.on ? 'On' : 'Off'));
  }
  /** An asset's own lamps (for example a desk's downlights and light strip): on, brightness and colour of this asset only. */
  function lampControls(item: RoomInstance) {
    const l = effectiveLighting(scene), own = l.instances?.[item.id] ?? {};
    const on = own.on ?? l.lamps.on, level = own.intensity ?? l.lamps.intensity, colour = own.colour !== undefined ? own.colour : l.lamps.colour;
    const list = h('div', 'rm-slider-list', lightingSlider('level', 'Brightness', level, '', .05, 0, 3,
      n => ({ instance: item.id, lamps: { intensity: n } }), (n, x) => { x.instances = { ...x.instances, [item.id]: { ...x.instances?.[item.id], intensity: n } }; }, item.id + '/lamps'));
    return details(item.id + '/lamps', 'Lamps', [toggle('On', on, v => void lightingWrite({ instance: item.id, lamps: { on: v } })), list,
      colourField('Colour', colour, tempColour(4000), v => void lightingWrite({ instance: item.id, lamps: { colour: v } }))], on ? 'On' : 'Off');
  }
  function inspect(item: RoomInstance, release: RoomRelease, isolated=false) {
    const prefix = item.id + '/', version = scene.version;
    const placement=h('div','rm-slider-list');
    for(const key of ['x','y','yaw'] as const){
      const turn=key==='yaw';
      placement.append(sceneSlider({key,label:turn?'Turn':key.toUpperCase(),value:item[key],unit:turn?'°':'m',step:turn?1:.01,
        low:turn?-180:0,high:turn?180:scene.room[key==='x'?'width':'depth']},prefix+'placement',
        n=>write('instances.move',{instance:item.id,[key]:n},version),
        (draft,n)=>{draft.instances.find(i=>i.id===item.id)![key]=n;}));
    }
    const inspector = section('Placement', placement);
    const controls = h('div', 'rm-detail-group');
    const parts = release.members.filter(m => m.kind==='part');
    if (parts.length) {
      const pick = select('Selected component', [{ value: '', label: 'Whole object' }, ...(scene.person?.host === item.id ? [{value:'@operator',label:'Operator'}] : []), ...parts.map(m => ({ value: m.id, label: plainLabel(m.label) }))], member);
      pick.onchange = () => choose(item.id, pick.value);
      controls.append(details(prefix + 'components', 'Components', [field('Selected component', pick)], String(parts.length)));
    }
    const joints = release.joints.filter(j => !j.locked || j.assumed);
    if (joints.length) {
      const joint = joints.find(j => j.id === chosenJoints.get(item.id)) ?? joints[0];
      const picker = select('Adjustment', joints.map(j => ({ value: j.id, label: j.label || j.id })), joint.id);
      picker.onchange = () => { chosenJoints.set(item.id, picker.value); expanded.add(prefix + 'joints'); renderPanel(); };
      controls.append(details(prefix + 'joints', 'Adjustments', [field('Joint', picker), jointForm(item, joint)], String(joints.length)));
    }
    if (view.lampCount(item.id)) controls.append(lampControls(item));
    const screens = screensSection(item);
    if (screens) controls.append(screens);
    if (release.seat) controls.append(roomOperatorControls({item,release,scene,apiRoot:api,write,bodySlider:f=>bodySlider(item,version,f),details}));
    const versions = select('Installed release', releases.filter(r => !r.retained || r.id === release.id).map(r => ({ value: r.id, label: shortRelease(r) })), release.id);
    const swap = action('Swap release', () => {
      void write('instances.swap', { instance: item.id, release: versions.value }, version).then(ok => { if (!ok) { versions.value = item.release; swap.disabled = true; } });
    }); swap.disabled = true; versions.onchange = () => { swap.disabled = versions.value === item.release; };
    const remove = action('Remove object', () => void write('instances.remove', { instance: item.id }, version), 'remove', 'rm-danger');
    controls.append(details(prefix + 'release', 'Asset release', [field('Installed release', versions), h('div', 'rm-object-actions', swap, remove)], 'v' + release.version));
    if (isolated) {
      controls.append(details(prefix+'placement','Room placement',[placement]));
      return [section('Asset controls',controls)];
    }
    const clearance = h('div', 'rm-clearance'); readClearance(item, clearance);
    return [inspector, section('Doorway clearance', clearance), controls];
  }
  // ---- live screen content: the object's Screens section, the screen card's Shows and View, the hover hint
  const content = view.content;
  /** Status lines on screen now; each updates itself when a screen's state changes and leaves when it is gone. */
  const liveLines = new Set<() => void>();
  let listShape = '';
  content.onChange(() => {
    const l = content.list();
    const shape = l ? JSON.stringify([l.apps.map(a => [a.id, a.items.map(i => [i.id, i.views.length])]), l.screens.map(x => x.instance + '/' + x.screen + ':' + x.offered)]) : '';
    if (shape !== listShape) {
      listShape = shape; afterTyping(scroll, renderPanel);
      for (const [frame, ref] of popouts) { const card = cardFor(ref.instance, ref.part, frame); if (card && !frame.querySelector('[data-typing]')) replaceComponentCard(frame, card); }
    }
    for (const line of [...liveLines]) line();
  });
  const sceneContent = (): SceneContent => scene.content && typeof scene.content === 'object' ? scene.content : { sources: {}, shows: {} };
  /** The address as the server will store it, remembered so that this browser loads it at once. */
  function rememberTyped(raw: string) {
    const l = content.list();
    if (!l) return;
    const a = frameAddress(embeddable(raw.trim()), { mode: l.mode, self: location.origin, apps: l.apps, publicSites: l.publicSites, typed: true });
    if (a.ok) liveStorage.addTyped(a.href);
  }
  function addressField(instance: string, screen: string | undefined, current: string) {
    const input = h('input'); input.type = 'url'; input.placeholder = 'https://…'; input.value = current; input.maxLength = 2048;
    input.setAttribute('aria-label', 'Web address'); input.dataset.focus = 'live-url/' + instance + '/' + (screen ?? '');
    const go = h('button', 'rm-button rm-primary', 'Show'); go.type = 'submit';
    const form = h('form', 'rm-live-address', input, go);
    form.addEventListener('submit', e => {
      e.preventDefault(); const url = input.value.trim(); if (!url) return;
      rememberTyped(url);
      void contentWrite('content.show', { instance, ...(screen ? { screen } : {}), url });
    });
    return form;
  }
  type Worst = { line: string; act?: { label: string; run: () => void } };
  /** One sentence for a set of screens, with at most one action. */
  function statusOf(keys: string[]): Worst | null {
    if (!keys.length) return null;
    if (!content.enabled()) return { line: 'Live screen content is off for this browser (Settings).' };
    const states = keys.map(k => [k, content.state(k)] as const).filter(([, s]) => s) as [string, NonNullable<ReturnType<typeof content.state>>][];
    if (!states.length) return { line: 'Starting…' };
    const find = (...names: string[]) => states.filter(([, s]) => names.includes(s.state));
    const bad = find('not_allowed');
    if (bad.length) return { line: 'Not allowed here' };
    const ended = find('ended', 'refused');
    if (ended.length) {
      const source = sourceOf(ended[0]![0]);
      return { line: ended[0]![1].text ?? 'Ended', act: source && sceneContent().sources[source]?.kind === 'app' ? { label: 'Restart', run: () => void contentWrite('content.restart', { source }) } : undefined };
    }
    const silent = find('not_answering');
    if (silent.length) return { line: 'Not answering', act: { label: 'Retry', run: () => { for (const [k] of silent) content.retry(k); } } };
    const asking = find('awaiting_click');
    if (asking.length) {
      const host = asking[0]![1].host, origin = host ? (() => { try { return new URL(sceneSourceUrl(asking[0]![0]) ?? '').origin; } catch { return ''; } })() : '';
      return { line: 'Content from ' + (host ?? 'another site'), act: origin && content.interactive() ? { label: 'Show', run: () => content.accept(origin) } : undefined };
    }
    const showing = find('showing', 'waiting').length, total = states.length;
    if (showing === total) return { line: total === 1 ? 'Showing' : 'Showing on ' + total + ' screens' };
    const starting = total - showing;
    return { line: total === 1 ? 'Starting…' : 'Starting… on ' + starting + ' of ' + total + ' screens' };
  }
  const showOf = (key: string) => { const [instance, screen] = key.split('/'); return sceneContent().shows[instance!]?.[screen!]; };
  const sourceOf = (key: string) => showOf(key)?.source;
  const sceneSourceUrl = (key: string) => { const s = sourceOf(key), src = s ? sceneContent().sources[s] : undefined; return src?.kind === 'page' ? src.url : undefined; };
  function statusLine(keys: () => string[]) {
    const box = h('div', 'rm-live-status'); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    const paint = () => {
      if (!box.isConnected && box.dataset.mounted) { liveLines.delete(paint); return; }
      const w = statusOf(keys());
      box.hidden = !w;
      if (!w) { box.replaceChildren(); return; }
      const text = h('span', null); text.textContent = w.line;
      box.replaceChildren(text, ...(w.act ? [action(w.act.label, w.act.run, undefined, 'rm-text-action')] : []));
    };
    liveLines.add(paint); paint(); queueMicrotask(() => { box.dataset.mounted = '1'; });
    return box;
  }
  const appItems = () => (content.list()?.apps ?? []).filter(a => a.items.length);
  function screensSection(item: RoomInstance) {
    const l = content.list();
    const offered = l?.screens.filter(x => x.instance === item.id && x.offered) ?? [];
    if (!l || !offered.length) return null;
    const c = sceneContent(), shows = c.shows[item.id] ?? {};
    const shown = offered.filter(x => shows[x.screen]).map(x => screenKey(item.id, x.screen));
    const sources = [...new Set(Object.values(shows).map(s => s.source))].map(id => [id, c.sources[id]] as const).filter(([, s]) => s);
    const app = sources.find(([, s]) => s!.kind === 'app') as readonly [string, AppSource] | undefined;
    const page = sources.find(([, s]) => s!.kind === 'page');
    const pick = h('select'); pick.setAttribute('aria-label', 'Screens'); pick.dataset.focus = 'live-screens/' + item.id;
    pick.add(new Option('Built-in pictures', 'builtin'));
    for (const a of appItems()) {
      const group = h('optgroup'); group.label = a.label;
      for (const i of a.items) group.append(new Option(i.label, 'item:' + a.id + '/' + i.id));
      pick.append(group);
    }
    pick.add(new Option('Web address…', 'url'));
    pick.value = app ? 'item:' + app[1].app + '/' + app[1].item : page ? 'url' : 'builtin';
    const body: Node[] = [field('Shows', pick)];
    const address = addressField(item.id, undefined, page && page[1]!.kind === 'page' ? page[1]!.url : '');
    address.hidden = pick.value !== 'url';
    pick.onchange = () => {
      if (pick.value === 'url') { address.hidden = false; address.querySelector('input')?.focus(); return; }
      address.hidden = true;
      if (pick.value === 'builtin') { void contentWrite('content.clear', { instance: item.id }); return; }
      const [appId, itemId] = pick.value.slice(5).split('/');
      const label = l.apps.find(a => a.id === appId)?.items.find(i => i.id === itemId)?.label ?? itemId;
      void contentWrite<{ assigned: unknown[] }>('content.show', { instance: item.id, item: itemId, app: appId }).then(r => {
        if (r && r.assigned.length > 1) tell(label + ' on ' + r.assigned.length + ' screens of ' + item.label, false, true);
      });
    };
    body.push(address);
    if (app) body.push(h('div', 'rm-object-actions',
      action('Restart', () => void contentWrite('content.restart', { source: app[0] }), undefined, 'rm-text-action'),
      action('Remove', () => void contentWrite('content.clear', { instance: item.id }), undefined, 'rm-text-action')));
    else if (shown.length) body.push(h('div', 'rm-object-actions', action('Remove', () => void contentWrite('content.clear', { instance: item.id }), undefined, 'rm-text-action')));
    body.push(statusLine(() => offered.filter(x => sceneContent().shows[item.id]?.[x.screen]).map(x => screenKey(item.id, x.screen))));
    return details(item.id + '/screens', 'Screens', body, app ? app[1].label : page ? 'Web address' : 'Built-in');
  }
  /** The Shows, View, status and Use controls of one offered screen (its component card). */
  function screenControls(item: RoomInstance, part: string): HTMLElement | undefined {
    const l = content.list(), place = l?.screens.find(x => x.instance === item.id && x.screen === part);
    if (!l || !place?.offered) return undefined;
    const c = sceneContent(), show = c.shows[item.id]?.[part], key = screenKey(item.id, part);
    const source = show ? c.sources[show.source] : undefined;
    const pick = h('select'); pick.setAttribute('aria-label', 'Shows'); pick.dataset.focus = 'live-shows/' + key;
    pick.add(new Option('Built-in picture', 'builtin'));
    const inScene = Object.entries(c.sources);
    if (inScene.length) {
      const group = h('optgroup'); group.label = 'In this scene';
      for (const [id, s] of inScene) group.append(new Option(s.label + ' · in this scene', 'source:' + id));
      pick.append(group);
    }
    for (const a of appItems()) {
      const items = a.items.filter(i => !inScene.some(([, s]) => s.kind === 'app' && s.app === a.id && s.item === i.id));
      if (!items.length) continue;
      const group = h('optgroup'); group.label = a.label;
      for (const i of items) group.append(new Option(i.label, 'item:' + a.id + '/' + i.id));
      pick.append(group);
    }
    pick.add(new Option('Web address…', 'url'));
    pick.value = show ? 'source:' + show.source : 'builtin';
    const address = addressField(item.id, part, source?.kind === 'page' ? source.url : '');
    address.hidden = true;
    pick.onchange = () => {
      if (pick.value === 'url') { address.hidden = false; address.querySelector('input')?.focus(); return; }
      address.hidden = true;
      if (pick.value === 'builtin') void contentWrite('content.clear', { instance: item.id, screen: part });
      else if (pick.value.startsWith('source:')) void contentWrite('content.show', { instance: item.id, screen: part, source: pick.value.slice(7) });
      else { const [appId, itemId] = pick.value.slice(5).split('/'); void contentWrite('content.show', { instance: item.id, screen: part, item: itemId, app: appId }); }
    };
    const box = h('div', 'rm-live-screen', field('Shows', pick), address);
    if (source?.kind === 'app' && show) {
      const views = l.apps.find(a => a.id === source.app)?.items.find(i => i.id === source.item)?.views ?? [];
      const viewPick = select('View', views.map(v => ({ value: v.id, label: v.label })), show.view);
      viewPick.dataset.focus = 'live-view/' + key;
      viewPick.onchange = () => void contentWrite('content.show', { instance: item.id, screen: part, source: show.source, view: viewPick.value });
      box.append(field('View', viewPick));
    }
    if (show) {
      box.append(statusLine(() => sceneContent().shows[item.id]?.[part] ? [key] : []));
      if (content.interactive()) {
        const use = action('Use', () => content.use(key), 'cursor', 'rm-live-use');
        use.title = 'Operate this screen: click, drag and scroll in it. Done, Esc or a click outside leaves.';
        const sync = () => { if (!use.isConnected && use.dataset.mounted) { liveLines.delete(sync); return; }
          const s = content.state(key); use.disabled = !(s?.operable && s.state === 'showing'); };
        liveLines.add(sync); sync(); queueMicrotask(() => { use.dataset.mounted = '1'; });
        box.append(use);
      }
    }
    return box;
  }
  // "Double-click to use" next to the pointer over an operable live screen
  const hint = h('div', 'rm-live-hint', 'Double-click to use'); hint.hidden = true; hint.setAttribute('aria-hidden', 'true');
  stage.append(hint);
  let pointer: [number, number] = [0, 0], pressed = false;
  const placeHint = () => {
    const key = content.hovered();
    hint.hidden = !key || pressed || !!content.using();
    if (!hint.hidden) { hint.style.left = pointer[0] + 'px'; hint.style.top = pointer[1] + 'px'; }
  };
  stage.addEventListener('pointermove', e => { const r = stage.getBoundingClientRect(); pointer = [e.clientX - r.left, e.clientY - r.top]; pressed = e.buttons !== 0; placeHint(); });
  stage.addEventListener('pointerleave', () => { hint.hidden = true; });
  content.onChange(placeHint);
  function jointForm(item: RoomInstance, joint: RoomJoint) {
    const value = item.pose[joint.id] ?? joint.neutral, angular = joint.type !== 'prismatic';
    const units = angular ? '°' : 'm', scale = angular ? 180 / Math.PI : 1;
    const axes = joint.type === 'ball' ? ['Roll', 'Pitch', 'Yaw'] : [angular ? 'Angle' : 'Position'];
    const values = Array.isArray(value) ? value : [value];
    const offsets = Array.isArray(joint.neutral) ? joint.neutral : [0];
    const version=scene.version,form=h('div','rm-slider-list');
    axes.forEach((label,index)=>{
      const low=(joint.lower+offsets[index])*scale,high=(joint.upper+offsets[index])*scale;
      const next=(n:number)=>Array.isArray(value)?value.map((v,i)=>index===i?n/scale:v):n/scale;
      form.append(sceneSlider({key:String(index),label,unit:units,value:values[index]*scale,low,high,min:low,max:high,
        step:Math.min(angular ? .1 : .001,(high-low)/200||1)},item.id+'/joint/'+joint.id,
        n=>write('pose.set',{instance:item.id,member:joint.id,...(joint.locked && joint.assumed?{allowAssumed:true}:{}),value:next(n)},version),
        (draft,n)=>{draft.instances.find(i=>i.id===item.id)!.pose[joint.id]=next(n);}));
    });
    const reset = action('Restore neutral position', () => void write('pose.set', { instance: item.id, member: joint.id, value: null }), undefined, 'rm-text-action');
    reset.disabled = !(joint.id in item.pose);
    return h('div', 'rm-joint-controls', form, h('p', 'rm-help', (joint.type === 'ball' ? 'From neutral ' : 'Range ') + displayNumber(joint.lower * scale, 2) + ' to ' + displayNumber(joint.upper * scale, 2) + ' ' + units), reset);
  }
  function describeEdge(edge: string) {
    const [id, side] = edge.split('/');
    if (id === 'door') return 'Door ' + (side ?? '').replaceAll('-', ' ');
    const item = scene.instances.find(i => i.id === id);
    return (item?.label ?? id) + ' · ' + (side ?? '').replaceAll('.', ' ').replaceAll('-', ' ');
  }
  function readClearance(item: RoomInstance, target: HTMLElement) {
    const token = measurementToken, version = scene.version;
    target.setAttribute('aria-live', 'polite'); target.textContent = 'Measuring…';
    void command<Clearance>('measure.clearance', { instance: item.id }).then(({ result, version: readVersion }) => {
      if (token !== measurementToken || version !== readVersion) return;
      const stat = (label: string, value: Span) => {
        const reading = h('strong', null, metres(value.metres)); reading.title = value.metres + ' m';
        return h('div', 'rm-reading', h('span', null, label), reading);
      };
      const edge = (label: string, span: Span) => h('p', 'rm-edges', h('b', null, label), span.edges.map(describeEdge).join(' ↔ '));
      target.replaceChildren(stat('Door approach', result), stat('Clear opening', result.opening), details('clearance/edges', 'Bounding edges', [edge('Door approach', result), edge('Clear opening', result.opening)]));
    }).catch(error => { if (token === measurementToken) target.textContent = errorText(error); });
  }
  function measurePanel() {
    const panel = h('div', 'rm-section', h('h2', 'rm-heading', 'Point to point'));
    if (!scene.instances.length) {
      panel.append(h('p', 'rm-help', 'Add an object to measure its points and doorway clearance.'), action('Add object', () => { tab = 'layout'; addId = ''; library = true; renderPanel(); }, 'plus', 'rm-primary'));
      return panel;
    }
    const first = current() ?? scene.instances[0], second = scene.instances.find(i => i.id !== first.id) ?? first;
    const resolve = (ref: RoomRef, fallback: RoomInstance, allowEye: boolean) => {
      const item = scene.instances.find(i => i.id === ref.instance) ?? fallback;
      const release = byRelease.get(item.release);
      const points = (release?.members ?? []).filter(m => m.id !== 'floor').map(m => ({ value: m.id, label: m.label }));
      const choices = [{ value: 'floor', label: 'Floor anchor' }, ...points];
      if (allowEye && scene.person?.host === item.id) choices.splice(1, 0, { value: '@eye', label: 'Seated eye' });
      ref.instance = item.id; if (!choices.some(p => p.value === ref.member)) ref.member = 'floor';
      return choices;
    };
    const endpoint = (ref: RoomRef, label: string, fallback: RoomInstance, eye: boolean) => {
      const choices = resolve(ref, fallback, eye);
      const instance = select(label + ' object', scene.instances.map(i => ({ value: i.id, label: i.label })), ref.instance);
      const point = select(label + ' point', choices, ref.member);
      instance.onchange = () => { ref.instance = instance.value; ref.member = 'floor'; renderPanel(); };
      point.onchange = () => { ref.member = point.value; renderPanel(); };
      return h('fieldset', 'rm-endpoint', h('legend', null, label), field('Object', instance), field('Point', point));
    };
    const a = endpoint(from, 'From', first, true), b = endpoint(to, 'To', second, false);
    const output = h('div', 'rm-distance', h('span', null, 'Spatial distance'), h('output', null, 'Measuring…'));
    panel.append(a, b, output);
    const token = measurementToken, version = scene.version, eye = from.member === '@eye';
    void command<Distance>(eye ? 'person.measure' : 'measure.distance', eye ? { to } : { from, to }).then(reply => {
      if (token !== measurementToken || reply.version !== version) return;
      const { result } = reply;
      const value = output.querySelector('output')!; value.textContent = metres(result.metres); value.title = result.metres + ' m';
      view.setMeasurement({ points: [result.from.point, result.to.point], instances:[result.from.instance,result.to.instance], label: metres(result.metres) });
    }).catch(error => { if (token === measurementToken) output.querySelector('output')!.textContent = errorText(error); });
    return panel;
  }
  const workspaceTools=mountRoomWorkspaceTools({host:toolbar,cameraHost:drawing,leading:[modeToggle],view,getScene:()=>scene,setMode,select:choose,command,write,notify:tell,apiRoot:api});
  // A link without a view opens the scene in 3D.
  view.setScene(scene,releases); void setMode(readRoomViewLink(location.hash)?.mode ?? '3d').then(()=>workspaceTools.restoreLink()); renderPanel(); void updateUndo();
  // A demo says so each time it opens; a public scene says once that it is the visitor's own and shared by its link.
  const note = demo ? 'This demo resets each time you open it from the homepage. Your changes here are not kept.'
    : isPublic && firstNote() ? 'This is your scene. Changes save automatically. Anyone with the link can open it.' : '';
  if (note) {
    tell(note); notice.classList.add('rm-notice-top');
    setTimeout(() => { if (notice.querySelector('span')?.textContent === note) notice.hidden = true; notice.classList.remove('rm-notice-top'); }, 12000);
  }
}
