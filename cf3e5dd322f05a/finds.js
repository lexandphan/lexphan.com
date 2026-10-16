const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const https = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const yen = (n) => (n == null ? "" : "¥" + Number(n).toLocaleString("ja-JP"));
const SOURCE = { yahoo: "Yahoo Auctions", flea: "PayPay Flea", mercari: "Mercari" };
const TABS = { brands: "My brands", discover: "Discover", saved: "Saved" };
const SETS = ["tier", "brand", "garment", "kind", "source"];

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

function run(data) {
  const items = data.items;
  const state = { tab: "brands", q: "", sort: "newest", pmin: "", pmax: "" };
  SETS.forEach((k) => (state[k] = new Set()));
  try {
    const s = JSON.parse(localStorage.getItem("finds-state") || "{}");
    for (const k of ["tab", "q", "sort", "pmin", "pmax"]) if (typeof s[k] === "string") state[k] = s[k];
    for (const k of SETS) if (Array.isArray(s[k])) state[k] = new Set(s[k]);
  } catch {}
  if (!TABS[state.tab]) state.tab = "brands";

  const tabItems = (tab) => tab === "saved" ? items.filter((it) => it.saved) : items.filter((it) => (tab === "discover") === !!it.discover);

  function chips(id, values, key, labels) {
    const box = $(id); box.replaceChildren();
    values.forEach((v) => {
      const b = el("button", "chip", labels ? labels[v] || v : v); b.type = "button";
      b.setAttribute("aria-pressed", String(state[key].has(v)));
      b.addEventListener("click", () => { state[key].has(v) ? state[key].delete(v) : state[key].add(v); b.setAttribute("aria-pressed", String(state[key].has(v))); render(); });
      box.append(b);
    });
  }
  function brandChips() {
    const counts = {};
    tabItems(state.tab).forEach((it) => (counts[it.brand] = (counts[it.brand] || 0) + 1));
    for (const b of [...state.brand]) if (!counts[b]) state.brand.delete(b);
    chips("brand", Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).slice(0, 30), "brand");
  }
  function tabs() {
    const box = $("tabs"); box.replaceChildren();
    Object.keys(TABS).forEach((t) => {
      const b = el("button", "tab", TABS[t]); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(state.tab === t));
      b.append(el("span", "n", String(tabItems(t).length)));
      b.addEventListener("click", () => { state.tab = t; state.brand.clear(); tabs(); brandChips(); render(); });
      box.append(b);
    });
  }
  chips("tier", ["fit", "maybe"], "tier", { fit: "Fit", maybe: "Maybe" });
  chips("garment", ["tops", "bottoms"], "garment", { tops: "Tops / outerwear", bottoms: "Bottoms" });
  chips("kind", ["fixed", "auction"], "kind", { fixed: "Buy now", auction: "Auction" });
  chips("source", ["yahoo", "flea", "mercari"].filter((s) => items.some((i) => i.source === s)), "source", SOURCE);
  tabs(); brandChips();
  $("q").value = state.q; $("sort").value = state.sort; $("pmin").value = state.pmin; $("pmax").value = state.pmax;
  $("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("pmin").addEventListener("input", (e) => { state.pmin = e.target.value; render(); });
  $("pmax").addEventListener("input", (e) => { state.pmax = e.target.value; render(); });
  $("reset").addEventListener("click", () => {
    state.q = state.pmin = state.pmax = ""; SETS.forEach((k) => state[k].clear());
    $("q").value = $("pmin").value = $("pmax").value = "";
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false")); render();
  });

  function endLabel(it) {
    if (it.is_fixed || !it.end_time) return "buy now";
    const ms = new Date(it.end_time) - Date.now(); if (ms < 0) return "ended";
    const h = Math.round(ms / 36e5); return h < 48 ? "ends in " + h + "h" : "ends in " + Math.round(h / 24) + "d";
  }
  function card(it) {
    const a = el("a", "card" + (it.saved ? " saved" : ""));
    const go = https(it.buyee_url); if (go) a.href = go;
    a.target = "_blank"; a.rel = "noopener noreferrer";
    const img = el("div", "img");
    const src = https(it.image_url);
    if (src) { const i = el("img"); i.src = src; i.alt = ""; i.loading = "lazy"; i.referrerPolicy = "no-referrer"; img.append(i); }
    else img.append(el("span", "noimg", "no image"));
    img.append(el("span", "tier " + it.tier, it.tier), el("span", "kind", endLabel(it)));
    if (it.taste_score != null) {
      const t = el("span", "taste" + (it.taste_score >= 8 ? " strong" : it.taste_score < 5 ? " low" : ""), "taste " + Number(it.taste_score).toFixed(1));
      img.append(t);
    }
    const body = el("div", "body");
    body.append(el("div", "brand", it.brand + (it.garment ? " · " + it.garment : "")));
    const title = el("div", "title", it.title); title.lang = "ja"; body.append(title);
    const price = el("div", "price", yen(it.price));
    if (it.buy_now && it.buy_now !== it.price) price.append(el("small", null, "buy now " + yen(it.buy_now)));
    body.append(price);
    const meta = el("div", "meta");
    [it.condition, "size " + (it.tag_size || "?"), SOURCE[it.source]].filter(Boolean).forEach((m) => meta.append(el("span", null, m)));
    body.append(meta);
    if (it.taste_reasons?.length) body.append(el("div", "why", it.taste_reasons.join(" · ")));
    if (it.fit_lines?.length) { const ul = el("ul", "fitl"); it.fit_lines.forEach((l) => ul.append(el("li", null, l))); body.append(ul); }
    const foot = el("div", "foot"); foot.append(el("span", "go", "Open on Buyee ↗"));
    const acts = el("span", "acts");
    if (it.saved) acts.append(el("span", "on", "Saved"));
    const s = https(it.source_url);
    if (s) {
      const l = el("a", "src", "source"); l.href = s; l.target = "_blank"; l.rel = "noopener noreferrer";
      l.addEventListener("click", (e) => e.stopPropagation()); acts.append(l);
    }
    foot.append(acts); body.append(foot);
    a.append(img, body);
    return a;
  }

  const ts = (it) => (it.found_at ? Date.parse(it.found_at) : 0);
  const sorters = {
    newest: (a, b) => ts(b) - ts(a),
    taste: (a, b) => (b.taste_score ?? -1) - (a.taste_score ?? -1) || ts(b) - ts(a),
    fit: (a, b) => (b.tier === "fit") - (a.tier === "fit") || (b.taste_score ?? -1) - (a.taste_score ?? -1),
    price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    ending: (a, b) => (a.is_fixed || !a.end_time ? Infinity : Date.parse(a.end_time)) - (b.is_fixed || !b.end_time ? Infinity : Date.parse(b.end_time)),
  };

  function render() {
    const q = state.q.trim().toLowerCase();
    const rows = tabItems(state.tab).filter((it) =>
      (!state.tier.size || state.tier.has(it.tier)) &&
      (!state.brand.size || state.brand.has(it.brand)) &&
      (!state.garment.size || state.garment.has(it.garment)) &&
      (!state.kind.size || state.kind.has(it.is_fixed ? "fixed" : "auction")) &&
      (!state.source.size || state.source.has(it.source)) &&
      (state.pmin === "" || (it.price ?? 0) >= +state.pmin) && (state.pmax === "" || (it.price ?? 0) <= +state.pmax) &&
      (!q || [it.title, it.brand, it.tag_size, it.condition, ...(it.fit_lines || [])].join(" ").toLowerCase().includes(q)));
    rows.sort(sorters[state.sort] || sorters.newest);
    const grid = $("grid"); grid.replaceChildren();
    if (!rows.length) {
      grid.append(el("div", "empty", state.tab === "saved" ? "Nothing saved yet. Tap Save on a Telegram card and it collects here."
        : state.tab === "discover" ? "No discoveries yet." : "Nothing matches these filters."));
    }
    rows.forEach((it) => grid.append(card(it)));
    $("count").textContent = rows.length + " / " + tabItems(state.tab).length + " listings";
    try { localStorage.setItem("finds-state", JSON.stringify({ tab: state.tab, q: state.q, sort: state.sort, pmin: state.pmin, pmax: state.pmax, ...Object.fromEntries(SETS.map((k) => [k, [...state[k]]])) })); } catch {}
  }
  $("gen").textContent = "Live as of " + new Date(data.generated_at).toLocaleString();
  render();
}

main();
