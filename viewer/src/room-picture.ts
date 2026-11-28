// Capture the displayed drawing at the current camera. SVG computed styles make plan exports self-contained.
const styles = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "vector-effect",
  "display",
  "visibility",
  "paint-order",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
];
async function drawPlan(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, w: number, h: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const inNodes = [svg, ...svg.querySelectorAll("*")],
    outNodes = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < inNodes.length; i++) {
    const source = getComputedStyle(inNodes[i]),
      target = outNodes[i] as SVGElement;
    for (const key of styles) {
      const val = source.getPropertyValue(key).replace(/url\(["']?[^)]*#([^)"']+)["']?\)/g, "url(#$1)");
      target.style.setProperty(key, val);
    }
  }
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.style.display = "block";
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    ctx.drawImage(image, 0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** Live screens on the picture: their pages are other sites' frames, which a canvas cannot read. */
export interface LiveCapture {
  /** Swap every live screen to a labelled plate and draw at once; returns how to swap back (same task). */
  plates(): () => void;
}
export const LIVE_NOTE = "Live screens are shown as labels. Use your system's screenshot to include them.";
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The stage as this tab shows it, live screens included, from one frame of a capture of this tab (Chrome and Edge
 *  ask once to "share this tab"). Null when the browser cannot or the person declines. */
async function tabPicture(stage: HTMLElement): Promise<Blob | null> {
  const media = navigator.mediaDevices;
  if (!media?.getDisplayMedia) return null;
  let stream: MediaStream;
  try {
    stream = await media.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true,
      selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
  } catch { return null; }
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || track.getSettings().displaySurface !== "browser") return null;
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    await video.play();
    for (let n = 0; n < 40 && !video.videoWidth; n++) await frame();
    await frame(); await frame();
    const vw = video.videoWidth, vh = video.videoHeight;
    // the capture must be this tab: same shape as the window
    if (!vw || !vh || Math.abs(vw / vh - innerWidth / innerHeight) > 0.03) return null;
    const k = vw / innerWidth, r = stage.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(r.width * k)); canvas.height = Math.max(1, Math.round(r.height * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, r.x * k, r.y * k, r.width * k, r.height * k, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch { return null; }
  finally { for (const t of stream.getTracks()) t.stop(); }
}

export async function roomPicture(stage: HTMLElement, mode: "3d" | "plan", live?: LiveCapture): Promise<Blob & { note?: string }> {
  if (live && mode === "3d") {
    const shot = await tabPicture(stage);
    if (shot) return shot;
  }
  await frame();
  await frame();
  const view = stage.getBoundingClientRect(),
    w = Math.round(view.width),
    h = Math.round(view.height);
  if (w < 1 || h < 1) throw new Error("Open a visible room drawing to save its picture.");
  const canvas = document.createElement("canvas"),
    scale = Math.min(devicePixelRatio || 1, 2, 4096 / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot export a drawing.");
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(stage).backgroundColor;
  ctx.fillRect(0, 0, w, h);
  if (mode === "plan") await drawPlan(ctx, stage.querySelector<SVGSVGElement>(".rv-plan")!, w, h);
  else {
    const gl = stage.querySelector("canvas");
    if (!gl) throw new Error("The 3D view is still opening.");
    // never a transparent hole: live screens become labelled plates for this one drawing
    const restore = live?.plates();
    try { ctx.drawImage(gl, 0, 0, w, h); } finally { restore?.(); }
    for (const tag of stage.querySelectorAll<HTMLElement>(".rv-orbit-tag")) {
      const r = tag.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(tag),
        x = r.x - view.x,
        y = r.y - view.y;
      ctx.fillStyle = s.backgroundColor;
      ctx.fillRect(x, y, r.width, r.height);
      ctx.fillStyle = s.color;
      ctx.font = s.font;
      ctx.textBaseline = "middle";
      ctx.fillText(tag.textContent ?? "", x + 5, y + r.height / 2, r.width - 7);
    }
  }
  const note = live && mode === "3d" ? LIVE_NOTE : undefined;
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(Object.assign(blob, note ? { note } : {})) : reject(new Error("Picture export failed."))), "image/png"),
  );
}
