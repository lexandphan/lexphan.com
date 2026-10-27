// Boot: Mini App (Telegram's init data as the header; no local state — Telegram's in-app storage is unreliable) or
// PWA (the signed link from `#l=`, stashed in localStorage because a home-screen app's storage is separate from
// Safari's). `?s=<id>` opens straight into that session; otherwise the home view. Nothing renders without auth.
import { $, toast, setTheme } from "./ui.js";
import { api, apiUrl, call, Gone } from "./api.js";
import { renderRank } from "./rank.js?v=20261027";
import { renderLists } from "./lists.js";

/** Areal (Dinamo's free Are.na face) loads from the project's public-read `fonts` bucket, on the host the API lives on.
 *  What stays out of this public repo is the font file and the project host. Until it loads the system stack stands in. */
async function loadAreal(host) {
  try {
    if (!("FontFace" in window)) return;
    const f = new FontFace("ABC Areal", `url(https://${host}/storage/v1/object/public/fonts/areal.woff2) format("woff2")`, { weight: "400 700", display: "swap" });
    document.fonts.add(f);
    await f.load();
  } catch { /* the system stack stays */ }
}

const STASH = "tori-link";
const DIR = "/ce40a07247fbae/";
const tg = (window.Telegram && window.Telegram.WebApp) || null;
const mini = Boolean(tg && tg.initData);

/** Launch params from the query (`?s=&a=`, the bucket card's button) and the fragment (`#l=`, the app link).
 *  Telegram's own `#tgWebAppData=…&tgWebAppVersion=…` lives in the fragment too; it is parsed past and ignored. */
export function launchParams(search, hash) {
  const out = {};
  for (const raw of [String(hash || "").replace(/^#/, ""), String(search || "").replace(/^\?/, "")]) {
    for (const part of raw.split("&")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      try { out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1)); } catch { /* a malformed pair is skipped */ }
    }
  }
  return out;
}

export const app = {
  state: { screen: "rank", home: null, session: null, last: null, highlight: null, listTab: null, kind: null, q: "", city: null },
  show, loadHome, open, start, fail, needLink,
};

function fail(msg) { $("state").textContent = msg; $("state").hidden = false; $("screen").hidden = true; $("tabs").hidden = true; }
function needLink() {
  fail(mini ? "Open me from Tori's button again — this view has expired." : 'This link has expired or is incomplete. Send Tori "app" for a fresh one.');
}
function show(screen) {
  app.state.screen = screen;
  for (const b of $("tabs").querySelectorAll("button")) b.setAttribute("aria-selected", b.dataset.screen === screen ? "true" : "false");
  $("state").hidden = true; $("screen").hidden = false; $("tabs").hidden = false;
  if (screen === "lists") renderLists(app); else renderRank(app);
}
let homeAt = 0;   // when the home last loaded: a resumed app refreshes it once it is a minute old
async function loadHome(city) {
  try { app.state.home = await call("GET", { view: "home", city: city ?? app.state.city }); homeAt = Date.now(); return app.state.home; }
  catch (e) { if (e instanceof Gone) needLink(); else toast("Couldn't reach Tori. Check your connection."); return null; }
}
/** A session's current View: a `?s=` launch, a reload, or where a 409 says it really is. */
async function open(id) {
  try { app.state.session = await call("GET", { session: id }); app.state.last = null; show("rank"); }
  catch (e) { if (e instanceof Gone) needLink(); else toast("Couldn't reach Tori. Check your connection."); }
}
/** Start a rating: `{ query, domain }` from the add box, `{ domain, item, year, city }` from a list. */
async function start(body) {
  try { app.state.session = await call("POST", { op: "start" }, body); app.state.last = null; show("rank"); }
  catch (e) { if (e instanceof Gone) needLink(); else toast("Couldn't start that rating. Try again."); }
}

/** The Mini App frame takes the paper colour so the deck sits on one surface (hex colours need Bot API 6.9). */
function paintFrame() {
  try {
    if (!tg.isVersionAtLeast("6.9")) return;
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#F4F1EA";
    tg.setHeaderColor(paper); tg.setBackgroundColor(paper);
  } catch { /* an older client */ }
}

async function boot() {
  const p = launchParams(location.search, location.hash);
  if (mini) {
    try { tg.ready(); tg.expand(); if (tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes(); } catch { /* an older client */ }
    setTheme(tg.colorScheme);
    try { tg.onEvent("themeChanged", () => { setTheme(tg.colorScheme); paintFrame(); }); } catch { /* an older client */ }
    paintFrame();
    const base = p.a ? await apiUrl(p.a) : null;
    if (!base) return needLink();
    api.base = base; api.initData = tg.initData;
    loadAreal(base.hostname);
  } else {
    let raw = p.l || null;
    if (raw) { try { localStorage.setItem(STASH, raw); } catch { /* private mode: the link lives for this open only */ } }
    else { try { raw = localStorage.getItem(STASH); } catch { /* same */ } }
    const base = raw ? await apiUrl(raw) : null;
    if (!base) return needLink();
    api.base = base;
    loadAreal(base.hostname);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${DIR}sw.js`).catch(() => {});
  }
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-screen]"); if (b) show(b.dataset.screen); });
  // A home-screen app resumed by iOS, or a Mini App restored after minimizing, would otherwise show the ladders it opened with.
  // Reload them on return; redraw the queue or Lists with them, never an open deck.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !app.state.home || Date.now() - homeAt < 60_000) return;
    loadHome().then((h) => { if (h && (app.state.screen === "lists" || !app.state.session)) show(app.state.screen); });
  });
  if (p.s && /^[0-9a-f-]{36}$/i.test(p.s)) { await open(p.s); if (app.state.session && !app.state.home) loadHome(); }
  else if (await loadHome()) show("rank");
  // a first load that failed without a 404 (a blip, a 5xx) only toasted: never leave "Opening…" up (a PWA has no reload)
  if ($("screen").hidden && $("state").textContent === "Opening…") fail("Couldn't reach Tori. Check your connection, then open me again.");
}
boot();
