const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const https = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const yen = (n) => (n == null ? "" : "¥" + Number(n).toLocaleString("ja-JP"));
const SOURCE = { yahoo: "Yahoo Auctions", flea: "PayPay Flea", mercari: "Mercari" };
const TABS = { brands: "My brands", discover: "Discover", saved: "Saved" };
const SETS = ["tier", "brand", "garment", "kind", "source", "silhouette", "tori"];
const SIL = { slim: "Slim", regular: "Regular", roomy: "Roomy", unknown: "Unknown" };
const TORI = { pass: "Tori ✓", miss: "Tori ✗", pending: "Not checked" };
const toriKey = (it) => it.tori || "pending";

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

async function main() {
  const url = dataUrl();
  if (!url || !(await hostOk(new URL(url).hostname))) return fail("This link is incomplete. Send Tori \"finds\" for a fresh one.");
  let data;
  try {
    const res = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!res.ok) return fail("This link has expired. Send Tori \"finds\" and she'll send a fresh one.");
    data = await res.json();
  } catch { return fail("Couldn't reach your finds. Check your connection and reload."); }
  if (!Array.isArray(data?.items)) return fail("Something's off with this link. Send Tori \"finds\" for a fresh one.");
  $("state").hidden = true; $("wrap").hidden = false;
  if (matchMedia("(min-width: 761px)").matches) $("filters").open = true;
  run(data);
}

const PAGE = 48;
const BRANDS_SHOWN = 10;
// Phone layout: "l2" two compact columns, "l1" one column. Overridable for previews.
function layout() {
  let l = "l2";
  try { const v = localStorage.getItem("finds-layout"); if (v === "l1" || v === "l2") l = v; } catch {}
  document.body.classList.add(l);
}

function run(data) {
  layout();
  const items = data.items;
  const state = { tab: "brands", q: "", sort: "fit", pmin: "", pmax: "", allBrands: false };
  SETS.forEach((k) => (state[k] = new Set()));
  try {
    const s = JSON.parse(localStorage.getItem("finds-state") || "{}");
    for (const k of ["tab", "q", "sort", "pmin", "pmax"]) if (typeof s[k] === "string") state[k] = s[k];
    for (const k of SETS) if (Array.isArray(s[k])) state[k] = new Set(s[k]);
  } catch {}
  if (!TABS[state.tab]) state.tab = "brands";
  if (!$("sort").querySelector(`option[value="${state.sort}"]`)) state.sort = "fit";

  const tabItems = (tab) => tab === "saved" ? items.filter((it) => it.saved) : items.filter((it) => (tab === "discover") === !!it.discover);
  const LABELS = { tier: { fit: "In range", maybe: "Tag size only" }, garment: { tops: "Tops / outerwear", bottoms: "Bottoms" },
    kind: { fixed: "Buy now", auction: "Auction" }, source: SOURCE, silhouette: SIL, tori: TORI, brand: null };

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
    for (const b of [...state.brand]) if (!counts[b]) state.brand.delete(b);
    const all = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    // picked brands always stay visible, even when the list is folded
    const shown = state.allBrands ? all : [...new Set([...all.slice(0, BRANDS_SHOWN), ...all.filter((b) => state.brand.has(b))])];
    chips("brand", shown, "brand");
    const more = $("brandmore");
    more.hidden = all.length <= BRANDS_SHOWN;
    more.textContent = state.allBrands ? "Fewer brands" : `All ${all.length} brands`;
  }
  $("brandmore").addEventListener("click", () => { state.allBrands = !state.allBrands; brandChips(); });
  function tabs() {
    const box = $("tabs"); box.replaceChildren();
    Object.keys(TABS).forEach((t) => {
      const b = el("button", "tab", TABS[t]); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(state.tab === t));
      b.append(el("span", "n", String(tabItems(t).length)));
      b.addEventListener("click", () => { state.tab = t; state.brand.clear(); tabs(); brandChips(); render(); });
      box.append(b);
    });
  }
  function allChips() {
    chips("tori", ["pass", "miss", "pending"], "tori");
    chips("silhouette", ["slim", "regular", "roomy", "unknown"], "silhouette");
    chips("garment", ["tops", "bottoms"], "garment");
    chips("tier", ["fit", "maybe"], "tier");
    chips("kind", ["fixed", "auction"], "kind");
    chips("source", ["yahoo", "flea", "mercari"].filter((s) => items.some((i) => i.source === s)), "source");
    brandChips();
  }
  tabs(); allChips();
  $("q").value = state.q; $("sort").value = state.sort; $("pmin").value = state.pmin; $("pmax").value = state.pmax;
  $("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("pmin").addEventListener("input", (e) => { state.pmin = e.target.value; render(); });
  $("pmax").addEventListener("input", (e) => { state.pmax = e.target.value; render(); });
  $("reset").addEventListener("click", () => {
    state.q = state.pmin = state.pmax = ""; SETS.forEach((k) => state[k].clear());
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
    if (it.tori === "pass") { const ref = lines.find((l) => /^vs your /i.test(l)); return ref ? "Sits like your " + ref.replace(/^vs your /i, "").replace(/\s*\(.*$/, "").replace(/:$/, "") : "Sits like your references"; }
    if (it.tori === "miss") return lines[0] || "Doesn't match your references";
    return lines[0] === "no measurements" || !it.fit_lines?.length ? "No measurements to check" : "Not checked yet";
  }
  function link(cls, href, text) {
    const a = el("a", cls, text); a.target = "_blank"; a.rel = "noopener noreferrer";
    if (href) a.href = href;
    return a;
  }
  function card(it) {
    const c = el("article", "card" + (it.saved ? " saved" : ""));
    const go = https(it.buyee_url);
    const img = link("img", go); img.setAttribute("aria-label", it.title);
    const src = https(it.image_url);
    if (src) { const i = el("img"); i.src = src; i.alt = ""; i.loading = "lazy"; i.decoding = "async"; i.referrerPolicy = "no-referrer"; img.append(i); }
    else img.append(el("span", "noimg", "no image"));
    img.append(el("span", "badge tori " + toriKey(it), it.tori ? TORI[it.tori] : "Tori —"), el("span", "badge kind", endLabel(it)));
    if (it.taste_score != null) img.append(el("span", "badge taste" + (it.taste_score >= 8 ? " strong" : it.taste_score < 5 ? " low" : ""), "taste " + Number(it.taste_score).toFixed(1)));
    const body = el("div", "body");
    body.append(el("div", "brand", it.brand + (it.garment ? " · " + it.garment : "")));
    const title = link("title", go, it.title); title.lang = "ja"; body.append(title);
    const price = el("div", "price", yen(it.price));
    if (it.buy_now && it.buy_now !== it.price) price.append(el("small", null, "buy now " + yen(it.buy_now)));
    body.append(price);
    const meta = el("div", "meta");
    meta.append(el("span", null, "size " + (it.tag_size || "?")));
    if (it.silhouette && it.silhouette !== "unknown") meta.append(el("span", "sil " + it.silhouette, SIL[it.silhouette]));
    meta.append(el("span", null, it.tier === "fit" ? "in range" : "tag size only"));
    if (it.condition) meta.append(el("span", "cond", it.condition));
    if (SOURCE[it.source]) meta.append(el("span", "srcname", SOURCE[it.source]));
    body.append(meta);
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
    if (it.saved) foot.append(el("span", "on", "Saved"));
    const s = https(it.source_url); if (s) foot.append(link("src", s, "source"));
    c.append(img, body, foot);
    return c;
  }

  const ts = (it) => (it.found_at ? Date.parse(it.found_at) : 0);
  const rank = { pass: 2, pending: 1, miss: 0 };
  const sorters = {
    newest: (a, b) => ts(b) - ts(a),
    taste: (a, b) => (b.taste_score ?? -1) - (a.taste_score ?? -1) || ts(b) - ts(a),
    fit: (a, b) => rank[toriKey(b)] - rank[toriKey(a)] || (b.taste_score ?? -1) - (a.taste_score ?? -1) || (b.tier === "fit") - (a.tier === "fit") || ts(b) - ts(a),
    price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
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

  let rows = [], shown = 0;
  function more() {
    const grid = $("grid");
    const frag = document.createDocumentFragment();
    rows.slice(shown, shown + PAGE).forEach((it) => frag.append(card(it)));
    grid.append(frag);
    shown = Math.min(rows.length, shown + PAGE);
  }
  new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && shown < rows.length) more(); }, { rootMargin: "1200px 0px" }).observe($("sentinel"));

  function render() {
    const q = state.q.trim().toLowerCase();
    rows = tabItems(state.tab).filter((it) =>
      (!state.tier.size || state.tier.has(it.tier)) &&
      (!state.brand.size || state.brand.has(it.brand)) &&
      (!state.garment.size || state.garment.has(it.garment)) &&
      (!state.kind.size || state.kind.has(it.is_fixed ? "fixed" : "auction")) &&
      (!state.source.size || state.source.has(it.source)) &&
      (!state.silhouette.size || state.silhouette.has(it.silhouette)) &&
      (!state.tori.size || state.tori.has(toriKey(it))) &&
      (state.pmin === "" || (it.price ?? 0) >= +state.pmin) && (state.pmax === "" || (it.price ?? 0) <= +state.pmax) &&
      (!q || [it.title, it.brand, it.tag_size, it.condition, ...(it.fit_lines || [])].join(" ").toLowerCase().includes(q)));
    rows.sort(sorters[state.sort] || sorters.fit);
    const grid = $("grid"); grid.replaceChildren(); shown = 0;
    if (!rows.length) {
      grid.append(el("div", "empty", state.tab === "saved" ? "Nothing saved yet. Tap Save on a Telegram card and it collects here."
        : state.tab === "discover" ? "No discoveries yet." : "Nothing matches these filters."));
    }
    more();
    $("count").textContent = rows.length + " / " + tabItems(state.tab).length + " listings";
    $("show").textContent = "Show " + rows.length + " result" + (rows.length === 1 ? "" : "s");
    activeChips();
    try { localStorage.setItem("finds-state", JSON.stringify({ tab: state.tab, q: state.q, sort: state.sort, pmin: state.pmin, pmax: state.pmax, ...Object.fromEntries(SETS.map((k) => [k, [...state[k]]])) })); } catch {}
  }
  $("gen").textContent = "Live as of " + new Date(data.generated_at).toLocaleString();
  render();
}

main();
