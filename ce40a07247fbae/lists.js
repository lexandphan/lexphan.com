// Lists: one tab per ladder; the ladder best first with ties marked "="; chips for kind (films, books) or section
// (places, opt-in) and, for places, the city note; search; tap an entry to re-rank it; a collapsed Unranked
// group (unscored entries, legacy ★) with Rank buttons. A Save lands here with the entry highlighted.
import { $, esc } from "./ui.js";

export function renderLists(app) {
  const screen = $("screen"), s = app.state, home = s.home;
  if (!home) {
    screen.innerHTML = `<p class="hint">Loading your ladders…</p>`;
    // `h` null: this load failed and said so, but a concurrent one may have filled the home. Never a loop: only a null home reloads.
    app.loadHome().then((h) => {
      if (app.state.screen !== "lists") return;
      if (h || app.state.home) renderLists(app);
      else screen.innerHTML = `<p class="hint">Couldn't load your ladders. Tap Lists to try again.</p>`;
    });
    return;
  }
  s.listTab = home.domains.some((d) => d.id === s.listTab) ? s.listTab : home.domains[0].id;
  const d = home.domains.find((x) => x.id === s.listTab);
  const tabs = `<div class="tabs scroll" role="tablist" aria-label="Ladder">${home.domains.map((x) => `<button role="tab" aria-selected="${x.id === d.id}" data-tab="${esc(x.id)}">${esc(x.label)}</button>`).join("")}</div>`;
  // the city chips come before the unreadable return: after a failed Tokyo read they are the way back to Los Angeles
  const cityChips = d.id === "place" && d.cities.length > 1
    ? `<div class="chips scroll" aria-label="City">${d.cities.map((c) => `<button class="chip" aria-pressed="${c === d.city}" data-city="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : "";
  if (d.unreadable) { screen.innerHTML = `${tabs}${cityChips}<p class="hint">Couldn't read this note just now.</p>`; wireTabs(); wireCities(); return; }
  const kinds = [...new Set([...d.ladder, ...d.unranked].map((e) => e.kind).filter(Boolean))];
  if (s.kind && !kinds.includes(s.kind)) s.kind = null;   // a filter this ladder doesn't have (a city or tab change left it set) is dropped, never shown as an empty ladder
  const byKind = (e) => !s.kind || e.kind === s.kind;
  const ladder = d.ladder.filter(byKind), unranked = d.unranked.filter(byKind);
  const hl = s.highlight && s.highlight.domain === d.id ? s.highlight.name : null;
  let rank = 0, prev = null;
  const row = (e, i) => {
    const tie = prev != null && e.score === prev;
    if (!tie) rank = i + 1;
    prev = e.score;
    return `<li class="${hl === e.name ? "hl" : ""}" data-act="rerank" data-name="${esc(e.name)}" data-year="${e.year ?? ""}" tabindex="0" role="button" aria-label="Re-rank ${esc(e.name)}">
      <span class="rank num">${tie ? "=" : rank}</span>
      <span class="t">${esc(e.name)} <span class="meta">${[e.year, e.kind].filter(Boolean).map((p) => (typeof p === "number" ? `<span class="num">${p}</span>` : esc(p))).join(" · ")}</span></span>
      <span class="score num">${Number(e.score).toFixed(1)}</span></li>`;
  };
  const kindChips = kinds.length > 1
    ? `<div class="chips scroll" aria-label="${d.kinds === "sections" ? "Section" : "Kind"}">${kinds.map((k) => `<button class="chip" aria-pressed="${s.kind === k}" data-kind="${esc(k)}">${esc(k)}</button>`).join("")}</div>` : "";
  screen.innerHTML = `
    ${tabs}${cityChips}${kindChips}
    <input id="search" class="field" type="search" placeholder="Search ${esc(d.label)}" value="${esc(s.q)}" autocomplete="off" aria-label="Search">
    <ol class="list ladder">${ladder.map(row).join("") || `<li class="hint">Nothing scored here yet.</li>`}</ol>
    <details class="unranked" ${unranked.some((e) => e.name === hl) ? "open" : ""}><summary>Unranked <span class="num">${unranked.length}</span></summary>
      <ul class="list">${unranked.map((e) => `<li data-name="${esc(e.name)}"><span class="t">${esc(e.name)} <span class="meta">${[e.year, e.legacy].filter(Boolean).map((p) => (typeof p === "number" ? `<span class="num">${p}</span>` : esc(p))).join(" · ")}</span></span>
        <button class="pill small" data-act="rank" data-name="${esc(e.name)}" data-year="${e.year ?? ""}">Rank</button></li>`).join("")}</ul>
    </details>`;
  wireTabs(); wireCities();
  screen.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { s.kind = s.kind === b.dataset.kind ? null : b.dataset.kind; renderLists(app); }));
  const search = $("search");
  const filter = () => {
    s.q = search.value;
    const q = s.q.trim().toLowerCase();
    screen.querySelectorAll(".list li[data-name]").forEach((li) => { li.hidden = q !== "" && !li.dataset.name.toLowerCase().includes(q); });
  };
  search.addEventListener("input", filter);
  if (s.q) filter();
  screen.querySelectorAll("[data-act]").forEach((el) => {
    const go = () => app.start({ domain: d.id, item: el.dataset.name, year: el.dataset.year ? Number(el.dataset.year) : null, city: d.city });
    el.addEventListener("click", go);
    if (el.tagName === "LI") el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  const h = screen.querySelector("li.hl");
  if (h) { h.scrollIntoView({ block: "center" }); s.highlight = null; }
  function wireTabs() {
    screen.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { s.listTab = b.dataset.tab; s.kind = null; s.q = ""; renderLists(app); }));
  }
  // The city sticks only once its load worked (a failed one must not steer every later home load), and the reply can land
  // after a tab switch: draw only while Lists is still the screen.
  function wireCities() {
    screen.querySelectorAll("[data-city]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await app.loadHome(b.dataset.city))) return;
      s.city = b.dataset.city;
      if (app.state.screen === "lists") renderLists(app);
    }));
  }
}
