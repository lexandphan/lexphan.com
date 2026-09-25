import { buildBody, buildGarment, ghostRings, landmarks, withDetail } from "/6ef1cfa0de5b6c/body.js";

const AXIS_LABEL = {
  p2p: "Pit-to-pit", len: "Length", sh: "Shoulder", slv: "Sleeve",
  waist: "Waist", rise: "Rise", thigh: "Thigh", knee: "Knee", hem: "Leg opening", inseam: "Inseam", hip: "Hip",
};
const TOP_AXES = ["p2p", "len", "sh", "slv"];
const BOTTOM_AXES = ["waist", "rise", "thigh", "knee", "hem", "inseam"];

const app = document.getElementById("app");
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const r1 = (n) => Math.round(n * 10) / 10;
const both = (cm) => `${r1(cm)}cm · ${r1(cm / 2.54)}in`;

// The signed link rides in the FRAGMENT, so it is never sent to this host — only the API sees it.
// It is decoded to a full URL rather than a bare token so this page holds no project identifier.
function dataUrl() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  try {
    const url = new URL(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (url.protocol !== "https:" || !/\.supabase\.co$/.test(url.hostname)) return null;
    if (!url.pathname.endsWith("/functions/v1/fit-view")) return null;
    url.searchParams.set("f", "json");
    return url.toString();
  } catch { return null; }
}

function fail(msg) {
  app.replaceChildren(el("p", null, msg));
  app.firstChild.id = "err";
}

async function main() {
  const url = dataUrl();
  if (!url) return fail("This link is incomplete. Ask Tori for the fit again.");
  let view;
  try {
    const res = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!res.ok) return fail("This link has expired. Ask Tori for the fit again and she'll send a fresh one.");
    view = await res.json();
  } catch { return fail("Couldn't reach the data for this fit."); }
  render(view, url);
}

function render(view, url) {
  const axes = view.garment.category === "bottom" ? BOTTOM_AXES : TOP_AXES;
  const usable = view.refs.map((r, i) => ({ ...r, i })).filter((r) => !r.unmeasured);
  let active = 0;

  app.replaceChildren();
  const head = el("header");
  head.append(
    el("h1", null, view.garment.name || "This piece"),
    el("div", "sub", `${view.garment.category === "bottom" ? "bottoms" : view.garment.category} · ${usable.length} reference${usable.length === 1 ? "" : "s"} in your vault`),
  );
  const chips = el("div"); chips.id = "chips";
  const stage = el("div"); stage.id = "stage";
  const hint = el("div", null, "drag to turn · pinch or scroll to zoom"); hint.id = "hint";
  stage.append(hint);
  const legend = el("div", null, ""); legend.id = "legend";
  const bars = el("div", "bars");
  const reads = el("div", "reads");
  const notes = el("div", "notes");
  const foot = el("footer");
  app.append(head, chips, stage, legend, bars, reads, notes, foot);

  const shorts = shortLabel(usable.map((x) => x.name));
  usable.forEach((r, n) => {
    const b = el("button", null, shorts[n]);
    b.setAttribute("aria-pressed", String(n === 0));
    b.onclick = () => { active = n; paint(); };
    chips.append(b);
  });

  for (const line of view.bodyReads || []) reads.append(el("p", null, line));

  if (view.model) {
    const m = view.model;
    const rows = [
      ["Height", m.heightCm, "heightCm"], ["Shoulder", m.shoulderCm, "shoulderCm"],
      ["Chest", m.chestCirc, "chestCirc"], ["Waist", m.waistCirc, "waistCirc"],
      ["Hip", m.hipCirc, "hipCirc"], ["Inseam", m.inseamCm, "inseamCm"],
    ];
    notes.append(el("p", null, "The figure is built from:"));
    for (const [label, val, key] of rows) {
      const estimated = !!m.estimated[key];
      notes.append(el("p", "est", `${label} ${r1(val)}cm — ${estimated ? `estimated, ${m.notes[key] || "derived"}` : "from your notes"}`));
    }
  }
  for (const c of view.caveats || []) notes.append(el("p", null, c));

  const flat = el("a", null, "Open the flat technical view");
  const flatUrl = new URL(url); flatUrl.searchParams.delete("f");
  flat.href = flatUrl.toString();
  foot.append(flat);

  const scene = makeScene(stage, view);

  function paint() {
    const ref = usable[active];
    [...chips.children].forEach((c, n) => c.setAttribute("aria-pressed", String(n === active)));
    legend.replaceChildren();
    const key = (cls, text) => { const i = el("i", cls); legend.append(i, document.createTextNode(text)); };
    key("p", "the piece\u2003");
    key("g", `your ${shorts[active]}${ref.size ? ` (${ref.size})` : ""}`);
    scene.setGhost(ref.axes);

    const deltas = view.deltas[ref.i];
    bars.replaceChildren();
    for (const axis of axes) {
      const d = deltas.find((x) => x.axis === axis) || { axis, garmentCm: null, refCm: null, deltaCm: null };
      const max = Math.max(1, ...usable.map((rr) => rr.axes[axis]?.cm || 0), view.garment.axes[axis]?.cm || 0) * 1.08;
      bars.append(barRow(d, max, shorts[active]));
    }
  }
  paint();
}

function barRow(d, max, refName) {
  const wrap = el("div", "bar");
  const top = el("div", "top");
  const left = el("div");
  left.append(el("div", "name", AXIS_LABEL[d.axis] || d.axis));
  left.append(el("div", "val", d.garmentCm == null ? "not given" : both(d.garmentCm)));
  const right = el("div", "delta",
    d.suppressed === "datum" ? "measured differently — not comparable"
      : d.garmentCm == null ? ""
      : d.deltaCm == null ? `no ${(AXIS_LABEL[d.axis] || "").toLowerCase()} on the ${refName}`
      : `${d.deltaCm > 0 ? "+" : d.deltaCm < 0 ? "−" : "±"}${Math.abs(d.deltaCm)}cm vs ${refName}`);
  top.append(left, right);
  wrap.append(top);

  const track = el("div", "track");
  if (d.garmentCm != null) {
    const fill = el("div", "fill");
    fill.style.width = `${Math.max(2, (d.garmentCm / max) * 100)}%`;
    track.append(fill);
    if (d.refCm != null && d.suppressed !== "datum") {
      const tick = el("div", "tick");
      tick.style.left = `calc(${(d.refCm / max) * 100}% - 1px)`;
      track.append(tick);
    }
  }
  wrap.append(track);
  return wrap;
}

function shortLabel(names) {
  const words = names.map((n) => n.split(/\s+/));
  return words.map((w, i) => {
    for (let take = 1; take <= w.length; take++) {
      const p = w.slice(0, take).join(" ");
      if (!words.some((o, j) => j !== i && o.slice(0, take).join(" ") === p)) return p.length > 18 ? p.slice(0, 17) + "…" : p;
    }
    return w.join(" ").slice(0, 17) + "…";
  });
}

function makeScene(stage, view) {
  let pending = null;
  let apply = (axes) => { pending = axes; };
  const api = { setGhost: (axes) => apply(axes) };
  if (!view.model) {
    const none = el("div", null, "Not enough body measurements on file to build a figure.");
    none.setAttribute("style", "position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:var(--muted);font-size:13px");
    stage.append(none);
    return api;
  }
  let disposed = false;
  (async () => {
    let THREE;
    try { THREE = await import("/vendor/three.module.js"); }
    catch { stage.append(el("div", "sub", "3D unavailable here.")); return; }
    if (disposed) return;

    const m = view.model, L = landmarks(m);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    stage.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
    const target = new THREE.Vector3(0, L.chest * 0.96, 0);

    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const accent = new THREE.Color(css("--accent"));
    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x3a3a45 : 0x9a9a92, dark ? 1.45 : 1.55));
    const key = new THREE.DirectionalLight(0xffffff, dark ? 1.25 : 1.35);
    key.position.set(-70, L.crown * 1.25, 120);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, dark ? 0.55 : 0.35);
    rim.position.set(95, L.crown * 0.6, -90);
    scene.add(rim);

    scene.add(buildBody(THREE, m, new THREE.Color(dark ? 0xf2f1ec : 0xfbfaf6)));

    const pieceMat = new THREE.MeshStandardMaterial({
      color: accent, roughness: .78, transparent: true, opacity: .58, side: THREE.FrontSide, depthWrite: false,
    });
    const piece = buildGarment(THREE, view.garment.axes, m, pieceMat, view.garment.category);
    if (piece) scene.add(piece);

    // A second hue, not a grey: the piece and the reference are two entities, and line-vs-fill
    // alone stops reading once the two shapes are close in size.
    const ghostMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(dark ? 0xe3a06a : 0xa8622a), transparent: true, opacity: .95, depthTest: false,
    });
    let ghost = null;
    apply = (axes) => {
      if (ghost) { scene.remove(ghost); ghost.traverse((o) => o.geometry?.dispose()); }
      ghost = withDetail({ seg: 64, sub: 1 }, () => ghostRings(THREE, axes, m, ghostMat, view.garment.category));
      // The reference is usually INSIDE the piece, so with depth testing on it is simply never
      // seen — and an invisible comparison is the one thing this page cannot ship with.
      if (ghost) { ghost.renderOrder = 2; scene.add(ghost); }
    };
    if (pending) apply(pending);

    // Orbit: azimuth/elevation around the figure, clamped so it never flips under the floor.
    let az = 0.42, el0 = 0.06, dist = m.heightCm * 1.5, userMoved = false;
    // Frame the WHOLE figure: fit its stature to the viewport's vertical field of view, with a
    // margin, so nothing is cropped at the knees by accident.
    const frame = () => {
      const fov = (camera.fov * Math.PI) / 180;
      const need = (m.heightCm * 1.12) / (2 * Math.tan(fov / 2));
      dist = clampDist(Math.max(need, need / Math.max(camera.aspect, 0.5)), m);
      target.set(0, m.heightCm * 0.52, 0);
    };
    const place = () => {
      camera.position.set(
        target.x + dist * Math.cos(el0) * Math.sin(az),
        target.y + dist * Math.sin(el0),
        target.z + dist * Math.cos(el0) * Math.cos(az),
      );
      camera.lookAt(target);
    };
    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (!userMoved) frame();
      place();
    };
    new ResizeObserver(resize).observe(stage);
    resize();

    const pts = new Map();
    let lastPinch = 0;
    stage.addEventListener("pointerdown", (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); });
    stage.addEventListener("pointerup", (e) => { pts.delete(e.pointerId); lastPinch = 0; });
    stage.addEventListener("pointercancel", (e) => { pts.delete(e.pointerId); lastPinch = 0; });
    stage.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, e);
      if (pts.size === 1) {
        az -= (e.clientX - prev.clientX) * 0.008;
        el0 = Math.max(-0.5, Math.min(0.75, el0 + (e.clientY - prev.clientY) * 0.005));
        userMoved = true;
        stage.querySelector("#hint")?.style.setProperty("opacity", "0");
      } else if (pts.size === 2) {
        userMoved = true;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (lastPinch) dist = clampDist(dist * (lastPinch / d), m);
        lastPinch = d;
      }
      place();
    });
    stage.addEventListener("wheel", (e) => { e.preventDefault(); userMoved = true; dist = clampDist(dist * (1 + e.deltaY * 0.0012), m); place(); }, { passive: false });

    const tick = () => { if (disposed) return; renderer.render(scene, camera); requestAnimationFrame(tick); };
    tick();
  })();
  addEventListener("pagehide", () => { disposed = true; });
  return api;
}

const clampDist = (d, m) => Math.max(m.heightCm * 0.7, Math.min(m.heightCm * 3, d));

main();
