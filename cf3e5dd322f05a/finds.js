const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const https = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const yen = (n) => (n == null ? "" : "¥" + Number(n).toLocaleString("ja-JP"));
const SOURCE = { yahoo: "Yahoo Auctions", flea: "PayPay Flea", mercari: "Mercari" };
const TABS = { brands: "My brands", discover: "Discover", saved: "Saved" };
const SETS = ["tier", "brand", "garment", "kind", "source", "silhouette", "tori", "capsule"];
const SIL = { slim: "Slim", regular: "Regular", roomy: "Roomy", unknown: "Unknown" };
const TORI = { pass: "Tori ✓", miss: "Tori ✗", pending: "Not checked" };
const CAP = { gap: "Fills a gap", have: "Have one", dup: "Repeat (2+)", off: "Off-palette", none: "Colour unknown" };
const capKey = (it) => it.capsule ? it.capsule.kind : "none";
const toriKey = (it) => it.tori || "pending";
// Fresh: how much more often a find surfaces early. A weighted shuffle, not a ranking: Tori ✓ and
// strong taste float up, everything else still gets turns (taste drifts ~1pt between runs, and
// most finds have no score at all).
function freshWeight(it) {
  let w = { pass: 3, pending: 1.5, miss: 1 }[toriKey(it)];
  if (it.taste_score != null) w *= it.taste_score >= 8 ? 2 : it.taste_score < 5 ? 0.5 : 1;
  const k = capKey(it);
  if (k === "gap" || it.capsule?.pair?.kind === "new") w *= 1.5;
  else if (k === "dup" || k === "off") w *= 0.7;
  if (it.found_at && Date.now() - Date.parse(it.found_at) < 2 * 864e5) w *= 1.5;
  return w;
}

// The signed link rides in the FRAGMENT, so it never reaches this host. It decodes to the full
// function URL. The host is pinned by its SHA-256, so a link pointing at someone else's Supabase
// project can't fill this page, and the public repo still holds no project identifier.
const HOST_SHA256 = "05d1f5821e5c40d1d6a40dab6d83055bfc5f816d052be84f9271ba680f9f6a89";
async function hostOk(host) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(host)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("") === HOST_SHA256;
}
function dataUrl() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  try {
    const url = new URL(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (url.protocol !== "https:" || !/\.supabase\.co$/.test(url.hostname)) return null;
    if (!url.pathname.endsWith("/functions/v1/buyee-page")) return null;
    return url.toString();
  } catch { return null; }
}

const fail = (msg) => { $("state").textContent = msg; $("state").hidden = false; $("wrap").hidden = true; };

// One GET on the signed link; `first` asks for the fast first page. Throws the text the page shows.
async function load(url, first) {
  const u = new URL(url); if (first) u.searchParams.set("first", "1");
  let res;
  try { res = await fetch(u, { referrerPolicy: "no-referrer" }); } catch { throw new Error("Couldn't reach your finds. Check your connection and reload."); }
  if (!res.ok) throw new Error("This link has expired. Send Tori \"finds\" and she'll send a fresh one.");
  let data;
  try { data = await res.json(); } catch {}
  if (!Array.isArray(data?.items)) throw new Error("Something's off with this link. Send Tori \"finds\" for a fresh one.");
  return data;
}

// Coming Back (bfcache dropped the page): the page rebuilds the order and position he left from the
// snapshot, which needs the full list. The first page is only a fallback there.
const back = (() => { try { return performance.getEntriesByType("navigation")[0]?.type === "back_forward"; } catch { return false; } })();
const num = (n) => typeof n === "number" && Number.isFinite(n);

// Both GETs start at once. The first page (<= 48 items, with counts) paints as soon as it lands; the
// full list swaps in behind it. A response without counts is the full list (a function that predates
// first=1), and so is a first page that holds every row, so whichever lands first as a full list wins
// and the other is ignored. On Back the first page waits, and paints only if the full list fails.
async function main() {
  const url = dataUrl();
  if (!url || !(await hostOk(new URL(url).hostname))) return fail("This link is incomplete. Send Tori \"finds\" for a fresh one.");
  let swap = null, fullIn = false, fullErr = null, firstErr = null, held = null;
  const note = () => { restFailed = true; $("loadrest").hidden = true; $("partial").hidden = false; };
  const give = (data, isFull) => {
    if (fullIn) return;
    fullIn = isFull;
    if (swap) {
      try { swap(data); } catch (e) { console.error(e); note(); }
      return;
    }
    $("state").hidden = true; $("wrap").hidden = false;
    API = url;
    if (matchMedia("(min-width: 761px)").matches) $("filters").open = true;
    swap = run(data, !isFull);
  };
  load(url).then((d) => give(d, true), (e) => {
    fullErr = e;
    if (swap) { if (!fullIn) note(); }
    else if (held) { give(held, false); note(); }
    else if (firstErr) fail(e.message);
  });
  const firstFailed = (e) => { firstErr = e; if (fullErr && !swap) fail(fullErr.message); };
  load(url, true).then((d) => {
    if (fullIn) return;
    if (!d.counts) return give(d, true);
    if (!num(d.counts.total) || !num(d.counts.new)) return firstFailed(new Error("first page without usable counts"));
    if (d.counts.total <= d.items.length) return give(d, true);
    if (back) { if (fullErr) { give(d, false); note(); } else held = d; return; }
    give(d, false);
    if (fullErr) note();
  }, firstFailed);
}

let API = null;   // the signed buyee-page URL this page was opened with
let restFailed = false;   // the full list did not load
const PAGE = 48;
const BRANDS_SHOWN = 10;
const SEEN_MS = 1000;         // half a card on screen this long = seen (a flick past doesn't count)
const SEEN_FLUSH_MS = 5000;   // seen ids go up in batches this often, and on leaving
// Phone layout: "l2" two compact columns, "l1" one column. Overridable for previews.
function layout() {
  let l = "l2";
  try { const v = localStorage.getItem("finds-layout"); if (v === "l1" || v === "l2") l = v; } catch {}
  document.body.classList.add(l);
}

// `partial`: data is only the first page (it carries counts). Returns the swap that takes the full list.
function run(data, partial) {
  layout();
  let items = data.items;
  const state = { tab: "brands", q: "", sort: "fresh", pmin: "", pmax: "", allBrands: false, combo: "" };
  SETS.forEach((k) => (state[k] = new Set()));
  try {
    const s = JSON.parse(localStorage.getItem("finds-state") || "{}");
    for (const k of ["tab", "q", "sort", "pmin", "pmax"]) if (typeof s[k] === "string") state[k] = s[k];
    for (const k of SETS) if (Array.isArray(s[k])) state[k] = new Set(s[k]);
    // Fresh became the default on 2026-10-18. A sort saved before then switches only if it was the old
    // default ("fit"); one picked on purpose (price, ending soon…) stays.
    if (s.v !== 2 && (!s.sort || s.sort === "fit")) state.sort = "fresh";
  } catch {}
  if (!TABS[state.tab]) state.tab = "brands";
  if (!$("sort").querySelector(`option[value="${state.sort}"]`)) state.sort = "fresh";

  const touched = new Map();   // saves made on this page: the full list was fetched before them
  const tabItems = (tab) => tab === "saved" ? items.filter((it) => it.saved) : items.filter((it) => (tab === "discover") === !!it.discover);
  const LABELS = { tier: { fit: "In range", maybe: "Tag size only" }, garment: { tops: "Tops / outerwear", bottoms: "Bottoms" },
    kind: { fixed: "Buy now", auction: "Auction" }, source: SOURCE, silhouette: SIL, tori: TORI, capsule: CAP, brand: null };

  function chips(id, values, key) {
    const box = $(id); box.replaceChildren();
    values.forEach((v) => {
      const b = el("button", "chip", LABELS[key]?.[v] || v); b.type = "button";
      b.setAttribute("aria-pressed", String(state[key].has(v)));
      b.addEventListener("click", () => { state[key].has(v) ? state[key].delete(v) : state[key].add(v); b.setAttribute("aria-pressed", String(state[key].has(v))); render(); });
      box.append(b);
    });
  }
  function brandChips() {
    const counts = {};
    tabItems(state.tab).forEach((it) => (counts[it.brand] = (counts[it.brand] || 0) + 1));
    if (!partial) for (const b of [...state.brand]) if (!counts[b]) state.brand.delete(b);
    const all = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    // picked brands always stay visible, even when the list is folded
    const shown = state.allBrands ? all : [...new Set([...all.slice(0, BRANDS_SHOWN), ...all.filter((b) => state.brand.has(b))])];
    chips("brand", shown, "brand");
    const more = $("brandmore");
    more.hidden = all.length <= BRANDS_SHOWN;
    more.textContent = state.allBrands ? "Fewer brands" : partial ? "All brands" : `All ${all.length} brands`;
  }
  $("brandmore").addEventListener("click", () => { state.allBrands = !state.allBrands; brandChips(); });
  function tabs() {
    const box = $("tabs"); box.replaceChildren();
    Object.keys(TABS).forEach((t) => {
      const b = el("button", "tab", TABS[t]); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(state.tab === t));
      if (!partial) b.append(el("span", "n", String(tabItems(t).length)));
      b.addEventListener("click", () => { state.tab = t; state.brand.clear(); tabs(); brandChips(); render(); });
      box.append(b);
    });
  }
  function allChips() {
    chips("tori", ["pass", "miss", "pending"], "tori");
    chips("capsule", ["gap", "have", "dup", "off", "none"], "capsule");
    chips("silhouette", ["slim", "regular", "roomy", "unknown"], "silhouette");
    chips("garment", ["tops", "bottoms"], "garment");
    chips("tier", ["fit", "maybe"], "tier");
    chips("kind", ["fixed", "auction"], "kind");
    chips("source", ["yahoo", "flea", "mercari"].filter((s) => partial || items.some((i) => i.source === s)), "source");
    brandChips();
  }
  tabs(); allChips();
  $("q").value = state.q; $("sort").value = state.sort; $("pmin").value = state.pmin; $("pmax").value = state.pmax;
  $("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("pmin").addEventListener("input", (e) => { state.pmin = e.target.value; render(); });
  $("pmax").addEventListener("input", (e) => { state.pmax = e.target.value; render(); });
  $("reset").addEventListener("click", () => {
    state.q = state.pmin = state.pmax = state.combo = ""; SETS.forEach((k) => state[k].clear());
    $("q").value = $("pmin").value = $("pmax").value = "";
    allChips(); render();
  });
  $("show").addEventListener("click", () => { $("filters").open = false; $("tabs").scrollIntoView({ block: "start" }); });

  function endLabel(it) {
    if (it.is_fixed || !it.end_time) return "buy now";
    const ms = new Date(it.end_time) - Date.now(); if (ms < 0) return "ended";
    const h = Math.round(ms / 36e5); return h < 48 ? "ends in " + h + "h" : "ends in " + Math.round(h / 24) + "d";
  }
  // One line for the card: a pass names the reference it sits like; a miss leads with its first reason.
  function verdictLine(it) {
    const lines = it.fit_lines || [];
    if (it.tori === "pass" && /^fits your body/i.test(lines[0] || "")) return lines[0].replace(/^fits your body/i, "Fits your body");
    if (it.tori === "pass") { const ref = lines.find((l) => /^vs your /i.test(l)); return ref ? "Sits like your " + ref.replace(/^vs your /i, "").replace(/\s*\(.*$/, "").replace(/:$/, "") : "Sits like your references"; }
    if (it.tori === "miss") return lines[0] || "Doesn't match your references";
    return lines[0] === "no measurements" || !it.fit_lines?.length ? "No measurements to check" : "Not checked yet";
  }
  function link(cls, href, text) {
    const a = el("a", cls, text); a.target = "_blank"; a.rel = "noopener noreferrer";
    if (href) a.href = href;
    return a;
  }
  // Same viewer as the Telegram card's Fit view; built on first tap, reused after. Same tab, so
  // Back returns here (a window.open after an await is blocked on iOS).
  async function openFit(id, btn) {
    const was = [...btn.childNodes].map((n) => n.cloneNode(true));
    btn.disabled = true; btn.textContent = "…";
    try {
      const u = new URL(API); u.searchParams.set("fit", id);
      const res = await fetch(u, { referrerPolicy: "no-referrer" });
      const j = res.ok ? await res.json() : null;
      if (j && https(j.url)) { location.href = j.url; return; }
      btn.textContent = res.status === 404 ? "No fit" : "Try again";
    } catch { btn.textContent = "Try again"; }
    btn.disabled = false;
    setTimeout(() => btn.replaceChildren(...was), 2500);
  }
  // ☆ Save, the page's one write: POST with the same signed link. Optimistic, then settles on what
  // the server says the row really is. A row unsaved on the Saved tab stays put until the next render.
  // The card is looked up by id each time: the full list swapping in replaces the card that was tapped.
  const saving = new Set();
  const cardOf = (id) => $("grid").querySelector(`article[data-id="${CSS.escape(id)}"]`);
  async function toggleSave(it) {
    const want = !it.saved;
    const show = (on) => {
      const cur = items.find((x) => x.id === it.id) || it, was = cur.saved;
      it.saved = cur.saved = on; touched.set(it.id, on);
      if (was !== on) tabs();
      const c = cardOf(it.id), btn = c?.querySelector(".savebtn"); if (!c) return;
      c.classList.toggle("saved", on); btn.textContent = on ? "★" : "☆";
      btn.setAttribute("aria-pressed", String(on)); btn.setAttribute("aria-label", on ? "Unsave" : "Save");
    };
    const busy = (on) => { const b = cardOf(it.id)?.querySelector(".savebtn"); if (b) b.disabled = on; };
    saving.add(it.id); show(want); busy(true);
    try {
      const u = new URL(API); u.searchParams.set("save", it.id); u.searchParams.set("on", want ? "1" : "0");
      const res = await fetch(u, { method: "POST", referrerPolicy: "no-referrer" });
      const j = res.ok ? await res.json() : null;
      show(j ? !!j.saved : !want);
    } catch { show(!want); }
    saving.delete(it.id); busy(false);
  }
  function card(it) {
    const c = el("article", "card" + (it.saved ? " saved" : "") + (it.sold ? " sold" : ""));
    c.dataset.id = it.id;
    const go = https(it.buyee_url);
    const img = link("img", go); img.setAttribute("aria-label", it.title);
    const src = https(it.image_url);
    if (src) { const i = el("img"); i.src = src; i.alt = ""; i.loading = "lazy"; i.decoding = "async"; i.referrerPolicy = "no-referrer"; img.append(i); }
    else img.append(el("span", "noimg", "no image"));
    img.append(el("span", "badge tori " + toriKey(it), it.tori ? TORI[it.tori] : "Tori —"), el("span", "badge kind", it.sold ? (it.is_fixed ? "sold" : "ended") : endLabel(it)));
    if (it.taste_score != null) img.append(el("span", "badge taste" + (it.taste_score >= 8 ? " strong" : it.taste_score < 5 ? " low" : ""), "taste " + Number(it.taste_score).toFixed(1)));
    const body = el("div", "body");
    body.append(el("div", "brand", it.brand + (it.garment ? " · " + it.garment : "")));
    const title = link("title", go, it.title); title.lang = "ja"; body.append(title);
    const price = el("div", "price", yen(it.price));
    if (it.buy_now && it.buy_now !== it.price) price.append(el("small", null, "buy now " + yen(it.buy_now)));
    if (it.price_was && it.price_was > (it.price ?? 0)) price.append(el("small", "was", "was " + yen(it.price_was)));
    body.append(price);
    // ~USD all-in: an estimate (fees, EMS by garment weight, ~15% duty), so it always carries "~"
    // and opens to its parts.
    if (it.landed) {
      const L = it.landed, p = L.parts, d = el("details", "landed");
      d.append(el("summary", null, "~$" + L.usd.toLocaleString() + " all-in" + (it.is_fixed ? "" : " (bid)")));
      d.append(el("div", "parts", [`item $${p.item}`, p.domestic ? `to Buyee $${p.domestic}` : "", `Buyee $${p.buyee}`,
        `shipping $${p.shipping} (~${L.kg}kg EMS)`, `duty ~$${p.duty}`].filter(Boolean).join(" · ") + (L.rateFallback ? " · rate offline, estimated" : "")));
      body.append(d);
    }
    const meta = el("div", "meta");
    meta.append(el("span", null, "size " + (it.tag_size || "?")));
    if (it.silhouette && it.silhouette !== "unknown") meta.append(el("span", "sil " + it.silhouette, SIL[it.silhouette]));
    meta.append(el("span", null, it.tier === "fit" ? "in range" : "tag size only"));
    if (it.condition) meta.append(el("span", "cond", it.condition));
    if (SOURCE[it.source]) meta.append(el("span", "srcname", SOURCE[it.source]));
    body.append(meta);
    if (it.capsule) {
      const cap = el("div", "cap " + it.capsule.kind);
      const sw = el("span", "sw " + it.capsule.color); sw.setAttribute("aria-hidden", "true");
      cap.append(sw, el("span", null, it.capsule.text));
      body.append(cap);
      if (it.capsule.pair) body.append(el("div", "pair " + it.capsule.pair.kind, (it.capsule.pair.kind === "new" ? "✦ " : "↔ ") + it.capsule.pair.text));
    }
    if (it.taste_reasons?.length) body.append(el("div", "why", it.taste_reasons.join(" · ")));
    // a miss's summary IS its first reason, so the expanded list starts after it
    const lines = [...new Set(it.fit_lines || [])].slice(it.tori === "miss" ? 1 : 0);
    const v = el("details", "verdict");
    const sum = el("summary");
    sum.append(el("span", "v " + (it.tori || ""), verdictLine(it)));
    if (lines.length > (it.tori === "miss" ? 0 : 1)) sum.append(el("span", "tog"));
    v.append(sum);
    if (lines.length > (it.tori === "miss" ? 0 : 1)) { const ul = el("ul", "fitl"); lines.forEach((l) => ul.append(el("li", null, l))); v.append(ul); }
    else sum.style.cursor = "default";
    body.append(v);
    const foot = el("div", "foot");
    const g = link("go", go); g.append(el("span", "full", "Open on\u00a0"), "Buyee ↗"); foot.append(g);
    if (it.measured) {
      const f = el("button", "fitbtn"); f.type = "button"; f.append(el("span", "ic", "📐 "), "Fit"); f.setAttribute("aria-label", "Compare with your reference garments");
      f.addEventListener("click", () => openFit(it.id, f));
      foot.append(f);
    }
    const s = https(it.source_url); if (s) foot.append(link("src", s, "source"));
    const media = el("div", "media"); media.append(img);
    const sv = el("button", "savebtn"); sv.type = "button";
    sv.textContent = it.saved ? "★" : "☆"; sv.setAttribute("aria-pressed", String(!!it.saved)); sv.setAttribute("aria-label", it.saved ? "Unsave" : "Save");
    sv.disabled = saving.has(it.id);
    sv.addEventListener("click", () => toggleSave(it));
    media.append(sv);
    c.append(media, body, foot);
    return c;
  }

  const ts = (it) => (it.found_at ? Date.parse(it.found_at) : 0);
  const rank = { pass: 2, pending: 1, miss: 0 };
  const capRank = { gap: 4, have: 3, dup: 2, none: 1, off: 0 };
  // Fresh order, fixed for this visit: seen-ness as of opening and one weighted draw per find. Seen
  // marks made while scrolling count from the next open, so nothing jumps under a thumb. The draw is
  // kept for this tab, so coming Back from the fit viewer (a reload when the browser didn't keep the
  // page) restores the same order and scroll instead of reshuffling. A refresh or a new link draws anew.
  let snap = null;
  if (back) try { snap = JSON.parse(sessionStorage.getItem("finds-fresh") || "null"); } catch {}
  // The full list swapping in keeps the draws the first page already made, and Fresh keeps the cards
  // the first page painted on top (pinned) in their order, so nothing he is looking at vanishes. Back
  // reuses the pinned set of the visit it returns to; a new open pins its own first page.
  const pinned = new Set(back && snap?.pinned ? snap.pinned : partial ? data.items.map((it) => it.id) : []);
  let seenAt = new Map(), luck = new Map();
  function adopt(d) {
    data = d; items = d.items;
    items.forEach((it) => { if (touched.has(it.id)) it.saved = touched.get(it.id); });
    seenAt = new Map(items.map((it) => [it.id, seenAt.get(it.id) ?? snap?.seen?.[it.id] ?? ((it.seen_at && Date.parse(it.seen_at)) || 0)]));
    luck = new Map(items.map((it) => [it.id, luck.get(it.id) ?? snap?.luck?.[it.id] ?? Math.random() ** (1 / freshWeight(it))]));
    if (!partial) try { sessionStorage.setItem("finds-fresh", JSON.stringify({ seen: Object.fromEntries(seenAt), luck: Object.fromEntries(luck), pinned: [...pinned] })); } catch {}
    $("gen").textContent = "Live as of " + new Date(d.generated_at).toLocaleString();
  }
  adopt(data);
  const sorters = {
    fresh: (a, b) => {
      const sa = seenAt.get(a.id), sb = seenAt.get(b.id);
      return (sa > 0) - (sb > 0) || pinned.has(b.id) - pinned.has(a.id) || (sa ? sa - sb : luck.get(b.id) - luck.get(a.id));   // new, then longest-ago seen
    },
    newest: (a, b) => ts(b) - ts(a),
    taste: (a, b) => (b.taste_score ?? -1) - (a.taste_score ?? -1) || ts(b) - ts(a),
    fit: (a, b) => rank[toriKey(b)] - rank[toriKey(a)] || (b.taste_score ?? -1) - (a.taste_score ?? -1) || (b.tier === "fit") - (a.tier === "fit") || ts(b) - ts(a),
    price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    capsule: (a, b) => capRank[capKey(b)] - capRank[capKey(a)] || rank[toriKey(b)] - rank[toriKey(a)] || ts(b) - ts(a),
    ending: (a, b) => (a.is_fixed || !a.end_time ? Infinity : Date.parse(a.end_time)) - (b.is_fixed || !b.end_time ? Infinity : Date.parse(b.end_time)),
  };

  // Active filters as removable chips above the grid, and a count on the phone's Filters toggle.
  function activeChips() {
    const box = $("active"); box.replaceChildren();
    let n = 0;
    for (const k of SETS) for (const v of state[k]) {
      n++;
      const b = el("button", "chip", LABELS[k]?.[v] || v); b.type = "button"; b.setAttribute("aria-label", "Remove filter " + (LABELS[k]?.[v] || v));
      b.addEventListener("click", () => { state[k].delete(v); allChips(); render(); });
      box.append(b);
    }
    if (state.combo) {
      n++;
      const b = el("button", "chip", "combo: " + state.combo); b.type = "button";
      b.addEventListener("click", () => { state.combo = ""; render(); });
      box.append(b);
    }
    for (const [k, label] of [["q", () => "“" + state.q.trim() + "”"], ["pmin", () => "≥ " + yen(state.pmin)], ["pmax", () => "≤ " + yen(state.pmax)]]) {
      if (!String(state[k]).trim()) continue;
      n++;
      const b = el("button", "chip", label()); b.type = "button";
      b.addEventListener("click", () => { state[k] = ""; $(k).value = ""; render(); });
      box.append(b);
    }
    box.hidden = !n;
    $("nact").textContent = n ? String(n) : "";
  }

  // Seen = half a card on screen for SEEN_MS. Ordering-only state: a lost batch just means a find
  // shows as new once more.
  const sent = new Set(), queue = new Set(), timers = new Map(), fails = new Map();
  const seenObs = new IntersectionObserver((es) => {
    for (const e of es) {
      const id = e.target.dataset.id;
      if (e.intersectionRatio < 0.49) { clearTimeout(timers.get(id)); timers.delete(id); }
      else if (!timers.has(id) && !sent.has(id) && !queue.has(id)) timers.set(id, setTimeout(() => { timers.delete(id); queue.add(id); }, SEEN_MS));
    }
  }, { threshold: 0.5 });
  const stopTimers = () => { timers.forEach((t) => clearTimeout(t)); timers.clear(); };
  function flushSeen(leaving) {
    while (queue.size) {
      const ids = [...queue].slice(0, 200);
      ids.forEach((id) => { queue.delete(id); sent.add(id); });
      const u = new URL(API); u.searchParams.set("seen", "1");
      const body = JSON.stringify({ ids });
      if (leaving && navigator.sendBeacon?.(u, body)) continue;
      fetch(u, { method: "POST", body, keepalive: leaving, referrerPolicy: "no-referrer" })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
        .catch(() => ids.forEach((id) => {   // three tries, then let it go (an expired link 404s forever)
          const n = (fails.get(id) || 0) + 1; fails.set(id, n);
          if (n < 3) { sent.delete(id); queue.add(id); }
        }));
      if (!leaving) break;   // one batch per tick
    }
  }
  setInterval(() => flushSeen(false), SEEN_FLUSH_MS);
  // Hidden: send what's queued and stop the clocks (a card half-watched before switching away isn't
  // seen). Visible again: re-observe, which re-reports whatever is on screen.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { stopTimers(); flushSeen(true); }
    else { seenObs.disconnect(); $("grid").querySelectorAll("article").forEach((c) => seenObs.observe(c)); }
  });
  addEventListener("pagehide", () => {
    flushSeen(true);
    try { sessionStorage.setItem("finds-pos", JSON.stringify({ y: scrollY, n: shown })); } catch {}
  });

  let rows = [], shown = 0, firstSeen = -1;
  function more() {
    const grid = $("grid");
    const frag = document.createDocumentFragment();
    rows.slice(shown, shown + PAGE).forEach((it, i) => {
      if (shown + i === firstSeen) frag.append(el("div", "seenhr", firstSeen ? "Seen before · oldest first" : "Nothing new here · seen before, oldest first"));
      const c = card(it); frag.append(c); seenObs.observe(c);
    });
    grid.append(frag);
    shown = Math.min(rows.length, shown + PAGE);
  }
  const sentinel = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && shown < rows.length) more(); }, { rootMargin: "1200px 0px" });
  sentinel.observe($("sentinel"));
  // The observer only reports a change, so after a render that leaves the sentinel in range (the swap,
  // a restore) it is re-armed to report where it stands now.
  const rearm = () => { sentinel.unobserve($("sentinel")); sentinel.observe($("sentinel")); };

  // Colour combos from wardrobe.md: wearable today, one find away (tap to see those finds), or
  // further off. Counts follow the current tab, not the other filters.
  function combos() {
    const box = $("combos"); box.replaceChildren();
    const list = data.combos || [];
    box.hidden = !list.length;
    if (!list.length) return;
    box.append(el("span", "lbl", "Combos"));
    const pool = tabItems(state.tab);
    const rows2 = list.map((c) => {
      const finds = partial ? [] : pool.filter((it) => (it.capsule?.combos || []).includes(c.name));
      return { c, n: finds.length, unlock: finds.filter((it) => it.capsule.pair?.kind === "new").length };
    }).sort((a, b) => (b.c.ready - a.c.ready) || (b.unlock - a.unlock) || (b.n - a.n));
    for (const { c, n, unlock } of rows2) {
      const b = el("button", "combo" + (c.ready ? " ready" : partial ? "" : unlock ? " near" : " far")); b.type = "button";
      b.setAttribute("aria-pressed", String(state.combo === c.name));
      const sws = el("span", "sws"); c.colors.forEach((col) => sws.append(el("span", "sw " + col)));
      b.append(sws, el("span", "nm", c.name), el("small", null, partial ? (c.ready ? "wearable" : "") : c.ready ? (n ? n + " that pair" : "wearable") : unlock ? unlock + " to unlock" : "2+ pieces away"));
      b.title = (c.note ? c.note + ". " : "") + (c.pieces.length ? "You own: " + c.pieces.join(", ") : "");
      if (!n && !partial) b.disabled = true;
      b.addEventListener("click", () => { state.combo = state.combo === c.name ? "" : c.name; render(); });
      box.append(b);
    }
  }
  function render() {
    combos();
    const q = state.q.trim().toLowerCase();
    rows = tabItems(state.tab).filter((it) =>
      (!state.tier.size || state.tier.has(it.tier)) &&
      (!state.brand.size || state.brand.has(it.brand)) &&
      (!state.garment.size || state.garment.has(it.garment)) &&
      (!state.kind.size || state.kind.has(it.is_fixed ? "fixed" : "auction")) &&
      (!state.source.size || state.source.has(it.source)) &&
      (!state.silhouette.size || state.silhouette.has(it.silhouette)) &&
      (!state.tori.size || state.tori.has(toriKey(it))) &&
      (!state.capsule.size || state.capsule.has(capKey(it))) &&
      (!state.combo || (it.capsule?.combos || []).includes(state.combo)) &&
      (state.pmin === "" || (it.price ?? 0) >= +state.pmin) && (state.pmax === "" || (it.price ?? 0) <= +state.pmax) &&
      (!q || [it.title, it.brand, it.tag_size, it.condition, it.capsule?.text, ...(it.fit_lines || [])].join(" ").toLowerCase().includes(q)));
    // Saved is a short list he comes back to: a steady Tori ✓ order there, not a rotation.
    const sort = state.sort === "fresh" && state.tab === "saved" ? "fit" : state.sort;
    rows.sort(sorters[sort] || sorters.fresh);
    firstSeen = sort === "fresh" ? rows.findIndex((it) => seenAt.get(it.id) > 0) : -1;
    seenObs.disconnect(); stopTimers();
    const grid = $("grid"); grid.replaceChildren(); shown = 0;
    if (!rows.length) {
      grid.append(el("div", "empty", partial ? "Nothing here in the first 48. The rest is still loading." : state.tab === "saved" ? "Nothing saved yet. Tap ☆ on a listing, or Save on a Telegram card."
        : state.tab === "discover" ? "No discoveries yet." : "Nothing matches these filters."));
    }
    more();
    $("count").textContent = partial ? data.counts.total + " listings · " + data.counts.new + " new"
      : rows.length + " / " + tabItems(state.tab).length + " listings · " + rows.filter((it) => !seenAt.get(it.id)).length + " new";
    $("show").textContent = partial ? "Show results" : "Show " + rows.length + " result" + (rows.length === 1 ? "" : "s");
    $("loadrest").hidden = !partial || restFailed;
    activeChips();
    try { localStorage.setItem("finds-state", JSON.stringify({ v: 2, tab: state.tab, q: state.q, sort: state.sort, pmin: state.pmin, pmax: state.pmax, ...Object.fromEntries(SETS.map((k) => [k, [...state[k]]])) })); } catch {}
  }
  // Coming Back: reopen as far down as he was. Runs at the full list's render, which is what he was scrolling.
  function restore() {
    if (!back) return;
    try {
      const pos = JSON.parse(sessionStorage.getItem("finds-pos") || "null");
      while (pos && shown < Math.min(pos.n, rows.length)) more();
      if (pos?.y) scrollTo(0, pos.y);
    } catch {}
  }
  render();
  restore();
  rearm();
  // The full list lands: same controls, same scroll, new items. Seen state (sent, queue) lives on.
  return (d) => {
    const y = scrollY;
    partial = false;
    adopt(d); tabs(); allChips(); render();
    if (scrollY !== y) scrollTo(0, y);
    rearm();
    $("partial").hidden = true;
  };
}

// Back's scroll is the page's own (restore), so the browser must not move him first.
history.scrollRestoration = "manual";
main();
