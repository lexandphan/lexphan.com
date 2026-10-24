// Small shared pieces: escaping, numbers in Areal's mono axis, the toast, haptics (Telegram only), theme, focus.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const num = (n) => n == null ? "" : `<span class="num">${Number(n).toFixed(1)}</span>`;
export const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

const tg = () => (window.Telegram && window.Telegram.WebApp) || null;
const has = (v) => { try { return !!tg() && tg().isVersionAtLeast(v); } catch { return false; } };
export function haptic(style) { try { if (has("6.1")) tg().HapticFeedback.impactOccurred(style || "light"); } catch { /* not inside Telegram */ } }
export function hapticNote(type) { try { if (has("6.1")) tg().HapticFeedback.notificationOccurred(type || "success"); } catch { /* not inside Telegram */ } }

let toastTimer;
export function toast(text) {
  const el = $("toast");
  el.textContent = text; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 1500);
}

// Every answer re-renders the screen, which would drop keyboard focus on <body>: put it back on the same control.
let lastAct = null;
export function remember(act) { lastAct = act; }
export function refocus(root) {
  if (!lastAct) return;
  const el = root.querySelector(`[data-act="${lastAct}"]`);
  lastAct = null;
  if (el) el.focus({ preventScroll: true });
}

/** "light" | "dark" pins the theme (Telegram's), anything else lets prefers-color-scheme decide. */
export function setTheme(scheme) {
  const r = document.documentElement;
  if (scheme === "dark" || scheme === "light") r.dataset.theme = scheme; else delete r.dataset.theme;
}
