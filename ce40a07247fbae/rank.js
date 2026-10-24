// The Rank screen: the queue grouped by ladder with a "Rank something" box, then the session's Views — bucket,
// the thrown-card deck (deck.js), ask-kind / ask-city, the confirm sheet, filed. Every answer is one POST with the
// step the View came from; a 409 swaps in where the session really is. Skip on a queued entry drops it from the
// queue (it stays under Unranked in Lists); Skip on a re-rate just abandons it. Nothing is written before Save.
import { $, esc, num, toast, haptic, hapticNote, remember, refocus } from "./ui.js";
import { call, Gone } from "./api.js";
import { deckBehaviour } from "./deck.js";

const BUCKETS = [["loved", "🔥 Loved it"], ["solid", "👍 Solid"], ["meh", "😐 Meh"]];
const screen = () => $("screen");
const meta = (parts) => parts.filter((p) => p != null && p !== "").map((p) => (typeof p === "number" ? `<span class="num">${p}</span>` : esc(p))).join(" · ");
const pinned = (v) => `<div class="pinned"><span class="name">${esc(v.item.name)}</span><span class="meta">${meta([v.item.year, v.item.kind])}</span></div>`;
function bind(app, handlers) {
  screen().querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => { remember(b.dataset.act); handlers(b.dataset.act, b); }));
  refocus(screen());
}

/** What has been typed on the confirm sheet, for one session: a re-render of the same session (a Lists round trip, a Save that
 *  couldn't reach Tori, a ▲/▼) puts it back. Dropped when the session ends (filed, skipped); another session starts empty. */
let draft = null;

/** One transition. `after(view)` runs before the re-render (the deck keeps the beaten opponent's score there). */
async function op(app, name, body, after) {
  const v = app.state.session;
  if (!v || v.busy) return;
  v.busy = true;
  try {
    const r = await call("POST", { op: name }, { id: v.id, step: v.step, ...body });
    if (r.stale) { app.state.session = r.view; app.state.last = null; toast("That card had moved on — here's where it is"); renderRank(app); return; }
    app.state.session = r;
    if (after) after(r);
    renderRank(app);
  } catch (e) {
    v.busy = false;
    if (e instanceof Gone) return app.needLink();
    toast("Couldn't reach Tori. Try again.");
    renderRank(app);   // the card comes back (a thrown one would otherwise leave a blank deck)
  }
}

export function renderRank(app) {
  const v = app.state.session;
  if (!v) return renderQueue(app);
  switch (v.kind) {
    case "bucket": return renderBucket(app, v);
    case "ask-kind": return renderAskKind(app, v);
    case "ask-city": return renderAskCity(app, v);
    case "question": return renderQuestion(app, v);
    case "confirm": return renderConfirm(app, v);
    case "filed": return renderFiled(app, v);
    case "file-failed": return renderFailed(app, v);
    case "filing": return renderFiling(app, v);
    case "unreadable": return renderUnreadable(app, v);
    case "ambiguous": return renderAmbiguous(app, v);
    case "skipped": {
      // the server's home cache can keep a skipped entry in its queue for up to 60 s: drop it here at once (home is null on a `?s=` launch until it loads)
      const d = app.state.home && app.state.home.domains.find((x) => x.id === v.domain);
      if (d) d.queue = d.queue.filter((e) => e.name !== v.item.name);
      app.state.session = null; draft = null; toast("Skipped — nothing written"); return renderQueue(app);
    }
    case "no-city": app.state.session = null; toast(`No city note called ${v.city}`); return renderQueue(app);
    default: app.state.session = null; toast("That rating is gone"); return renderQueue(app);
  }
}

// ---------- the queue + "Rank something" ----------
function renderQueue(app) {
  const home = app.state.home;
  if (!home) {
    screen().innerHTML = `<p class="hint">Loading your ladders…</p>`;
    // `h` null: this load failed and said so, but a concurrent one (boot's, on a `?s=` launch) may have filled the home.
    // Never a loop: only a null home reloads, and the failure line waits for a tap.
    app.loadHome().then((h) => {
      if (app.state.screen !== "rank" || app.state.session) return;
      if (h || app.state.home) renderQueue(app);
      else screen().innerHTML = `<p class="hint">Couldn't load your ladders. Tap Rank to try again.</p>`;
    });
    return;
  }
  const chips = [["detect", "Detect"], ...home.domains.map((d) => [d.id, d.label])];
  const groups = home.domains.map((d) => {
    if (d.unreadable) return `<section class="group"><h2>${esc(d.label)}</h2><p class="hint left">Couldn't read this note just now.</p></section>`;
    if (!d.queue.length) return "";
    const rows = d.queue.map((e) => `<li><span class="t">${esc(e.name)} <span class="meta">${meta([e.year, e.kind || e.legacy])}</span></span>
      <button class="pill small" data-act="rank" data-domain="${esc(d.id)}" data-name="${esc(e.name)}" data-year="${e.year ?? ""}" data-city="${esc(d.city ?? "")}">Rank</button></li>`).join("");
    return `<section class="group"><h2>${esc(d.label)} <span class="meta num">${d.queue.length}</span></h2><ul class="list queue">${rows}</ul></section>`;
  }).join("");
  const empty = home.domains.every((d) => !d.unreadable && !d.queue.length);   // an unreadable note is never hidden behind "Nothing waiting"
  screen().innerHTML = `
    <form class="add" id="add">
      <input id="q" class="field" type="search" placeholder="Rank something…" maxlength="80" autocomplete="off" enterkeyhint="go" aria-label="Title">
      <div class="chips" role="radiogroup" aria-label="Ladder">${chips.map(([id, l], i) => `<button type="button" class="chip" role="radio" aria-checked="${i === 0}" data-domain="${esc(id)}">${esc(l)}</button>`).join("")}</div>
      <button class="pill fill" type="submit">Rank</button>
    </form>
    ${empty ? `<p class="hint">Nothing waiting. Type a title above, or open Lists to re-rank anything.</p><ul class="list queue" hidden></ul>` : groups}`;
  let domain = "detect";
  screen().querySelectorAll(".chips .chip").forEach((c) => c.addEventListener("click", () => {
    domain = c.dataset.domain;
    screen().querySelectorAll(".chips .chip").forEach((x) => x.setAttribute("aria-checked", x === c ? "true" : "false"));
  }));
  $("add").addEventListener("submit", (e) => { e.preventDefault(); const query = $("q").value.trim(); if (query.length >= 2) app.start({ query, domain }); });
  bind(app, (act, b) => {
    if (act === "rank") app.start({ domain: b.dataset.domain, item: b.dataset.name, year: b.dataset.year ? Number(b.dataset.year) : null, city: b.dataset.city || null });
  });
}

// ---------- the bucket card ----------
function renderBucket(app, v) {
  screen().innerHTML = `
    ${pinned(v)}
    <h2>How was it?</h2>
    <p class="hint">${v.prior != null ? `You have it at ${num(v.prior)} — Skip keeps that.` : `I'll place it against your other ${esc(v.label)} from here.`}</p>
    <div class="controls col">${BUCKETS.map(([id, l]) => `<button class="pill big" data-act="bucket" data-bucket="${id}">${l}</button>`).join("")}</div>
    <div class="controls"><button class="pill quiet" data-act="skip">Skip</button></div>`;
  bind(app, (act, b) => {
    if (act === "bucket") { haptic("light"); op(app, "bucket", { bucket: b.dataset.bucket }); }
    if (act === "skip") op(app, "skip", {});
  });
}

// ---------- two ladders carry the title: ask, never pick ----------
function renderAmbiguous(app, v) {
  screen().innerHTML = `
    <h2>“${esc(v.query)}” is on more than one ladder</h2>
    <p class="hint">Which one?</p>
    <div class="controls">${v.options.map((o) => `<button class="pill" data-act="pick" data-domain="${esc(o.domain)}">${esc(o.label)}</button>`).join("")}<button class="pill quiet" data-act="back">Back</button></div>`;
  bind(app, (act, b) => {
    if (act === "pick") app.start({ query: v.query, domain: b.dataset.domain });
    if (act === "back") { app.state.session = null; renderRank(app); }
  });
}

// ---------- the question: the item pinned above, the opponent is the card ----------
const dots = (i) => `<div class="dots" role="img" aria-label="question ${i + 1} of 4">${[0, 1, 2, 3].map((k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div>`;
function renderQuestion(app, v) {
  const o = v.opponent, me = v.item.name, last = app.state.last;
  const hint = `Swipe right if <b>${esc(me)}</b> is better, left if <b>${esc(o.name)}</b> is.`;
  screen().innerHTML = `
    ${pinned(v)}
    <div class="label center">${esc(v.scope)}</div>
    <div class="deck rank" id="deck">
      <div class="card opp behind" aria-hidden="true"></div>
      <div class="card opp front anim" role="group" aria-label="${esc(o.name)}">
        <span class="stamp l ink">${esc(o.name)}</span><span class="stamp r ink">${esc(me)}</span>
        <div class="name">${esc(o.name)}</div><div class="sub">${meta([o.year, o.kind])}</div>
      </div>
    </div>
    <div class="live" id="live" aria-live="polite">${last ? `<b>${esc(last.name)}</b> sits at ${num(last.score)}` : hint}</div>
    <div class="controls"><button class="pill" data-act="left">← ${esc(o.name)}</button><button class="pill" data-act="right">${esc(me)} →</button></div>
    <div class="controls"><button class="pill quiet" data-act="same">Same</button><button class="pill quiet" data-act="tough" ${v.toughLeft ? "" : "disabled"}>Too tough</button><button class="pill quiet" data-act="skip">Skip</button></div>
    ${dots(v.asked)}`;
  const live = $("live");
  // The score line is a hold, not motion, so it stays 1.4 s for reduced-motion viewers too.
  if (last) { const shownLast = last; setTimeout(() => { if (app.state.last === shownLast && $("live") === live) live.innerHTML = hint; }, 1400); }
  const d = deckBehaviour($("deck"), {
    onDrag(dx) { live.innerHTML = dx > 30 ? `<b>${esc(me)}</b> is better` : dx < -30 ? `<b>${esc(o.name)}</b> is better` : hint; },
    onThrow(dir) { answer(dir > 0 ? "better" : "worse"); },
  });
  // deck.js re-arms the card 260 ms into a throw, so a second throw's answer can fire after the first reply has put the next
  // View in. Answer only the View this card was drawn for: op() reads the session at call time and would post it at the new step.
  const answer = (a) => { if (app.state.session === v) op(app, "answer", { answer: a }, (r) => { app.state.last = r.last ?? null; }); };
  bind(app, (act) => {
    if (act === "right") d.throwCard(1);
    else if (act === "left") d.throwCard(-1);
    else if (act === "same") answer("same");
    else if (act === "tough") { toast("Swapped for another opponent"); answer("tough"); }
    else if (act === "skip") op(app, "skip", {});
  });
}

// ---------- Haiku was unsure (or the note has sections): the kind decides the opponents, so ask first ----------
function renderAskKind(app, v) {
  screen().innerHTML = `
    ${pinned(v)}
    <h2>${v.what === "section" ? "Which section?" : `What kind of ${esc(v.noun)} is it?`}</h2>
    <p class="hint">The ${v.what} decides who it's compared with.</p>
    <div class="chips">${v.options.map((o, i) => `<button class="chip" data-act="kind" data-idx="${i}">${esc(o)}</button>`).join("")}</div>
    <div class="controls"><button class="pill quiet" data-act="skip">Skip</button></div>`;
  bind(app, (act, b) => {
    if (act === "kind") op(app, "repick", { idx: Number(b.dataset.idx) });
    if (act === "skip") op(app, "skip", {});
  });
}

// ---------- a place with no city resolved ----------
function renderAskCity(app, v) {
  screen().innerHTML = `
    ${pinned(v)}
    <h2>Which city note does this go in?</h2>
    <form class="add" id="cityf"><input id="city" class="field" type="text" placeholder="Tokyo" maxlength="40" autocomplete="off" enterkeyhint="go" aria-label="City"><button class="pill fill" type="submit">Place it</button></form>
    <div class="controls"><button class="pill quiet" data-act="skip">Skip</button></div>`;
  $("cityf").addEventListener("submit", (e) => { e.preventDefault(); const city = $("city").value.trim(); if (city) op(app, "city", { city }); });
  bind(app, (act) => { if (act === "skip") op(app, "skip", {}); });
}

// ---------- the confirm sheet: what Save will write, exactly ----------
function renderConfirm(app, v) {
  if (!draft || draft.id !== v.id) draft = { id: v.id, note: "", override: "", year: "", author: "" };
  const typed = draft;   // the listeners below write here, even if the session ends (draft = null) while this sheet is still up
  const needYear = !v.item.known && v.item.year == null && (v.domain === "movie" || v.domain === "book");
  const needAuthor = !v.item.known && !v.item.author && v.domain === "book";
  const where = v.domain === "place" ? (v.city ?? "your vault") : v.label;
  screen().innerHTML = `
    <div class="sheet">
      <div class="big num">${Number(v.score).toFixed(1)}</div>
      <div><b>${esc(v.item.name)}</b> ${meta([v.item.year, v.item.kind])}</div>
      <div class="trail">${esc(v.trail) || "nothing comparable yet — this is the starting point"}${v.prior != null ? ` · was ${num(v.prior)}` : ""}</div>
      <div class="row">
        <button class="pill" data-act="up"><span class="num">▲ ${Number(v.up).toFixed(1)}</span></button>
        <button class="pill" data-act="down"><span class="num">▼ ${Number(v.down).toFixed(1)}</span></button>
        <input id="override" class="field num" type="number" inputmode="decimal" step="0.1" min="1" max="10" placeholder="or a number" aria-label="Score override" value="${esc(typed.override)}">
      </div>
      ${needYear ? `<input id="year" class="field num" type="number" inputmode="numeric" min="1800" max="2100" placeholder="Year — it isn't on the note yet" aria-label="Year" value="${esc(typed.year)}">` : ""}
      ${needAuthor ? `<input id="author" class="field" type="text" maxlength="80" placeholder="Author — it isn't on the note yet" aria-label="Author" value="${esc(typed.author)}">` : ""}
      <textarea id="note" class="field" rows="2" maxlength="300" placeholder="Why ${Number(v.score).toFixed(1)} — a line, or leave it to the trail" aria-label="Why line">${esc(typed.note)}</textarea>
      <div class="row"><button class="pill fill" data-act="save">Save to ${esc(where)}</button><button class="pill quiet" data-act="skip">Skip</button></div>
    </div>`;
  for (const k of ["override", "year", "author", "note"]) { const el = $(k); if (el) el.addEventListener("input", () => { typed[k] = el.value; }); }
  bind(app, (act) => {
    if (act === "up" || act === "down") { typed.override = ""; op(app, "nudge", { dir: act }); }   // a nudge takes the server's new score; the note, year and author stay
    if (act === "skip") op(app, "skip", {});
    if (act === "save") {
      // text a number field can't parse reads as "" and would save the engine's score while the field still shows the typing
      if ($("override").validity.badInput) return toast("Scores run 1 to 10");
      const body = { note: $("note").value };
      const o = parseFloat($("override").value);
      if ($("override").value !== "") {
        if (!Number.isFinite(o) || o < 1 || o > 10) return toast("Scores run 1 to 10");
        body.score = Math.round(o * 10) / 10;
      }
      const y = needYear ? parseInt($("year").value, 10) : NaN;
      if (Number.isFinite(y)) body.year = y;
      const a = needAuthor ? $("author").value.trim() : "";
      if (a) body.author = a;
      op(app, "confirm", body);
    }
  });
}

// ---------- filed: patch the home, open the ladder on the entry ----------
async function renderFiled(app, v) {
  hapticNote("success");
  app.state.session = null; draft = null;
  app.state.highlight = { domain: v.domain, name: v.item.name };
  app.state.listTab = v.domain;
  app.state.kind = null; app.state.q = "";
  await app.loadHome(v.domain === "place" ? v.city : null);
  toast(`Saved — ${Number(v.score).toFixed(1)} in ${v.where}`);   // after the load: a failed refresh's toast must not replace it
  patchHome(app.state.home, v);
  app.show("lists");
}
/** The API drops its home cache on a write, but another isolate may still serve the old one for up to a minute:
 *  put the entry where it now belongs so the highlight always lands. Idempotent. */
function patchHome(home, v) {
  const d = home && home.domains.find((x) => x.id === v.domain);
  if (!d) return;
  const same = (e) => e.name.toLowerCase() === v.item.name.toLowerCase();
  d.queue = d.queue.filter((e) => !same(e));
  d.unranked = d.unranked.filter((e) => !same(e));
  const hit = d.ladder.find(same);
  if (hit) hit.score = v.score;
  else d.ladder.push({ name: v.item.name, score: v.score, kind: v.item.kind || "", year: v.item.year, legacy: null, todo: false });
  d.ladder.sort((a, b) => b.score - a.score);
}

// ---------- not written: the same sheet idea, with the reason and one Save again ----------
const FAIL_COPY = {
  "note-changed": "the note changed under me and I can't find its line. Fix the note, then Save again.",
  "note-missing": "I couldn't read the note just now. Save again in a minute.",
  "write-failed": "the vault write failed. Save again in a minute.",
  "no-section": "the note has no section to put it in. Add one, then Save again.",
  "needs-year": "I need its year to add it — fill it in and Save again.",
  "needs-author": "I need the author to add it — fill it in and Save again.",
  "not-on-note": "it isn't on that note yet. Add the line, then rate it.",
};
function renderFailed(app, v) {
  const retryable = v.reason !== "not-on-note";
  screen().innerHTML = `
    <div class="sheet">
      <div class="big num">${Number(v.score).toFixed(1)}</div>
      <div><b>${esc(v.item.name)}</b> ${meta([v.item.year, v.item.kind])}</div>
      <p class="hint left">Not written: ${esc(FAIL_COPY[v.reason] || "it didn't go through. Save again in a minute.")}</p>
      ${v.reason === "needs-year" ? `<input id="year" class="field num" type="number" inputmode="numeric" min="1800" max="2100" placeholder="Year" aria-label="Year">` : ""}
      ${v.reason === "needs-author" ? `<input id="author" class="field" type="text" maxlength="80" placeholder="Author" aria-label="Author">` : ""}
      <div class="row">${retryable ? `<button class="pill fill" data-act="save">Save again</button>` : ""}<button class="pill quiet" data-act="skip">Skip</button></div>
    </div>`;
  bind(app, (act) => {
    if (act === "skip") op(app, "skip", {});
    if (act === "save") {
      const body = {};
      const y = v.reason === "needs-year" ? parseInt($("year").value, 10) : NaN;
      if (Number.isFinite(y)) body.year = y;
      const a = v.reason === "needs-author" ? $("author").value.trim() : "";
      if (a) body.author = a;
      op(app, "confirm", body);   // no score, no note: the engine files exactly what was confirmed
    }
  });
}

// ---------- filing: a place's meal is logged and its city note is Tori's agent turn, started from the 📝 card the Save sent to Telegram; a film or book is here only while its write is still running ----------
function renderFiling(app, v) {
  const place = v.domain === "place";
  screen().innerHTML = `
    <div class="sheet">
      <div class="big num">${Number(v.score).toFixed(1)}</div>
      <div><b>${esc(v.item.name)}</b> ${meta(place ? [v.city, v.item.kind] : [v.item.year, v.item.kind])}</div>
      <p class="hint left">${place ? `Logged. Tap 📝 File it in Telegram and Tori writes the ${esc(v.city ?? "city")} note.` : "Saving… this takes a few seconds."}</p>
      <div class="row"><button class="pill fill" data-act="done">Done</button></div>
    </div>`;
  bind(app, (act) => { if (act === "done") { app.state.session = null; app.loadHome().then(() => renderRank(app)); } });
  // A film or book is in `filing` only while its write runs (a second Save answered with a 409, a `?s=` reopen): look again every 1.5 s
  // while the row still says filing. Leaving Rank stops it (coming back re-renders this sheet and starts it again); Done ends it.
  if (!place) setTimeout(() => { if (app.state.session === v && app.state.screen === "rank") app.open(v.id); }, 1500);
}

// ---------- the note could not be read: the bucket stays claimed, so a tap can try again ----------
function renderUnreadable(app, v) {
  screen().innerHTML = `
    ${pinned(v)}
    <p class="hint">Couldn't read your ${esc(v.what)} note just now.</p>
    <div class="controls">${v.bucket ? `<button class="pill fill" data-act="again">Try again</button>` : ""}<button class="pill quiet" data-act="skip">Skip</button></div>`;
  bind(app, (act) => {
    if (act === "again") op(app, "bucket", { bucket: v.bucket });
    if (act === "skip") op(app, "skip", {});
  });
}
