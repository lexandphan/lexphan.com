// One gesture engine for every deck (the committed mockup's, docs/superpowers/mockups/2026-10-23-tori-deck-mockup.html):
// direction lock, flick velocity, tap passthrough; then the deck — a front card over a waiting one, dragged with
// stamps, thrown off, the next one rising. The Dream deck (slice 2) reuses this file unchanged.
import { haptic, wait } from "./ui.js";

function gesture(el, h) {
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, state = 0, id = null;   // 0 pending, 1 ours, -1 the page's (vertical)
  el.addEventListener("pointerdown", (e) => { if (e.button) return; x0 = e.clientX; y0 = e.clientY; t0 = e.timeStamp; dx = 0; state = 0; id = e.pointerId; });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id || state === -1) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (state === 0) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      state = Math.abs(mx) > Math.abs(my) ? 1 : -1;
      if (state !== 1) return;
      try { el.setPointerCapture(id); } catch { /* already captured */ }
      h.start();
    }
    dx = mx; h.move(dx);
  });
  const end = (e) => { if (e.pointerId !== id) return; const was = state; const v = dx / Math.max(1, e.timeStamp - t0); id = null; state = 0; if (was === 1) h.end(dx, v); };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  el.addEventListener("click", (e) => { if (Math.abs(dx) > 8) { e.stopPropagation(); e.preventDefault(); dx = 0; } }, true);
}

export function deckBehaviour(deck, opts) {
  const card = deck.querySelector(".card.front"), behind = deck.querySelector(".card.behind");
  const sl = card.querySelector(".stamp.l"), sr = card.querySelector(".stamp.r");
  let busy = false;
  gesture(deck, {
    start() { card.classList.remove("anim"); if (behind) behind.classList.remove("anim"); },
    move(dx) {
      if (busy) return;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 16}deg)`;
      const k = Math.min(1, Math.abs(dx) / 70);
      if (sl) sl.style.opacity = dx < 0 ? k : 0;
      if (sr) sr.style.opacity = dx > 0 ? k : 0;
      if (behind) { const g = Math.min(1, Math.abs(dx) / 140); behind.style.transform = `translateY(${10 - 10 * g}px) scale(${0.96 + 0.04 * g})`; behind.style.opacity = 0.6 + 0.4 * g; }
      if (opts.onDrag) opts.onDrag(dx);
    },
    end(dx, v) {
      card.classList.add("anim"); if (behind) behind.classList.add("anim");
      if (busy) return;
      if (Math.abs(dx) >= 60 || Math.abs(v) >= 0.5) throwCard(dx > 0 ? 1 : -1);
      else {
        card.style.transform = "";
        if (sl) sl.style.opacity = 0; if (sr) sr.style.opacity = 0;
        if (behind) { behind.style.transform = ""; behind.style.opacity = ""; }
        if (opts.onDrag) opts.onDrag(0);
      }
    },
  });
  async function throwCard(dir) {
    if (busy) return;
    busy = true; haptic("medium");
    if (opts.onCommit) opts.onCommit(dir);   // before the behind card rises: the caller can draw the card that comes next into it
    card.classList.add("anim"); if (behind) behind.classList.add("anim");
    if (sl) sl.style.opacity = dir < 0 ? 1 : 0;
    if (sr) sr.style.opacity = dir > 0 ? 1 : 0;
    card.style.transform = `translateX(${dir * 125}%) rotate(${dir * 18}deg)`; card.style.opacity = "0";
    if (behind) { behind.style.transform = "none"; behind.style.opacity = "1"; }
    await wait(260);
    busy = false;
    opts.onThrow(dir);
  }
  return { throwCard };
}
