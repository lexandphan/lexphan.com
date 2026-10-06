// The piece laid flat, the way a listing measures it.
//
// ONE scale (px per cm) for every garment and for him. That single scale is the whole point:
// scaled separately, an overlay looks authoritative and means nothing.
//
// The convention is the listing's. Every garment width is a FLAT width: a 58 cm pit-to-pit is drawn
// 58 cm across. Alex is drawn at HALF HIS GIRTH, which is what a garment with no room in it would
// measure laid flat: on a top only as a guide across the chest (no figure under the cloth), on
// trousers as a plain block whose waist shows above the band.
//
// Trousers lie the way they do on a table: each leg at its listed flat width, the two overlapping
// at the seat because the back rise folds under, so a pair is about hip-wide at the crotch, never
// twice the thigh. How far the legs overlap and how far they part are drawing, and every pair on the
// page is laid the same way, so the gap between two outlines at a station is the difference between
// their numbers there.
//
// Line language:
//   from the listing ......... a solid indigo edge over an opaque cloth tint
//   not in the listing ....... the same edge dotted, inside a hatched band: borrowed from a garment
//                              he owns, or failing that drawn from his figure (a placeholder when
//                              there is no figure). The hatch is ONE pattern fixed to the drawing,
//                              not to the shape, so it reads as a drafting overlay and never as a
//                              fabric. A station whose height is listed but whose width isn't keeps
//                              solid ticks at its ends.
//   his own garment .......... sienna dashes on a paper casing, ONLY between stations whose numbers
//                              are on file, drawn under the piece's edges. Where the piece borrowed
//                              a width from it, the two lines would be one, so his is left out there
//                              and only where it differs (its crotch, its hems, the leg it has below
//                              the piece's hem) is drawn.
//   him ...................... trousers: a plain block in one tone, no shading, its widths and
//                              landmark heights proportions. Tops: one guide across the chest.
//
// Built with createElementNS and attributes only: no innerHTML and no inline style attributes, so it
// runs under a strict CSP, and no string from the listing ever reaches markup.

const NS = "http://www.w3.org/2000/svg";
export const BOTTOM = ["waist", "rise", "thigh", "knee", "hem", "inseam"];
export const TOP = ["p2p", "len", "sh", "slv"];
const WIDTH_AXES = new Set(["waist", "thigh", "knee", "hem", "hip", "p2p", "sh"]);

const DEG = Math.PI / 180;
const SLOPE = 14 * DEG; // shoulder slope: drawing
const HANG = 26 * DEG;  // sleeves hang this far off vertical: drawing
const SPLAY = 0.045;    // trouser legs part from the crotch at this slope: drawing
const SEAT = 1.25;      // with no hip listed, the legs overlap until the seat is this × the waist: drawing
const FLOOR_SURE = 5;   // cm past the floor before a pair is said to reach it; nearer is "about"
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const r1 = (n) => Math.round(n * 10) / 10;

// ── a tiny vector kit, in cm, y up from the floor
const V = (x, y) => ({ x, y });
const add = (a, b) => V(a.x + b.x, a.y + b.y);
const sub = (a, b) => V(a.x - b.x, a.y - b.y);
const mul = (a, k) => V(a.x * k, a.y * k);
const mir = (p) => V(-p.x, p.y);
const quad = (a, c, b, t) => V((1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y);
const quadPts = (a, c, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => quad(a, c, b, i / n));
function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }
/** where p + t·u meets q + s·v; the corner (q.x, p.y) for near-parallel lines */
function meet(p, u, q, v) {
  const D = u.x * -v.y + v.x * u.y;
  if (Math.abs(D) < 1e-6) return V(q.x, p.y);
  const w = sub(q, p);
  const t = (w.x * -v.y + v.x * w.y) / D;
  return t > 0 ? add(p, mul(u, t)) : V(q.x, p.y);
}

/** Catmull-Rom through `pts`, sampled: one point array per gap, so a span can be cut out of it. */
function crSegments(pts, n = 10) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const s = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      s.push(V(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y)));
    }
    segs.push(s);
  }
  return segs;
}

/** A monotone cubic (Fritsch-Carlson) through points stacked top to bottom, x as a function of y:
 *  one point array per gap, like crSegments, but it never swings past the stations it joins, so a
 *  seat can't bulge beyond the hip it was drawn through. */
function monoSegments(pts, n = 10) {
  const k = pts.length - 1;
  const h = [], d = [];
  for (let i = 0; i < k; i++) { h.push(pts[i + 1].y - pts[i].y); d.push((pts[i + 1].x - pts[i].x) / h[i]); }
  const m = pts.map((_, i) => {
    if (i === 0) return d[0];
    if (i === k) return d[k - 1];
    if (d[i - 1] * d[i] <= 0) return 0;
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    return (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  });
  const segs = [];
  for (let i = 0; i < k; i++) {
    const s = [];
    for (let j = 0; j <= n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const x = (2 * t3 - 3 * t2 + 1) * pts[i].x + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1].x + (t3 - t2) * h[i] * m[i + 1];
      s.push(V(x, pts[i].y + h[i] * t));
    }
    segs.push(s);
  }
  return segs;
}

/** The part of a polyline at or above `y0` (closed rings too: Sutherland-Hodgman on one edge). */
function keepAbove(pts, y0, closed = false) {
  const out = [];
  const n = pts.length;
  const lim = closed ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ain = a.y >= y0, bin = b.y >= y0;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (y0 - a.y) / (b.y - a.y); out.push(V(lerp(a.x, b.x, t), y0)); }
  }
  if (!closed && pts.length && pts[n - 1].y >= y0) out.push(pts[n - 1]);
  return out;
}
/** the part of a polyline strictly below `y0` */
function keepBelow(pts, y0) {
  const flip = pts.map((p) => V(p.x, -p.y));
  return keepAbove(flip, -y0 + 1e-6).map((p) => V(p.x, -p.y));
}

/** Views stored before 6819e48 carry a shoulder-to-FINGERTIP arm (0.44 × height). Drawn as a
 *  shoulder-to-wrist arm it hangs a hand too low and makes every sleeve look short. */
export function armLength(m) {
  return /0\.44/.test(m.notes?.armLenCm ?? "") ? Math.round(m.heightCm * 0.38 * 10) / 10 : m.armLenCm;
}

/** A hanging sleeve: shoulder point → a cap that leaves along the shoulder and arrives hanging → a
 *  tube → the cuff. Its outer edge is exactly `length` long, measured the way a sleeve is: along the
 *  top, from the shoulder point. Widths (`top`, `cuff`) are drawing, never data. */
function hang(SP, UA, top, cuff, length) {
  const u = V(Math.cos(SLOPE), -Math.sin(SLOPE));
  const d = V(Math.sin(HANG), -Math.cos(HANG)), n = V(Math.cos(HANG), Math.sin(HANG));
  const BO = add(UA, mul(n, top));
  const K = meet(SP, u, BO, mul(d, -1));
  const capLen = polyLen(quadPts(SP, K, BO, 24));
  const run = Math.max(4, length - capLen);
  const off = (top - cuff) / 2;
  const ax = Math.sqrt(Math.max(run * run - off * off, 4));
  const CC = add(mul(add(UA, BO), 0.5), mul(d, ax));
  return { SP, UA, BO, K, CO: add(CC, mul(n, cuff / 2)), CI: sub(CC, mul(n, cuff / 2)), d, n };
}

// ─────────────────────────────────────────────────────────────────────────────
// Him: landmark heights for hanging the garments, and for trousers a plain block at half girth.
// Height, shoulder, chest and hip come from his notes; waist and inseam are the model's labelled
// estimates; every landmark height and every limb width is a proportion. Drawn, never dimensioned.

function blockGeo(m) {
  const H = m.heightCm;
  const y = { hps: H * 0.826, armpit: H * 0.71, waist: H * 0.622, hip: H * 0.528, crotch: m.inseamCm, knee: H * 0.285, calf: H * 0.2, ankle: H * 0.045 };
  const neck = (m.chestCirc * 0.37) / 4;
  const chest = m.chestCirc / 4, waist = m.waistCirc / 4, hip = m.hipCirc / 4;
  // legs: each leg at half its girth, the two touching at the crotch
  const thigh = Math.min((m.hipCirc * 0.58) / 2, hip + 2.5), knee = (m.hipCirc * 0.4) / 2, calf = (m.hipCirc * 0.37) / 2, ankle = (m.hipCirc * 0.235) / 2;
  const tc = thigh / 2, kc = tc + 0.6, cc = tc + 0.9, ac = tc + 1.2;
  return { m, H, y, neck, chest, waist, hip, thigh, knee, calf, ankle, tc, kc, cc, ac };
}

/** The block under a pair of trousers, right half then mirrored: a plain stub above the waist (the
 *  only part of his torso a pair is compared with), then the legs to the floor. */
function blockOutline(B) {
  const y = B.y, R = [];
  R.push(V(B.waist, y.waist + 16), V(B.waist, y.waist + 4));
  const side = crSegments([V(B.waist, y.waist + 4), V(B.waist, y.waist), V(B.hip, y.hip), V(B.thigh, y.crotch - 3), V(B.kc + B.knee / 2, y.knee), V(B.cc + B.calf / 2, y.calf), V(B.ac + B.ankle / 2, y.ankle)], 8);
  for (const s of side) R.push(...s.slice(1));
  R.push(V(B.ac + B.ankle / 2, 0), V(B.ac - B.ankle / 2, 0));
  const inner = crSegments([V(B.ac - B.ankle / 2, y.ankle), V(B.cc - B.calf / 2, y.calf), V(B.kc - B.knee / 2, y.knee), V(0.5, y.crotch - 5), V(0, y.crotch)], 8);
  R.push(V(B.ac - B.ankle / 2, y.ankle));
  for (const s of inner) R.push(...s.slice(1));
  const L = R.map(mir).reverse();
  return [...R, ...L.slice(1)];
}

// ─────────────────────────────────────────────────────────────────────────────
// What each garment is drawn from. The listing's numbers are used as they are; what it leaves out
// is BORROWED — from the garment it is drawn against, then from his other garments, then from his
// figure (or, with no figure, a placeholder) — and each borrowed number remembers where it came
// from, so the drawing can hatch it and the caption can name the source.

function bodyGuess(axis, m, H) {
  if (m) {
    const B = { waist: m.waistCirc / 2, rise: clamp(H * 0.165, 26, 34), thigh: (m.hipCirc * 0.58) / 2 + 2, knee: (m.hipCirc * 0.4) / 2 + 3,
      hem: (m.hipCirc * 0.235) / 2 + 9, inseam: m.inseamCm, p2p: m.chestCirc / 2 + 6, len: H * 0.4, sh: m.shoulderCm, slv: armLength(m) - 6 };
    return B[axis];
  }
  // no figure: a generic placeholder, so there is a shape to hatch — the caption says so
  return { waist: 40, rise: 29, thigh: 31, knee: 23, hem: 20, inseam: 80, p2p: 56, len: 72, sh: 47, slv: 63 }[axis];
}

/** a reference sleeve can be drawn only when it was measured from the same point as the listing's */
const sameDatum = (a, b) => !a || !b || !a.datum || !b.datum || a.datum === b.datum;

function resolvePiece(view, usable, k) {
  const own = view.garment.axes, bottom = view.garment.category === "bottom";
  const AX = bottom ? BOTTOM : TOP;
  const order = [k, ...usable.map((_, j) => j).filter((j) => j !== k)].filter((j) => usable[j]);
  const out = {};
  for (const a of AX) {
    if (own[a]) { out[a] = { cm: own[a].cm, src: "listing", v: own[a] }; continue; }
    const j = order.find((j) => usable[j].axes[a]);
    if (j != null) { out[a] = { cm: usable[j].axes[a].cm, src: "ref", ref: j, v: usable[j].axes[a] }; continue; }
    out[a] = { cm: bodyGuess(a, view.model, view.model?.heightCm ?? 178), src: "figure" };
  }
  if (bottom && own.hip) out.hip = { cm: own.hip.cm, src: "listing", v: own.hip };
  if (!bottom && own.hem) out.hem = { cm: own.hem.cm, src: "listing", v: own.hem };
  return out;
}

/** a reference, completed only so it can be PLACED; `known` says which numbers are real */
function resolveRef(r, pieceAx, bottom) {
  const AX = bottom ? BOTTOM : TOP;
  const out = {}, known = {};
  for (const a of AX) {
    known[a] = !!r.axes[a];
    out[a] = r.axes[a] ? { cm: r.axes[a].cm, src: "ref", v: r.axes[a] } : { ...pieceAx[a] };
  }
  if (bottom && r.axes.hip) { out.hip = { cm: r.axes.hip.cm, v: r.axes.hip }; known.hip = true; }
  return { ax: out, known };
}

/** How a top is cut at the neck and front, read off its name: a drawing convention, never a
 *  measurement. Shirts, jackets and other outerwear get a point collar and a buttoned placket, a
 *  cardigan a V and buttons, knits and tees a plain crew neck. */
function topLook(g) {
  const n = (g.name || "").toLowerCase();
  if (/cardigan/.test(n)) return "v";
  if (/hood|sweat|knit|sweater|jumper|crew|\btee\b|t-shirt|tshirt|polo|tank/.test(n)) return "crew";
  if (g.category === "outerwear" || /shirt|jacket|coat|blouson|trucker|chore|parka|anorak|blazer/.test(n)) return "collar";
  return "crew";
}

// ─────────────────────────────────────────────────────────────────────────────
// Garment geometry: cm, y up from the floor, x from the centre line.

/** Trousers laid flat, hung from his waist line: the crotch `rise` below it, the hem `inseam` below
 *  that. Each leg is its listed width; at the seat the two overlap by `ov` (from a listed hip, else
 *  the overlap the page lays every pair with), and below the crotch they part at one slope. */
function trouserGeo(ax, y0, opt = {}) {
  const W = ax.waist.cm, R = ax.rise.cm, T = ax.thigh.cm, K = ax.knee.cm, Hm = ax.hem.cm, I = ax.inseam.cm;
  const yc = y0 - R, yt = yc - 2.5, yk = yc - Math.max(18, I / 2 - 5), yh = yc - I;
  const hipCm = ax.hip?.cm ?? null;
  let ov = hipCm != null ? T - hipCm / 2 : opt.ov ?? T - (SEAT * W) / 2;
  ov = clamp(ov, 0, Math.max(0, Math.min(T * 0.4, T - W / 2 - 0.5)));
  const xin = (y) => Math.max(0, (yc - y) * SPLAY);
  const ti = V(xin(yt), yt), ki = V(xin(yk), yk), hi = V(xin(yh), yh), cr = V(0, yc);
  const to = V(ti.x + T - ov, yt), ko = V(ki.x + K, yk), ho = V(hi.x + Hm, yh);
  // the seat: through a listed hip, else no wider than the leg below it (no invented bulge)
  const hipX = hipCm != null ? hipCm / 2 : Math.max(W / 2 + 0.3, to.x);
  const wc = V(W / 2, y0), hip = V(hipX, y0 - R * 0.58);
  const outer = monoSegments([wc, hip, to, ko, ho], 10);
  const spans = [
    { key: "band", pts: [mir(wc), wc], need: ["waist"], style: ["waist"], mirror: false },
    { key: "side", pts: [...outer[0], ...outer[1].slice(1)], need: ["waist", "thigh", "rise"], style: hipCm != null ? ["waist", "hip", "thigh", "rise"] : ["waist", "thigh", "rise"] },
    { key: "outUp", pts: outer[2], need: ["thigh", "knee", "rise", "inseam"], style: ["thigh", "knee", "rise", "inseam"] },
    { key: "outLo", pts: outer[3], need: ["knee", "hem", "rise", "inseam"], style: ["knee", "hem", "rise", "inseam"] },
    { key: "hem", pts: [ho, hi], need: ["hem", "rise", "inseam"], style: ["hem", "rise", "inseam"], hemLine: true },
    { key: "inLo", pts: [hi, ki], need: ["hem", "knee", "rise", "inseam"], style: ["hem", "knee", "rise", "inseam"] },
    { key: "inUp", pts: [ki, ti], need: ["knee", "thigh", "rise", "inseam"], style: ["knee", "thigh", "rise", "inseam"] },
    // the top of the fork: solid only when the edges below it are; a listed rise alone gets a tick
    { key: "crotch", pts: [ti, cr], need: ["rise"], style: ["rise", "thigh", "knee", "inseam"] },
  ];
  const floor = opt.floor !== false;
  return { kind: "bottom", y0, yc, yt, yk, yh, W, R, T, K, Hm, I, ov, wc, hip, to, ko, ho, hi, ki, ti, cr, spans, pooled: floor && yh < 0, past: -yh };
}

/** A top laid flat, sleeves hanging off the shoulder, hung from his side-neck point. */
function topGeo(ax, yH, N, look) {
  const P = ax.p2p.cm, Lg = ax.len.cm, S = ax.sh.cm;
  const SP = V(S / 2, yH - Math.max(1.5, (S / 2 - N) * Math.tan(SLOPE)));
  const UA = V(P / 2, SP.y - clamp(P * 0.4, 21, 28));        // armhole depth: drawing
  const raglan = ax.slv.v?.datum === "raglan";
  // a neck-to-cuff sleeve is drawn from the shoulder point: its neck-to-shoulder run comes off
  const run = raglan ? Math.max(ax.slv.cm - S / 2, ax.slv.cm * 0.6) : ax.slv.cm;
  const sl = hang(SP, UA, clamp(P * 0.27, 14, 18), clamp(P * 0.21, 11, 14), run);
  const hemHalf = (ax.hem?.cm ?? P) / 2;
  const yHem = yH - Lg;
  const HPS = V(N, yH);
  const cap = quadPts(SP, sl.K, sl.BO, 12);
  const vDepth = clamp(Lg * 0.32, 14, 24);
  const neck = look === "v" ? [V(-N, yH), V(0, yH - vDepth), V(N, yH)] : quadPts(V(-N, yH), V(0, yH - 9.5), V(N, yH), 12);
  const spans = [
    { key: "shoulder", pts: [HPS, SP], need: ["sh"], style: ["sh"] },
    { key: "slvTop", pts: [...cap, sl.CO], need: ["sh", "p2p", "slv"], style: ["sh", "slv"], sleeve: true },
    { key: "cuff", pts: [sl.CO, sl.CI], need: ["sh", "p2p", "slv"], style: ["sh", "slv"], sleeve: true, cuffLine: true },
    { key: "slvUnder", pts: [sl.CI, UA], need: ["sh", "p2p", "slv"], style: ["p2p", "slv"], sleeve: true },
    { key: "side", pts: [UA, V(hemHalf, yHem)], need: ["p2p", "len"], style: ["p2p", "len"] },
    { key: "hem", pts: [V(hemHalf, yHem), V(-hemHalf, yHem)], need: ["p2p", "len"], style: ax.hem ? ["hem", "len"] : ["p2p", "len"], hemLine: true, mirror: false },
  ];
  return { kind: "top", yH, N, P, S, Lg, yHem, SP, UA, sl, hemHalf, HPS, cap, raglan, look, vDepth, neck, spans, pooled: false };
}

/** Every span on both sides, as drawn: mirrored where the garment is symmetric, cut at the floor. */
function allSpans(G) {
  const out = [];
  for (const s of G.spans) {
    for (const side of s.mirror === false ? [1] : [1, -1]) {
      let pts = side === 1 ? s.pts : s.pts.map(mir);
      if (G.kind === "bottom" && G.pooled) pts = keepAbove(pts, 0);
      if (pts.length < 2) continue;
      out.push({ ...s, side, pts });
    }
  }
  // trousers long enough to reach the floor end there: the hem becomes the cut across each leg
  if (G.kind === "bottom" && G.pooled) {
    for (const side of [1, -1]) {
      const o = out.find((s) => s.key === "outLo" && s.side === side), i = out.find((s) => s.key === "inLo" && s.side === side);
      if (o && i) out.push({ ...G.spans.find((s) => s.key === "hem"), side, pts: [o.pts[o.pts.length - 1], i.pts[0]], floor: true });
    }
  }
  return out;
}

/** The garment's whole silhouette, for the cloth under its edges. */
function outline(G) {
  if (G.kind === "bottom") {
    const sp = (k) => G.spans.find((s) => s.key === k).pts;
    const right = [...sp("side"), ...sp("outUp").slice(1), ...sp("outLo").slice(1), G.hi, G.ki, G.ti, G.cr];
    const ring = [...right, ...right.slice(0, -1).map(mir).reverse()];
    return G.pooled ? keepAbove(ring, 0, true) : ring;
  }
  const right = [G.HPS, ...G.cap, G.sl.CO, G.sl.CI, G.UA, V(G.hemHalf, G.yHem)];
  return [...right, ...right.map(mir).reverse(), ...G.neck.slice(1, -1)];
}

/** A point collar laid on the neckline (right leaf; the left is its mirror), and the back of its
 *  stand seen inside the neck. Drawing, never data. */
function collarShapes(G) {
  const N = G.N, y = G.yH;
  const back = [...quadPts(V(-N - 0.5, y + 0.3), V(0, y + 3.9), V(N + 0.5, y + 0.3), 12), ...quadPts(V(N - 1.1, y - 0.5), V(0, y + 1.1), V(-N + 1.1, y - 0.5), 12)];
  const leaf = [V(N + 0.5, y + 0.3), V(N + 1.6, y - 3.2), V(N * 0.5 + 0.6, y - 10.2), V(0.25, y - 4.4), V(N - 1.1, y - 0.5)];
  return { back, leaves: [leaf, leaf.map(mir)] };
}

/** The construction lines: generic, the same on every garment, never read from the listing. */
function details(G, cat, ownWidths) {
  const solid = [], stitch = [], buttons = [];
  if (G.kind === "bottom") {
    const band = Math.min(4, G.R * 0.12), yb = G.y0 - band;
    const side = G.spans.find((s) => s.key === "side").pts;
    const xAt = (y) => { for (let i = 1; i < side.length; i++) if ((side[i - 1].y - y) * (side[i].y - y) <= 0) { const a = side[i - 1], b = side[i]; return lerp(a.x, b.x, (y - a.y) / ((b.y - a.y) || 1)); } return G.W / 2; };
    solid.push([V(-xAt(yb) + 0.3, yb), V(xAt(yb) - 0.3, yb)]);
    solid.push([V(0, yb), V(0, G.yc + 2)]);
    const yF = G.y0 - G.R * 0.62;
    stitch.push([V(3, yb), V(3, yF + 3), ...quadPts(V(3, yF + 3), V(3, yF), V(0.2, yF - 0.6), 6).slice(1)]);
    if (ownWidths) {
      for (const s of [-1, 1]) {
        const y2 = G.y0 - Math.min(14, G.R * 0.48);
        stitch.push(quadPts(V(s * (G.W / 2 - 8), yb), V(s * (G.W / 2 - 7.4), y2 + 2), V(s * (xAt(y2) - 0.3), y2), 10));
      }
    }
    if (!G.pooled) for (const s of [-1, 1]) {
      const y = G.yh + 2.6, t = 2.6 / Math.max(1, G.yk - G.yh);
      stitch.push([V(s * (lerp(G.hi.x, G.ki.x, t) + 0.6), y), V(s * (lerp(G.ho.x, G.ko.x, t) - 0.6), y)]);
    }
    return { solid, stitch, buttons };
  }
  // tops: the armhole seam, the cuffs, a hem band, and the neck the way the piece is cut
  for (const s of [-1, 1]) {
    const q = (p) => V(s * p.x, p.y);
    const c = V(lerp(G.SP.x, G.UA.x, 0.85) + 1.6, lerp(G.UA.y, G.SP.y, 0.4));
    solid.push(quadPts(q(G.SP), q(c), q(G.UA), 10));
    const back = mul(G.sl.d, -5.5);
    solid.push([q(add(G.sl.CO, back)), q(add(G.sl.CI, back))]);
  }
  stitch.push([V(-G.hemHalf + 0.7, G.yHem + 2.8), V(G.hemHalf - 0.7, G.yHem + 2.8)]);
  let top = null;
  if (G.look === "collar") top = G.yH - 4.4;
  else if (G.look === "v") {
    top = G.yH - G.vDepth;
    const off = 2;
    solid.push([V(-G.N + off * 0.9, G.yH), V(0, G.yH - G.vDepth + off * 0.6), V(G.N - off * 0.9, G.yH)]);
  } else solid.push(quadPts(V(-G.N + 0.4, G.yH - 0.6), V(0, G.yH - 11.6), V(G.N - 0.4, G.yH - 0.6), 10));
  if (top != null) {
    // a buttoned front: the edge, its topstitching and the buttons on the centre line
    solid.push([V(0, top), V(0, G.yHem)]);
    stitch.push([V(1.7, top - 0.2), V(1.7, G.yHem + 0.4)]);
    const first = top - 2.4, last = G.yHem + 7;
    const n = Math.max(2, Math.round((first - last) / 9.5) + 1);
    for (let i = 0; i < n; i++) buttons.push(V(0, lerp(first, last, i / (n - 1))));
  }
  return { solid, stitch, buttons };
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG

const f1 = (v) => (Math.round(v * 10) / 10).toString();
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  if (parent) parent.append(e);
  return e;
};
/** break a label into lines of at most n characters, on spaces */
function wrap(text, n) {
  const out = [];
  for (const w of text.split(/\s+/)) {
    const last = out[out.length - 1];
    if (last && (last + " " + w).length <= n) out[out.length - 1] = last + " " + w; else out.push(w);
  }
  return out.slice(0, 3);
}
/** do segments ab and cd cross? */
function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

let uid = 0;
/** A hatch pattern, in the user space of whatever SVG holds it: one diagonal every `gap` px. */
export function hatchPattern(svg, id, gap = 4.6) {
  const defs = svg.querySelector("defs") ?? mk("defs", {}, svg);
  const p = mk("pattern", { id, patternUnits: "userSpaceOnUse", width: gap, height: gap, patternTransform: "rotate(45)" }, defs);
  mk("line", { x1: 0, y1: 0, x2: 0, y2: gap, class: "fig-hatch-line" }, p);
  return `url(#${id})`;
}

/**
 * @param view    the FitView
 * @param usable  the usable refs, in page order: [{ i, axes, short, size, ... }]
 */
export function createFlat(view, usable) {
  const m = view.model;
  const cat = view.garment.category;
  const bottom = cat === "bottom";
  const AX = bottom ? BOTTOM : TOP;
  const B = m ? blockGeo(m) : null;
  const y0 = bottom ? (B ? B.y.waist : 110) : (B ? B.y.hps : 150);
  const N = B ? B.neck + 0.9 : 9.8;
  const look = bottom ? null : topLook(view.garment);
  // with no figure there is no floor: nothing is cut there and nothing is said to reach it
  const floor = !!B;
  const nRefs = usable.length;

  // everything that can be drawn, per reference — computed once, so the frame never moves. The
  // reference is laid with the piece's overlap at the seat, so their stations compare directly.
  const states = Array.from({ length: Math.max(1, nRefs) }, (_, k) => {
    const pax = resolvePiece(view, usable, nRefs ? k : -1);
    const P = bottom ? trouserGeo(pax, y0, { floor }) : topGeo(pax, y0, N, look);
    let R = null, rk = null;
    if (nRefs) {
      rk = resolveRef(usable[k], pax, bottom);
      R = bottom ? trouserGeo(rk.ax, y0, { floor, ov: P.ov }) : topGeo(rk.ax, y0, N, look);
    }
    return { k, pax, P, R, rk };
  });

  // ── the frame
  let xMax = 0, yTop, yBot;
  const pts = [];
  for (const s of states) for (const G of [s.P, s.R]) if (G) for (const sp of allSpans(G)) pts.push(...sp.pts);
  for (const p of pts) xMax = Math.max(xMax, Math.abs(p.x));
  if (bottom) {
    if (B) xMax = Math.max(xMax, B.waist + 0.5);
    yTop = y0 + 10;
    yBot = Math.min(floor ? -3 : Infinity, ...pts.map((p) => p.y - 3));
  } else {
    if (B) xMax = Math.max(xMax, m.chestCirc / 4 + 1.5);
    yTop = y0 + (look === "collar" ? 5.5 : 2.5);
    yBot = Math.min(...pts.map((p) => p.y)) - 4;
  }
  // trousers stand left of centre with their hems labelled in the space beside them, so where each
  // one ends is read off the drawing, not off a legend
  const labelled = bottom;
  const LABEL = labelled ? 112 : 0;
  const xLeft = xMax + (bottom ? 4.5 : 2), xRight = xMax + 2;

  const svg = mk("svg", { class: "fig-svg", role: "img", focusable: "false" });
  const defs = mk("defs", {}, svg);
  const id = `fh${++uid}`;
  const hatch = hatchPattern(svg, `${id}-hatch`);
  const grad = mk("linearGradient", { id: `${id}-fade`, gradientUnits: "userSpaceOnUse", x1: 0, x2: 0 }, defs);
  const fade = mk("mask", { id: `${id}-mask`, maskUnits: "userSpaceOnUse" }, defs);
  const fadeRect = mk("rect", { fill: `url(#${id}-fade)` }, fade);

  const gCentre = mk("g", {}, svg);
  const gBody = mk("g", { mask: `url(#${id}-mask)` }, svg);
  const gFloor = mk("g", {}, svg);
  const gCloth = mk("g", {}, svg);
  const gRef = mk("g", {}, svg);
  const gSeams = mk("g", {}, svg);
  const gYou = mk("g", {}, svg);
  const gMarks = mk("g", {}, svg);
  const gLabel = mk("g", {}, svg);
  const gScale = mk("g", {}, svg);

  let active = 0, W = 330, Hpx = 400;
  const state = () => states[Math.min(active, states.length - 1)];

  /** the piece's span is its own only when every number it rests on came from the listing */
  const own = (pax, sp) => sp.style.every((a) => pax[a]?.src === "listing") && !(sp.sleeve && pax.slv?.v?.datum === "raglan");
  const floorWords = (G) => (G.past > FLOOR_SURE ? "to the floor" : "near the floor");

  function draw() {
    const padT = 6, padB = 26, padX = 8;
    const s = Math.min((Hpx - padT - padB) / (yTop - yBot), (W - padX * 2 - LABEL) / (xLeft + xRight));
    const avail = W - padX * 2 - LABEL;
    const cx = padX + (avail - (xLeft + xRight) * s) / 2 + xLeft * s;
    const X = (x) => cx + x * s, Y = (y) => padT + (yTop - y) * s;
    const D = (pp, closed = false) => pp.map((p, i) => `${i ? "L" : "M"}${f1(X(p.x))},${f1(Y(p.y))}`).join("") + (closed ? "Z" : "");
    const usedH = padT + (yTop - yBot) * s + padB;
    for (const [k, v] of Object.entries({ viewBox: `0 0 ${f1(W)} ${f1(usedH)}`, width: f1(W), height: f1(usedH) })) svg.setAttribute(k, v);

    const { pax, P, R, rk } = state();
    const r = usable[active] ?? null;

    // the centre line, the way a flat is drafted
    gCentre.replaceChildren();
    mk("path", { d: `M${f1(X(0))},${f1(Y(yTop) + 2)}V${f1(Y(bottom && floor ? 0 : yBot) - 2)}`, class: "fig-centre" }, gCentre);

    // ── him, under trousers: a plain block, fading where the drawing crops it, shown only where the
    // pair doesn't cover him: his waist above the band, and his shins below a hem whose opening the
    // listing gives. Inside a borrowed opening they would show room nobody measured.
    gBody.replaceChildren();
    if (B && bottom) {
      const span = yTop - yBot;
      grad.replaceChildren();
      for (const [o, a] of [[0, 0], [7.5 / span, 1], [1, 1]]) mk("stop", { offset: Math.round(clamp(o, 0, 1) * 1000) / 1000, "stop-color": "#fff", "stop-opacity": a }, grad);
      grad.setAttribute("y1", f1(Y(yTop))); grad.setAttribute("y2", f1(Y(yBot)));
      for (const [k, v] of Object.entries({ x: 0, y: 0, width: f1(W), height: f1(usedH) })) fadeRect.setAttribute(k, v);
      const body = blockOutline(B);
      const parts = [keepAbove(body, P.y0 - 0.6, true)];
      if (pax.hem.src === "listing" && !P.pooled) parts.push(keepAbove(body.map((p) => V(p.x, -p.y)), -(P.yh + 0.6), true).map((p) => V(p.x, -p.y)));
      for (const part of parts) if (part.length > 2) mk("path", { d: D(part, true), class: "fig-block" }, gBody);
    }

    // the floor, only as wide as what stands on it, so it never reads as a leader to a label
    gFloor.replaceChildren();
    if (bottom && floor) {
      let fx = Math.max(P.ho.x, R ? R.ho.x : 0);
      if (B) fx = Math.max(fx, B.ac + B.ankle / 2);
      fx += 6 / s;
      mk("path", { d: `M${f1(X(-fx))},${f1(Y(0))}H${f1(X(fx))}`, class: "fig-floor-line" }, gFloor);
    }

    // ── the piece: cloth and construction (its edges go on top of his garment, below)
    gCloth.replaceChildren();
    const widthsOwn = AX.filter((a) => WIDTH_AXES.has(a)).every((a) => pax[a].src === "listing");
    const widthsNone = AX.filter((a) => WIDTH_AXES.has(a)).every((a) => pax[a].src !== "listing");
    mk("path", { d: D(outline(P), true), class: `fig-cloth${widthsNone ? " is-est" : ""}` }, gCloth);
    const det = details(P, cat, widthsOwn);
    const gd = mk("g", { class: "fig-detail" }, gCloth);
    for (const pp of det.solid) mk("path", { d: D(pp), class: "fig-detail-line" }, gd);
    for (const pp of det.stitch) mk("path", { d: D(pp), class: "fig-stitch" }, gd);
    if (!bottom && P.look === "collar") {
      // the neckline runs under the collar: it shows only inside the neck
      mk("path", { d: D(P.neck), class: "fig-seam" }, gCloth);
      const c = collarShapes(P);
      mk("path", { d: D(c.back, true), class: `fig-collar is-back${widthsNone ? " is-est" : ""}` }, gCloth);
      for (const leaf of c.leaves) mk("path", { d: D(leaf, true), class: `fig-collar${widthsNone ? " is-est" : ""}` }, gCloth);
    }
    for (const b of det.buttons) mk("circle", { cx: f1(X(b.x)), cy: f1(Y(b.y)), r: f1(Math.max(1.6, 0.55 * s)), class: `fig-button${widthsNone ? " is-est" : ""}` }, gCloth);
    const spans = allSpans(P);
    for (const sp of spans.filter((sp) => !own(pax, sp))) mk("path", { d: D(sp.pts), class: "fig-hatch-band", stroke: hatch }, gCloth);

    // ── his garment: only between stations whose numbers are on file, and not where the piece
    // already draws the same line because it borrowed that width from this garment
    gRef.replaceChildren();
    const refSpans = [];
    if (r && R) {
      const k = rk.known;
      // a sleeve measured from the neck is never drawn: placing it would need a shoulder conversion
      const sleevesOk = !bottom && r.axes.slv?.datum !== "raglan" && sameDatum(view.garment.axes.slv ?? pax.slv.v, r.axes.slv);
      const lent = (a) => pax[a]?.src === "ref" && pax[a].ref === active;
      const pieceEnd = bottom ? P.yh : P.yHem;
      for (const sp of allSpans(R)) {
        if (!sp.need.every((a) => k[a])) continue;
        if (sp.sleeve && !sleevesOk) continue;
        if (sp.key === "crotch") continue;
        const widths = sp.need.filter((a) => WIDTH_AXES.has(a));
        const shared = widths.length > 0 && widths.every(lent) && !sp.hemLine && !sp.cuffLine;
        if (shared) {
          // the same line as the piece's down to the piece's hem; below it, the reference is its own
          const below = keepBelow(sp.pts, Math.max(pieceEnd, 0));
          if (below.length >= 2 && (bottom || sp.key === "side")) refSpans.push({ ...sp, pts: below });
          continue;
        }
        if (sp.key === "band") {
          // both hang from one waist line, so his band would lie under the piece's: mark where it
          // ends instead, with a tick at each corner standing above the band
          if (!lent("waist")) for (const sd of [-1, 1]) refSpans.push({ key: "bandTick", pts: [V(sd * R.W / 2, R.y0 - 1.2), V(sd * R.W / 2, R.y0 + 2.8)] });
          continue;
        }
        refSpans.push(sp);
      }
      // where a reference's crotch falls, when its inside leg isn't drawn to show it
      if (bottom && k.rise && !refSpans.some((sp) => sp.key === "inUp")) refSpans.push({ key: "crotchTick", pts: [V(-3.2, R.yc), V(3.2, R.yc)] });
      // a hem whose height is on file but whose width isn't: a tick at each side
      if (bottom && k.rise && k.inseam && !k.hem && !R.pooled) for (const sd of [-1, 1]) refSpans.push({ key: "hemTick", pts: [V(sd * (P.ho.x - 3), R.yh), V(sd * (P.ho.x + 1.5), R.yh)] });
      if (!bottom && k.len && !k.p2p) for (const sd of [-1, 1]) refSpans.push({ key: "hemTick", pts: [V(sd * (P.hemHalf - 3), R.yHem), V(sd * (P.hemHalf + 1.5), R.yHem)] });
      for (const cls of ["fig-ref-casing", "fig-ref"]) {
        const g = mk("g", { class: cls }, gRef);
        for (const sp of refSpans) mk("path", { d: D(sp.pts) }, g);
      }
    }

    // ── the piece's edges, over his garment: the piece is what the page is about
    gSeams.replaceChildren();
    for (const sp of spans) {
      const mine = own(pax, sp);
      mk("path", { d: D(sp.pts), class: mine ? (sp.hemLine || sp.cuffLine ? "fig-seam is-station" : "fig-seam") : "fig-seam is-borrowed" }, gSeams);
    }
    if (!bottom && P.look !== "collar") mk("path", { d: D(P.neck), class: "fig-seam" }, gSeams);
    if (!bottom && pax.len.src === "listing" && !own(pax, P.spans.find((sp) => sp.key === "hem"))) {
      // a length the listing gives under a width it doesn't: solid ticks at the hem's ends
      for (const sd of [1, -1]) mk("path", { d: D([V(sd * (P.hemHalf - 2.4), P.yHem), V(sd * (P.hemHalf + 1.2), P.yHem)]), class: "fig-seam is-station" }, gSeams);
    }
    if (bottom) {
      const lengthOwn = pax.rise.src === "listing" && pax.inseam.src === "listing";
      // a hem height the listing gives under an opening it doesn't: solid ticks at its ends
      if (lengthOwn && pax.hem.src !== "listing" && !P.pooled) {
        for (const sd of [1, -1]) for (const [a, b] of [[P.ho.x - 2.4, P.ho.x + 1.2], [P.hi.x + 2.4, Math.max(0.15, P.hi.x - 1.2)]]) {
          mk("path", { d: D([V(sd * a, P.yh), V(sd * b, P.yh)]), class: "fig-seam is-station" }, gSeams);
        }
      }
      // a crotch depth the listing gives over inside edges it doesn't: a solid tick at the fork
      if (pax.rise.src === "listing" && !own(pax, P.spans.find((sp) => sp.key === "crotch"))) {
        mk("path", { d: D([V(-2.4, P.yc), V(2.4, P.yc)]), class: "fig-seam is-station" }, gSeams);
      }
    }

    // ── him, on a top: one guide across his chest at half girth, where a pit-to-pit is measured
    gYou.replaceChildren();
    if (!bottom && B) {
      const yG = P.UA.y - 2.5, half = m.chestCirc / 4;
      mk("path", { d: `M${f1(X(-half))},${f1(Y(yG))}H${f1(X(half))}`, class: "fig-you-line" }, gYou);
      for (const sx of [-1, 1]) mk("path", { d: `M${f1(X(sx * half))},${f1(Y(yG) - 4.5)}v9`, class: "fig-you-line" }, gYou);
      if (pax.p2p.src === "listing") {
        // the room it leaves: marked ~ (his chest is his own estimate), or ≈ when the pit-to-pit's
        // flat-or-around reading was guessed
        const room = r1(P.P - m.chestCirc / 2);
        const t = mk("text", { x: f1(X(0)), y: f1(Y(yG) - 7), class: `fig-you-tag${widthsNone ? " is-est" : ""}`, "text-anchor": "middle" }, gYou);
        t.textContent = `${pax.p2p.v?.assumed ? "≈" : "~"}${room >= 0 ? "+" : "−"}${Math.abs(room)} cm across`;
      }
    }

    // ── marks: where the hems land against each other, the crotch, and what the listing left out
    gMarks.replaceChildren();
    const refHemKnown = !!(r && R && rk.known.rise && rk.known.inseam);
    // the right-hand hem corner as drawn (cut at the floor when the pair would reach it)
    const hemCorner = (G) => { const o = allSpans(G).find((sp) => sp.key === "outLo" && sp.side === 1); return o ? o.pts[o.pts.length - 1] : V(G.ho.x, Math.max(G.yh, 0)); };
    // hung from the same waist, the hems differ by rise + inseam: the same number the rows give
    const ownLength = bottom && pax.rise.src === "listing" && pax.inseam.src === "listing";
    const landing = ownLength && refHemKnown ? R.yh - P.yh : null;
    if (landing != null && !P.pooled && !R.pooled && Math.abs(landing) >= 2.5 && Math.abs(landing) * s >= 9) {
      const pc = hemCorner(P), rc = rk.known.hem ? hemCorner(R) : V(pc.x, R.yh);
      const x = X(-(Math.max(pc.x, rc.x) + 2.6));
      mk("path", { d: `M${f1(X(-pc.x) - 2)},${f1(Y(P.yh))}H${f1(x - 4)}M${f1(X(-rc.x) - 2)},${f1(Y(R.yh))}H${f1(x - 4)}`, class: "fig-ext" }, gMarks);
      const y1 = Y(P.yh), y2 = Y(R.yh), dir = y2 > y1 ? 1 : -1;
      mk("path", { d: `M${f1(x)},${f1(y1 + dir)}V${f1(y2 - dir)}`, class: "fig-dim" }, gMarks);
      for (const [yy, dd] of [[y1, dir], [y2, -dir]]) mk("path", { d: `M${f1(x)},${f1(yy)}l-2.6,${f1(dd * 5.2)}h5.2Z`, class: "fig-dim-head" }, gMarks);
    }
    if (bottom && pax.waist.src !== "listing") {
      const t = mk("text", { x: f1(X(0)), y: f1(Y(P.y0) - 7), class: "fig-tag", "text-anchor": "middle" }, gMarks);
      t.textContent = "waist not listed";
    }
    if (bottom && pax.rise.src === "listing") {
      // the two crotch marks are named once, between them
      const refY = r && R && rk.known.rise ? R.yc : null;
      const yMid = refY != null && Math.abs(Y(refY) - Y(P.yc)) < 30 ? (Y(refY) + Y(P.yc)) / 2 : Y(P.yc);
      const t = mk("text", { x: f1(X(4.6)), y: f1(yMid + 3.6), class: `fig-crotch-tag${widthsNone ? " is-est" : ""}` }, gMarks);
      t.textContent = "crotch";
    }

    // ── labels: where each one ends, beside it
    gLabel.replaceChildren();
    const lx = X(xRight) + 10;
    if (labelled) {
      const at = (p) => ({ x: X(p.x), y: Y(p.y) });
      const items = [];
      const subs = [];
      if (pax.inseam.src !== "listing") subs.push("no inseam listed");
      else if (pax.rise.src !== "listing") subs.push("no rise listed");
      else if (P.pooled) subs.push(floorWords(P));
      if (landing != null) {
        const d = Math.round(Math.abs(landing) * 2) / 2;
        const both = P.pooled && R.pooled;
        if (d >= 1.5) subs.push(`≈${d} cm ${landing < 0 ? (both ? "shorter" : "higher") : (both ? "longer" : "lower")}`);
        else if (!both) subs.push("about level");
      }
      const a = at(hemCorner(P));
      items.push({ cls: "is-piece", lines: ["this piece"], subs, ax: a.x, ay: a.y });
      if (refHemKnown) {
        const b = rk.known.hem ? at(hemCorner(R)) : at(V(P.ho.x + 1.5, Math.max(R.yh, 0)));
        items.push({ cls: "is-yours", lines: wrap(`your ${r.short}`, 14), subs: R.pooled ? [floorWords(R)] : [], ax: b.x, ay: b.y });
      }
      items.sort((u, v) => u.ay - v.ay || u.ax - v.ax);
      const lineH = 15, subH = 14, gapH = 10;
      const height = (it) => it.lines.length * lineH + it.subs.length * subH;
      const place = () => {
        let next = -Infinity;
        for (const it of items) { it.ly = Math.max(it.ay - 6, next); next = it.ly + height(it) + gapH; }
        const limit = usedH - padB + 2;
        const over = items.length ? items[items.length - 1].ly + height(items[items.length - 1]) - limit : 0;
        if (over > 0) for (const it of items) it.ly -= over;
      };
      const leader = (it) => [V(it.ax + 3.5, it.ay), V(lx - 12, it.ly + lineH / 2 - 2)];
      place();
      // two pins side by side: stack the labels the other way round if their leaders would cross.
      // The pins stay on their hems; only which label sits on top changes.
      if (items.length === 2) {
        const [u, v] = items.map(leader);
        if (crosses(u[0], u[1], v[0], v[1])) items.reverse();
      }
      // both at the floor: say it once, under the second
      const atFloor = (it) => /floor$/.test(it.subs[0] ?? "");
      if (items.length === 2 && atFloor(items[0]) && atFloor(items[1]) && Math.abs(items[0].ay - items[1].ay) < 8) {
        const near = items.some((it) => it.subs[0] === "near the floor");
        items[0].subs.shift(); items[1].subs.shift(); items[1].subs.push(...(near ? ["both near", "the floor"] : ["both to the floor"]));
      }
      place();
      for (const it of items) {
        const yMid = it.ly + lineH / 2 - 2;
        mk("circle", { cx: f1(it.ax), cy: f1(it.ay), r: 2.4, class: `fig-pin ${it.cls}` }, gLabel);
        mk("path", { d: `M${f1(it.ax + 3.5)},${f1(it.ay)}L${f1(lx - 12)},${f1(yMid)}H${f1(lx - 4)}`, class: `fig-leader ${it.cls}` }, gLabel);
        it.lines.forEach((ln, k) => { const t = mk("text", { x: f1(lx), y: f1(it.ly + k * lineH + 10), class: `fig-label ${it.cls}` }, gLabel); t.textContent = ln; });
        it.subs.forEach((ln, k) => { const t = mk("text", { x: f1(lx), y: f1(it.ly + it.lines.length * lineH + k * subH + 9), class: "fig-label-sub" }, gLabel); t.textContent = ln; });
      }
    }

    // ── scale: 10 cm, bottom left (under the labels, when there are labels)
    gScale.replaceChildren();
    const sx = labelled ? lx : padX, sy = usedH - 8;
    mk("path", { d: `M${f1(sx)},${f1(sy - 4)}V${f1(sy)}H${f1(sx + 10 * s)}V${f1(sy - 4)}`, class: "fig-scale-bar" }, gScale);
    const t = mk("text", { x: f1(sx + 10 * s + 6), y: f1(sy), class: "fig-scale-text" }, gScale);
    t.textContent = "10 cm";
  }

  return {
    el: svg,
    setRef(k) { active = k; draw(); },
    resize(width, height) { W = Math.max(260, width); Hpx = height; draw(); },
    /** what the caption needs to say about the drawing against reference k */
    describe(k) {
      const st = states[Math.min(k, states.length - 1)];
      const r = usable[k] ?? null;
      const { pax, P, R, rk } = st;
      // borrowed numbers, grouped by where they came from
      const groups = [];
      for (const a of AX) {
        const v = pax[a];
        if (v.src === "listing") continue;
        const from = v.src === "ref" ? v.ref : "figure";
        const g = groups.find((x) => x.from === from);
        if (g) g.axes.push(a); else groups.push({ from, axes: [a] });
      }
      const ownLength = bottom ? pax.rise.src === "listing" && pax.inseam.src === "listing" : pax.len.src === "listing";
      const pieceFloor = !!P.pooled && ownLength, refFloor = !!R?.pooled;
      const out = {
        borrowed: groups.map((g) => ({ axes: g.axes, from: g.from === "figure" ? null : usable[g.from] })),
        refMissing: [], sleeveApart: null, refSleeveNeck: false,
        pooled: { piece: pieceFloor, ref: refFloor, near: (pieceFloor && P.past <= FLOOR_SURE) || (refFloor && R.past <= FLOOR_SURE) },
        converted: !bottom && P.raglan,
        // drawn widths that rest on a guessed flat-or-around reading
        assumed: { piece: AX.filter((a) => WIDTH_AXES.has(a) && pax[a].src === "listing" && pax[a].v?.assumed), ref: [] },
      };
      if (r && rk) {
        const want = bottom ? ["waist", "thigh", "knee", "hem"] : ["sh", "p2p", "len"];
        out.refMissing = want.filter((a) => !rk.known[a]);
        out.assumed.ref = AX.filter((a) => WIDTH_AXES.has(a) && rk.known[a] && r.axes[a]?.assumed);
        if (!bottom && r.axes.slv && !sameDatum(view.garment.axes.slv ?? pax.slv.v, r.axes.slv)) out.sleeveApart = r.axes.slv.datum === "raglan" ? "ref" : "piece";
        if (!bottom && r.axes.slv?.datum === "raglan") out.refSleeveNeck = true;
        if (!bottom && !r.axes.slv) out.refMissing.push("slv");
      }
      return out;
    },
  };
}
