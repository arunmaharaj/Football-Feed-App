/* FootyScope – Arun
 * Live football scores powered by ESPN's public (keyless) soccer feeds.
 * On Netlify, requests go through the /api/espn/* proxy defined in netlify.toml.
 * Every request falls back to calling ESPN directly if the proxy fails.
 */
(() => {
  "use strict";

  const LEAGUES = window.FOOTY_LEAGUES || [];
  const LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));
  const FEATURED = LEAGUES.filter((l) => l.tier === "featured").map((l) => l.id);
  const TOP = LEAGUES.filter((l) => l.tier === "top").map((l) => l.id);
  const PRIORITY = new Set([...FEATURED, ...TOP]);
  const PROXY_BASE = "/api/espn";
  const DIRECT_BASE = "https://site.api.espn.com/apis";
  const REFRESH_LIVE_MS = 30_000;
  const REFRESH_TODAY_MS = 2 * 60_000;
  const REFRESH_OTHER_MS = 5 * 60_000;
  const TIMEOUT_MS = 12_000;
  const CONCURRENCY = 8;

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
    league: readHashLeague(), // null = home
    tab: "matches",
    liveOnly: false,
    query: "",
    favs: new Set(loadFavs()),
    // leagueId -> { league, events, latest, loaded, failed }
    data: {},
    loading: false,
    loadToken: 0,
    lastUpdated: null,
    timer: null,
    proxyFailures: 0,
    standingsCache: {},
  };

  /* ---------------- utilities ---------------- */

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function localDateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayLocal() { return localDateKey(new Date()); }
  function shiftDate(iso, days) {
    const [y, m, d] = iso.split("-").map(Number);
    return localDateKey(new Date(y, m - 1, d + days));
  }
  function espnDate(iso) { return iso.replace(/-/g, ""); }
  function fmtTime(dateStr) { return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function fmtShortDate(dateStr) { return new Date(dateStr).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }); }
  function fmtDateLong(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  function dayLabel(iso) {
    if (iso === todayLocal()) return "today";
    if (iso === shiftDate(todayLocal(), -1)) return "yesterday";
    if (iso === shiftDate(todayLocal(), 1)) return "tomorrow";
    return "on " + fmtDateLong(iso);
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
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return JSON.parse(text); // throws on an HTML error page
    } finally {
      clearTimeout(t);
    }
  }

  // path is relative to ESPN's /apis, e.g. "site/v2/sports/soccer/eng.1/scoreboard".
  // Tries the Netlify proxy first, then ESPN directly. If the proxy keeps failing,
  // stop using it for the rest of the session.
  async function api(path) {
    if (state.proxyFailures < 3) {
      try {
        const json = await fetchJson(`${PROXY_BASE}/${path}`);
        state.proxyFailures = 0;
        return json;
      } catch {
        state.proxyFailures++;
      }
    }
    return fetchJson(`${DIRECT_BASE}/${path}`);
  }

  async function pool(items, limit, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try { await fn(item); } catch { /* handled inside fn */ }
      }
    });
    await Promise.all(workers);
  }

  // ESPN groups matches by its own calendar day (US time). To show every match on the
  // user's *local* day we query that day plus the neighbouring day(s) it overlaps.
  function espnDaysFor(iso) {
    const offsetH = -new Date().getTimezoneOffset() / 60;
    const days = [iso];
    if (offsetH > -5) days.unshift(shiftDate(iso, -1)); // ahead of US Eastern
    if (offsetH < 0) days.push(shiftDate(iso, 1)); // behind UTC
    return days;
  }

  function leagueMeta(leagueId, json) {
    const lg = (json && json.leagues && json.leagues[0]) || {};
    const known = LEAGUE_BY_ID[leagueId] || {};
    return {
      id: leagueId,
      name: known.name || lg.name || leagueId,
      region: known.region || "",
      tier: known.tier || "",
      logo: lg.logos?.[0]?.href || "",
    };
  }

  async function fetchDay(leagueId, isoDate) {
    const days = espnDaysFor(isoDate);
    const settled = await Promise.allSettled(
      days.map((d) => api(`site/v2/sports/soccer/${leagueId}/scoreboard?dates=${espnDate(d)}`))
    );
    const ok = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
    if (!ok.length) throw new Error("all requests failed");
    const seen = new Set();
    const events = [];
    for (const json of ok) {
      for (const raw of json.events || []) {
        if (seen.has(raw.id)) continue;
        seen.add(raw.id);
        if (localDateKey(new Date(raw.date)) !== isoDate) continue;
        const ev = normalizeEvent(raw);
        if (ev) events.push(ev);
      }
    }
    return { league: leagueMeta(leagueId, ok[0]), events };
  }

  // ESPN's default scoreboard (no date) returns the league's current matchday,
  // which is used to show something useful when there are no games on the chosen day.
  async function fetchLatest(leagueId) {
    const json = await api(`site/v2/sports/soccer/${leagueId}/scoreboard`);
    const events = (json.events || []).map(normalizeEvent).filter(Boolean);
    return { league: leagueMeta(leagueId, json), events };
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
      id: String(ev.id),
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

  function entry(id) {
    if (!state.data[id]) state.data[id] = { league: leagueMeta(id), events: [], latest: null, loaded: false, failed: false };
    return state.data[id];
  }

  async function loadOne(id, date, token) {
    const e = entry(id);
    try {
      const r = await fetchDay(id, date);
      if (token !== state.loadToken) return;
      e.league = { ...e.league, ...r.league, logo: r.league.logo || e.league.logo };
      e.events = r.events;
      e.failed = false;
    } catch {
      if (token !== state.loadToken) return;
      e.failed = !e.loaded || e.failed; // keep showing stale data on a failed refresh
    }
    e.loaded = true;
    // Featured/top leagues (and the selected league) always show something:
    // if nothing is on that day, fetch their current matchday.
    if ((PRIORITY.has(id) || id === state.league) && !e.events.length && !e.latest) await loadLatest(id, token);
    scheduleRender();
  }

  async function loadLatest(id, token = state.loadToken) {
    const e = entry(id);
    e.latestPending = true;
    try {
      const r = await fetchLatest(id);
      if (token !== state.loadToken) return;
      e.latest = r.events;
      if (!e.league.logo) e.league.logo = r.league.logo;
    } catch {
      if (token === state.loadToken) e.latest = e.latest || [];
    } finally {
      e.latestPending = false;
    }
    scheduleRender();
  }

  async function loadDay({ silent = false } = {}) {
    const token = ++state.loadToken;
    const date = state.date;
    clearTimeout(state.timer);
    let ids;
    if (silent) {
      // refresh only what matters: priority leagues, the selected league and leagues with games
      ids = LEAGUES.map((l) => l.id).filter((id) => PRIORITY.has(id) || id === state.league || state.data[id]?.events.length || state.data[id]?.failed);
    } else {
      state.data = {};
      ids = LEAGUES.map((l) => l.id);
      // selected league first, then European cups, top 5, then the rest
      ids.sort((a, b) => rank(a) - rank(b));
      ids.forEach(entry);
    }
    state.loading = true;
    if (!silent) render();
    await pool(ids, CONCURRENCY, (id) => loadOne(id, date, token));
    if (token !== state.loadToken) return;
    state.loading = false;
    state.lastUpdated = new Date();
    render();
    scheduleRefresh();
  }

  function rank(id) {
    if (id === state.league) return 0;
    if (FEATURED.includes(id)) return 1;
    if (TOP.includes(id)) return 2;
    if (state.favs.has(id)) return 3;
    return 4;
  }

  function scheduleRefresh() {
    clearTimeout(state.timer);
    const anyLive = allEvents().some((e) => e.state === "in");
    const ms = anyLive ? REFRESH_LIVE_MS : state.date === todayLocal() ? REFRESH_TODAY_MS : REFRESH_OTHER_MS;
    state.timer = setTimeout(() => {
      if (document.hidden) return scheduleRefresh();
      loadDay({ silent: true });
    }, ms);
  }

  function allEvents() {
    return Object.values(state.data).flatMap((d) => d.events);
  }

  /* ---------------- rendering ---------------- */

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function render() {
    renderSidebar();
    el.tabs.hidden = !state.league;
    el.tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
    if (state.league && state.tab === "table") {
      if (!el.content.querySelector(`[data-standings="${state.league}"]`)) renderStandings(state.league);
    } else if (state.league) renderLeague(state.league);
    else if (state.query || state.liveOnly) renderFiltered();
    else renderHome();
    renderStatus();
  }

  function renderStatus() {
    const entries = Object.values(state.data);
    const evs = allEvents();
    const live = evs.filter((e) => e.state === "in").length;
    const comps = entries.filter((d) => d.events.length).length;
    const done = entries.filter((d) => d.loaded).length;
    const failed = entries.filter((d) => d.failed).length;
    const day = state.date === todayLocal() ? "Today" : fmtDateLong(state.date);
    let text = `${day} · ${evs.length} matches in ${comps} competitions${live ? ` · ${live} live` : ""}`;
    if (state.loading && done < entries.length) text += ` · loading ${done}/${entries.length}…`;
    else if (state.lastUpdated) text += ` · updated ${state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (failed && !state.loading) text += failed === entries.length ? " · ⚠ couldn't reach the score feed, tap Refresh" : ` · ${failed} feeds unavailable`;
    el.status.textContent = text;
  }

  function renderSidebar() {
    const regions = [];
    const byRegion = {};
    for (const l of LEAGUES) {
      if (!byRegion[l.region]) { byRegion[l.region] = []; regions.push(l.region); }
      byRegion[l.region].push(l);
    }
    const total = allEvents().length;
    const totalLive = allEvents().filter((e) => e.state === "in").length;

    const item = (l) => {
      const d = state.data[l.id];
      const c = d?.events.length || 0;
      const lv = d?.events.filter((e) => e.state === "in").length || 0;
      const logo = d?.league.logo;
      const fav = state.favs.has(l.id);
      const dim = !c && !PRIORITY.has(l.id) && d?.loaded;
      return `<a href="#/${esc(l.id)}" class="lg-item ${state.league === l.id ? "active" : ""} ${dim ? "empty" : ""}">
        ${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" />` : `<span class="lg-dot"></span>`}
        <span class="lg-name">${esc(l.name)}</span>
        ${lv ? `<span class="badge live">${lv}</span>` : c ? `<span class="badge">${c}</span>` : ""}
        <button class="star ${fav ? "on" : ""}" data-fav="${esc(l.id)}" aria-label="${fav ? "Unpin" : "Pin"} ${esc(l.name)}" title="Pin to top">★</button>
      </a>`;
    };

    let html = `<a href="#/" class="lg-item all ${state.league ? "" : "active"}">
        <span class="lg-dot all"></span><span class="lg-name">Home</span>
        ${totalLive ? `<span class="badge live">${totalLive}</span>` : total ? `<span class="badge">${total}</span>` : ""}
      </a>`;
    const favList = LEAGUES.filter((l) => state.favs.has(l.id));
    if (favList.length) html += `<div class="lg-region static">Pinned</div>` + favList.map(item).join("");
    for (const r of regions) {
      const ls = byRegion[r];
      const open = ls.some((l) => PRIORITY.has(l.id) || state.data[l.id]?.events.length || l.id === state.league);
      html += `<details class="lg-group" ${open ? "open" : ""}><summary class="lg-region">${esc(r)}</summary>${ls.map(item).join("")}</details>`;
    }
    // Phone layout: a single horizontal chip row (Home, cups, top 5, pinned, leagues with games)
    const chipIds = LEAGUES.filter((l) => PRIORITY.has(l.id) || state.favs.has(l.id) || state.data[l.id]?.events.length || l.id === state.league);
    const chip = (href, label, active, badge) => `<a href="${href}" class="chip ${active ? "active" : ""}">${esc(label)}${badge || ""}</a>`;
    const chips = chip("#/", "Home", !state.league, totalLive ? `<span class="badge live">${totalLive}</span>` : "") +
      chipIds.map((l) => {
        const lv = state.data[l.id]?.events.filter((e) => e.state === "in").length || 0;
        return chip(`#/${esc(l.id)}`, l.name, state.league === l.id, lv ? `<span class="badge live">${lv}</span>` : "");
      }).join("");
    el.leagueList.innerHTML = `<div class="chips">${chips}</div><div class="lg-tree">${html}</div>`;
  }

  function teamLogo(t, cls = "crest") {
    const fb = esc(initials(t.name));
    return t.logo
      ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" data-fb="${fb}" />`
      : `<span class="${cls} crest-fallback">${fb}</span>`;
  }

  function statusCell(ev, withDate) {
    if (ev.state === "in") {
      const isHT = ev.statusName === "STATUS_HALFTIME" || /^HT$/i.test(ev.detail);
      const label = isHT ? "HT" : ev.clock || ev.detail || "LIVE";
      return `<span class="st live"><span class="pulse"></span>${esc(label)}</span>`;
    }
    const dateLine = withDate ? `<small>${esc(fmtShortDate(ev.date))}</small>` : "";
    if (ev.state === "post") {
      const label = /postpon/i.test(ev.statusName) ? "PPD" : /cancel/i.test(ev.statusName) ? "CAN" : /abandon/i.test(ev.statusName) ? "ABD" : (ev.detail || "FT");
      return `<span class="st ft">${dateLine}${esc(label)}</span>`;
    }
    if (/postpon/i.test(ev.statusName)) return `<span class="st ft">${dateLine}PPD</span>`;
    return `<span class="st pre">${dateLine}${esc(fmtTime(ev.date))}</span>`;
  }

  function matchRow(ev, { withDate = false, league = null } = {}) {
    const showScore = ev.state !== "pre" && ev.home.score !== "" && !/postpon|cancel/i.test(ev.statusName);
    const pens = ev.home.shootout != null && ev.away.shootout != null ? `<span class="pens">(${esc(ev.home.shootout)}–${esc(ev.away.shootout)} p)</span>` : "";
    const red = (n) => (n ? `<span class="redcard" title="${n} red card${n > 1 ? "s" : ""}">${n > 1 ? n : ""}</span>` : "");
    const win = (t) => (ev.state === "post" && t.winner ? "win" : "");
    return `<button class="match ${ev.state}" data-event="${esc(ev.id)}">
      ${league ? `<span class="m-league">${league.logo ? `<img src="${esc(league.logo)}" alt="" />` : ""}${esc(league.name)}</span>` : ""}
      <span class="m-status">${statusCell(ev, withDate)}</span>
      <span class="m-team home ${win(ev.home)}"><span class="t-name">${esc(ev.home.name)}</span>${red(ev.home.redCards)}${teamLogo(ev.home)}</span>
      <span class="m-score">${showScore ? `<b>${esc(ev.home.score)}</b><i>–</i><b>${esc(ev.away.score)}</b>` : `<span class="vs">vs</span>`}${pens}</span>
      <span class="m-team away ${win(ev.away)}">${teamLogo(ev.away)}${red(ev.away.redCards)}<span class="t-name">${esc(ev.away.name)}</span></span>
    </button>`;
  }

  function sortEvents(events) {
    const r = { in: 0, pre: 1, post: 2 };
    return [...events].sort((a, b) => (r[a.state] - r[b.state]) || new Date(a.date) - new Date(b.date));
  }

  function skeletonRows(n = 3) { return Array.from({ length: n }, () => `<div class="sk sk-row"></div>`).join(""); }

  // A league card. Priority leagues never disappear from the home page: they show the
  // chosen day's games, or their current matchday, or a clear empty/error message.
  function leagueCard(id, { big = false } = {}) {
    const d = entry(id);
    const lg = d.league;
    const live = d.events.some((e) => e.state === "in");
    let body;
    let sub = esc(lg.region);
    if (d.events.length) {
      body = sortEvents(d.events).map((ev) => matchRow(ev)).join("");
    } else if (!d.loaded || d.latestPending) {
      body = skeletonRows(big ? 3 : 2);
    } else if (d.latest && d.latest.length) {
      const anyFuture = d.latest.some((e) => e.state !== "post");
      sub = `No matches ${esc(dayLabel(state.date))} · showing ${anyFuture ? "next matchday" : "latest results"}`;
      body = sortEvents(d.latest).map((ev) => matchRow(ev, { withDate: true })).join("");
    } else if (d.failed) {
      body = `<div class="card-msg">Couldn't load this competition. <button class="link-btn" data-retry="${esc(id)}">Retry</button></div>`;
    } else {
      body = `<div class="card-msg">No matches ${esc(dayLabel(state.date))}.</div>`;
    }
    return `<section class="card ${big ? "big" : ""}">
      <header class="card-head">
        ${lg.logo ? `<img class="lg-logo" src="${esc(lg.logo)}" alt="" loading="lazy" />` : `<span class="lg-logo lg-dot"></span>`}
        <div class="card-title">
          <a href="#/${esc(id)}" class="lg-link">${esc(lg.name)}</a>
          <span class="lg-region-sm">${sub}</span>
        </div>
        ${live ? `<span class="live-chip"><span class="pulse"></span>LIVE</span>` : ""}
      </header>
      <div class="matches">${body}</div>
    </section>`;
  }

  function renderHome() {
    const live = [];
    for (const l of LEAGUES) {
      const d = state.data[l.id];
      if (d) d.events.filter((e) => e.state === "in").forEach((ev) => live.push({ ev, league: d.league }));
    }
    const others = LEAGUES.filter((l) => !PRIORITY.has(l.id) && state.data[l.id]?.events.length)
      .sort((a, b) => {
        const fa = state.favs.has(a.id) ? 0 : 1, fb = state.favs.has(b.id) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const la = state.data[a.id].events.some((e) => e.state === "in") ? 0 : 1;
        const lb = state.data[b.id].events.some((e) => e.state === "in") ? 0 : 1;
        return la - lb;
      });
    const othersLoading = state.loading && LEAGUES.some((l) => !PRIORITY.has(l.id) && !state.data[l.id]?.loaded);

    let html = "";
    if (live.length) {
      html += `<h2 class="section-title"><span class="pulse"></span>Live now</h2>
        <section class="card live-card"><div class="matches">${live.map(({ ev, league }) => matchRow(ev, { league })).join("")}</div></section>`;
    }
    html += `<h2 class="section-title">European Cups</h2><div class="grid-cards one">${FEATURED.map((id) => leagueCard(id, { big: true })).join("")}</div>`;
    html += `<h2 class="section-title">Top 5 Leagues</h2><div class="grid-cards">${TOP.map((id) => leagueCard(id)).join("")}</div>`;
    if (others.length || othersLoading) {
      html += `<h2 class="section-title">More football ${esc(dayLabel(state.date))}</h2>`;
      html += others.map((l) => leagueCard(l.id)).join("");
      if (othersLoading) html += `<section class="card">${skeletonRows(2)}</section>`;
    }
    el.content.innerHTML = html;
  }

  function renderFiltered() {
    const q = state.query.toLowerCase();
    const groups = [];
    for (const l of LEAGUES) {
      const d = state.data[l.id];
      if (!d) continue;
      let events = d.events;
      if (state.liveOnly) events = events.filter((ev) => ev.state === "in");
      if (q) events = events.filter((ev) => [d.league.name, d.league.region, ev.home.name, ev.away.name].some((s) => String(s).toLowerCase().includes(q)));
      if (events.length) groups.push({ d, events });
    }
    if (!groups.length) {
      el.content.innerHTML = emptyState(state.liveOnly ? "No live matches right now" : "No matches match your search",
        state.liveOnly ? "Turn off the Live filter to see all fixtures and results." : "Try another team, league or date.");
      return;
    }
    el.content.innerHTML = groups.map(({ d, events }) => `
      <section class="card">
        <header class="card-head">
          ${d.league.logo ? `<img class="lg-logo" src="${esc(d.league.logo)}" alt="" loading="lazy" />` : ""}
          <div class="card-title"><a href="#/${esc(d.league.id)}" class="lg-link">${esc(d.league.name)}</a><span class="lg-region-sm">${esc(d.league.region)}</span></div>
        </header>
        <div class="matches">${sortEvents(events).map((ev) => matchRow(ev)).join("")}</div>
      </section>`).join("");
  }

  function renderLeague(id) {
    const d = entry(id);
    if (d.loaded && !d.events.length && d.latest === null && !d.latestPending) loadLatest(id);
    el.content.innerHTML = leagueCard(id, { big: true });
  }

  function emptyState(title, text) {
    return `<div class="empty-state"><div class="empty-ball">⚽</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
  }

  /* ---------------- standings ---------------- */

  async function renderStandings(leagueId) {
    el.content.innerHTML = `<section class="card" data-standings="${esc(leagueId)}">${skeletonRows(5)}</section>`;
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
      el.content.innerHTML = `<div data-standings="${esc(leagueId)}">${emptyState("No table available", json ? "This competition doesn't have a league table right now (it may be in a knockout stage)." : "Couldn't reach the standings feed. Try Refresh.")}</div>`;
      return;
    }

    const stat = (e, n) => (e.stats || []).find((x) => x.name === n || x.type === n);
    const val = (e, n) => { const s = stat(e, n); return s ? (s.displayValue ?? s.value ?? "") : ""; };
    const num = (e, n) => { const s = stat(e, n); return s ? Number(s.value ?? s.displayValue) || 0 : 0; };
    const liveTeams = new Set(allEvents().filter((ev) => ev.state === "in").flatMap((ev) => [ev.home.id, ev.away.id]));

    el.content.innerHTML = `<div data-standings="${esc(leagueId)}">` + tables.map((t) => {
      const rows = [...t.entries].sort((a, b) => (num(a, "rank") || 999) - (num(b, "rank") || 999) || num(b, "points") - num(a, "points"));
      return `<section class="card">
        ${t.name ? `<header class="card-head"><div class="card-title"><span class="lg-link">${esc(t.name)}</span></div></header>` : ""}
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
    }).join("") + `</div>`;
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
      const ev = d.events.find((e) => e.id === id) || (d.latest || []).find((e) => e.id === id);
      if (ev) return { ev, league: d.league };
    }
    return null;
  }

  function eventKind(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("own goal")) return { cls: "goal og", label: "Own goal" };
    if (t.includes("penalty") && (t.includes("miss") || t.includes("saved"))) return { cls: "miss", label: "Penalty missed" };
    if (t.includes("goal") || t.includes("scored")) return { cls: "goal", label: "Goal" };
    if (t.includes("red") || t.includes("second yellow")) return { cls: "red", label: "Red card" };
    if (t.includes("yellow")) return { cls: "yellow", label: "Yellow card" };
    if (t.includes("substitution")) return { cls: "sub", label: "Substitution" };
    return null;
  }

  async function openMatch(id) {
    const found = findEvent(id);
    if (!found) return;
    const { ev, league } = found;
    el.modalBody.innerHTML = modalHeader(ev, league) + `<div class="modal-section">${skeletonRows(2)}</div>`;
    if (typeof el.modal.showModal === "function") el.modal.showModal(); else el.modal.setAttribute("open", "");

    let summary = null;
    try { summary = await api(`site/v2/sports/soccer/${league.id}/summary?event=${encodeURIComponent(id)}`); } catch { /* fall back */ }
    if (!el.modal.open) return;

    el.modalBody.innerHTML = modalHeader(ev, league) +
      (buildTimeline(ev, summary) || `<div class="modal-section"><p class="muted">${ev.state === "pre" ? "Match hasn't started yet." : "No match events available."}</p></div>`) +
      buildStats(ev, summary);
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
          side: k.team?.id === ev.away.id ? "away" : "home",
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
          side: d.team?.id === ev.away.id ? "away" : "home",
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
    const wanted = ["possessionPct", "totalShots", "shotsOnTarget", "wonCorners", "foulsCommitted", "offsides", "yellowCards", "redCards", "saves"];
    const rows = wanted.map((name) => {
      const h = (home.statistics || []).find((s) => s.name === name);
      const a = (away.statistics || []).find((s) => s.name === name);
      if (!h || !a) return null;
      const hv = parseFloat(h.displayValue) || 0;
      const av = parseFloat(a.displayValue) || 0;
      const total = hv + av || 1;
      const pct = (s) => (name === "possessionPct" && !String(s.displayValue).includes("%") ? `${s.displayValue}%` : s.displayValue);
      return `<div class="stat">
        <div class="stat-vals"><b>${esc(pct(h))}</b><span>${esc(h.label || name)}</span><b>${esc(pct(a))}</b></div>
        <div class="stat-bar"><i class="h" style="width:${(hv / total) * 100}%"></i><i class="a" style="width:${(av / total) * 100}%"></i></div>
      </div>`;
    }).filter(Boolean);
    return rows.length ? `<div class="modal-section"><h3>Stats</h3>${rows.join("")}</div>` : "";
  }

  /* ---------------- events / wiring ---------------- */

  function setDate(iso) {
    state.date = iso;
    el.datePicker.value = iso;
    loadDay();
  }

  el.datePicker.value = state.date;
  el.datePicker.addEventListener("change", () => el.datePicker.value && setDate(el.datePicker.value));
  $("#prevDay").addEventListener("click", () => setDate(shiftDate(state.date, -1)));
  $("#nextDay").addEventListener("click", () => setDate(shiftDate(state.date, 1)));
  $("#todayBtn").addEventListener("click", () => setDate(todayLocal()));
  $("#refreshBtn").addEventListener("click", () => { state.standingsCache = {}; state.proxyFailures = 0; loadDay(); });

  el.liveToggle.addEventListener("click", () => {
    state.liveOnly = !state.liveOnly;
    el.liveToggle.setAttribute("aria-pressed", String(state.liveOnly));
    el.liveToggle.classList.toggle("on", state.liveOnly);
    if (state.liveOnly && state.league) location.hash = "#/";
    else render();
  });

  let searchT;
  el.search.addEventListener("input", () => {
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      state.query = el.search.value.trim();
      if (state.query && state.league) location.hash = "#/";
      else render();
    }, 150);
  });

  el.tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    state.tab = b.dataset.tab;
    el.content.innerHTML = "";
    render();
  });

  el.leagueList.addEventListener("click", (e) => {
    const star = e.target.closest("[data-fav]");
    if (!star) return;
    e.preventDefault();
    e.stopPropagation();
    const id = star.dataset.fav;
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    saveFavs();
    render();
  });

  window.addEventListener("hashchange", () => {
    state.league = readHashLeague();
    state.tab = "matches";
    el.content.innerHTML = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  el.content.addEventListener("click", (e) => {
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      const id = retry.dataset.retry;
      const d = entry(id);
      d.loaded = false;
      d.failed = false;
      d.latest = null;
      render();
      loadOne(id, state.date, state.loadToken);
      return;
    }
    const m = e.target.closest(".match");
    if (m) openMatch(m.dataset.event);
  });

  // broken crest image -> initials badge
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!img || img.tagName !== "IMG" || !img.dataset.fb) return;
    const span = document.createElement("span");
    span.className = img.className + " crest-fallback";
    span.textContent = img.dataset.fb;
    img.replaceWith(span);
  }, true);

  $("#modalClose").addEventListener("click", () => el.modal.close());
  el.modal.addEventListener("click", (e) => { if (e.target === el.modal) el.modal.close(); });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.loading && state.lastUpdated && Date.now() - state.lastUpdated > REFRESH_LIVE_MS) loadDay({ silent: true });
  });

  loadDay();
})();
