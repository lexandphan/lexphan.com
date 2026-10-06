// What the page SAYS about a fit: the verdict, the two or three rows that decide it, and everything
// else. Pure — no DOM — so it runs under node against real views.
//
// Every sentence here is built from numbers in the FitView. Nothing is guessed silently:
//   - a value the listing did not give is reported as missing;
//   - "≈" marks a number whose flat-or-around reading was GUESSED (AxisValue.assumed) — on the
//     listing's side or on one of his own garments — and every number worked out from one
//     (a difference, a doubled "around", where a hem lands);
//   - a guessed reading is spelled out where it is used: "read as flat", or, when the number was
//     taken to be a circumference, "read as 76.2 cm around and halved" — in centimetres, which is
//     all a FitView stores, so it never claims to quote the listing or his notes;
//   - "~" marks a body number from his own notes, which are self-estimated.
// The fit bands for chest and shoulder mirror bodyReads() in supabase/functions/_shared/fit.ts, so
// the page and the Telegram card never disagree about what "a regular fit" means.

export const AXIS_LABEL = {
  p2p: "Pit-to-pit", len: "Length", sh: "Shoulder", slv: "Sleeve",
  waist: "Waist", rise: "Rise", thigh: "Thigh", knee: "Knee", hem: "Leg opening", inseam: "Inseam", hip: "Hip",
};
export const TOP_AXES = ["p2p", "len", "sh", "slv"];
export const BOTTOM_AXES = ["waist", "rise", "thigh", "knee", "hem", "inseam"];

export const lower = (axis) => (axis === "p2p" ? "pit-to-pit" : axis === "hem" ? "leg opening" : AXIS_LABEL[axis].toLowerCase());
const r1 = (n) => { const r = Math.round(n * 10) / 10; return Object.is(r, -0) ? 0 : r; };
export const num = (n) => String(r1(n));
const NB = " "; // narrow no-break space: a number never wraps away from its unit
export const cm = (n) => `${num(n)}${NB}cm`;
/** a worked-out distance, to the nearest half centimetre: "≈16.5 cm" */
export const approx = (n) => `≈${num(Math.round(Math.abs(n) * 2) / 2)}${NB}cm`;
/** A signed difference for the figure column: "+4", "−20.5", "±0". */
export const signed = (d) => (Math.abs(d) < 0.05 ? "±0" : `${d > 0 ? "+" : "−"}${num(Math.abs(d))}`);

/** true when any of these values had its flat-or-around reading guessed */
export const guessed = (...vs) => vs.some((v) => !!v?.assumed);
/** "≈" for a guessed value, and for anything worked out from one */
export const G = (...vs) => (guessed(...vs) ? "≈" : "");

/** How a stored value came to be, when it wasn't stated plainly as a flat width — the words the
 *  "Every measurement" lists use. Null when there is nothing to say. */
export function howRead(v) {
  if (!v) return null;
  if (v.halved && v.assumed) return `read as ${cm(v.cm * 2)} around, halved`;
  if (v.halved) return `given as ${cm(v.cm * 2)} around, halved`;
  if (v.assumed) return "read as flat";
  return null;
}

// Rich text: an array of strings, {n} figures (set in the mono face) and {m} quiet qualifiers.
const N = (s) => ({ n: s });
const M = (s) => ({ m: s });
const K = (s) => ({ k: s }); // a term that never breaks across lines ("pit-to-pit")
export const plain = (parts) => parts.map((p) => (typeof p === "string" ? p : p.n ?? p.m ?? p.k)).join("");

const WORDS = {
  len: ["longer", "shorter"], slv: ["longer", "shorter"], inseam: ["longer", "shorter"], rise: ["longer", "shorter"],
};
const word = (axis, d) => (WORDS[axis] ?? ["wider", "narrower"])[d > 0 ? 0 : 1];
export const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const upper = (s) => s[0].toUpperCase() + s.slice(1);

// ─────────────────────────────────────────────────────────────────────────────
// Names

/** What Alex would call each piece out loud: the brand. "Post Archive Faction 8.0 Shirt Center" is
 *  "Post Archive Faction", "Oni 200 Secret Denim" is "Oni". Duplicates grow a word until unique. */
export function shortNames(refs) {
  const words = refs.map((r) => r.name.trim().split(/\s+/));
  const brand = words.map((w) => {
    const out = [w[0]];
    if (w[0].length <= 4) {
      for (let i = 1; i < Math.min(w.length, 3); i++) {
        if (/^[A-Z][a-z]/.test(w[i]) && !/\d/.test(w[i])) out.push(w[i]); else break;
      }
    }
    return out.length;
  });
  return words.map((w, i) => {
    for (let take = brand[i]; take <= w.length; take++) {
      const p = w.slice(0, take).join(" ");
      if (!words.some((o, j) => j !== i && o.slice(0, take).join(" ") === p)) return p;
    }
    return refs[i].size ? `${w.join(" ")} (${refs[i].size})` : w.join(" ");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis

export function analyse(view) {
  const g = view.garment;
  const isBottom = g.category === "bottom";
  const AX = isBottom ? BOTTOM_AXES : TOP_AXES;
  const refs = view.refs.map((r, i) => ({ ...r, i })).filter((r) => !r.unmeasured);
  shortNames(refs).forEach((s, k) => { refs[k].short = s; });
  const unmeasured = view.refs.filter((r) => r.unmeasured);

  const axes = {};
  for (const axis of isBottom && g.axes.hip ? [...AX, "hip"] : AX) {
    const gv = g.axes[axis] ?? null;
    const comps = [], apart = [];
    for (const r of refs) {
      const d = (view.deltas[r.i] ?? []).find((x) => x.axis === axis);
      if (!d || d.refCm == null || !gv) continue;
      const row = { ref: r, refCm: d.refCm, delta: d.deltaCm, val: r.axes[axis], gv };
      if (d.suppressed) apart.push({ ...row, note: d.note });
      else if (d.deltaCm != null) comps.push(row);
    }
    const owned = refs.filter((r) => r.axes[axis]).map((r) => ({ ref: r, val: r.axes[axis] }));
    axes[axis] = { axis, gv, comps, apart, owned };
  }

  // Where the hem lands, for trousers: hung from the same waist, a pair ends rise + inseam below it.
  // Worked out, so it is only ever shown with "≈" — but it is the comparison that answers "how
  // long", because a short inseam on a long rise can land exactly where a long inseam on a short
  // rise does.
  let landing = null;
  if (isBottom && g.axes.rise && g.axes.inseam) {
    const mine = g.axes.rise.cm + g.axes.inseam.cm;
    const rows = refs
      .filter((r) => r.axes.rise && r.axes.inseam)
      .map((r) => ({ ref: r, total: r.axes.rise.cm + r.axes.inseam.cm, delta: r1(mine - (r.axes.rise.cm + r.axes.inseam.cm)) }));
    if (rows.length) landing = { total: r1(mine), rows };
  }

  const missing = AX.filter((a) => !g.axes[a]);
  const given = AX.filter((a) => g.axes[a]);
  const extra = Object.keys(g.axes).filter((a) => !AX.includes(a) && !(isBottom && a === "hip"));
  const body = view.body ?? {};
  const out = { view, g, isBottom, AX, refs, unmeasured, axes, landing, missing, given, extra, body };
  out.rows = isBottom ? bottomRows(out) : topRows(out);
  out.headline = isBottom ? bottomHeadline(out) : topHeadline(out);
  out.ask = ask(out);
  out.against = against(out);
  // a row never repeats the verdict word for word — when it would, its evidence speaks instead
  const said = out.headline.toLowerCase();
  for (const r of out.rows.top) {
    const h = r.head && plain(r.head).replace(/\.$/, "").toLowerCase();
    if (h && said.includes(h)) r.head = null;
  }
  return out;
}

/** "Checked against your Oni (29) and Lemaire (M), on rise and inseam only." */
function against(an) {
  if (!an.refs.length) return null;
  const named = an.refs.map((r) => `${r.short}${r.size ? ` (${r.size})` : ""}`);
  const some = an.given.length && an.given.length < an.AX.length;
  return `Checked against your ${and(named)}${some ? `, on ${and(an.given.map(lower))} only` : ""}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparing against what he owns
//
// A row LEADS with one difference — against the first garment on the list, which is the one the
// Telegram card compared with, so the page and the card agree — and the other garments follow in
// the muted line underneath.

/** "1.9 cm wider than your Lemaire and 3 cm wider than your Post Archive Faction." — with "≈" on
 *  any difference that rests on a guessed reading. */
function others(axis, all) {
  if (!all.length) return [];
  const comps = [...all].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta)).slice(0, 2);
  const parts = [];
  comps.forEach((c, k) => {
    if (k) parts.push(k === comps.length - 1 ? " and " : ", ");
    if (Math.abs(c.delta) < 0.5) parts.push(`${guessed(c.gv, c.val) ? "about " : ""}the same as your ${c.ref.short}`);
    else parts.push(N(`${G(c.gv, c.val)}${cm(Math.abs(c.delta))}`), ` ${word(axis, c.delta)} than your ${c.ref.short}`);
  });
  parts.push(".");
  return cap(parts);
}

/** just the nearest other piece: "5.4 cm longer than your Kapital." */
const nearest = (axis, comps) => others(axis, [[...comps].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]]);

/** Capitalise a sentence — unless it opens on a figure ("3.4 cm shorter…"), which stays as written. */
function cap(parts) {
  const out = [...parts];
  const i = out.findIndex((p) => typeof p !== "string" || p.trim());
  if (i >= 0 && typeof out[i] === "string") out[i] = out[i].replace(/^(\s*)(\S)/, (_, s, c) => s + c.toUpperCase());
  return out;
}

/** joins rich sentences with a space */
function joined(...sentences) {
  const out = [];
  for (const s of sentences) {
    if (!s || !s.length) continue;
    if (out.length) out.push(" ");
    out.push(...s);
  }
  return out;
}

const beyondAll = (comps, sign, min = 1) => comps.length > 0 && comps.every((c) => sign * c.delta >= min);
const leadOf = (c) => (c ? { fig: signed(c.delta), approx: guessed(c.gv, c.val), vs: `vs ${c.ref.short}` } : null);

/** The guessed readings behind a row, in words, whoever made them: the listing ("here"), his
 *  notes ("your Oni"), or both. A number read as a circumference and halved says so — it was
 *  never "read as flat". */
function guessNote(what, gv, vals) {
  const mineFlat = !!gv?.assumed && !gv.halved;
  const flat = [...new Set(vals.filter((x) => x.val?.assumed && !x.val.halved).map((x) => x.ref.short))];
  const halved = vals.filter((x) => x.val?.assumed && x.val.halved);
  const out = [];
  if (mineFlat && flat.length) out.push(`The ${what} was read as flat here and on your ${and(flat)}; neither said which.`);
  else {
    if (mineFlat) out.push(`The listing didn't say if the ${what} is flat or around; it was read as flat.`);
    if (flat.length) out.push(`The ${what} on your ${and(flat)} was read as flat; your notes didn't say.`);
  }
  if (gv?.assumed && gv.halved) out.push(`The listing didn't say flat or around; it was read as ${cm(gv.cm * 2)} around and halved.`);
  for (const x of halved) out.push(`Your notes don't say if the ${x.ref.short} number is flat or around; it was read as ${cm(x.val.cm * 2)} around and halved.`);
  return out.length ? [M(`≈ ${out.join(" ")}`)] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Trousers

function legPick(an) {
  // the reference with the most leg widths in common — the honest one to describe a cut against
  const legs = ["thigh", "knee", "hem"].filter((a) => an.axes[a].gv);
  let best = null;
  for (const r of an.refs) {
    const rows = legs
      .map((axis) => { const c = an.axes[axis].comps.find((x) => x.ref === r); return c && { ...c, axis }; })
      .filter(Boolean);
    if (rows.length && (!best || rows.length > best.rows.length)) best = { ref: r, rows };
  }
  return best;
}

const taper = (axes) => (axes.thigh && axes.hem ? axes.hem.cm / axes.thigh.cm : null);
const cutWord = (t) => (t == null ? null : t < 0.63 ? "a tapered leg" : t < 0.78 ? "a straight leg" : "a wide leg");

function lengthWord(an) {
  // Judged on where the hem lands when the rise is known on both sides, else on the inseam alone.
  const L = an.landing, I = an.axes.inseam;
  const rows = L ? L.rows : I.comps.map((c) => ({ ref: c.ref, delta: c.delta }));
  if (!rows.length) return null;
  const n = rows.length;
  const who = n === 1 ? `your ${rows[0].ref.short}` : n === 2 ? `both your ${rows[0].ref.short} and ${rows[1].ref.short}` : `all ${n} pairs you've measured`;
  if (rows.every((r) => r.delta <= -6)) return { kind: "cropped", who, rows };
  if (rows.every((r) => r.delta <= -2)) return { kind: "short", who, rows };
  if (rows.every((r) => r.delta >= 2)) return { kind: "long", who, rows };
  return { kind: "mixed", who, rows };
}

/** "Hung from the same waist, its hem lands ≈16.5 cm higher than on your Oni and ≈10 cm higher
 *  than on your Lemaire." */
export function landingClause(an) {
  const L = an.landing;
  if (!L) return [];
  const parts = ["Hung from the same waist, its hem lands "];
  L.rows.forEach((r, k) => {
    if (k) parts.push(k === L.rows.length - 1 ? " and " : ", ");
    if (Math.abs(r.delta) < 1.5) parts.push(`about where it does on your ${r.ref.short}`);
    else parts.push(N(approx(r.delta)), ` ${r.delta < 0 ? "higher" : "lower"} than on your ${r.ref.short}`);
  });
  parts.push(".");
  return parts;
}

function bottomRows(an) {
  const { axes, g } = an;
  const rows = [];

  // Waist: the one number that decides whether trousers can be worn at all.
  const W = axes.waist;
  if (W.gv) {
    const a = W.comps[0];
    let head;
    if (!a) head = ["None of your trousers have a waist on file to compare."];
    else if (W.comps.length > 1 && beyondAll(W.comps, -1)) head = ["Tighter at the waist than any pair you've measured."];
    else if (Math.abs(a.delta) < 1) head = [`The same waist as your ${a.ref.short}.`];
    else head = [`${a.delta > 0 ? "Looser" : "Tighter"} at the waist than your ${a.ref.short}.`];
    const more = joined(
      others("waist", W.comps.slice(1)),
      [N(`${G(W.gv)}${cm(W.gv.cm * 2)}`), " around."],
      guessNote("waist", W.gv, W.comps),
    );
    rows.push({ key: "waist", label: "Waist", value: [N(`${G(W.gv)}${cm(W.gv.cm)}`), " flat"], lead: leadOf(a), head, more });
  }

  // Length: the inseam against his, then where the hem actually lands.
  const I = axes.inseam;
  if (I.gv) {
    const a = I.comps[0];
    const lw = lengthWord(an);
    let head;
    if (!a) head = ["None of your trousers have an inseam on file."];
    else if (lw.kind === "cropped" || lw.kind === "short") head = [`Shorter than ${lw.who}.`];
    else if (lw.kind === "long") head = [`Longer than ${lw.who}.`];
    else {
      const row = lw.rows.find((r) => r.ref === a.ref) ?? lw.rows[0];
      const d = row.delta;
      head = [Math.abs(d) < 1.5 ? `Ends where your ${row.ref.short} does.`
        : Math.abs(d) <= 3 ? `Ends a touch ${d < 0 ? "higher" : "lower"} than your ${row.ref.short}.`
        : `Ends ${d < 0 ? "higher" : "lower"} than your ${row.ref.short}.`];
    }
    const more = joined(others("inseam", I.comps.slice(1)), landingClause(an));
    rows.push({ key: "length", label: "Inseam", value: [N(cm(I.gv.cm))], lead: leadOf(a), head, more });
  }

  // The leg: thigh, knee and opening read together, as a cut.
  const legAxes = ["thigh", "knee", "hem"].filter((x) => axes[x].gv);
  if (legAxes.length) {
    const value = [];
    legAxes.forEach((x, k) => { if (k) value.push(", "); value.push(`${x === "hem" ? "opening" : lower(x)} `, N(`${G(g.axes[x])}${num(g.axes[x].cm)}`)); });
    const pick = legPick(an);
    const cut = cutWord(taper(g.axes));
    let head, more = [], lead = null;
    if (pick) {
      const ds = pick.rows.map((r) => r.delta);
      const refCut = taper(pick.ref.axes);
      const sameCut = cut && refCut != null && Math.abs(taper(g.axes) - refCut) < 0.04;
      const name = pick.ref.short;
      const c = cut ? upper(cut) : null;
      if (ds.every((d) => Math.abs(d) < 1)) head = [`${c ? `${c}, cut` : "Cut"} just like your ${name}.`];
      else if (ds.every((d) => d >= 1)) head = [c ? `${c}, ${sameCut ? `cut like your ${name} but roomier` : `roomier than your ${name}`}.` : `Roomier through the leg than your ${name}.`];
      else if (ds.every((d) => d <= -1)) head = [c ? `${c}, ${sameCut ? `cut like your ${name} but slimmer` : `slimmer than your ${name}`}.` : `Slimmer through the leg than your ${name}.`];
      else head = [c ? `${c}, shaped differently from your ${name}.` : `Shaped differently from your ${name}.`];
      // "≈3 cm wider at the thigh, 3 cm wider at the knee": equal deltas share a clause, but a
      // difference resting on a guessed reading never shares one with a measured difference
      const groups = [];
      for (const r of pick.rows) {
        const where = r.axis === "hem" ? "opening" : lower(r.axis);
        const gs = guessed(r.gv, r.val);
        const gi = groups.find((x) => x.d === r.delta && x.gs === gs);
        if (gi) gi.at.push(where); else groups.push({ d: r.delta, gs, at: [where] });
      }
      const spans = groups.flatMap((gr, k) => [
        k ? ", " : "",
        N(`${gr.gs ? "≈" : ""}${cm(Math.abs(gr.d))}`),
        ` ${Math.abs(gr.d) < 1 ? "off" : word("thigh", gr.d)} at the ${and(gr.at)}`,
      ]);
      more = [...spans, "."];
      const first = pick.rows[0];
      lead = { fig: signed(first.delta), approx: guessed(first.gv, first.val), vs: `${first.axis === "hem" ? "opening" : lower(first.axis)}, vs ${name}` };
      const w = (x) => (x === "hem" ? "opening" : lower(x));
      // one note per leg axis that rests on a guess, same rules as everywhere else
      for (const r of pick.rows) {
        if (!guessed(r.gv, r.val)) continue;
        more = joined(more, guessNote(w(r.axis), r.gv, [r]));
      }
    } else {
      head = [cut ? `${upper(cut)}.` : "The leg widths are listed."];
      more = ["None of your trousers have these widths on file."];
      for (const x of legAxes) if (g.axes[x].assumed) more = joined(more, guessNote(x === "hem" ? "opening" : lower(x), g.axes[x], []));
    }
    rows.push({ key: "leg", label: "Leg", value, lead, head, more });
  }

  // His own drape rule, when the listing has a hip. The server's bodyReads line says it; when a view
  // has none, the same rule (about-me.md: "pants need garment hip >=100cm for preferred drape") is
  // applied here, as the chest bands are for tops.
  const Hp = g.axes.hip;
  if (Hp) {
    const around = r1(Hp.cm * 2);
    const line = (an.view.bodyReads ?? []).find((l) => /^Hip\b/.test(l));
    const said = line ? line.replace(/^[^—]*—\s*/, "") : around >= 100 ? "clears the 100cm you like for drape." : "under the 100cm your notes say you want for drape.";
    // the server writes "100cm"; on the page a figure is set in the mono face, with its unit
    const head = upper(said).split(/(\d+(?:\.\d+)?)\s?cm\b/).map((t, k) => (k % 2 ? N(cm(Number(t))) : t)).filter((t) => t !== "");
    const mine = an.body.hipFlatCm != null ? r1(an.body.hipFlatCm * 2) : null;
    const est = an.body.estimated ? "~" : "";
    rows.push({
      key: "hip", label: "Hip", value: [N(`${G(Hp)}${cm(Hp.cm)}`), " flat"],
      lead: mine != null ? { fig: signed(r1(around - mine)), approx: guessed(Hp), vs: `vs your ${est}${num(mine)}` } : null,
      head,
      more: joined([N(`${G(Hp)}${cm(around)}`), " around", ...(mine != null ? [", against your ", N(`${est}${cm(mine)}`), " hip."] : ["."])], guessNote("hip", Hp, [])),
    });
  }

  // Rise.
  const R = axes.rise;
  if (R.gv) {
    const a = R.comps[0];
    let head;
    const hi = R.comps.filter((c) => c.delta >= 1), lo = R.comps.filter((c) => c.delta <= -1);
    if (!a) head = ["None of your trousers have a rise on file."];
    else if (hi.length && lo.length) head = [`A longer rise than your ${hi[0].ref.short}, a shorter one than your ${lo[0].ref.short}.`];
    else if (Math.abs(a.delta) < 1) head = [`The same rise as your ${a.ref.short}.`];
    else head = [`A ${a.delta > 0 ? "longer" : "shorter"} rise than ${R.comps.length > 1 && (hi.length === R.comps.length || lo.length === R.comps.length) ? `both your ${and(R.comps.map((c) => c.ref.short))}` : `your ${a.ref.short}`}.`];
    rows.push({ key: "rise", label: "Rise", value: [N(cm(R.gv.cm))], lead: leadOf(a), head, more: others("rise", R.comps.slice(1)) });
  }

  // Two or three: waist and length always win when present; the leg next; rise only if room. A
  // listed hip is shown even as a fourth row: it carries his own rule for how trousers should drape.
  const order = ["waist", "length", "leg", "rise"];
  const chosen = order.map((k) => rows.find((r) => r.key === k)).filter(Boolean);
  const hipRow = rows.find((r) => r.key === "hip");
  const top = chosen.slice(0, 3);
  if (hipRow) top.push(hipRow);
  return { top, rest: chosen.slice(3) };
}

function bottomHeadline(an) {
  const { axes } = an;
  const W = axes.waist;
  const pick = legPick(an);
  let fit = null;
  if (W.gv && beyondAll(W.comps, -1)) fit = `Tighter at the waist than ${W.comps.length > 1 ? "any trousers you wear" : `your ${W.comps[0].ref.short}`}`;
  else {
    const P = pick?.ref ?? W.comps[0]?.ref ?? null;
    const ds = P ? [...(pick?.ref === P ? pick.rows : []), ...W.comps.filter((c) => c.ref === P)].map((r) => r.delta) : [];
    if (ds.length >= 2 && ds.every((d) => d >= 1)) fit = `Roomier than your ${P.short} all the way down`;
    else if (ds.length >= 2 && ds.every((d) => d <= -1)) fit = `Slimmer than your ${P.short} all the way down`;
    else if (ds.length >= 2 && ds.every((d) => Math.abs(d) < 1)) fit = `Cut like your ${P.short}`;
    else if (W.gv && W.comps.some((c) => Math.abs(c.delta) < 1)) fit = "Your waist size";
    else if (W.gv && beyondAll(W.comps, 1)) fit = "Roomier at the waist than your trousers";
    else if (pick && pick.rows.every((r) => r.delta >= 1)) fit = `Roomier through the leg than your ${pick.ref.short}`;
    else if (pick && pick.rows.every((r) => r.delta <= -1)) fit = `Slimmer through the leg than your ${pick.ref.short}`;
  }

  const lw = lengthWord(an);
  let length = null;
  if (lw) {
    if (lw.kind === "cropped") length = { solo: `A cropped leg, shorter than ${lw.who}.`, tail: "cropped", kind: "cropped" };
    else if (lw.kind === "short" || lw.kind === "long") {
      const t = `${lw.kind === "short" ? "shorter" : "longer"} than ${lw.who}`;
      length = { solo: `${upper(t)}.`, tail: t };
    } else {
      // between his pairs: describe against the one the fit clause named, else the nearest
      const named = fit && an.refs.find((r) => fit.includes(`your ${r.short}`));
      const rows = [...lw.rows].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      const row = (named && rows.find((r) => r.ref === named)) || rows[0];
      const d = row.delta;
      const t = Math.abs(d) < 1.5 ? `the same length as your ${row.ref.short}`
        : Math.abs(d) <= 3 ? `a touch ${d < 0 ? "shorter" : "longer"}${named === row.ref ? "" : ` than your ${row.ref.short}`}`
        : `${d < 0 ? "shorter" : "longer"} than your ${row.ref.short}`;
      length = { solo: `${upper(t)}.`, tail: t };
    }
  }

  if (!W.gv && length) return `${length.kind === "cropped" ? "A cropped leg" : upper(length.tail)}, but the waist isn't listed.`;
  if (fit && length) return `${fit}, and ${length.tail}.`;
  if (length) return length.solo;
  if (fit) return `${fit}.`;
  return an.refs.length ? "Not enough in the listing to call it." : "Nothing on file to compare these against yet.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Tops and outerwear

const band = (v, bands) => bands.find(([hi]) => v < hi)?.[1] ?? bands[bands.length - 1][1];

function chestFacet(an) {
  const p2p = an.g.axes.p2p, flat = an.body.chestFlatCm;
  if (!p2p || flat == null) return null;
  const ease = r1(p2p.cm * 2 - flat * 2);
  // bands mirror bodyReads() in fit.ts
  const read = band(ease, [[8, "close-fitting"], [18, "a regular fit"], [30, "roomy"], [Infinity, "very oversized"]]);
  return { ease, read, around: r1(p2p.cm * 2), body: r1(flat * 2), tight: ease < 0, v: p2p };
}

function shoulderFacet(an) {
  const sh = an.g.axes.sh, mine = an.body.shoulderCm;
  if (!sh || mine == null) return null;
  const perSide = r1((sh.cm - mine) / 2);
  const kind = perSide < -1.5 ? "pull" : perSide <= 0.5 ? "square" : "drop";
  const drop = kind === "drop" ? band(perSide, [[3, "a slight drop"], [6, "a soft drop"], [Infinity, "a heavy drop"]]) : null;
  return { perSide, kind, drop, sh: sh.cm, mine };
}

function topRows(an) {
  const { axes } = an;
  const rows = [];
  const est = an.body.estimated ? "~" : "";

  const C = chestFacet(an);
  const P = axes.p2p;
  if (C) {
    const words = { "close-fitting": "Close-fitting.", "a regular fit": "Relaxed, not oversized.", roomy: "Roomy, with real drape.", "very oversized": "Very oversized." };
    const head = [C.tight ? "Tight: less room than your chest." : words[C.read]];
    const a = P.comps[0];
    const more = joined(
      [N(`${G(C.v)}${cm(C.around)}`), " around, against your ", N(`${est}${cm(C.body)}`), " chest."],
      a ? others("p2p", [a]) : [],
      guessNote("pit-to-pit", P.gv, a ? [a] : []),
    );
    rows.push({ key: "chest", label: "Chest", value: [N(`${G(P.gv)}${cm(P.gv.cm)}`), " pit-to-pit"], lead: { fig: signed(C.ease), approx: guessed(C.v), vs: `vs your ${est}${num(C.body)}` }, head, more });
  } else if (P.gv) {
    const a = P.comps[0];
    rows.push({
      key: "chest", label: "Pit-to-pit", value: [N(`${G(P.gv)}${cm(P.gv.cm)}`)], lead: leadOf(a),
      head: a ? [Math.abs(a.delta) < 1 ? `The same width as your ${a.ref.short}.` : `${a.delta > 0 ? "Wider" : "Narrower"} than your ${a.ref.short}.`] : ["Nothing of yours to compare it with."],
      more: joined(others("p2p", P.comps.slice(1)), guessNote("pit-to-pit", P.gv, P.comps)),
    });
  }

  const S = shoulderFacet(an);
  const Sh = axes.sh;
  if (S) {
    const head = S.kind === "square" ? ["Square and boxy: the seam sits right on your shoulder."]
      : S.kind === "pull" ? ["Tight across the back: the seam sits inside your shoulder."]
      : [`${upper(S.drop)} shoulder.`];
    const a = Sh.comps[0];
    const more = joined(
      S.kind === "square" ? ["Your shoulders measure ", N(`${est}${cm(S.mine)}`), "."]
        : S.kind === "pull" ? ["The seam sits ", N(cm(Math.abs(S.perSide))), " inside each of your ", N(`${est}${cm(S.mine)}`), " shoulders."]
        : ["The seam drops ", N(cm(S.perSide)), " past each of your ", N(`${est}${cm(S.mine)}`), " shoulders."],
      a ? others("sh", [a]) : [],
    );
    rows.push({ key: "shoulder", label: "Shoulder", value: [N(cm(S.sh))], lead: { fig: signed(r1(S.sh - S.mine)), approx: false, vs: `vs your ${est}${num(S.mine)}` }, head, more });
  } else if (Sh.gv) {
    const a = Sh.comps[0];
    rows.push({
      key: "shoulder", label: "Shoulder", value: [N(cm(Sh.gv.cm))], lead: leadOf(a),
      head: a ? [Math.abs(a.delta) < 1 ? `The same shoulder as your ${a.ref.short}.` : `${a.delta > 0 ? "Wider" : "Narrower"} across the shoulder than your ${a.ref.short}.`] : ["Nothing of yours to compare it with."],
      more: others("sh", Sh.comps.slice(1)),
    });
  }

  // Length and sleeve read together: both are "where does it end on me".
  const Ln = axes.len, Sl = axes.slv;
  if (Ln.gv || Sl.gv) {
    const main = Ln.gv ? Ln : Sl;
    const axis = Ln.gv ? "len" : "slv";
    const a = main.comps[0];
    let head;
    if (!a) head = [an.refs.length ? `None of your measured pieces has a ${axis === "len" ? "length" : "sleeve"} to compare.` : "Nothing of yours is measured yet to compare it with."];
    else {
      const all = main.comps;
      const n = all.length;
      const who = n === 1 ? `your ${a.ref.short}` : n === 2 ? `both your ${all[0].ref.short} and ${all[1].ref.short}` : `all ${n} pieces you've measured`;
      const what = axis === "len" ? "length" : "sleeve";
      if (Math.abs(a.delta) < 1) head = [`The same ${what} as your ${a.ref.short}.`];
      else if (all.every((c) => c.delta >= 1)) head = [axis === "len" ? `Longer than ${who}.` : `Longer in the sleeve than ${who}.`];
      else if (all.every((c) => c.delta <= -1)) head = [axis === "len" ? `Shorter than ${who}.` : `Shorter in the sleeve than ${who}.`];
      else head = [axis === "len" ? `${a.delta > 0 ? "Longer" : "Shorter"} than your ${a.ref.short}.` : `${a.delta > 0 ? "Longer" : "Shorter"} in the sleeve than your ${a.ref.short}.`];
    }
    // with sleeves to report as well, only the nearest other piece makes the line
    const rest = main.comps.slice(1);
    let more = !rest.length ? [] : Ln.gv && Sl.gv ? nearest(axis, rest) : others(axis, rest);
    if (Ln.gv && Sl.gv) {
      const v = Sl.comps;
      const s = ["Sleeves ", N(cm(Sl.gv.cm))];
      if (v.length) {
        s.push(": ");
        v.forEach((c, k) => {
          if (k) s.push(k === v.length - 1 ? " and " : ", ");
          if (Math.abs(c.delta) < 0.5) s.push(`the same as your ${c.ref.short}`);
          else s.push(N(cm(Math.abs(c.delta))), ` ${word("slv", c.delta)} than your ${c.ref.short}`);
        });
      }
      s.push(".");
      more = joined(more, s);
    }
    if (Sl.gv && Sl.apart.length) {
      // a sleeve comparison is suppressed when the two were measured from different points; say
      // which side is the neck-to-cuff one, since it can be either
      const neck = Sl.apart.filter((c) => c.val?.datum === "raglan").map((c) => c.ref.short);
      const shoulder = Sl.apart.filter((c) => c.val?.datum !== "raglan").map((c) => c.ref.short);
      if (neck.length) more = joined(more, [M(`${neck.length > 1 ? `The ${and(neck)} sleeves are` : `The ${neck[0]} sleeve is`} measured from the neck, so not compared.`)]);
      if (shoulder.length) more = joined(more, [M(`This sleeve is measured from the neck and ${shoulder.length > 1 ? `the ${and(shoulder)} sleeves` : `the ${shoulder[0]} sleeve`} from the shoulder, so ${shoulder.length > 1 ? "they aren't" : "it isn't"} compared.`)]);
    }
    rows.push({ key: "length", label: Ln.gv ? "Length" : "Sleeve", value: [N(cm(main.gv.cm))], lead: leadOf(a), head, more });
  }
  return { top: rows.slice(0, 3), rest: rows.slice(3) };
}

function topHeadline(an) {
  const C = chestFacet(an), S = shoulderFacet(an);
  const chestWord = C && (C.tight ? "Tight through the chest" : { "close-fitting": "Close-fitting", "a regular fit": "A regular fit", roomy: "Roomy", "very oversized": "Very oversized" }[C.read]);
  const sh = S && (S.kind === "square" ? "square on the shoulder" : S.kind === "pull" ? "but tight across the shoulders" : `with ${S.drop} shoulder`);
  if (C?.tight && S?.kind === "pull") return "Tight through the chest and across the shoulders.";
  if (chestWord && sh) return `${chestWord}, ${sh}.`;
  if (chestWord) return `${chestWord}.`;
  if (sh) return `${upper(sh.replace(/^but /, ""))}.`;
  const Ln = an.axes.len;
  if (Ln.gv && Ln.comps.length) {
    const s = [...Ln.comps].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    const n = s.length;
    const who = n === 1 ? `your ${s[0].ref.short}` : n === 2 ? `both your ${s[0].ref.short} and ${s[1].ref.short}` : `all ${n} pieces you've measured`;
    const t = Math.abs(s[0].delta) < 1 ? `The same length as your ${s[0].ref.short}`
      : s.every((c) => c.delta > 0) ? `Longer than ${who}`
      : s.every((c) => c.delta < 0) ? `Shorter than ${who}`
      : `Between your ${s.filter((c) => c.delta > 0)[0].ref.short} and ${s.filter((c) => c.delta < 0)[0].ref.short} in length`;
    return an.g.axes.p2p ? `${t}.` : `${t}, but the chest isn't listed.`;
  }
  return an.refs.length ? "Not enough in the listing to call it." : "Nothing on file to compare this against yet.";
}

// ─────────────────────────────────────────────────────────────────────────────
// The open question

/** A missing waist on trousers (or chest on a top) is the gap that decides the purchase, so it gets a
 *  direction, not just a mention: ask for it, and here is the number to hope for. */
function ask(an) {
  const key = an.isBottom ? "waist" : "p2p";
  const A = an.axes[key];
  if (A.gv) return null;
  const what = an.isBottom ? "waist" : "pit-to-pit";
  const body = [];
  const owned = A.owned;
  let note = null;
  if (owned.length) {
    body.push(`Yours, laid flat: `);
    owned.forEach((o, k) => {
      if (k) body.push(", ");
      body.push(`${o.ref.short} `, N(`${G(o.val)}${cm(o.val.cm)}`));
    });
    body.push(".");
    const g = guessNote(what, null, owned.filter((o) => o.val.assumed));
    if (g.length) note = g;
  }
  // a number the listing gave under a name trousers don't have is very often the waist laid flat
  const extra = an.extra.map((x) => ({ axis: x, v: an.g.axes[x] })).filter((x) => x.v);
  // a bare "waist 38" would be read as inches (fit.ts parseGarmentInput: no unit and every number
  // under 46), so the tip carries its unit
  const aside = extra.map((x) => (an.isBottom && x.axis === "p2p"
    ? ["Its ", N(`${G(x.v)}${cm(x.v.cm)}`), " ", K(lower(x.axis)), " may be the waist laid flat: resend with ", K(`“waist ${num(x.v.cm)} cm”`), " instead."]
    : ["It also gave a ", N(`${G(x.v)}${cm(x.v.cm)}`), " ", K(lower(x.axis)), `, which ${an.isBottom ? "trousers don't" : "a top doesn't"} have, so that number is left out.`]));
  return { head: ["Ask the seller for the ", K(what), " before you buy."], body, note, aside };
}
