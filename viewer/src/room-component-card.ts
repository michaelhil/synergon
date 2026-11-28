// An inspector always carries an instance ID as well as its selected member.
// The same card is used in the sidebar and in movable comparison windows.
import { adjWords, type AdjWord } from "../../shared/words.ts";
import { h } from "./dom.ts";
import { action, iconAction } from "./room-controls.ts";
import { sliderRow, wireDrag, type BeginSlider } from "./room-slider.ts";
import type { JointValue } from "../../shared/pose.ts";
import type { RoomInstance, RoomJoint, RoomRelease } from "../../shared/room.ts";

export type ComponentEdit = (joint:RoomJoint,value:JointValue|null) => Promise<boolean>;
type PoseValues=Record<string,JointValue>;
export type BeginPoseGesture=(card:HTMLElement,joints:RoomJoint[],reset:()=>void)=>{
  update:(values:PoseValues)=>void;commit:(values:PoseValues)=>void;cancel:()=>void;
};
interface CardOptions {
  item:RoomInstance; release:RoomRelease; part:string;
  beginGesture:BeginPoseGesture;
  apply:(values:Record<string,JointValue|null>)=>Promise<boolean>; dock?:()=>void; edit:ComponentEdit; close:()=>void; pop?:()=>void; placement:()=>void;
  /** A live screen's Shows, View, status and Use (room-app.ts), for an S_ member offered for live content. */
  screen?:HTMLElement;
}

export function componentPanel(title:string,item:RoomInstance,part:string,close:()=>void,pop?:()=>void,dock?:()=>void) {
  const card = h("section","rm-component-card");
  card.setAttribute("aria-label",title+" controls for "+item.label);
  card.dataset.component = part; card.dataset.instance = item.id;
  const header = h("header","rm-card-head",h("div",null,h("div","rm-kicker",item.label),h("h2",null,title)));
  if (pop) header.append(iconAction("Pop out component controls",pop,"pop"));
  if (dock) header.append(iconAction("Dock component controls",dock,"collapse"));
  header.append(iconAction("Close component controls",close,"close")); card.append(header);
  return card;
}

export function componentCard({item,release,part,edit,apply,beginGesture,close,pop,dock,placement,screen}:CardOptions) {
  const member=release.members.find(m=>m.id===part);
  const title=(member?.label || item.label).replace(/:\s*lit area$/i,"");
  const card=componentPanel(title==="Active screen" ? "Screen" : title,item,part,close,pop,dock);
  const joints = release.joints.filter(j=>member?.controls?.includes(j.id) && (!j.locked || j.assumed));
  if (screen) card.append(screen);
  if (!joints.length) {
    card.append(...(screen ? [] : [h("p","rm-help","This part is fixed to its object.")]),action("Object placement",placement,"axis"));
    return card;
  }
  const axes=joints.flatMap(joint=>adjWords(joint).map(word=>({joint,word})));
  for (const {joint,word} of axes) {
    const angle=joint.type!=="prismatic",scale=angle?180/Math.PI:1000;
    const component=word.comp??0,pose=item.pose[joint.id]??joint.neutral;
    const value=Array.isArray(pose)?pose[component]:pose;
    const offset=Array.isArray(joint.neutral)?joint.neutral[component]:0;
    const low=(joint.lower+offset)*scale,high=(joint.upper+offset)*scale;
    const name=word.label || joint.label || joint.id;
    const jointValue=(n:number)=>Array.isArray(pose)?pose.map((v,i)=>i===component?n/scale:v):n/scale;
    const begin:BeginSlider=(read,reset)=>{
      const gesture=beginGesture(card,[joint],reset);
      const values=()=>({[joint.id]:jointValue(read())});
      return {update:()=>gesture.update(values()),commit:()=>gesture.commit(values()),cancel:gesture.cancel};
    };
    const {row,range,exact}=sliderRow({key:word.key,label:name,unit:angle?"°":"mm",value:value*scale,
      step:Math.min(angle ? 0.1 : 1,(high-low)/200||1),low,high,min:low,max:high},
      n=>edit(joint,jointValue(n)),begin,item.id+"/"+part+"/"+word.key);
    range.dataset.joint=joint.id;exact.dataset.joint=joint.id;card.append(row);
  }
  for(const axis of axes){
    const pair=axis.word.pad;
    if(!pair || axis.word.key!==pair[0])continue;
    const other=axes.find(a=>a.word.key===pair[1]);
    if(other)card.append(h("details","rm-disclosure",h("summary",null,axis.word.padLabel??"Direction pad"),
      directionPad(axis,other,item,apply,card,beginGesture)));
  }
  if (joints.some(j=>Object.hasOwn(item.pose,j.id))) {
    card.append(action("Reset component",()=>void apply(Object.fromEntries(joints.map(j=>[j.id,null]))),"undo","rm-text-action"));
  }
  return card;
}

export function placeFloatingCard(frame:HTMLElement,x=frame.offsetLeft,y=frame.offsetTop) {
  const stage=frame.parentElement;
  if (!stage) return;
  frame.style.left=Math.max(4,Math.min(stage.clientWidth-frame.offsetWidth-4,x))+"px";
  frame.style.top=Math.max(4,Math.min(stage.clientHeight-frame.offsetHeight-4,y))+"px";
}

/** Live scene updates rebuild controls. Keep the keyboard on the same adjustment
 * and keep the user's open sections in each separate inspector. */
export function replaceComponentCard(container:HTMLElement,card:HTMLElement) {
  const previous=container.querySelector<HTMLElement>(".rm-component-card");
  const same=previous?.dataset.component===card.dataset.component && previous?.dataset.instance===card.dataset.instance;
  if (same && previous?.hasAttribute("data-pose-gesture")) return;
  const active=document.activeElement as HTMLElement|null;
  const moveFocus=!!active && active!==container && container.contains(active);
  const selector="input,button,select,textarea,summary,[tabindex]";
  function controlKey(el:HTMLElement) {
    const label=el.getAttribute("aria-label") || el.title || el.getAttribute("name") ||
      (el.matches('input[type="checkbox"]') ? el.closest("label")?.textContent : el.textContent);
    return [el.tagName,el.getAttribute("type"),label?.trim()].join("/");
  }
  const focusKey=same && moveFocus ? controlKey(active!) : undefined;
  const opened=new Set(same ? [...previous!.querySelectorAll("details[open] > summary")].map(s=>s.textContent) : []);
  container.replaceChildren(card);
  const heading=card.querySelector<HTMLElement>("h2")!;
  heading.tabIndex=-1;
  function restore() {
    for (const details of card.querySelectorAll("details"))
      if (opened.has(details.querySelector(":scope > summary")?.textContent ?? "")) details.open=true;
    if (!moveFocus || (document.activeElement!==document.body && document.activeElement!==heading)) return;
    const match=focusKey && [...card.querySelectorAll<HTMLElement>(selector)].find(el=>controlKey(el)===focusKey);
    (match || heading).focus({preventScroll:true});
  }
  restore();
  // Operator fields arrive after loading the selected avatar's control definitions.
  if (same && card.dataset.component==="@operator" && (moveFocus || opened.size) && !card.querySelector("select")) {
    const observer=new MutationObserver(()=>{
      observer.disconnect();
      if (card.isConnected) restore();
    });
    observer.observe(card,{subtree:true,childList:true});
  }
}

type PadAxis = {joint:RoomJoint; word:AdjWord};
function directionPad(x:PadAxis,y:PadAxis,item:RoomInstance,apply:CardOptions["apply"],card:HTMLElement,begin:BeginPoseGesture) {
  const axes=[x,y], title=x.word.padLabel ?? "Adjust direction";
  const thumb=h("i"), pad=h("div","rm-direction-pad",thumb);
  pad.tabIndex=0; pad.setAttribute("role","group"); pad.setAttribute("aria-label",title);
  pad.setAttribute("aria-description","Use the arrow keys to adjust the two axes.");
  const range=axes.map(({joint,word})=>{
    const offset=Array.isArray(joint.neutral)?joint.neutral[word.comp!]:0;
    const value=item.pose[joint.id] ?? joint.neutral;
    const current=Array.isArray(value)?value[word.comp!]:value;
    const lo=joint.lower+offset, span=joint.upper-joint.lower;
    const fraction=span ? (current-lo)/span : 0.5;
    return {lo,span,fraction:word.flip ? 1-fraction : fraction};
  });
  const clamp=(value:number)=>Math.max(0,Math.min(1,value));
  let point=range.map(r=>clamp(r.fraction));
  function paint() {thumb.style.left=point[0]*100+"%";thumb.style.top=(1-point[1])*100+"%";}
  function currentValues() {
    const values:Record<string,JointValue>={};
    axes.forEach(({joint,word},n)=>{
      const value=range[n].lo+(word.flip ? 1-point[n] : point[n])*range[n].span;
      if (word.comp===null) values[joint.id]=value;
      else {
        const previous=values[joint.id] ?? item.pose[joint.id] ?? joint.neutral;
        if (Array.isArray(previous)) {const next=[...previous];next[word.comp]=value;values[joint.id]=next;}
      }
    });
    return values;
  }
  const reset=()=>{point=range.map(r=>r.fraction);paint();};
  function track(event:PointerEvent) {
    const box=pad.getBoundingClientRect();
    point=[clamp((event.clientX-box.left)/box.width),clamp((box.bottom-event.clientY)/box.height)];paint();
  }
  wireDrag(pad,resetDrag=>{
    const gesture=begin(card,axes.map(a=>a.joint),resetDrag);
    return {update:()=>gesture.update(currentValues()),commit:()=>gesture.commit(currentValues()),cancel:gesture.cancel};
  },reset,track);
  pad.onkeydown=e=>{
    const deltas:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
    const delta=deltas[e.key];if (!delta) return;
    e.preventDefault();point=point.map((v,n)=>clamp(v+delta[n]*(e.shiftKey?0.1:0.01)));paint();
    void apply(currentValues()).then(ok=>{if (!ok) reset();});
  };
  paint();
  return h("div","rm-direction",h("small",null,y.word.hi),
    h("div","rm-direction-row",h("small",null,x.word.lo),pad,h("small",null,x.word.hi)),h("small",null,y.word.lo));
}

export function floatingCard(stage:HTMLElement,index:number) {
  const frame=h("aside","rm-floating-card");frame.setAttribute("role","dialog");
  frame.tabIndex=-1;
  stage.append(frame);
  placeFloatingCard(frame,20+24*(index%5),48+24*(index%5));
  let drag:{id:number;x:number;y:number;left:number;top:number}|undefined;
  frame.addEventListener("pointerdown",e=>{
    const target=e.target as Element;
    if (e.button!==0 || !target.closest(".rm-card-head") || target.closest("button")) return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:frame.offsetLeft,top:frame.offsetTop};
    frame.focus({preventScroll:true});
    frame.setPointerCapture(e.pointerId);e.preventDefault();
  });
  frame.onpointermove=e=>{
    if(drag?.id!==e.pointerId)return;
    placeFloatingCard(frame,drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);
  };
  frame.onpointerup=frame.onpointercancel=()=>{drag=undefined;};
  frame.onkeydown=e=>{
    if (!e.altKey || !(e.target===frame || (e.target as Element).closest(".rm-card-head"))) return;
    const dx=e.key==="ArrowLeft" ? -16 : e.key==="ArrowRight" ? 16 : 0;
    const dy=e.key==="ArrowUp" ? -16 : e.key==="ArrowDown" ? 16 : 0;
    if (dx || dy) { e.preventDefault(); placeFloatingCard(frame,frame.offsetLeft+dx,frame.offsetTop+dy); }
  };
  return frame;
}
