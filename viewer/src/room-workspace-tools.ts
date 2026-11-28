import { h, link } from "./dom.ts";
import { ask } from "./dialog.ts";
import { field, select } from "./room-controls.ts";
import { readRoomViewLink, type CameraPreset } from "./room-camera-state.ts";
import type { mountRoomView, RoomViewMode } from "./room-view.ts";
import type { RoomPoint, RoomScene } from "../../shared/room.ts";

type Args = Record<string, unknown>;
type View = ReturnType<typeof mountRoomView>;
interface ToolsOptions {
  host: HTMLElement;
  cameraHost: HTMLElement;
  /** Controls placed first in the view-controls group (the 2D/3D toggle). */
  leading?: HTMLElement[];
  view: View;
  getScene: () => RoomScene;
  setMode: (m: RoomViewMode) => Promise<void>;
  select: (id: string | null, member?: string) => void;
  command: <T>(id: string, args: Args, base?: number) => Promise<{ version: number; result: T }>;
  write: (id: string, args: Args, base?: number) => Promise<boolean>;
  notify: (s: string, error?: boolean) => void;
  apiRoot: string;
}
const symbols = {
  link: "M10 14l4-4m-5-2 2-2a4 4 0 0 1 6 6l-2 2m0 2-2 2a4 4 0 0 1-6-6l2-2",
  picture: "M3 7h5l2-3h4l2 3h5v13H3z M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  trace: "M4 6h16M4 12h4l2-4 4 9 2-5h4M4 20h16",
  settings:
    "m10 3-.6 2.2-2 .9-2-.8-2 3.4 1.6 1.5v2.7l-1.6 1.5 2 3.4 2-.8 2 .9.6 2.2h4l.6-2.2 2-.9 2 .8 2-3.4-1.6-1.5v-2.7l1.6-1.5-2-3.4-2 .8-2-.9L14 3z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  views: "m3 8 9-5 9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  reset: "M4 10a8 8 0 1 1 0 5 M4 4v6h6",
  lamp: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.3 1.1 2.2h5c0-.9.3-1.6 1.1-2.2A6 6 0 0 0 12 3z",
  close: "M5 5l14 14M19 5 5 19",
};
function toolButton(label: string, glyph: keyof typeof symbols, run: () => void) {
  const button = h("button", "rm-button rm-icon-action rw-tool");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.onclick = run;
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg"),
    path = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "rm-icon");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", symbols[glyph]);
  svg.append(path);
  button.append(svg);
  return button;
}
const section = (label: string, ...kids: Node[]) => h("details", "rw-section", h("summary", null, label), ...kids);
function check(label: string, value: boolean, change: (on: boolean) => void) {
  const box = h("input");
  box.type = "checkbox";
  box.checked = value;
  box.onchange = () => change(box.checked);
  return h("label", "rw-check", box, label);
}
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    /* Fall back to the selected permission-compatible field. */
  }
  const t = h("textarea");
  t.value = value;
  t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(t);
  t.select();
  const done = document.execCommand("copy");
  t.remove();
  if (!done) throw new Error("Clipboard access is unavailable in this browser.");
}
export function mountRoomWorkspaceTools(o: ToolsOptions) {
  type Panel = "Settings" | "Activity" | "Views";
  const { view } = o,
    camera = h("div", "rw-cameras");
  camera.setAttribute("role", "group");
  camera.setAttribute("aria-label", "Camera controls");
  o.cameraHost.append(camera);
  o.host.classList.add("rw-toolbar");
  o.host.setAttribute("role", "group");
  o.host.setAttribute("aria-label", "Scene tools");
  const pop = h("div", "rw-pop");
  pop.hidden = true;
  pop.setAttribute("role", "region");
  document.body.append(pop);
  let panel: Panel | null = null,
    opener: HTMLButtonElement | undefined,
    eyeMode = false,
    eyeEpoch = 0,
    traceEpoch = 0;
  function report(e: unknown) {
    o.notify(e instanceof Error ? e.message : String(e), true);
  }
  function close(focus = false) {
    panel = null;
    pop.hidden = true;
    opener?.setAttribute("aria-expanded", "false");
    if (focus) opener?.focus();
    opener = undefined;
  }
  function position() {
    if (!opener || pop.hidden) return;
    const r = opener.getBoundingClientRect();
    pop.style.left =
      Math.max(
        8,
        Math.min(window.innerWidth - pop.offsetWidth - 8, panel === "Views" ? r.right - pop.offsetWidth : r.left),
      ) + "px";
    pop.style.bottom = Math.max(8, window.innerHeight - r.top + 7) + "px";
  }
  function popover(which: Panel, source: HTMLButtonElement) {
    if (panel === which) {
      close(true);
      return;
    }
    close();
    panel = which;
    opener = source;
    source.setAttribute("aria-expanded", "true");
    pop.hidden = false;
    pop.setAttribute("aria-label", which);
    const body = h("div", "rw-content");
    pop.replaceChildren(
      h(
        "header",
        null,
        h("h2", null, which),
        toolButton("Close " + which.toLowerCase(), "close", () => close(true)),
      ),
      body,
    );
    if (which === "Settings") settings(body);
    else if (which === "Views") views(body);
    else activity(body);
    position();
    pop.querySelector<HTMLElement>("button")?.focus();
  }
  window.addEventListener("resize", position);
  document.addEventListener("pointerdown", (event) => {
    if (
      !pop.hidden &&
      !pop.contains(event.target as Node) &&
      !o.host.contains(event.target as Node) &&
      !camera.contains(event.target as Node)
    )
      close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !pop.hidden) {
      event.preventDefault();
      close(true);
    }
  });
  const copyView = toolButton("Copy view link", "link", () => {
    const url = new URL(location.href);
    const state = view.cameraState();
    url.hash = new URLSearchParams({ view: JSON.stringify(state) }).toString();
    void copy(url.href)
      .then(() => o.notify("View link copied."))
      .catch(report);
  });
  const picture = toolButton("Save picture", "picture", () => {
    void view
      .picture()
      .then((blob) => {
        const url = URL.createObjectURL(blob),
          a = link("Download picture", url);
        const subject = o.getScene().instances.find((i) => i.id === view.focusedAsset())?.label ?? o.getScene().name;
        a.download = (subject.replace(/[^\p{L}\p{N}.-]+/gu, "-") || "Room") + ".png";
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        o.notify("Room picture saved." + (blob.note ? " " + blob.note : ""));
      })
      .catch(report);
  });
  const trace = toolButton("Trace", "trace", () => popover("Activity", trace));
  const cog = toolButton("Settings", "settings", () => popover("Settings", cog));
  cog.classList.add("rw-cog");
  o.host.append(copyView, picture, trace, cog);
  const viewMenu = toolButton("Views", "views", () => popover("Views", viewMenu));
  const eye = toolButton("Operator’s eye", "eye", () => {
    close();
    void operator(!view.cameraState().eye).catch(report);
  });
  const reset = toolButton("Reset all", "reset", () => {
    close();
    const focused = view.focusedAsset();
    const label = o.getScene().instances.find((i) => i.id === focused)?.label;
    void ask({
      title: "Reset adjustments and view?",
      body:
        "Restore neutral joint settings for " +
        (label ?? "every object in the scene") +
        " and reset this view. Undo restores the joint settings.",
      confirm: "Reset all",
      run: async () => {
        if (!(await o.write("scene.reset", focused ? { instance: focused } : {}, o.getScene().version)))
          return "The reset could not be applied. Read the message in the view for details.";
        eyeMode = false;
        ++eyeEpoch;
        view.showAllComponents();
        view.setDisplay({ labels: false, grid: true, colours: "natural", lighting: "day" });
        view.fit();
        refresh();
        return null;
      },
    });
  });
  // The lighting view: the daylight dimmed so the scene's lighting (ceiling lights, screens, the assets' lamps) shows.
  const LAMP_NOTE = "synergon.lampNote";
  const lamp = toolButton("Show the lighting (room dimmed)", "lamp", () => {
    const on = view.display().lighting !== "lamps";
    view.setDisplay({ ...view.display(), lighting: on ? "lamps" : "day" });
    lamp.classList.remove("rw-tool-dot"); lamp.setAttribute("aria-label", "Show the lighting (room dimmed)");
    syncLamp();
    if (on) note();
  });
  lamp.title = "Show the lighting (room dimmed). Shows where light falls; brightness is not measured.";
  lamp.classList.add("rw-lighting");
  const note = () => {
    let seen = false;
    try { seen = localStorage.getItem(LAMP_NOTE) === "1"; localStorage.setItem(LAMP_NOTE, "1"); } catch { /* storage blocked */ }
    if (!seen) o.notify("Lighting on. This shows where light falls, not how bright it is (no lux values). Set the lights under Room envelope › Lighting.");
  };
  const syncLamp = () => lamp.setAttribute("aria-pressed", String(view.display().lighting === "lamps"));
  syncLamp();
  // the panel switches the lighting view on when someone edits the lighting
  o.cameraHost.addEventListener("rv-lighting", () => { syncLamp(); note(); });
  // changed elsewhere (another viewer, an agent, a simulation) while this viewer shows daylight
  o.cameraHost.addEventListener("rv-lighting-changed", () => { lamp.classList.add("rw-tool-dot"); lamp.setAttribute("aria-label", "Lighting changed. Show the lighting view"); });
  camera.append(...(o.leading ?? []), viewMenu, lamp, eye, reset);
  for (const b of [viewMenu, trace, cog]) b.setAttribute("aria-expanded", "false");
  async function operator(on: boolean) {
    const epoch = ++eyeEpoch;
    eyeMode = on;
    if (!on) {
      view.leaveEye();
      eye.setAttribute("aria-pressed", "false");
      return;
    }
    const scene = o.getScene(),
      person = scene.person,
      host = scene.instances.find((i) => i.id === person?.host);
    if (!person || !host || (view.focusedAsset() && host.id !== view.focusedAsset())) {
      eyeMode = false;
      view.leaveEye();
      throw new Error("Seat an operator in a compatible station first.");
    }
    const release = view.releases().find((r) => r.id === host.release);
    const target =
      person.state.aims?.look ??
      ["S_mon_screen", "D_screen_center"].find((id) => release?.members.some((m) => m.id === id));
    if (!target) {
      eyeMode = false;
      throw new Error("Choose a look target for the seated operator.");
    }
    try {
      const r = await o.command<{ from: { point: RoomPoint }; to: { point: RoomPoint } }>("person.measure", {
        to: { instance: host.id, member: target },
      });
      if (epoch !== eyeEpoch || !eyeMode || r.version !== o.getScene().version) return;
      await o.setMode("3d");
      if (epoch !== eyeEpoch || !eyeMode) return;
      view.eye(r.result.from.point, r.result.to.point);
      eye.setAttribute("aria-pressed", "true");
    } catch (e) {
      if (epoch === eyeEpoch) {
        eyeMode = false;
        view.leaveEye();
        eye.setAttribute("aria-pressed", "false");
      }
      throw e;
    }
  }
  o.cameraHost.addEventListener("room-camera-change", () => {
    const active = !!view.cameraState().eye;
    eye.setAttribute("aria-pressed", String(active));
    if (!active) eyeMode = false;
  });
  function views(body: HTMLElement) {
    const list: [CameraPreset, string][] = [
      ["overview", "Overview"],
      ["front", "Front · south"],
      ["back", "Back · north"],
      ["left", "Left · west"],
      ["right", "Right · east"],
      ["top", "Top"],
    ];
    for (const [key, label] of list) {
      const b = h("button", "rw-choice", label);
      b.type = "button";
      b.onclick = () => {
        eyeMode = false;
        ++eyeEpoch;
        close();
        void o
          .setMode("3d")
          .then(() => {
            view.preset(key);
            refresh();
          })
          .catch(report);
      };
      body.append(b);
    }
  }
  function settings(body: HTMLElement) {
    const d = view.display();
    const colors = select(
      "Colours",
      [
        { value: "natural", label: "Natural materials" },
        { value: "parts", label: "Part colours" },
        { value: "evidence", label: "Evidence colours" },
      ],
      d.colours,
    );
    colors.onchange = () => view.setDisplay({ ...view.display(), colours: colors.value as typeof d.colours });
    body.append(
      field("Colours", colors),
      check("Object labels", d.labels, (on) => view.setDisplay({ ...view.display(), labels: on })),
      check("Live screen content", view.content.enabled(), (on) => view.content.setEnabled(on)),
    );
    if (!view.focusedAsset())
      body.append(check("Floor grid", d.grid, (on) => view.setDisplay({ ...view.display(), grid: on })));
    const scene = o.getScene(),
      parts = h("div");
    for (const i of scene.instances) {
      if (view.focusedAsset() && i.id !== view.focusedAsset()) continue;
      const components = view.components(i.id);
      if (components.length)
        parts.append(
          section(
            i.label,
            ...components.map((c) => check(c.label, c.visible, (on) => view.setComponentVisible(i.id, c.id, on))),
          ),
        );
    }
    const show = h("button", "rm-button", "Show all components");
    show.onclick = () => {
      view.showAllComponents();
      for (const e of parts.querySelectorAll("input")) e.checked = true;
    };
    if (parts.children.length) body.append(section("Component visibility", show, parts));
    const endpoint = new URL(o.apiRoot + "/mcp", location.origin).href,
      input = h("input");
    input.value = endpoint;
    input.readOnly = true;
    input.onclick = () => input.select();
    const copyEndpoint = h("button", "rm-button", "Copy MCP endpoint");
    copyEndpoint.onclick = () =>
      void copy(endpoint)
        .then(() => o.notify("Scene endpoint copied."))
        .catch(report);
    body.append(
      section(
        "Agent access",
        field("Scene MCP endpoint", input),
        copyEndpoint,
        link("Agent guide", "/llms.txt", "rw-guide"),
      ),
      section(
        "Controls and shortcuts",
        h(
          "p",
          null,
          "Drag an object to place it in plan. Drag empty space to pan. In 3D, click an adjustable part, then drag it to move its joints. Drag the background to orbit and scroll to zoom. Shift-click opens another component card. Ctrl/Cmd + Z undoes a layout edit.",
        ),
      ),
    );
  }
  function activity(body: HTMLElement) {
    const n = ++traceEpoch;
    body.textContent = "Reading activity…";
    void o
      .command<{ entries: { version: number; command: string; key?: string; at?: string }[] }>("history.list", {})
      .then((r) => {
        if (n !== traceEpoch || panel !== "Activity") return;
        const entries = [...r.result.entries].sort((a, b) => b.version - a.version);
        body.replaceChildren(
          ...(entries.length
            ? entries.map((e) =>
                h(
                  "div",
                  "rw-event",
                  h("b", null, "r" + e.version),
                  h("span", null, e.command, e.key && h("small", null, e.key)),
                ),
              )
            : [h("p", null, "No recorded edits in this scene.")]),
        );
      })
      .catch((e) => {
        if (n === traceEpoch) body.textContent = e.message;
      });
  }
  function refresh() {
    syncLamp();
    eye.disabled = !o.getScene().person || (!!view.focusedAsset() && o.getScene().person?.host !== view.focusedAsset());
    if (eyeMode && view.getView() === "3d") {
      if (eye.disabled) {
        eyeMode = false;
        view.leaveEye();
      } else void operator(true).catch(report);
    } else if (view.getView() === "plan") eyeMode = false;
    eye.setAttribute("aria-pressed", String(!!view.cameraState().eye));
    if (panel === "Activity") {
      const body = pop.querySelector<HTMLElement>(".rw-content");
      if (body) activity(body);
    }
  }
  async function restoreLink() {
    const state = readRoomViewLink(location.hash);
    if (!state) return;
    if (state.labels !== undefined) view.setDisplay({ ...view.display(), labels: state.labels });
    if (state.focused) {
      if (!o.getScene().instances.some((i) => i.id === state.focused)) {
        o.notify("The shared asset is no longer in this scene. Showing the whole scene.");
        return;
      }
      await view.focusAsset(state.focused);
      if (view.focusedAsset() !== state.focused) return;
    }
    const selected = o.getScene().instances.find((i) => i.id === state.selected);
    const validMember =
      selected &&
      view
        .releases()
        .find((r) => r.id === selected.release)
        ?.members.some((m) => m.id === state.member);
    o.select(
      selected?.id ?? null,
      validMember || (state.member === "@operator" && selected && o.getScene().person?.host === selected.id)
        ? state.member!
        : undefined,
    );
    await o.setMode(state.mode);
    view.restoreCamera(state);
    if (state.mode === "3d" && state.eye && o.getScene().person) {
      await operator(true).catch(report);
      if (state.look && view.cameraState().eye) view.restoreLook(state.look);
    }
  }
  o.cameraHost.addEventListener("room-focus-change", (event) => {
    close();
    refresh();
    const { restoreEye, look } = (event as CustomEvent).detail;
    if (restoreEye && !eye.disabled)
      void operator(true)
        .then(() => {
          if (look && view.cameraState().eye) view.restoreLook(look);
        })
        .catch(report);
  });
  refresh();
  return { refresh, restoreLink };
}
