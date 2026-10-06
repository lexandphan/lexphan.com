import { analyse, AXIS_LABEL, TOP_AXES, BOTTOM_AXES, num, lower, and, howRead, G } from "/6ef1cfa0de5b6c/read.js";
import { createFlat, hatchPattern } from "/6ef1cfa0de5b6c/flat.js";

const app = document.getElementById("app");
const NS = "http://www.w3.org/2000/svg";
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

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

function fail(msg, plainHref) {
  app.replaceChildren(el("p", "state", msg));
  if (plainHref) {
    const a = el("a", "flat", "Open the simple version");
    a.href = plainHref;
    a.rel = "noreferrer";
    const p = el("p", "state state--link");
    p.append(a);
    app.append(p);
  }
}

async function main() {
  const url = dataUrl();
  if (!url) return fail("This link is incomplete. Ask Tori for the fit again.");
  let view;
  try {
    const res = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!res.ok) return fail("This link has expired. Ask Tori for the fit again and she'll send a fresh one.");
    view = await res.json();
  } catch { return fail("Couldn't reach the data for this fit. Check your connection and reload."); }
  const plain = new URL(url); plain.searchParams.delete("f");
  if (!view?.garment?.axes || !Array.isArray(view.refs) || !Array.isArray(view.deltas)) {
    return fail("This fit has no measurements to show here. The simple version has whatever Tori saved.", plain.toString());
  }
  try { render(view, url); }
  catch (e) {
    console.error(e);
    fail("This fit couldn't be drawn here, but the simple version still has every number.", plain.toString());
  }
}

/** Rich text from read.js: strings, {n} figures in the mono face, {m} quiet qualifiers. Text nodes
 *  only — the garment name and every other string arrive as data, never as markup. */
function rich(parent, parts) {
  for (const p of parts ?? []) {
    if (p == null || p === "") continue;
    if (typeof p === "string") parent.append(document.createTextNode(p));
    else if (p.n != null) parent.append(el("span", "n", p.n));
    else if (p.m != null) parent.append(el("span", "m", p.m));
    else if (p.k != null) parent.append(el("span", "nb", p.k));
  }
  return parent;
}

const NOUN = { bottom: "Trousers", top: "A top", outerwear: "Outerwear" };

function render(view, url) {
  const an = analyse(view);
  const g = view.garment;
  app.replaceChildren();
  const name = g.name || `${NOUN[g.category] ?? "A piece"} from a listing`;
  document.title = `Fit check: ${name}`;

  // ── the answer ──
  const head = el("header", "head");
  head.append(el("p", "name", name));
  head.append(el("h1", "verdict", an.headline));
  // the listing's units were guessed: every number below rests on that, so it is said up here
  if (g.unitAssumed) head.append(el("p", "flag", `Read as ${g.unitRead === "in" ? "inches" : "centimetres"} — the listing gave no units.`));
  if (an.against) head.append(el("p", "against", an.against));
  app.append(head);

  // ── the open question, when the listing is missing the number that decides it ──
  if (an.ask) {
    const box = el("aside", "ask");
    box.append(rich(el("p", "ask-head"), an.ask.head));
    if (an.ask.body.length) box.append(rich(el("p", "ask-body"), an.ask.body));
    if (an.ask.note) box.append(rich(el("p", "ask-note"), an.ask.note));
    for (const a of an.ask.aside) box.append(rich(el("p", "ask-aside"), a));
    app.append(box);
  }

  // ── the drawing: "See it on you" is what the Telegram button promised ──
  app.append(figureSection(view, an));

  // ── the two or three differences that decide it ──
  if (an.rows.top.length) {
    const ul = el("ul", "rows");
    for (const r of an.rows.top) ul.append(row(r));
    app.append(ul);
  }

  // ── what the listing left out, in one line ──
  if (an.missing.length) {
    const names = an.missing.map(lower);
    const p = el("p", "gaps", "Not in the listing: ");
    names.forEach((n, k) => {
      if (k) p.append(document.createTextNode(k === names.length - 1 ? " and " : ", "));
      p.append(el("span", "nb", n));
    });
    p.append(document.createTextNode("."));
    app.append(p);
  }
  if (!an.ask) {
    for (const a of an.extra) {
      const v = g.axes[a];
      const p = el("p", "gaps");
      rich(p, [`It also gave a `, { n: `${G(v)}${num(v.cm)} cm` }, ` ${lower(a)}, which ${an.isBottom ? "trousers don't" : "a top doesn't"} have, so that number is left out.`]);
      app.append(p);
    }
  }

  // ── everything else, on demand ──
  const details = el("div", "details");
  const ladders = measurementLadders(view, an);
  if (ladders) details.append(more("Every measurement", ladders));
  details.append(more("How it's drawn", builtFrom(view, an)));
  if (details.childElementCount) app.append(details);

  // ── the small print (the units caveat already sits under the headline) ──
  const notes = el("div", "notes");
  for (const c of view.caveats ?? []) if (!/^No units were given/.test(c)) notes.append(keepHyphens(el("p"), c));
  app.append(notes);

  const foot = el("div", "foot");
  const plain = el("a", "flat", "Open the simple version");
  const plainUrl = new URL(url); plainUrl.searchParams.delete("f");
  plain.href = plainUrl.toString();
  plain.rel = "noreferrer";
  foot.append(plain);
  const when = new Date(view.createdAt);
  if (!Number.isNaN(when.getTime())) foot.append(el("span", "when", `Checked ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`));
  app.append(foot);

  // the marks, explained once — only the ones this page actually uses (closed sections included)
  const text = app.textContent;
  const marks = [];
  if (text.includes("≈")) marks.push("≈ marks a guessed flat-or-around reading, a number worked out from one, or where a hem lands.");
  if (text.includes("~")) marks.push("~ marks your own estimate.");
  if (marks.length) notes.append(keepHyphens(el("p"), marks.join(" ")));
  if (!notes.childElementCount) notes.remove();
  app.classList.add("is-ready");
}

/** Text with every hyphenated word kept whole ("TODO-confirm", "flat-or-around"), so a narrow
 *  screen never breaks one at its hyphen. Text nodes and spans only. */
function keepHyphens(parent, text) {
  for (const part of text.split(/(\S*\w-\w\S*)/)) {
    if (!part) continue;
    if (/\w-\w/.test(part)) parent.append(el("span", "nb", part));
    else parent.append(document.createTextNode(part));
  }
  return parent;
}

/** One row: the difference that matters as a figure, then what it means, then the evidence. */
function row(r) {
  const li = el("li", "row");
  const fig = el("p", "row-fig");
  if (r.lead) {
    const d = el("span", "row-delta");
    if (r.lead.approx) d.append(el("span", "row-approx", "≈"));
    d.append(el("span", "row-num", r.lead.fig), el("span", "row-unit", "cm"));
    fig.append(d, el("span", "row-vs", r.lead.vs));
  } else {
    // nothing to compare against: the listing's own number stands in, and says so
    const v = r.value.find((p) => p && p.n != null);
    if (v) {
      const d = el("span", "row-delta is-plain");
      d.append(el("span", "row-num", v.n.replace(/\s*cm$/, "")), el("span", "row-unit", "cm"));
      fig.append(d, el("span", "row-vs", "as listed"));
    }
  }
  const body = el("div", "row-body");
  const h = el("h2", "row-label", `${r.label} `);
  h.append(rich(el("span", "row-value"), r.value));
  body.append(h);
  if (r.head) body.append(rich(el("p", "row-head"), r.head));
  if (r.more?.length) body.append(rich(el("p", r.head ? "row-more" : "row-more is-lead"), r.more));
  li.append(fig, body);
  return li;
}

function more(title, body) {
  const d = el("details", "more");
  d.append(el("summary", null, title));
  const b = el("div", "more-body");
  b.append(body);
  d.append(b);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// The drawing

let swatchId = 0;
function swatch(kind) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("width", "26"); s.setAttribute("height", "14"); s.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); s.append(e); return e; };
  if (kind === "piece") { add("rect", { x: 1.5, y: 2.5, width: 23, height: 9, rx: 1, class: "fig-cloth" }); add("rect", { x: 1.5, y: 2.5, width: 23, height: 9, rx: 1, class: "fig-seam" }); }
  if (kind === "borrowed") {
    // the same hatched band and dotted edge the drawing uses
    const paint = hatchPattern(s, `sw-hatch-${++swatchId}`);
    add("path", { d: "M1,7H25", class: "fig-hatch-band", stroke: paint });
    add("path", { d: "M2.5,7H24", class: "fig-seam is-borrowed" });
  }
  if (kind === "yours") add("path", { d: "M1,7H25", class: "fig-ref" });
  // him as the drawing shows him: the block on a chip of the print it sits on, or the chest guide
  if (kind === "you") { add("rect", { x: 0.5, y: 0.5, width: 25, height: 13, rx: 2, class: "sw-chip" }); add("rect", { x: 4.5, y: 3.5, width: 17, height: 7, rx: 1, class: "fig-block" }); }
  if (kind === "chest") add("path", { d: "M3,7H23M3,2.5V11.5M23,2.5V11.5", class: "fig-you-line" });
  return s;
}

const nm = (a) => (a === "hem" ? "leg opening" : a === "slv" ? "sleeve" : lower(a));
const or = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

function figureSection(view, an) {
  const sec = el("figure", "fig");
  const usable = an.refs;
  const isBottom = an.isBottom;
  const AX = isBottom ? BOTTOM_AXES : TOP_AXES;
  const flat = createFlat(view, usable);
  let active = 0;

  // which garment of his the drawing is set against; the rows above always say "vs …" themselves
  let radios = [];
  if (usable.length > 1) {
    const tabs = el("div", "fig-tabs");
    tabs.setAttribute("role", "radiogroup");
    tabs.setAttribute("aria-label", "Drawn against");
    const lab = el("span", "fig-tabs-label", "Drawn against");
    lab.setAttribute("aria-hidden", "true");
    tabs.append(lab);
    radios = usable.map((r, k) => {
      const b = el("button", "fig-tab", r.short);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => { active = k; paint(); });
      b.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        active = (active + step + usable.length) % usable.length;
        paint();
        radios[active].focus();
      });
      tabs.append(b);
      return b;
    });
    sec.append(tabs);
    // once the chips wrap, the label takes its own line so it heads every row of them
    const fit = () => {
      tabs.classList.remove("is-wrapped");
      const tops = radios.map((b) => b.offsetTop);
      if (Math.max(...tops) - Math.min(...tops) > 4 || (radios[0] && radios[0].offsetTop - lab.offsetTop > 4)) tabs.classList.add("is-wrapped");
    };
    new ResizeObserver(fit).observe(tabs);
  } else if (usable.length === 1) {
    sec.append(el("p", "fig-solo", `Drawn against your ${usable[0].short}${usable[0].size ? ` (${usable[0].size})` : ""}`));
  }

  const print = el("div", "fig-print");
  const stage = el("div", "fig-stage");
  stage.append(flat.el);
  print.append(stage);
  sec.append(print);

  const cap = el("figcaption");
  const key = el("ul", "fig-key");
  const note = el("p", "fig-note");
  cap.append(key, note);
  sec.append(cap);

  const own = view.garment.axes;
  const m = view.model;
  const est = m?.estimated ?? {};
  const self = an.body.estimated ? "~" : "";
  // of his model, only the waist width shows (the stub above a waistband); a top shows only his chest
  const drawnEst = isBottom && est.waistCirc ? ["waist"] : [];

  function paint() {
    radios.forEach((b, k) => { b.setAttribute("aria-checked", String(k === active)); b.tabIndex = k === active ? 0 : -1; });
    flat.setRef(active);
    const r = usable[active] ?? null;
    const d = flat.describe(active);
    const borrowedAxes = d.borrowed.flatMap((b) => b.axes);
    const listed = AX.filter((a) => own[a]);

    key.replaceChildren();
    const item = (kind, text) => { const li = el("li"); li.append(swatch(kind), el("span", null, text)); key.append(li); };
    if (listed.length) item("piece", "this piece, as listed");
    if (borrowedAxes.length || d.converted) item("borrowed", borrowedAxes.length ? (d.converted ? "not in the listing, or estimated" : "not in the listing") : "estimated");
    if (r) item("yours", `your ${r.short}${r.size ? ` (${r.size})` : ""}`);
    if (m) item(isBottom ? "you" : "chest", isBottom ? "you, at half girth" : "your chest, at half girth");

    const lines = [];
    // what was borrowed, and from where — with no figure on file, a placeholder, and said so
    const from = (b) => (b.from ? `from your ${b.from.short}` : m ? "drawn from your figure" : "drawn as a placeholder");
    if (borrowedAxes.length) {
      if (!listed.length) lines.push(`Nothing in the listing could be drawn, so all of it is hatched${d.borrowed.length === 1 ? `, ${from(d.borrowed[0])}` : ""}.`);
      else if (borrowedAxes.length >= listed.length) {
        const rest = d.borrowed.length === 1 ? `, ${from(d.borrowed[0]).replace(/^from/, "taken from")}` : `: ${d.borrowed.map((b, k) => `the ${and(b.axes.map(nm))} ${k ? from(b) : from(b).replace(/^from/, "taken from")}`).join(", ")}`;
        lines.push(`Only its ${and(listed.map(nm))} ${listed.length > 1 ? "are" : "is"} from the listing; the rest is hatched${rest}.`);
      } else {
        lines.push(`No ${and(borrowedAxes.map(nm))} in the listing, so ${borrowedAxes.length > 1 ? "those parts are" : "that part is"} hatched, ${d.borrowed.map((b) => `${d.borrowed.length > 1 ? `the ${and(b.axes.map(nm))} ` : ""}${from(b).replace(/^from/, "taken from")}`).join(", ")}.`);
      }
    }
    if (d.converted) lines.push("Its sleeve is measured from the neck, so it's drawn from the shoulder as an estimate, hatched.");
    // widths drawn as read although nobody said whether they were flat or around
    if (d.assumed.piece.length || d.assumed.ref.length) {
      const its = d.assumed.piece.length ? `its ${and(d.assumed.piece.map(nm))}` : "";
      const yours = r && d.assumed.ref.length ? `the ${and(d.assumed.ref.map(nm))} on your ${r.short}` : "";
      const n = d.assumed.piece.length + d.assumed.ref.length;
      const who = its && yours ? `${its}, and ${yours},` : its || yours;
      lines.push(`${who[0].toUpperCase()}${who.slice(1)} had no flat-or-around label, so ${n > 1 ? "those widths" : "that width"} could be off.`);
    }
    // what his garment has no number for
    if (r) {
      const miss = d.refMissing;
      if (isBottom) {
        if (miss.includes("thigh") || miss.includes("knee")) lines.push(`Your ${r.short} has no ${or(miss.filter((a) => a === "thigh" || a === "knee").map(nm))} on file, so its legs aren't drawn, only where its crotch and hems fall.`);
        else if (miss.includes("hem")) lines.push(`Your ${r.short} has no leg opening on file, so its hems are only marked.`);
        if (miss.includes("waist")) lines.push(`Your ${r.short} has no waist on file, so its waistband isn't drawn.`);
      } else {
        const noSh = miss.includes("sh");
        // which of the two sleeves is the neck-to-cuff one decides the sentence
        const apart = d.sleeveApart === "ref" ? `its sleeve is measured from the neck` : `its sleeve is measured from the shoulder and this one's from the neck`;
        if (noSh && d.sleeveApart) lines.push(`Your ${r.short} has no shoulder on file and ${apart}, so neither is drawn.`);
        else if (noSh) lines.push(`Your ${r.short} has no shoulder on file, so its shoulders${r.axes.slv ? " and sleeves" : ""} aren't drawn.`);
        else if (d.sleeveApart === "ref" || d.refSleeveNeck) lines.push(`The sleeve on your ${r.short} is measured from the neck, so it isn't drawn.`);
        else if (d.sleeveApart) lines.push(`The sleeve on your ${r.short} is measured from the shoulder and this one's from the neck, so yours isn't drawn.`);
        else if (miss.includes("slv")) lines.push(`Your ${r.short} has no sleeve on file.`);
        if (miss.includes("p2p")) lines.push(`Your ${r.short} has no pit-to-pit on file, so only its hem is marked.`);
        if (miss.includes("len")) lines.push(`Your ${r.short} has no length on file, so its sides aren't drawn.`);
      }
    }
    // the floor is where a drawn proportion (his waist line) puts it, so a near thing is said as near
    const reach = d.pooled.near ? "would end about at the floor (your waist height is an estimate)" : "would reach the floor";
    if (d.pooled.piece && d.pooled.ref && r) lines.push(`Both ${reach}, so both stop there.`);
    else if (d.pooled.piece) lines.push(`This piece ${reach}, so it stops there.`);
    else if (d.pooled.ref && r) lines.push(`Your ${r.short} ${reach}, so it stops there.`);
    const conv = !m ? "Drawn flat to one scale, the way listings measure. Your notes don't have enough to draw you, so only the garments are drawn."
      : isBottom ? `Drawn flat to one scale, the way listings measure, on you at half your girth${drawnEst.length ? `; your ${and(drawnEst)} is an estimate` : ""}.`
      : `Drawn flat to one scale, the way listings measure. Your ${self}${num(m.chestCirc)} cm chest is marked at half its girth, so the gap at each side is the room you'd have.`;
    lines.push(conv);
    note.textContent = lines.join(" ");
    flat.el.setAttribute("aria-label", `This piece drawn flat${m ? " over your figure" : ""}${r ? `, with your ${r.short} outlined` : ""}. ${lines.join(" ")}`);
  }

  const size = () => {
    const w = stage.clientWidth || 330;
    // trousers are tall and narrow, so their drawing is taller than a top's
    flat.resize(w, Math.round(isBottom ? Math.min(540, Math.max(420, w * 1.36)) : Math.min(440, Math.max(300, w * 0.95))));
  };
  new ResizeObserver(size).observe(stage);
  size();
  paint();
  return sec;
}

// ─────────────────────────────────────────────────────────────────────────────
// Every measurement: where the piece falls among the things he owns, one axis at a time

const DIFF = { len: ["longer", "shorter"], slv: ["longer", "shorter"], inseam: ["longer", "shorter"], rise: ["longer", "shorter"] };
const diffWord = (axis, d) => (DIFF[axis] ?? ["wider", "narrower"])[d > 0 ? 0 : 1];

function measurementLadders(view, an) {
  const wrap = el("div");
  const AX = an.isBottom ? (an.axes.hip ? [...BOTTOM_AXES, "hip"] : BOTTOM_AXES) : TOP_AXES;
  for (const axis of AX) {
    const A = an.axes[axis];
    if (!A?.gv) continue;
    const rows = [{ kind: "piece", v: A.gv.cm, who: "This piece", val: A.gv }];
    for (const c of A.comps) rows.push({ kind: "yours", v: c.refCm, who: c.ref.name, size: c.ref.size, val: c.val, d: c.refCm - A.gv.cm, approx: !!(A.gv.assumed || c.val?.assumed) });
    // his own body where his notes have the number: the zero-room line for the chest and shoulder
    if (axis === "p2p" && an.body.chestFlatCm != null) rows.push({ kind: "you", v: an.body.chestFlatCm, who: "You, chest laid flat", est: an.body.estimated });
    if (axis === "sh" && an.body.shoulderCm != null) rows.push({ kind: "you", v: an.body.shoulderCm, who: "You, shoulders", est: an.body.estimated });
    if (axis === "hip" && an.body.hipFlatCm != null) rows.push({ kind: "block", v: an.body.hipFlatCm, who: "You, hip laid flat", est: an.body.estimated });
    rows.sort((a, b) => b.v - a.v);

    const sec = el("section", "ladder");
    const h = el("h3", null, AXIS_LABEL[axis]);
    h.append(el("span", "m", ", cm"));
    sec.append(h);
    const ol = el("ol");
    for (const r of rows) {
      const li = el("li", r.kind === "piece" ? "is-piece" : null);
      li.append(el("span", `mk mk-${r.kind}`));
      li.append(el("span", "v", `${r.est ? "~" : ""}${G(r.val)}${num(r.v)}`));
      const who = el("span", "who", r.who);
      if (r.size) who.append(el("span", "m", `, size ${r.size}`));
      const how = howRead(r.val);
      if (how) who.append(el("span", "m", `, ${how}`));
      li.append(who);
      li.append(el("span", "d", r.d == null ? "" : Math.abs(r.d) < 0.5 ? (r.approx ? "about the same" : "same") : `${r.approx ? "≈" : ""}${num(Math.abs(r.d))} ${diffWord(axis, r.d)}`));
      ol.append(li);
    }
    sec.append(ol);
    if (A.apart.length) {
      const fromNeck = A.apart.every((c) => c.val?.datum === "raglan");
      sec.append(el("p", "apart", `Measured from ${fromNeck ? "the neck" : "a different point than this one"}, so not compared: ${A.apart.map((c) => `${c.ref.short} ${num(c.refCm)}`).join(", ")}.`));
    }
    wrap.append(sec);
  }
  if (an.landing) {
    const L = an.landing;
    const rows = [{ kind: "piece", v: L.total, who: "This piece" }, ...L.rows.map((r) => ({ kind: "yours", v: r.total, who: r.ref.name, size: r.ref.size, d: r.total - L.total }))];
    rows.sort((a, b) => b.v - a.v);
    const sec = el("section", "ladder");
    const h = el("h3", null, "Waist to hem");
    h.append(el("span", "m", ", cm, worked out as rise + inseam"));
    sec.append(h);
    const ol = el("ol");
    for (const r of rows) {
      const li = el("li", r.kind === "piece" ? "is-piece" : null);
      li.append(el("span", `mk mk-${r.kind}`), el("span", "v", `≈${num(r.v)}`));
      const who = el("span", "who", r.who);
      if (r.size) who.append(el("span", "m", `, size ${r.size}`));
      // to the half centimetre, the way the rows and the drawing say it
      li.append(who, el("span", "d", r.d == null ? "" : Math.abs(r.d) < 0.5 ? "same" : `≈${num(Math.round(Math.abs(r.d) * 2) / 2)} ${r.d > 0 ? "longer" : "shorter"}`));
      ol.append(li);
    }
    sec.append(ol);
    wrap.append(sec);
  }
  return wrap.childElementCount ? wrap : null;
}

function builtFrom(view, an) {
  const m = view.model;
  const isBottom = an.isBottom;
  const wrap = el("div");
  const p = (text) => wrap.append(el("p", "built-intro", text));
  if (isBottom) {
    p("Every width is drawn flat, the way listings measure, all to one scale. Laid flat, a pair's legs overlap at the seat because the back rise folds under, so each leg is its listed width with the two overlapping there, and the seat is drawn, not measured, unless the listing gives a hip. How far the legs overlap and part, and the knee height, are drawing, the same for every pair, so the gap between two outlines at one point is the difference between their numbers there.");
  } else {
    p("Every width is drawn flat, the way listings measure, all to one scale. Armhole depth and sleeve widths aren't measured, so they're drawing, and so is the neckline, read off the piece's name.");
  }
  if (!m) {
    p("Your notes don't have enough to draw you, so only the garments are drawn, and where neither the listing nor your own garments give a width, the shape there is a placeholder, hatched.");
    return wrap;
  }
  const est = m.estimated ?? {};
  const self = an.body.estimated ? "~" : "";
  const rows = isBottom
    ? [["Height", m.heightCm, "heightCm", ""], ["Waist", m.waistCirc, "waistCirc", " around"], ["Hip", m.hipCirc, "hipCirc", " around"]]
    : [["Chest", m.chestCirc, "chestCirc", " around"]];
  p(isBottom
    ? "You're drawn as a plain block at half your girth: what a garment with no room in it would measure laid flat. Your waist shows above the band, and your legs below a hem the listing gives. It's built from your sizing notes; where a number isn't in them, it's worked out and marked here."
    : `Your chest is marked at half its girth, just below the armholes where a pit-to-pit is measured: your ${self}${num(m.chestCirc)} cm chest is drawn ${self}${num(m.chestCirc / 2)} cm across, what a garment with no room in it would measure laid flat.`);
  const ul = el("ul", "built");
  for (const [label, val, k, unit] of rows) {
    const li = el("li");
    const worked = !!est[k];
    const src = worked ? `worked out: ${m.notes?.[k] ?? "derived"}` : "from your notes";
    li.append(el("span", null, label), el("span", "v", `${worked ? "≈" : self}${num(val)}`), el("span", "src", `${unit ? `${unit.trim()}, ` : ""}${src}`.replace(/ x /g, " × ")));
    ul.append(li);
  }
  wrap.append(ul);
  if (isBottom) p(`Trousers hang from a waist line set at 62% of your height, so where a hem meets the floor is only as good as that proportion. The widths of your legs are drawing, not measurement.`);
  return wrap;
}

main();
