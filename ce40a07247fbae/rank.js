// The Rank screen: the queue grouped by ladder with a "Rank something" box, then the session's Views — a log's prompts (the
// bucket's, before it; a notes-only session's `notes`, instead of it), bucket, the thrown-card deck (deck.js), ask-kind / ask-city,
// the confirm sheet, filed, and `noted` (where a notes-only session's answers went). Every answer is one POST with the
// step the View came from; a 409 swaps in where the session really is. A question carries the View each answer
// returns (`next`), so an answer is drawn on the tap and its POST runs behind it. Skip on a queued entry drops it from
// the queue (it stays under Unranked in Lists); Skip on a re-rate just abandons it. Nothing is written before Save (a log's
// prompt answers wait in localStorage until the Save that carries them).
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

/** What has been typed for one session — the confirm sheet's fields and a log's prompt answers — so a re-render of the same session (a
 *  Lists round trip, a Save that couldn't reach Tori, a ▲/▼) puts it back. The answers are mirrored to localStorage as `tori-notes:<id>`
 *  (a reload, or Telegram reopening the Mini App, resumes the prompts; every access is guarded — private mode or a webview may have no
 *  storage) and dropped when the session ends: filed, noted, skipped. */
let draft = null;
const notesKey = (id) => `tori-notes:${id}`;
function draftFor(id) {
  if (draft && draft.id === id) return draft;
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(notesKey(id)) || "null"); } catch { /* no storage here: this open only */ }
  // Answers are keyed by label, and a label is model output: a null-prototype map, so `constructor`, `toString` or `valueOf` is just a key.
  draft = { id, note: "", override: "", year: "", author: "", answers: Object.assign(Object.create(null), kept && kept.answers), at: (kept && kept.at) || 0, prompts: (kept && kept.prompts) || null };
  return draft;
}
function keepDraft(d) { try { localStorage.setItem(notesKey(d.id), JSON.stringify({ answers: d.answers, at: d.at, prompts: d.prompts })); } catch { /* best effort */ } }
function dropDraft(id) { if (draft && draft.id === id) draft = null; try { localStorage.removeItem(notesKey(id)); } catch { /* best effort */ } }
/** The answers as the API takes them: one per prompt that has words, in prompt order. */
const notesOf = (d) => (d && d.prompts ? d.prompts.map((p) => ({ label: p.label, answer: (d.answers[p.label] || "").trim() })).filter((n) => n.answer) : []);

/** An answer drawn ahead of its reply, still on its way. Every POST waits for it: its reply carries the step the next is for. */
let pending = Promise.resolve();
const ANSWER_MS = 8000;   // an answer whose reply hasn't come by then is lost: the session is reloaded

/** One transition. `after(view)` runs before the re-render (the deck keeps the beaten opponent's score there). */
async function op(app, name, body, after) {
  const v = app.state.session;
  if (!v || v.busy) return;
  v.busy = true;
  await pending;
  if (app.state.session !== v) return;   // the reply in flight redrew the session: this tap was on a card that is gone
  try {
    const r = await call("POST", { op: name }, { id: v.id, step: v.step, ...body }, name === "answer" ? ANSWER_MS : undefined);
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
    case "bucket": return v.prompts && v.prompts.length && draftFor(v.id).at < v.prompts.length ? renderPrompts(app, v) : renderBucket(app, v);
    case "notes": return renderPrompts(app, v);
    case "noted": return renderNoted(app, v);
    case "ask-kind": return renderAskKind(app, v);
    case "ask-city": return renderAskCity(app, v);
    case "question": return renderQuestion(app, v);
    case "confirm": return renderConfirm(app, v);
    case "filed": return renderFiled(app, v);
    case "file-failed": return v.notesOnly ? renderNotesFailed(app, v) : renderFailed(app, v);
    case "filing": return renderFiling(app, v);
    case "unreadable": return renderUnreadable(app, v);
    case "ambiguous": return renderAmbiguous(app, v);
    case "skipped": {
      // the server's home cache can keep a skipped entry in its queue for up to 60 s: drop it here at once (home is null on a `?s=` launch until it loads)
      const d = app.state.home && app.state.home.domains.find((x) => x.id === v.domain);
      if (d) d.queue = d.queue.filter((e) => e.name !== v.item.name);
      app.state.session = null; dropDraft(v.id); toast("Skipped — nothing written"); return renderQueue(app);
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
const oppFace = (o) => `<div class="name">${esc(o.name)}</div><div class="sub">${meta([o.year, o.kind])}</div>`;
/** Identical once `next` (the reply's lookahead) and `busy` (this page's) are set aside: both come from the API's one View shape. */
const sameView = (a, b) => JSON.stringify({ ...a, next: undefined, busy: undefined }) === JSON.stringify({ ...b, next: undefined, busy: undefined });

/** The reply to an answer drawn ahead. The View that was drawn (it is, unless the session moved on elsewhere): the screen stays, and
 *  the reply's step and lookahead go into the drawn View, which the screen's handlers hold. Anything else is drawn in its place. */
function landed(app, p, r) {
  if (app.state.session !== p) return;   // he has left this session: nothing on screen is its
  const view = r.stale ? r.view : r;
  if (!r.stale && sameView(view, p)) { Object.assign(p, view); return; }
  app.state.session = view; app.state.last = null;
  if (app.state.screen !== "rank") return;   // Lists stays put: the Rank tab draws the session when he comes back
  toast("That card had moved on — here's where it is");
  renderRank(app);
}
/** No reply for an answer drawn ahead (dropped, timed out, a server error): it may or may not have landed, so draw the session from
 *  where it really is. The reload is not returned: `pending` waiting on it would let a hung one (a dead zone) hold up every write. */
function lost(app, p, e) {
  if (app.state.session !== p) return;
  if (e instanceof Gone) return app.needLink();
  if (app.state.screen === "rank") toast("Couldn't reach Tori — here's where that rating stands");
  call("GET", { session: p.id }, null, ANSWER_MS).then((view) => {
    if (app.state.session !== p) return;   // he moved on while it loaded (a Skip, another rating): never pull him back
    app.state.session = view; app.state.last = null;
    if (app.state.screen === "rank") renderRank(app);
  }, (err) => { if (err instanceof Gone && app.state.session === p) app.needLink(); });
}

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
        ${oppFace(o)}
      </div>
    </div>
    <div class="live" id="live" aria-live="polite">${last ? `<b>${esc(last.name)}</b> sits at ${num(last.score)}` : hint}</div>
    <div class="controls"><button class="pill" data-act="left">← ${esc(o.name)}</button><button class="pill" data-act="right">${esc(me)} →</button></div>
    <div class="controls"><button class="pill quiet" data-act="same">Same</button><button class="pill quiet" data-act="tough" ${v.toughLeft ? "" : "disabled"}>Too tough</button><button class="pill quiet" data-act="skip">Skip</button></div>
    ${dots(v.asked)}`;
  const live = $("live");
  // The score line is a hold, not motion, so it stays 1.4 s for reduced-motion viewers too.
  if (last) { const shownLast = last; setTimeout(() => { if (app.state.last === shownLast && $("live") === live) live.innerHTML = hint; }, 1400); }
  // The lookahead: an answer makes its View the session at once and posts behind it. A View drawn that way has no `next` until its reply
  // lands, so an answer on it before then goes the old way (op), which waits for that reply.
  let drawn = null;
  const ahead = (a) => {
    const p = app.state.session === v && !v.busy && v.next ? v.next[a] : null;
    if (!p) return null;
    v.busy = true; app.state.session = p;
    const sent = pending.then(() => call("POST", { op: "answer" }, { id: v.id, step: v.step, answer: a }, ANSWER_MS));
    pending = sent.then((r) => landed(app, p, r), (e) => lost(app, p, e)).catch((e) => console.error("answer", e));   // never a stuck queue
    return p;
  };
  const show = (p) => { if (app.state.session === p) { app.state.last = p.last ?? null; renderRank(app); } };
  const d = deckBehaviour($("deck"), {
    onDrag(dx) { live.innerHTML = dx > 30 ? `<b>${esc(me)}</b> is better` : dx < -30 ? `<b>${esc(o.name)}</b> is better` : hint; },
    onCommit(dir) {
      drawn = ahead(dir > 0 ? "better" : "worse");
      if (drawn && drawn.kind === "question") $("deck").querySelector(".card.behind").innerHTML = oppFace(drawn.opponent);   // it rises during the throw
    },
    onThrow(dir) { const p = drawn; drawn = null; if (p) show(p); else answer(dir > 0 ? "better" : "worse"); },
  });
  // deck.js re-arms the card 260 ms into a throw, so a second throw's answer can fire after the first reply has put the next
  // View in. Answer only the View this card was drawn for: op() reads the session at call time and would post it at the new step.
  const answer = (a) => { if (app.state.session === v) op(app, "answer", { answer: a }, (r) => { app.state.last = r.last ?? null; }); };
  const tap = (a) => { const p = ahead(a); if (p) show(p); else answer(a); };
  bind(app, (act) => {
    if (act === "right") d.throwCard(1);
    else if (act === "left") d.throwCard(-1);
    else if (act === "same") tap("same");
    else if (act === "tough") { toast("Swapped for another opponent"); tap("tough"); }
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
  const typed = draftFor(v.id);   // the listeners below write here, even if the session ends (the draft dropped) while this sheet is still up
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
      const notes = notesOf(typed);
      if (notes.length) body.notes = notes;
      op(app, "confirm", body);
    }
  });
}

// ---------- filed: patch the home, open the ladder on the entry ----------
async function renderFiled(app, v) {
  hapticNote("success");
  app.state.session = null; dropDraft(v.id);
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
      const notes = notesOf(draftFor(v.id)); if (notes.length) body.notes = notes;   // the draft is kept on a failed write: Save again carries the prompts' answers
      op(app, "confirm", body);   // no score, no Why line: the engine files exactly what was confirmed
    }
  });
}

// ---------- filing: a place's meal is logged and its city note is Tori's agent turn, started from the 📝 card the Save sent to Telegram; a film or book is here only while its write is still running ----------
function renderFiling(app, v) {
  const place = v.domain === "place";
  if (place) dropDraft(v.id);   // a place's confirm succeeded: its answers are with its filing turn now
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

// ---------- a log's prompts: up to three questions about the thing, before the bucket — or, notes-only, instead of it ----------
/** TMDB's credit (Terms §3; Alex kept TMDB, 2026-10-26): its logo, self-hosted because the CSP allows only this origin's images, and its
 *  notice, verbatim. On a film's or show's prompt screen only, quieter than every Tori mark (app.css `.credit`). */
const TMDB_NOTICE = "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";
const tmdbCredit = () => `<p class="credit" id="tmdb-credit"><img src="/ce40a07247fbae/tmdb.svg" alt="TMDB" height="12"><span>${TMDB_NOTICE}</span></p>`;

/** The look Alex picked (Task 11). The markup carries the ids pl, pq, answer, pn and pnext, and puts TMDB's credit (id tmdb-credit) where
 *  Alex saw it when `credit` is set. Only the prompt count `n` is drawn here: fill() sets #pl, #pq, #pn and #pnext right after this lands,
 *  with textContent, because a prompt's label and text are model output and none of it may go through innerHTML. */
const promptMarkup = (n, credit) => `
    <div class="sheet prompt">
      <div class="label" id="pl"></div>
      <h2 id="pq"></h2>
      <textarea id="answer" class="field" rows="3" maxlength="300" enterkeyhint="next" autofocus aria-labelledby="pq" placeholder="A line or two — or skip it"></textarea>
      <div class="row between"><span class="meta"><span class="num" id="pn"></span> of <span class="num">${n}</span></span>
        <span class="row"><button class="pill quiet" data-act="skip-prompt">Skip</button><button class="pill fill" id="pnext" data-act="next"></button></span></div>
      ${credit ? tmdbCredit() : ""}
    </div>`;

/** One prompt per screen, all in the top half (the iOS keyboard covers the bottom; the app has no keyboard-aware layout); no Back.
 *  Next (an empty box counts as Skip), Skip, or Enter moves on. Drawn once and updated in place, so the keyboard stays up between
 *  prompts. A full log's last prompt leads to the bucket; a notes-only session's last button is Save. A film or a show carries TMDB's
 *  credit: the View's `domain` says which, as it does for every session. */
function renderPrompts(app, v) {
  const d = draftFor(v.id);
  d.prompts = v.prompts;
  const n = v.prompts.length, notesOnly = v.kind === "notes";
  if (d.at >= n) d.at = n - 1;   // only a notes-only session gets here with every prompt passed: its Save is on the last one
  screen().innerHTML = `${pinned(v)}${promptMarkup(n, v.domain === "movie" || v.domain === "show")}`;
  const box = $("answer");
  const fill = () => {
    const p = v.prompts[d.at];
    $("pl").textContent = p.label; $("pq").textContent = p.text; $("pn").textContent = String(d.at + 1);
    $("pnext").textContent = notesOnly && d.at === n - 1 ? "Save" : "Next";
    box.value = d.answers[p.label] || "";
    box.focus({ preventScroll: true });
  };
  const step = (keep) => {
    if (app.state.session !== v) return;   // the session moved on under this screen: nothing here is its
    d.answers[v.prompts[d.at].label] = keep ? box.value : "";
    if (d.at < n - 1) { d.at++; keepDraft(d); return fill(); }
    if (!notesOnly) { d.at = n; keepDraft(d); return renderRank(app); }   // a full log: on to the bucket
    keepDraft(d);
    op(app, "notes", { notes: notesOf(d) });
  };
  box.addEventListener("input", () => { d.answers[v.prompts[d.at].label] = box.value; keepDraft(d); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); step(true); } });
  bind(app, (act) => { if (act === "next") step(true); if (act === "skip-prompt") step(false); });
  fill();
}

// ---------- notes saved: where they went, and Re-rate when it already has a score ----------
function renderNoted(app, v) {
  const d = draft && draft.id === v.id ? draft : null;
  // Once per View, not once per render (a Rank→Lists→Rank trip draws this again): `wrote` is how many answers the Save carried, or null
  // for a session reopened after its save, which has no draft (then just say where).
  if (!("wrote" in v)) { v.wrote = d ? notesOf(d).length : null; hapticNote("success"); }
  dropDraft(v.id);
  screen().innerHTML = `
    ${pinned(v)}
    <div class="sheet">
      <p class="hint left">${v.wrote === 0 ? "Nothing written — no answers." : `Notes saved to ${esc(v.where)}.`}</p>
      ${v.prior != null ? `<p class="hint left">You have it at ${num(v.prior)}.</p>` : ""}
      <div class="row">${v.prior != null ? `<button class="pill" data-act="rerate">Re-rate</button>` : ""}<button class="pill fill" data-act="done">Done</button></div>
    </div>`;
  bind(app, (act) => {
    if (act === "rerate") app.start({ item: v.item.name, domain: v.domain, year: v.item.year, city: v.city });
    if (act === "done") { app.state.session = null; renderRank(app); }
  });
}

// ---------- a notes save that didn't land: the reason and Save again (the answers stay in the draft) ----------
/** FAIL_COPY's wording for the reasons a notes save shares with a rating's (note-missing, write-failed); not-on-note reads differently here. */
const NOTES_FAIL = { ...FAIL_COPY, "not-on-note": "it isn't on the note yet — Tori may still be adding it. Save again in a minute." };
function renderNotesFailed(app, v) {
  screen().innerHTML = `
    ${pinned(v)}
    <div class="sheet">
      <p class="hint left">Not saved: ${esc(NOTES_FAIL[v.reason] || "it didn't go through. Save again in a minute.")}</p>
      <div class="row"><button class="pill fill" data-act="save">Save again</button><button class="pill quiet" data-act="skip">Skip</button></div>
    </div>`;
  bind(app, (act) => {
    if (act === "save") op(app, "notes", { notes: notesOf(draftFor(v.id)) });
    if (act === "skip") op(app, "skip", {});
  });
}
