/* FootyScope – Arun
 * Live football scores powered by ESPN's public (keyless) soccer feeds.
 * On Netlify, requests go through the /api/espn/* proxy defined in netlify.toml
 * (same-origin, no CORS issues). Locally it falls back to calling ESPN directly.
 */
(() => {
  "use strict";

  const LEAGUES = window.FOOTY_LEAGUES || [];
  const LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));
  const PROXY_BASE = "/api/espn";
  const DIRECT_BASE = "https://site.api.espn.com/apis";
  const REFRESH_LIVE_MS = 30_000;
  const REFRESH_IDLE_MS = 5 * 60_000;
  const CONCURRENCY = 10;

  const $ = (sel) => document.querySelector(sel);
  const el = {
    content: $("#content"),
    leagueList: $("#leagueList"),
    status: $("#statusText"),
    datePicker: $("#datePicker"),
    liveToggle: $("#liveToggle"),
    search: $("#search"),
    tabs: $("#tabs"),
    modal: $("#matchModal"),
    modalBody: $("#modalBody"),
  };

  const state = {
    date: todayLocal(),
    league: readHashLeague(), // null = all
    tab: "matches",
    liveOnly: false,
    query: "",
    favs: new Set(loadFavs()),
    data: {}, // leagueId -> { league, events }
    loading: false,
    lastUpdated: null,
    timer: null,
    apiMode: null, // "proxy" | "direct"
    standingsCache: {},
  };

  /* ---------------- utilities ---------------- */

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function localDateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function shiftDate(iso, days) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + days);
    return localDateKey(dt);
  }
  function espnDate(iso) { return iso.replace(/-/g, ""); }
  function fmtTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDateLong(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  function loadFavs() {
    try { return JSON.parse(localStorage.getItem("footyscope:favs") || "[]"); } catch { return []; }
  }
  function saveFavs() {
    try { localStorage.setItem("footyscope:favs", JSON.stringify([...state.favs])); } catch { /* ignore */ }
  }
  function readHashLeague() {
    const id = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    return LEAGUE_BY_ID[id] ? id : null;
  }

  /* ---------------- API ---------------- */

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (!type.includes("json")) throw new Error("Not JSON");
    return res.json();
  }

  // path is relative to /apis, e.g. "site/v2/sports/soccer/eng.1/scoreboard"
  async function api(path) {
    if (state.apiMode === "direct") return fetchJson(`${DIRECT_BASE}/${path}`);
    if (state.apiMode === "proxy") return fetchJson(`${PROXY_BASE}/${path}`);
    try {
      const json = await fetchJson(`${PROXY_BASE}/${path}`);
      state.apiMode = "proxy";
      return json;
    } catch {
      const json = await fetchJson(`${DIRECT_BASE}/${path}`);
      state.apiMode = "direct";
      return json;
    }
  }

  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
      }
    });
    await Promise.all(workers);
    return out;
  }

  // Fetch a 3-day window so every match that falls on the user's *local* day is captured.
  async function fetchScoreboard(leagueId, isoDate) {
    const from = espnDate(shiftDate(isoDate, -1));
    const to = espnDate(shiftDate(isoDate, 1));
    const json = await api(`site/v2/sports/soccer/${leagueId}/scoreboard?dates=${from}-${to}&limit=300`);
    const events = (json.events || [])
      .filter((ev) => localDateKey(new Date(ev.date)) === isoDate)
      .map(normalizeEvent)
      .filter(Boolean);
    const lg = (json.leagues && json.leagues[0]) || {};
    return {
      league: {
        id: leagueId,
        name: LEAGUE_BY_ID[leagueId]?.name || lg.name || leagueId,
        region: LEAGUE_BY_ID[leagueId]?.region || "",
        logo: lg.logos?.[0]?.href || "",
      },
      events,
    };
  }

  function normalizeEvent(ev) {
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    const cs = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === "home") || cs[0];
    const away = cs.find((c) => c.homeAway === "away") || cs[1];
    if (!home || !away) return null;
    const st = ev.status || comp.status || {};
    const type = st.type || {};
    const team = (c) => ({
      id: c.team?.id,
      name: c.team?.displayName || c.team?.name || "TBD",
      short: c.team?.shortDisplayName || c.team?.abbreviation || c.team?.displayName || "TBD",
      logo: c.team?.logo || c.team?.logos?.[0]?.href || "",
      score: c.score ?? "",
      shootout: c.shootoutScore,
      winner: !!c.winner,
      redCards: (comp.details || []).filter((d) => d.redCard && d.team?.id === c.team?.id).length,
    });
    return {
      id: ev.id,
      date: ev.date,
      state: type.state || "pre", // pre | in | post
      statusName: type.name || "",
      detail: type.shortDetail || type.detail || "",
      clock: st.displayClock || "",
      completed: !!type.completed,
      venue: comp.venue?.fullName || "",
      home: team(home),
      away: team(away),
      details: comp.details || [],
      note: comp.notes?.[0]?.headline || "",
    };
  }

  /* ---------------- loading ---------------- */

  async function loadDay({ silent = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const date = state.date;
    if (!silent) {
      state.data = {};
      renderSkeleton();
      setStatus("Loading matches from " + LEAGUES.length + " competitions…");
    }
    const ids = LEAGUES.map((l) => l.id);
    const results = await pool(ids, CONCURRENCY, (id) => fetchScoreboard(id, date));
    state.loading = false;
    if (date !== state.date) return loadDay(); // date changed mid-flight

    const fresh = {};
    let ok = 0;
    results.forEach((r, i) => {
      if (r) { ok++; fresh[ids[i]] = r; }
      else if (state.data[ids[i]]) fresh[ids[i]] = state.data[ids[i]]; // keep stale data on a failed refresh
    });
    state.data = fresh;
    state.lastUpdated = new Date();

    if (ok === 0) {
      setStatus("Couldn't reach the live score feed. Check your connection and hit Refresh.");
    }
    render();
    scheduleRefresh();
  }

  function scheduleRefresh() {
    clearTimeout(state.timer);
    const anyLive = allEvents().some((e) => e.state === "in");
    const isToday = state.date === todayLocal();
    const ms = anyLive ? REFRESH_LIVE_MS : isToday ? REFRESH_IDLE_MS / 2.5 : REFRESH_IDLE_MS;
    state.timer = setTimeout(() => {
      if (document.hidden) return scheduleRefresh();
      loadDay({ silent: true });
    }, ms);
  }

  function allEvents() {
    return Object.values(state.data).flatMap((d) => d.events);
  }

  /* ---------------- rendering ---------------- */

  function setStatus(text) { el.status.textContent = text; }

  function renderSkeleton() {
    el.content.innerHTML = Array.from({ length: 4 }, () => `
      <section class="card skeleton">
        <div class="card-head"><div class="sk sk-logo"></div><div class="sk sk-title"></div></div>
        ${Array.from({ length: 3 }, () => `<div class="sk sk-row"></div>`).join("")}
      </section>`).join("");
  }

  function matchesQuery(league, ev) {
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return [league.name, league.region, ev.home.name, ev.away.name, ev.home.short, ev.away.short]
      .some((s) => String(s).toLowerCase().includes(q));
  }

  function visibleGroups() {
    const groups = [];
    const ids = state.league ? [state.league] : LEAGUES.map((l) => l.id);
    for (const id of ids) {
      const d = state.data[id];
      if (!d) continue;
      let events = d.events.filter((ev) => matchesQuery(d.league, ev));
      if (state.liveOnly) events = events.filter((ev) => ev.state === "in");
      if (!events.length) continue;
      events.sort((a, b) => {
        const rank = { in: 0, pre: 1, post: 2 };
        return (rank[a.state] - rank[b.state]) || new Date(a.date) - new Date(b.date);
      });
      groups.push({ league: d.league, events });
    }
    // favourites first, then leagues with live games, then original order
    const order = Object.fromEntries(LEAGUES.map((l, i) => [l.id, i]));
    groups.sort((a, b) => {
      const fa = state.favs.has(a.league.id) ? 0 : 1;
      const fb = state.favs.has(b.league.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const la = a.events.some((e) => e.state === "in") ? 0 : 1;
      const lb = b.events.some((e) => e.state === "in") ? 0 : 1;
      if (la !== lb) return la - lb;
      return order[a.league.id] - order[b.league.id];
    });
    return groups;
  }

  function render() {
    renderSidebar();
    el.tabs.hidden = !state.league;
    el.tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
    if (state.league && state.tab === "table") renderStandings(state.league);
    else renderMatches();
    renderStatus();
  }

  function renderStatus() {
    const evs = allEvents();
    const live = evs.filter((e) => e.state === "in").length;
    const leagues = Object.values(state.data).filter((d) => d.events.length).length;
    const when = state.lastUpdated ? state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
    const day = state.date === todayLocal() ? "Today" : fmtDateLong(state.date);
    setStatus(`${day} · ${evs.length} matches in ${leagues} competitions${live ? ` · ${live} live` : ""} · updated ${when}`);
  }

  function renderSidebar() {
    const counts = {};
    const live = {};
    for (const [id, d] of Object.entries(state.data)) {
      counts[id] = d.events.length;
      live[id] = d.events.filter((e) => e.state === "in").length;
    }
    const total = allEvents().length;
    const totalLive = allEvents().filter((e) => e.state === "in").length;

    const regions = [];
    const byRegion = {};
    for (const l of LEAGUES) {
      if (!byRegion[l.region]) { byRegion[l.region] = []; regions.push(l.region); }
      byRegion[l.region].push(l);
    }

    const item = (l) => {
      const c = counts[l.id] || 0;
      const lv = live[l.id] || 0;
      const logo = state.data[l.id]?.league.logo;
      const fav = state.favs.has(l.id);
      return `<a href="#/${esc(l.id)}" class="lg-item ${state.league === l.id ? "active" : ""} ${c ? "" : "empty"}" data-league="${esc(l.id)}">
        ${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" />` : `<span class="lg-dot"></span>`}
        <span class="lg-name">${esc(l.name)}</span>
        ${lv ? `<span class="badge live">${lv}</span>` : c ? `<span class="badge">${c}</span>` : ""}
        <button class="star ${fav ? "on" : ""}" data-fav="${esc(l.id)}" aria-label="${fav ? "Unpin" : "Pin"} ${esc(l.name)}" title="Pin to top">★</button>
      </a>`;
    };

    const favList = LEAGUES.filter((l) => state.favs.has(l.id));
    let html = `<a href="#/" class="lg-item all ${state.league ? "" : "active"}" data-league="">
        <span class="lg-dot all"></span><span class="lg-name">All competitions</span>
        ${totalLive ? `<span class="badge live">${totalLive}</span>` : `<span class="badge">${total}</span>`}
      </a>`;
    if (favList.length) html += `<div class="lg-region">Pinned</div>` + favList.map(item).join("");
    for (const r of regions) {
      // hide regions with no matches today, unless a league in it is selected
      const ls = byRegion[r];
      const hasAny = ls.some((l) => counts[l.id]) || ls.some((l) => l.id === state.league);
      html += `<details class="lg-group" ${hasAny ? "open" : ""}><summary class="lg-region">${esc(r)}</summary>${ls.map(item).join("")}</details>`;
    }
    el.leagueList.innerHTML = html;
  }

  function teamLogo(t, cls = "crest") {
    return t.logo
      ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls} crest-fallback',textContent:'${esc(initials(t.name)).replace(/'/g, "")}'}))" />`
      : `<span class="${cls} crest-fallback">${esc(initials(t.name))}</span>`;
  }

  function statusCell(ev) {
    if (ev.state === "in") {
      const isHT = ev.statusName === "STATUS_HALFTIME" || /^HT$/i.test(ev.detail);
      const label = isHT ? "HT" : ev.clock || ev.detail || "LIVE";
      return `<span class="st live"><span class="pulse"></span>${esc(label)}</span>`;
    }
    if (ev.state === "post") {
      const label = /postpon/i.test(ev.statusName) ? "PPD" : /cancel/i.test(ev.statusName) ? "CAN" : /abandon/i.test(ev.statusName) ? "ABD" : (ev.detail || "FT");
      return `<span class="st ft">${esc(label)}</span>`;
    }
    if (/postpon/i.test(ev.statusName)) return `<span class="st ft">PPD</span>`;
    return `<span class="st pre">${esc(fmtTime(ev.date))}</span>`;
  }

  function matchRow(ev) {
    const showScore = ev.state !== "pre" && ev.home.score !== "" && !/postpon|cancel/i.test(ev.statusName);
    const pens = ev.home.shootout != null && ev.away.shootout != null ? `<span class="pens">(${esc(ev.home.shootout)}–${esc(ev.away.shootout)} p)</span>` : "";
    const red = (n) => (n ? `<span class="redcard" title="${n} red card${n > 1 ? "s" : ""}">${n > 1 ? n : ""}</span>` : "");
    const win = (t) => (ev.state === "post" && t.winner ? "win" : "");
    return `<button class="match ${ev.state}" data-event="${esc(ev.id)}">
      <span class="m-status">${statusCell(ev)}</span>
      <span class="m-team home ${win(ev.home)}"><span class="t-name">${esc(ev.home.name)}</span>${red(ev.home.redCards)}${teamLogo(ev.home)}</span>
      <span class="m-score">${showScore ? `<b>${esc(ev.home.score)}</b><i>–</i><b>${esc(ev.away.score)}</b>` : `<span class="vs">vs</span>`}${pens}</span>
      <span class="m-team away ${win(ev.away)}">${teamLogo(ev.away)}${red(ev.away.redCards)}<span class="t-name">${esc(ev.away.name)}</span></span>
    </button>`;
  }

  function renderMatches() {
    const groups = visibleGroups();
    if (!groups.length) {
      const hadData = Object.keys(state.data).length > 0;
      el.content.innerHTML = `<div class="empty-state">
        <div class="empty-ball">⚽</div>
        <h2>${state.liveOnly ? "No live matches right now" : state.query ? "No matches match your search" : hadData ? "No matches on this day" : "No data yet"}</h2>
        <p>${state.liveOnly ? "Turn off the Live filter to see today's fixtures and results." : "Try another date or competition."}</p>
      </div>`;
      return;
    }
    el.content.innerHTML = groups.map(({ league, events }) => `
      <section class="card">
        <header class="card-head">
          ${league.logo ? `<img class="lg-logo" src="${esc(league.logo)}" alt="" loading="lazy" />` : ""}
          <div class="card-title">
            <a href="#/${esc(league.id)}" class="lg-link">${esc(league.name)}</a>
            <span class="lg-region-sm">${esc(league.region)}</span>
          </div>
          ${events.some((e) => e.state === "in") ? `<span class="live-chip"><span class="pulse"></span>LIVE</span>` : ""}
        </header>
        <div class="matches">${events.map(matchRow).join("")}</div>
      </section>`).join("");
  }

  /* ---------------- standings ---------------- */

  async function renderStandings(leagueId) {
    el.content.innerHTML = `<section class="card"><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div></section>`;
    let json = state.standingsCache[leagueId];
    if (!json) {
      try {
        json = await api(`v2/sports/soccer/${leagueId}/standings`);
        state.standingsCache[leagueId] = json;
      } catch {
        json = null;
      }
    }
    if (state.league !== leagueId || state.tab !== "table") return;

    const tables = [];
    const collect = (node) => {
      if (!node) return;
      if (node.standings?.entries?.length) tables.push({ name: node.name || node.abbreviation || "", entries: node.standings.entries });
      (node.children || []).forEach(collect);
    };
    collect(json);

    if (!tables.length) {
      el.content.innerHTML = `<div class="empty-state"><div class="empty-ball">📊</div><h2>No table available</h2><p>This competition doesn't have a league table (it may be a knockout cup), or the feed is unavailable.</p></div>`;
      return;
    }

    const stat = (e, ...names) => {
      for (const n of names) {
        const s = (e.stats || []).find((x) => x.name === n || x.type === n || x.abbreviation === n);
        if (s) return s;
      }
      return null;
    };
    const val = (e, ...names) => { const s = stat(e, ...names); return s ? (s.displayValue ?? s.value ?? "") : ""; };
    const num = (e, ...names) => { const s = stat(e, ...names); return s ? Number(s.value ?? s.displayValue) || 0 : 0; };

    const liveTeams = new Set(allEvents().filter((ev) => ev.state === "in").flatMap((ev) => [ev.home.id, ev.away.id]));

    el.content.innerHTML = tables.map((t) => {
      const rows = [...t.entries].sort((a, b) => (num(a, "rank") || 999) - (num(b, "rank") || 999) || num(b, "points") - num(a, "points"));
      return `<section class="card">
        ${tables.length > 1 || t.name ? `<header class="card-head"><div class="card-title"><span class="lg-link">${esc(t.name)}</span></div></header>` : ""}
        <div class="table-wrap"><table class="standings">
          <thead><tr><th>#</th><th class="team-col">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th class="hide-sm">GF</th><th class="hide-sm">GA</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${rows.map((e, i) => {
            const team = e.team || {};
            const logo = team.logos?.[0]?.href || team.logo || "";
            const color = e.note?.color ? `style="--zone:${esc(e.note.color)}"` : "";
            return `<tr ${color} class="${e.note ? "zone" : ""}" title="${esc(e.note?.description || "")}">
              <td>${esc(val(e, "rank") || i + 1)}</td>
              <td class="team-col"><span class="tc">${teamLogo({ logo, name: team.displayName }, "crest sm")}<span>${esc(team.shortDisplayName || team.displayName || "")}</span>${liveTeams.has(team.id) ? `<span class="pulse sm" title="Playing now"></span>` : ""}</span></td>
              <td>${esc(val(e, "gamesPlayed"))}</td>
              <td>${esc(val(e, "wins"))}</td>
              <td>${esc(val(e, "ties"))}</td>
              <td>${esc(val(e, "losses"))}</td>
              <td class="hide-sm">${esc(val(e, "pointsFor"))}</td>
              <td class="hide-sm">${esc(val(e, "pointsAgainst"))}</td>
              <td>${esc(val(e, "pointDifferential"))}</td>
              <td class="pts">${esc(val(e, "points"))}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        ${legend(rows)}
      </section>`;
    }).join("");
  }

  function legend(rows) {
    const seen = new Map();
    rows.forEach((r) => { if (r.note?.description && !seen.has(r.note.description)) seen.set(r.note.description, r.note.color); });
    if (!seen.size) return "";
    return `<div class="legend">${[...seen].map(([d, c]) => `<span><i style="background:${esc(c)}"></i>${esc(d)}</span>`).join("")}</div>`;
  }

  /* ---------------- match detail modal ---------------- */

  function findEvent(id) {
    for (const d of Object.values(state.data)) {
      const ev = d.events.find((e) => e.id === id);
      if (ev) return { ev, league: d.league };
    }
    return null;
  }

  function eventKind(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("own goal")) return { icon: "⚽", cls: "goal og", label: "Own goal" };
    if (t.includes("penalty") && (t.includes("miss") || t.includes("saved"))) return { icon: "✖", cls: "miss", label: "Penalty missed" };
    if (t.includes("goal") || t.includes("penalty - scored") || t.includes("scored")) return { icon: "⚽", cls: "goal", label: "Goal" };
    if (t.includes("red") || t.includes("second yellow")) return { icon: "🟥", cls: "red", label: "Red card" };
    if (t.includes("yellow")) return { icon: "🟨", cls: "yellow", label: "Yellow card" };
    if (t.includes("substitution")) return { icon: "⇄", cls: "sub", label: "Substitution" };
    if (t.includes("var")) return { icon: "📺", cls: "var", label: "VAR" };
    return null;
  }

  async function openMatch(id) {
    const found = findEvent(id);
    if (!found) return;
    const { ev, league } = found;
    el.modalBody.innerHTML = modalHeader(ev, league) + `<div class="modal-section"><div class="sk sk-row"></div><div class="sk sk-row"></div></div>`;
    if (typeof el.modal.showModal === "function") el.modal.showModal(); else el.modal.setAttribute("open", "");

    let summary = null;
    try { summary = await api(`site/v2/sports/soccer/${league.id}/summary?event=${encodeURIComponent(id)}`); } catch { /* fall back */ }
    if (!el.modal.open) return;

    const timeline = buildTimeline(ev, summary);
    const stats = buildStats(ev, summary);
    el.modalBody.innerHTML = modalHeader(ev, league) +
      (timeline || `<div class="modal-section"><p class="muted">${ev.state === "pre" ? "Match hasn't started yet." : "No match events available."}</p></div>`) +
      (stats || "");
  }

  function modalHeader(ev, league) {
    const showScore = ev.state !== "pre" && ev.home.score !== "";
    return `<div class="mh">
      <div class="mh-league">${league.logo ? `<img src="${esc(league.logo)}" alt="" />` : ""}${esc(league.name)}</div>
      ${ev.note ? `<div class="mh-note">${esc(ev.note)}</div>` : ""}
      <div class="mh-row">
        <div class="mh-team">${teamLogo(ev.home, "crest lg")}<span>${esc(ev.home.name)}</span></div>
        <div class="mh-score">
          ${showScore ? `<div class="big">${esc(ev.home.score)} – ${esc(ev.away.score)}</div>` : `<div class="big ko">${esc(fmtTime(ev.date))}</div>`}
          ${ev.home.shootout != null ? `<div class="pens">Pens ${esc(ev.home.shootout)} – ${esc(ev.away.shootout)}</div>` : ""}
          <div>${statusCell(ev)}</div>
        </div>
        <div class="mh-team">${teamLogo(ev.away, "crest lg")}<span>${esc(ev.away.name)}</span></div>
      </div>
      <div class="mh-meta">${esc(new Date(ev.date).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}${ev.venue ? ` · ${esc(ev.venue)}` : ""}</div>
    </div>`;
  }

  function buildTimeline(ev, summary) {
    let items = [];
    const keyEvents = summary?.keyEvents || [];
    if (keyEvents.length) {
      items = keyEvents.map((k) => {
        const kind = eventKind(`${k.type?.text || ""} ${k.type?.type || ""}`);
        if (!kind) return null;
        const who = (k.participants || []).map((p) => p.athlete?.displayName).filter(Boolean);
        return {
          minute: k.clock?.displayValue || "",
          side: k.team?.id === ev.home.id ? "home" : k.team?.id === ev.away.id ? "away" : "home",
          kind,
          who: kind.cls === "sub" && who.length >= 2 ? `${who[0]} ↔ ${who[1]}` : who.join(", ") || k.text || "",
        };
      }).filter(Boolean);
    } else if (ev.details.length) {
      items = ev.details.map((d) => {
        const kind = d.redCard ? eventKind("red") : d.yellowCard ? eventKind("yellow") : d.ownGoal ? eventKind("own goal") : d.scoringPlay ? eventKind("goal") : eventKind(d.type?.text);
        if (!kind) return null;
        return {
          minute: d.clock?.displayValue || "",
          side: d.team?.id === ev.home.id ? "home" : "away",
          kind,
          who: (d.athletesInvolved || []).map((a) => a.displayName).join(", "),
        };
      }).filter(Boolean);
    }
    if (!items.length) return "";
    return `<div class="modal-section"><h3>Match events</h3><ol class="timeline">${items.map((it) => `
      <li class="tl ${it.side} ${it.kind.cls}">
        <span class="tl-min">${esc(it.minute)}</span>
        <span class="tl-who" title="${esc(it.kind.label)}">${esc(it.who)}</span>
      </li>`).join("")}</ol></div>`;
  }

  function buildStats(ev, summary) {
    const teams = summary?.boxscore?.teams || [];
    if (teams.length < 2) return "";
    const home = teams.find((t) => t.team?.id === ev.home.id) || teams[0];
    const away = teams.find((t) => t.team?.id === ev.away.id) || teams[1];
    const wanted = ["possessionPct", "totalShots", "shotsOnTarget", "wonCorners", "foulsCommitted", "offsides", "yellowCards", "redCards", "saves", "accuratePasses", "passPct"];
    const rows = wanted.map((name) => {
      const h = (home.statistics || []).find((s) => s.name === name);
      const a = (away.statistics || []).find((s) => s.name === name);
      if (!h || !a) return null;
      const hv = parseFloat(h.displayValue) || 0;
      const av = parseFloat(a.displayValue) || 0;
      const total = hv + av || 1;
      const isPct = /pct/i.test(name);
      const fmt = (v, s) => (isPct ? `${s.displayValue.includes("%") ? s.displayValue : (v <= 1 ? Math.round(v * 100) : v) + "%"}` : s.displayValue);
      return `<div class="stat">
        <div class="stat-vals"><b>${esc(fmt(hv, h))}</b><span>${esc(h.label || name)}</span><b>${esc(fmt(av, a))}</b></div>
        <div class="stat-bar"><i class="h" style="width:${(hv / total) * 100}%"></i><i class="a" style="width:${(av / total) * 100}%"></i></div>
      </div>`;
    }).filter(Boolean);
    if (!rows.length) return "";
    return `<div class="modal-section"><h3>Stats</h3>${rows.join("")}</div>`;
  }

  /* ---------------- events / wiring ---------------- */

  function setDate(iso) {
    state.date = iso;
    el.datePicker.value = iso;
    loadDay();
  }

  function selectLeague(id) {
    state.league = id || null;
    if (!state.league) state.tab = "matches";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  el.datePicker.value = state.date;
  el.datePicker.addEventListener("change", () => el.datePicker.value && setDate(el.datePicker.value));
  $("#prevDay").addEventListener("click", () => setDate(shiftDate(state.date, -1)));
  $("#nextDay").addEventListener("click", () => setDate(shiftDate(state.date, 1)));
  $("#todayBtn").addEventListener("click", () => setDate(todayLocal()));
  $("#refreshBtn").addEventListener("click", () => { state.standingsCache = {}; loadDay({ silent: true }); setStatus("Refreshing…"); });

  el.liveToggle.addEventListener("click", () => {
    state.liveOnly = !state.liveOnly;
    el.liveToggle.setAttribute("aria-pressed", String(state.liveOnly));
    el.liveToggle.classList.toggle("on", state.liveOnly);
    if (state.liveOnly) state.tab = "matches";
    render();
  });

  let searchT;
  el.search.addEventListener("input", () => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { state.query = el.search.value.trim(); if (state.tab === "matches") renderMatches(); }, 150);
  });

  el.tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    state.tab = b.dataset.tab;
    render();
  });

  el.leagueList.addEventListener("click", (e) => {
    const star = e.target.closest("[data-fav]");
    if (star) {
      e.preventDefault();
      e.stopPropagation();
      const id = star.dataset.fav;
      state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
      saveFavs();
      render();
    }
  });

  window.addEventListener("hashchange", () => selectLeague(readHashLeague()));

  el.content.addEventListener("click", (e) => {
    const m = e.target.closest(".match");
    if (m) openMatch(m.dataset.event);
  });

  $("#modalClose").addEventListener("click", () => el.modal.close());
  el.modal.addEventListener("click", (e) => { if (e.target === el.modal) el.modal.close(); });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.lastUpdated && Date.now() - state.lastUpdated > REFRESH_LIVE_MS) loadDay({ silent: true });
  });

  loadDay();
})();
