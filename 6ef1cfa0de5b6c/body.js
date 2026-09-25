// Parametric mannequin + garment shells, built from measurements in centimetres.
// Scene units are centimetres; the camera is framed to the figure's height.

// Ramanujan's ellipse perimeter, solved backwards: given a circumference and a width:depth ratio,
// what are the half-axes? Every cross-section in here is an ellipse specified by its circumference,
// because a circumference is what a tape measure and a spec sheet both give you.
export function axesFromCirc(circ, ratio) {
  const unit = Math.PI * (3 * (ratio + 1) - Math.sqrt((3 * ratio + 1) * (ratio + 3)));
  const k = circ / unit;
  return { a: ratio * k, b: k };
}

let SEG = 48;   // points around a ring
let SUB = 5;    // spline steps between two key rings

/** Build something at a coarser resolution. A ghost is drawn as a wireframe, and a smoothed
 *  48-sided mesh is a fog of lines rather than a readable outline — so it gets few segments and
 *  no subdivision, which leaves the shape while dropping the noise. */
export function withDetail({ seg = SEG, sub = SUB }, fn) {
  const prevSeg = SEG, prevSub = SUB;
  SEG = seg; SUB = sub;
  try { return fn(); } finally { SEG = prevSeg; SUB = prevSub; }
}

function ring(y, a, b, xOff = 0, zOff = 0) {
  const pts = [];
  for (let i = 0; i < SEG; i++) {
    const t = (i / SEG) * Math.PI * 2;
    pts.push([xOff + Math.cos(t) * a, y, zOff + Math.sin(t) * b]);
  }
  return pts;
}

/** Catmull-Rom through the key rings, per vertex index. Without this the silhouette is a stack of
 *  straight segments with a crease at every landmark — the "boxy" look. Centripetal
 *  parameterisation keeps the curve from bulging past the measurements it interpolates. */
export function smoothRings(keys, subdiv = SUB) {
  if (keys.length < 3 || subdiv <= 1) return keys;
  const at = (i) => keys[Math.max(0, Math.min(keys.length - 1, i))];
  const out = [];
  for (let k = 0; k < keys.length - 1; k++) {
    const p0 = at(k - 1), p1 = at(k), p2 = at(k + 1), p3 = at(k + 2);
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv, t2 = t * t, t3 = t2 * t;
      const r = [];
      for (let i = 0; i < p1.length; i++) {
        r.push([0, 1, 2].map((c) =>
          0.5 * ((2 * p1[i][c]) +
            (-p0[i][c] + p2[i][c]) * t +
            (2 * p0[i][c] - 5 * p1[i][c] + 4 * p2[i][c] - p3[i][c]) * t2 +
            (-p0[i][c] + 3 * p1[i][c] - 3 * p2[i][c] + p3[i][c]) * t3)));
      }
      out.push(r);
    }
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/** Loft a tube through a stack of equal-length rings.
 *
 *  INDEXED, sharing one vertex per (ring, segment). An unindexed loft gives every triangle its own
 *  vertices, so computeVertexNormals can only produce facet normals and the whole figure shades
 *  flat no matter how many segments it has. Sharing vertices is what makes it read as a curve. */
export function loft(THREE, keyRings, { capTop = false, capBottom = false, smooth = true } = {}) {
  const rings = smooth ? smoothRings(keyRings) : keyRings;
  const n = rings[0].length;
  const pos = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);

  const idx = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = r * n + i, b = r * n + j, c = (r + 1) * n + i, d = (r + 1) * n + j;
      idx.push(a, c, d, a, d, b);
    }
  }
  const cap = (ringIdx, up) => {
    const r = rings[ringIdx];
    const c = r.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
    const centre = pos.length / 3;
    pos.push(c[0], c[1], c[2]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = ringIdx * n + i, b = ringIdx * n + j;
      if (up) idx.push(centre, a, b); else idx.push(centre, b, a);
    }
  };
  if (capTop) cap(rings.length - 1, true);
  if (capBottom) cap(0, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A limb as a CAPSULE: a tapered tube with a hemispherical cap at each end.
 *
 *  The figure is a soft vinyl mannequin, not an anatomical model, so nothing terminates in a flat
 *  disc. The caps are rings on a quarter-circle profile, so they belong to the same lofted surface
 *  and share its smooth normals — and the rounded end of an arm IS the mitten hand. */
function capsule(THREE, from, to, circA, circB, ratio = 1.05, { capA = true, capB = true } = {}) {
  const steps = 6, capSteps = 4;
  const axis = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const dir = axis.map((c) => c / len);
  const at = (t) => [0, 1, 2].map((c) => from[c] + axis[c] * t);
  const ringAt = (p, a, b) => ring(p[1], a, b, p[0], p[2]);
  const rings = [];

  const cap = (circ, origin, sign, descending) => {
    const { a, b } = axesFromCirc(circ, ratio);
    const r = Math.max(a, b);
    const idx = descending ? [...Array(capSteps).keys()].map((i) => capSteps - i) : [...Array(capSteps).keys()].map((i) => i + 1);
    for (const i of idx) {
      const u = (i / capSteps) * (Math.PI / 2);
      const p = [0, 1, 2].map((c) => origin[c] + sign * dir[c] * Math.sin(u) * r);
      rings.push(ringAt(p, Math.max(a * Math.cos(u), 0.02), Math.max(b * Math.cos(u), 0.02)));
    }
  };

  if (capA) cap(circA, from, -1, true);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { a, b } = axesFromCirc(circA + (circB - circA) * t, ratio);
    rings.push(ringAt(at(t), a, b));
  }
  if (capB) cap(circB, to, 1, false);

  return loft(THREE, rings, { capTop: !capB, capBottom: !capA, smooth: false });
}

const limb = capsule;

/** Heights as a fraction of stature, and circumferences as a fraction of a measured girth.
 *  These are proportions, not measurements — they place the numbers he DOES have on a plausible
 *  frame. Everything load-bearing (shoulder, chest, waist, hip, inseam, height) is his. */
export function landmarks(m) {
  const H = m.heightCm;
  return {
    crown: H,
    chin: H * 0.865,
    neck: H * 0.822,
    shoulder: H * 0.812,
    armpit: H * 0.772,
    chest: H * 0.722,
    waist: H * 0.622,
    hip: H * 0.528,
    crotch: m.inseamCm,
    knee: H * 0.285,
    ankle: H * 0.045,
  };
}

export function buildBody(THREE, m, color) {
  const L = landmarks(m);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .95, metalness: 0 });

  const neckC = m.chestCirc * 0.37;
  const shoulderHalf = m.shoulderCm / 2;
  const upperC = m.chestCirc * 0.40, wristC = m.chestCirc * 0.30;
  const armHalf = axesFromCirc(upperC, 1.06).a;
  const torsoTopHalf = Math.min(shoulderHalf - armHalf * 0.55, m.chestCirc * 0.20);
  // Cross-sections stay elliptical and stay driven by his real girths — the toy look comes from
  // ROUNDING THE ENDS, not from pretending his chest is circular. A circular chest would shrink
  // the drawn width for the same circumference and quietly break the width comparison.
  const chestAx = axesFromCirc(m.chestCirc, 1.30);
  // A wider width:depth ratio at the waist spends more of his 28cm chest-to-waist drop on DEPTH
  // and less on width, so the front silhouette reads closer to a slab. The girth is unchanged —
  // this moves where the reduction shows, it does not shrink or invent anything.
  const waistAx = axesFromCirc(m.waistCirc, 1.52);
  const hipAx = axesFromCirc(m.hipCirc, 1.36);
  const neckAx = axesFromCirc(neckC, 1.05);

  const rings = [];
  rings.push(ring(L.hip - 9, hipAx.a * 0.93, hipAx.b * 0.93));
  rings.push(ring(L.hip - 3, hipAx.a, hipAx.b));
  rings.push(ring(L.waist, waistAx.a, waistAx.b));
  rings.push(ring(L.chest, chestAx.a, chestAx.b));
  rings.push(ring(L.armpit, chestAx.a * 1.02, chestAx.b * 0.98));
  // The shoulder is the widest point but it is NOT a corner: the width arrives on a curve from the
  // armpit and leaves on one into the yoke, so there is no plateau and no edge where an arm meets
  // a torso. His 52cm delt-to-delt is still the maximum; only the approach to it is rounded.
  rings.push(ring((L.armpit + L.shoulder) / 2, chestAx.a * 1.04, chestAx.b * 0.96));
  rings.push(ring(L.shoulder, torsoTopHalf, chestAx.b * 0.94));
  const domeH = 11;
  for (let i = 1; i <= 7; i++) {
    const u = (i / 7) * (Math.PI / 2);
    rings.push(ring(
      L.shoulder + Math.sin(u) * domeH,
      neckAx.a + (torsoTopHalf - neckAx.a) * Math.pow(Math.cos(u), 0.8),
      neckAx.b + (chestAx.b * 0.94 - neckAx.b) * Math.pow(Math.cos(u), 0.8),
    ));
  }
  g.add(new THREE.Mesh(loft(THREE, rings, { capTop: true, capBottom: true }), mat));

  // Head: a ball resting IN the yoke. The reference has no real neck, so the sphere overlaps the
  // dome rather than being stilted above it.
  const headR = neckC * 0.395;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
  head.scale.set(headR, headR * 1.14, headR * 1.03);
  head.position.y = L.shoulder + domeH + headR * 0.48;
  g.add(head);

  const thighC = m.hipCirc * 0.68, kneeC = m.hipCirc * 0.50, ankleC = m.hipCirc * 0.37;
  const lc = legCenters(m);
  for (const s of [-1, 1]) {
    g.add(new THREE.Mesh(capsule(THREE, [s * lc.hip, L.hip - 1, 0], [s * lc.knee, L.knee, 0], thighC * 1.06, kneeC, 1.06, { capA: false, capB: false }), mat));
    g.add(new THREE.Mesh(capsule(THREE, [s * lc.knee, L.knee, 0], [s * lc.ankle, L.ankle + 2, 0], kneeC, ankleC, 1.1, { capA: false }), mat));
    // foot: a short capsule nosing forward, rounded at both ends
    g.add(new THREE.Mesh(capsule(THREE, [s * lc.ankle, L.ankle + 1, 0], [s * lc.ankle, L.ankle - 1, ankleC * 0.42], ankleC, ankleC * 0.82, 1.15), mat));
  }

  for (const s of [-1, 1]) {
    const from = armRoot(m, s), to = armEnd(m, s);
    // capped at the top: that dome IS the shoulder, merged into the torso's yoke
    g.add(new THREE.Mesh(capsule(THREE, from, to, upperC, wristC, 1.06), mat));
  }
  return g;
}

/** Where a sleeve starts and ends. Shared by the body and by every garment, so a sleeve always
 *  lands on the arm it is supposed to cover. */
/** Where the two legs sit, at the hip / knee / ankle. Defined ONCE because the body, the trousers
 *  and the reference rings all have to stand in the same place — drifting stances read as the
 *  trousers missing the legs. Slightly wider than a real stance so a wide leg opening does not
 *  merge its two hems into one shape. */
export function legCenters(m) {
  const hipAx = axesFromCirc(m.hipCirc, 1.38);
  const x = hipAx.a * 0.52;
  return { hip: x, knee: x * 0.99, ankle: x * 0.98 };
}

export function armRoot(m, side) {
  const L = landmarks(m);
  const armHalf = axesFromCirc(m.chestCirc * 0.40, 1.06).a;
  return [side * (m.shoulderCm / 2 - armHalf), L.shoulder + 1, 0];
}
export function armEnd(m, side) {
  const L = landmarks(m);
  const root = armRoot(m, side);
  const drop = m.armLenCm;
  const out = Math.sin(0.23) * drop;
  return [root[0] + side * out, root[1] - Math.cos(0.23) * drop, 0];
}

/** A top as a shell around the figure: shoulder seam at the top, pit-to-pit at the armpit,
 *  straight to the hem. Open at both ends, so you can see the body through it. */
export function buildTop(THREE, axes, m, material) {
  const L = landmarks(m);
  const p2p = axes.p2p?.cm, len = axes.len?.cm;
  if (!p2p || !len) return null;
  const g = new THREE.Group();
  const shHalf = (axes.sh?.cm ?? p2p * 0.86) / 2;
  const bodyAx = axesFromCirc(p2p * 2, 1.38);
  const hemAx = axes.hem ? axesFromCirc(axes.hem.cm * 2, 1.38) : bodyAx;

  const yShoulder = L.shoulder + 1.5;
  const yPit = Math.min(L.armpit, yShoulder - len * 0.30);
  const yHem = yShoulder - len;
  const neckAx = axesFromCirc(m.chestCirc * 0.40, 1.1);

  g.add(new THREE.Mesh(loft(THREE, [
    ring(yHem, hemAx.a, hemAx.b),
    ring(yPit, bodyAx.a, bodyAx.b),
    ring(yShoulder - 1, shHalf, bodyAx.b * 0.94),
    ring(yShoulder, Math.max(shHalf * 0.34, neckAx.a), neckAx.b),
  ]), material));

  const slv = axes.slv?.cm;
  if (slv) {
    // A raglan sleeve is measured from the centre-back neck, so the run along the ARM is shorter
    // than the number by roughly the neck-to-shoulder span. Using the raw number puts the cuff a
    // third of a forearm past the hand.
    const raglan = axes.slv?.datum === "raglan";
    const run = raglan ? Math.max(slv - m.shoulderCm * 0.42, slv * 0.6) : slv;
    const bicep = p2p * 0.82, cuff = Math.max(20, p2p * 0.38);
    for (const s of [-1, 1]) {
      const root = armRoot(m, s), end = armEnd(m, s);
      const dx = end[0] - root[0], dy = end[1] - root[1];
      const full = Math.hypot(dx, dy) || 1;
      const t = Math.min(run / full, 1.25);
      g.add(new THREE.Mesh(
        limb(THREE, [root[0], root[1] + 1, 0], [root[0] + dx * t, root[1] + dy * t, 0], bicep, cuff, 1.05,
          { capA: false, capB: false }),
        material,
      ));
    }
  }
  return g;
}

/** Bottoms: waistband, crotch at the rise, two tapered legs. */
export function buildBottom(THREE, axes, m, material) {
  const waist = axes.waist?.cm, inseam = axes.inseam?.cm;
  if (!waist || !inseam) return null;
  const L = landmarks(m);
  const g = new THREE.Group();
  const rise = axes.rise?.cm ?? waist * 0.7;
  const thighC = (axes.thigh?.cm ?? waist * 0.78) * 2;
  const kneeC = (axes.knee?.cm ?? thighC / 2 * 0.8) * 2;
  const hemC = (axes.hem?.cm ?? kneeC / 2 * 0.9) * 2;

  // Trousers hang from the WAIST, so the band is the anchor and the crotch follows the rise down
  // from it — not the other way round. Anchoring the crotch to the body and adding the rise put
  // the Lemaire waistband at rib height. His own note is the check: waist 111cm, rise 39.4 and
  // inseam 69.9 land the hem at ~2cm, which is "breaks at shoe" exactly as written; the Oni's
  // rise 29 / inseam 87 lands it below the floor, which is why that note says to cuff them.
  const yWaist = L.waist;
  const yCrotch = yWaist - rise;
  const yKnee = yCrotch - inseam * 0.45;
  const yHem = Math.max(yCrotch - inseam, -12);

  const wAx = axesFromCirc(waist * 2, 1.3);
  const hipAx = axesFromCirc(Math.max(waist * 2, m.hipCirc + 6), 1.4);
  g.add(new THREE.Mesh(loft(THREE, [
    ring(yCrotch, hipAx.a, hipAx.b),
    ring(yWaist - (yWaist - yCrotch) * 0.45, hipAx.a, hipAx.b),
    ring(yWaist, wAx.a, wAx.b),
  ]), material));

  const lc = legCenters(m);
  const legRing = (y, circ, x) => { const { a, b } = axesFromCirc(circ, 1.05); return ring(y, a, b, x); };
  for (const s of [-1, 1]) {
    g.add(new THREE.Mesh(loft(THREE, [
      legRing(yHem, hemC, s * lc.ankle),
      legRing(yKnee, kneeC, s * lc.knee),
      legRing(yCrotch + 1, thighC, s * lc.hip),
      legRing(yCrotch + 6, thighC * 1.02, s * lc.hip),
    ]), material));
  }
  return g;
}

export const buildGarment = (THREE, axes, m, material, category) =>
  category === "bottom" ? buildBottom(THREE, axes, m, material) : buildTop(THREE, axes, m, material);

/** The reference garment as a handful of rings rather than a mesh.
 *
 *  A wireframe shell of the reference is a cage: it sits outside or inside the piece and buries it.
 *  What actually needs comparing is a few levels — how wide at the chest, where the hem lands, how
 *  wide the shoulder — so those are drawn, and nothing else. Same information, no fog. */
export function ghostRings(THREE, axes, m, material, category) {
  const L = landmarks(m);
  const g = new THREE.Group();
  const add = (y, a, b, xOff = 0) => {
    const pts = ring(y, a, b, xOff).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material));
  };

  if (category === "bottom") {
    const waist = axes.waist?.cm, inseam = axes.inseam?.cm;
    if (!waist || !inseam) return null;
    const rise = axes.rise?.cm ?? waist * 0.7;
    const yWaist = L.waist, yCrotch = yWaist - rise;
    const yHem = Math.max(yCrotch - inseam, -12);
    const w = axesFromCirc(waist * 2, 1.3);
    add(yWaist, w.a, w.b);
    void yCrotch;
    const lc = legCenters(m);
    const h = axesFromCirc((axes.hem?.cm ?? 22) * 2, 1.05);
    for (const s of [-1, 1]) add(yHem, h.a, h.b, s * lc.ankle);
    return g;
  }

  const p2p = axes.p2p?.cm, len = axes.len?.cm;
  if (!p2p || !len) return null;
  const body = axesFromCirc(p2p * 2, 1.38);
  const shHalf = (axes.sh?.cm ?? p2p * 0.86) / 2;
  const yShoulder = L.shoulder + 1.5;
  add(yShoulder - 1, shHalf, body.b * 0.94);
  add(Math.min(L.armpit, yShoulder - len * 0.30), body.a, body.b);
  add(yShoulder - len, (axes.hem ? axesFromCirc(axes.hem.cm * 2, 1.38) : body).a, (axes.hem ? axesFromCirc(axes.hem.cm * 2, 1.38) : body).b);

  const slv = axes.slv?.cm;
  if (slv) {
    const run = axes.slv?.datum === "raglan" ? Math.max(slv - m.shoulderCm * 0.42, slv * 0.6) : slv;
    const cuff = axesFromCirc(Math.max(20, p2p * 0.38), 1.05);
    for (const s of [-1, 1]) {
      const root = armRoot(m, s), end = armEnd(m, s);
      const dx = end[0] - root[0], dy = end[1] - root[1];
      const t = Math.min(run / (Math.hypot(dx, dy) || 1), 1.25);
      add(root[1] + 1 + dy * t, cuff.a, cuff.b, root[0] + dx * t);
    }
  }
  return g;
}
