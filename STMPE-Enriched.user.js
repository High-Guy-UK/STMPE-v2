// ==UserScript==
// @name         STMPE-Enriched
// @namespace    https://broadcasthe.net/
// @version      1.8.0
// @description  A combination of userscripts that enrich the TV series experience, all managed from one panel on your profile settings page. Features: Sonarr Integration, Fanart.tv Logo, IMDb Parents Guide, Trending Shows, Artwork Placeholders, Hide Empty Requests, Collapse Old Seasons, Trailer Player (fixed), Cast Row (TMDb), Enhanced Series Summary, Stamps Row, and Fan Art Carousels.
// @author       Prism16
// @match        *://broadcasthe.net/*
// @match        *://www.broadcasthe.net/*
// @updateURL    https://high-guy-uk.github.io/STMPE-v2/STMPE-Enriched.user.js
// @downloadURL  https://high-guy-uk.github.io/STMPE-v2/STMPE-Enriched.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Which BTN page are we on? The script now works on two:
  //   • series.php            -> banner pills (per-server red/green status)
  //   • user.php?action=edit  -> the two settings panels (Manager + Sonarr Settings)
  const PATH = location.pathname;
  const IS_SERIES = /^\/series\.php\b/i.test(PATH);
  const IS_EDIT   = /^\/user\.php\b/i.test(PATH) && /(?:^|[?&])action=edit(?:&|$)/i.test(location.search);
  const IS_HOME   = /^\/(index\.php)?$/i.test(PATH);
  // The placeholder feature runs on ANY BTN page (series, torrents browse, etc.),
  // so we only bail out if we're somehow not on BroadcasTheNet at all.
  if (!/(^|\.)broadcasthe\.net$/i.test(location.hostname)) return;

  /* =========================================================================
   * Storage (shared GM cache — synchronous reads after one async hydrate)
   * =======================================================================*/
  const STORE_KEY = 'btn_sonarr_servers_v1';
  const FEAT_KEY  = 'btn_userscript_features_v1';
  const KEYS_KEY  = 'btn_userscript_keys_v1';

  const GMstore = {
    get(key, def) {
      if (typeof GM_getValue === 'function') return Promise.resolve(GM_getValue(key, def));
      if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') return Promise.resolve(GM.getValue(key, def));
      try { const v = localStorage.getItem('GM_' + key); return Promise.resolve(v == null ? def : v); }
      catch (e) { return Promise.resolve(def); }
    },
    set(key, val) {
      if (typeof GM_setValue === 'function') { try { GM_setValue(key, val); } catch (e) {} return Promise.resolve(); }
      if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') return Promise.resolve(GM.setValue(key, val));
      try { localStorage.setItem('GM_' + key, val); } catch (e) {}
      return Promise.resolve();
    }
  };

  /* ---- servers ---- */
  let serversCache = [];
  function parseServers(raw) {
    try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function loadServers() { return serversCache.map(s => Object.assign({}, s)); }
  function saveServers(list) {
    serversCache = list.map(s => Object.assign({}, s));
    GMstore.set(STORE_KEY, JSON.stringify(serversCache));
  }
  function newId() { return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function blankServer() {
    return {
      id: newId(), name: '', url: '', apiKey: '',
      qualityProfileId: null, rootFolderPath: '', languageProfileId: null,
      seasonFolder: true, searchOnAdd: true, monitor: 'all',
      _profiles: [], _rootFolders: [], _languageProfiles: [], _version: null
    };
  }

  /* ---- feature flags (Userscript Manager) ---- */
  const FEATURE_DEFS = [
    { id: 'sonarr', name: 'Sonarr Integration', def: true,
      desc: 'Add a red/green Sonarr status link per server to the series link bar, and add shows to Sonarr in one click.' },
    { id: 'seasons', name: 'Collapse Old Seasons', def: true,
      desc: 'On series pages, automatically collapse every season except the most recent. The (show)/(hide) links stay clickable to expand any season.' },
    { id: 'fanart', name: 'Fanart.tv Logo', def: true, needsKey: true, keyLabel: 'Fanart.tv API Key',
      defKey: '8a3d24a20c50c65c9f729fa3e67eebd2', keyPlaceholder: 'Your fanart.tv personal API key',
      desc: 'Fetch the show’s HD clear logo from fanart.tv and place it at the top of the series sidebar.' },
    { id: 'parents', name: 'IMDb Parents Guide', def: true,
      desc: 'Show a colour-coded Parents Guide (nudity, violence, profanity, etc.) as category cards below the torrent table on series pages, with a UK certificate badge and 7-day caching.' },
    { id: 'trending', name: 'Trending Shows (Homepage)', def: true, needsKey: true, keyLabel: 'TMDb API Key',
      defKey: '75c8f6d3dd058fe33f10db544d0cbb6b', keyPlaceholder: 'Your TMDb API v3 key',
      desc: 'Add a row of today’s trending TV shows from TMDb to the top of the homepage, each linking to a BTN series search.' },
    { id: 'placeholder', name: 'Artwork Placeholders', def: true,
      desc: 'Replace BTN’s default “No Poster / No Banner / No Fan Art” images with a clean placeholder that matches the theme — everywhere they appear, including torrent-table thumbnails.' },
    { id: 'hidereq', name: 'Hide Empty Requests', def: true,
      desc: 'On a series page, hide the Requests section entirely when it has no open requests (“Nothing found!”).' },
    { id: 'trailer', name: 'Trailer Player (fixed)', def: true,
      desc: 'Fix the broken (Flash / Error 153) trailer: play it in a clean pop-up YouTube player. Uses the show’s BTN trailer, falling back to TMDb’s official trailer when BTN has none (uses the TMDb key above).' },
    { id: 'actors', name: 'Cast Row (TMDb)', def: true,
      desc: 'Replace BTN’s plain sidebar Actors list with a horizontal cast row above the Fan Art — TMDb photos and character names, each still linking to the actor’s BTN page (uses the TMDb key above).' },
    { id: 'enhsummary', name: 'Enhanced Series Summary', def: true,
      desc: 'Fold the sidebar Latest Episode, Next Episode and Genres panels into the Series Summary card and enrich it with TMDb (rating, status, network, run, episode stills/dates). Keeps the existing description and external links, and hides the broken YouTube/Flash sidebar card.' },
    { id: 'stamps', name: 'Stamps Row', def: true,
      desc: 'Move the Buy Stamps panel out of the sidebar into a long horizontal row across the bottom of the main column.' },
    { id: 'artwork', name: 'Fan Art Carousels', def: true,
      desc: 'Fill the Series Fan Art card with fanart.tv artwork — backgrounds, posters, banners, thumbnails, clear art, character art and logos — as controllable single-image carousels (uses the Fanart.tv key above).' }
    // future features slot in here — the manager panel renders whatever is listed.
  ];
  let featuresCache = {};
  let keysCache = {};
  function isEnabled(id) {
    if (Object.prototype.hasOwnProperty.call(featuresCache, id)) return !!featuresCache[id];
    const d = FEATURE_DEFS.find(f => f.id === id);
    return d ? !!d.def : false;
  }
  function setFeature(id, on) {
    featuresCache[id] = !!on;
    GMstore.set(FEAT_KEY, JSON.stringify(featuresCache));
  }
  function getKey(id) {
    if (Object.prototype.hasOwnProperty.call(keysCache, id)) return keysCache[id] || '';
    const d = FEATURE_DEFS.find(f => f.id === id);
    return (d && d.defKey) ? d.defKey : '';
  }
  function setKey(id, val) {
    keysCache[id] = val;
    GMstore.set(KEYS_KEY, JSON.stringify(keysCache));
  }

  async function initStorage() {
    const [rawServers, rawFeat, rawKeys] = await Promise.all([
      GMstore.get(STORE_KEY, '[]'),
      GMstore.get(FEAT_KEY, '{}'),
      GMstore.get(KEYS_KEY, '{}')
    ]);
    serversCache = parseServers(rawServers);
    try { featuresCache = JSON.parse(rawFeat || '{}') || {}; } catch (e) { featuresCache = {}; }
    try { keysCache = JSON.parse(rawKeys || '{}') || {}; } catch (e) { keysCache = {}; }
  }

  /* =========================================================================
   * Sonarr API helper (GM_xmlhttpRequest bypasses CORS / mixed content)
   * =======================================================================*/
  function normBase(url) {
    let u = (url || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '');
  }
  function gmXhr(opts) {
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest(opts);
    if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest(opts);
    throw new Error('No GM_xmlhttpRequest / GM.xmlHttpRequest available — check the userscript @grant lines');
  }
  function sonarrRequest(server, path, { method = 'GET', body = null } = {}) {
    const url = normBase(server.url) + path;
    return new Promise((resolve, reject) => {
      gmXhr({
        method, url,
        headers: { 'X-Api-Key': (server.apiKey || '').trim(), 'Accept': 'application/json', 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 15000,
        onload: (res) => {
          let data = null;
          try { data = res.responseText ? JSON.parse(res.responseText) : null; } catch (e) {}
          if (res.status >= 200 && res.status < 300) resolve({ status: res.status, data });
          else reject({
            status: res.status,
            message: (data && (data.message || data.error)) ||
                     (res.status === 401 ? 'Unauthorized — check the API key' :
                      res.status === 404 ? 'Endpoint not found — check the URL / base path' : 'HTTP ' + res.status),
            data
          });
        },
        ontimeout: () => reject({ status: 0, message: 'Request timed out (15s)' }),
        onerror: () => reject({ status: 0, message: 'Network error — URL unreachable, or Sonarr not running' })
      });
    });
  }
  const SonarrAPI = {
    status: (s) => sonarrRequest(s, '/api/v3/system/status'),
    qualityProfiles: (s) => sonarrRequest(s, '/api/v3/qualityprofile'),
    rootFolders: (s) => sonarrRequest(s, '/api/v3/rootfolder'),
    languageProfiles: (s) => sonarrRequest(s, '/api/v3/languageprofile'),
    lookup: (s, term) => sonarrRequest(s, '/api/v3/series/lookup?term=' + encodeURIComponent(term)),
    seriesByTvdb: (s, tvdbId) => sonarrRequest(s, '/api/v3/series?tvdbId=' + encodeURIComponent(tvdbId)),
    addSeries: (s, payload) => sonarrRequest(s, '/api/v3/series', { method: 'POST', body: payload })
  };

  /* =========================================================================
   * Page facts (series identity for the add flow)
   * =======================================================================*/
  function seriesInfo() {
    try {
      const banner = document.querySelector('#banner');
      const bsrc = banner ? (banner.src || '') : '';
      let tvdbId =
        (bsrc.match(/\/v4\/series\/(\d+)\//) || [])[1] ||
        (bsrc.match(/\/series\/(\d+)\//) || [])[1] ||
        (bsrc.match(/\/graphical\/(\d+)-/) || [])[1] ||
        (bsrc.match(/\/(?:posters|fanart|seasons|banners)\/(\d+)-/) || [])[1] || null;
      if (!tvdbId) {
        const tv = document.querySelector('a[href*="thetvdb.com"]');
        if (tv) tvdbId = (tv.href.match(/[?&](?:id|seriesid)=(\d+)/i) || [])[1] || null;
      }
      const imdbA = document.querySelector('a[href*="imdb.com/title/"]');
      const imdbId = imdbA ? ((imdbA.href.match(/title\/(tt\d+)/i) || [])[1] || null) : null;
      const title = (document.title || '').replace(/\s*::\s*BroadcasTheNet\s*$/i, '').trim();
      return { tvdbId, imdbId, title };
    } catch (e) {
      return { tvdbId: null, imdbId: null, title: (document.title || '').replace(/\s*::\s*BroadcasTheNet\s*$/i, '').trim() };
    }
  }

  /* =========================================================================
   * Styles — everything keys off the STMPE theme vars, with safe fallbacks so
   * it still renders fine if the theme isn't loaded.
   * =======================================================================*/
  const CSS = `
  .snr, .snr * { box-sizing: border-box; }

  /* ---- settings panels (injected into #slider .scrollContainer) ---- */
  .snr-panel{
    background:var(--bg-2,#12151a); border:1px solid var(--line,#232830); border-radius:12px;
    padding:0 20px 18px; margin:0 0 18px; box-sizing:border-box; vertical-align:top;
    display:inline-block; width:100%; break-inside:avoid; -webkit-column-break-inside:avoid;
    color:var(--text-1,#cdd4de); font-size:13px;
  }
  .snr-panel-title{
    font-family:var(--fd,inherit); font-weight:600; font-size:14px; color:var(--text-1,#cdd4de);
    letter-spacing:.01em; padding:14px 0 12px; margin-bottom:12px; border-bottom:1px solid var(--line,#232830);
  }

  /* ---- manager feature rows ---- */
  .snr-feat{ display:flex; align-items:flex-start; gap:14px; padding:11px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .snr-feat:last-child{ border-bottom:none; }
  .snr-feat .meta{ flex:1 1 auto; min-width:0; }
  .snr-feat .meta b{ color:var(--text,#f4f7fb); font-weight:600; }
  .snr-feat .meta .d{ color:var(--text-3,#7d8794); font-size:11.5px; margin-top:3px; line-height:1.5; }
  .snr-keyrow{ margin-top:9px; }
  .snr-keyrow > label{ display:block; margin-bottom:5px; color:var(--text-2,#9aa4b2); font-weight:600; font-size:11.5px; }
  .snr-keyinput{
    width:100%; padding:7px 10px; background:var(--bg-1,#0c0e12); color:var(--text,#f4f7fb);
    border:1px solid var(--line-2,#2d333c); border-radius:8px; font-size:12.5px; letter-spacing:.02em;
    font-family:var(--ff,inherit);
  }
  .snr-keyinput:focus{ outline:none; border-color:var(--accent,#1f9dff); box-shadow:0 0 0 3px rgba(31,157,255,.15); }

  /* toggle switch */
  .snr-switch{ position:relative; width:42px; height:23px; flex:0 0 auto; display:inline-block; cursor:pointer; margin-top:2px; }
  .snr-switch input{ position:absolute; opacity:0; width:0; height:0; }
  .snr-switch .track{ position:absolute; inset:0; background:var(--bg-4,#20252d); border:1px solid var(--line-2,#2d333c); border-radius:999px; transition:.15s; }
  .snr-switch .thumb{ position:absolute; top:3px; left:3px; width:17px; height:17px; border-radius:50%; background:var(--text-3,#7d8794); transition:.15s; }
  .snr-switch input:checked ~ .track{ background:rgba(31,157,255,.22); border-color:var(--accent,#1f9dff); }
  .snr-switch input:checked ~ .thumb{ left:22px; background:var(--accent-bright,#3fc8ff); }

  /* ---- fields ---- */
  .snr-field{ margin-bottom:14px; }
  .snr-field > label{ display:block; margin-bottom:5px; color:var(--text-2,#9aa4b2); font-weight:600; font-size:12px; }
  .snr-field input[type=text], .snr-field input[type=url], .snr-field input[type=password], .snr-field select{
    width:100%; padding:8px 10px; background:var(--bg-1,#0c0e12); color:var(--text,#f4f7fb);
    border:1px solid var(--line-2,#2d333c); border-radius:8px; font-size:13px;
  }
  .snr-field input:focus, .snr-field select:focus{ outline:none; border-color:var(--accent,#1f9dff); box-shadow:0 0 0 3px rgba(31,157,255,.15); }
  .snr-row{ display:flex; gap:12px; flex-wrap:wrap; } .snr-row > .snr-field{ flex:1 1 200px; }
  .snr-inline{ display:flex; gap:8px; align-items:center; } .snr-inline input{ flex:1; }
  .snr-hint{ color:var(--text-3,#7d8794); font-size:11px; margin-top:4px; line-height:1.5; }
  .snr-toggle{ display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--text-1,#cdd4de); font-weight:500; }

  /* ---- ghost buttons (match theme) ---- */
  .snr-btn{
    cursor:pointer; font-family:var(--fd,inherit); font-weight:600; font-size:12px; letter-spacing:.01em;
    padding:7px 14px; border-radius:9px; border:1px solid var(--line-2,#2d333c);
    background:transparent; color:var(--accent-bright,#3fc8ff); transition:.15s;
  }
  .snr-btn:hover{ color:#fff; border-color:var(--accent,#1f9dff); }
  .snr-btn.danger{ color:#ff8a94; border-color:rgba(255,92,106,.4); }
  .snr-btn.danger:hover{ color:#fff; border-color:#ff5c6a; }
  .snr-btn.good{ color:#7ee2a8; border-color:rgba(57,208,138,.5); }
  .snr-btn.good:hover{ color:#fff; border-color:#39d08a; }
  .snr-btn:disabled{ opacity:.5; cursor:not-allowed; }

  /* ---- server tabs ---- */
  .snr-tabs{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
  .snr-tab{ display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border:1px solid var(--line,#232830);
    background:var(--bg-3,#181c22); color:var(--text-2,#9aa4b2); border-radius:8px; cursor:pointer; font-size:12px; }
  .snr-tab.active{ background:rgba(31,157,255,.14); border-color:var(--accent,#1f9dff); color:var(--text,#f4f7fb); }
  .snr-tab.add{ color:var(--accent-bright,#3fc8ff); font-weight:600; }
  .snr-tab .dot{ width:8px; height:8px; border-radius:50%; background:var(--text-3,#7d8794); flex:0 0 auto; }
  .snr-tab .dot.ok{ background:#39d08a; box-shadow:0 0 5px rgba(57,208,138,.7); }
  .snr-tab .dot.bad{ background:#ff5c6a; }

  /* ---- status banners ---- */
  .snr-status{ margin:6px 0 14px; padding:9px 12px; border-radius:8px; font-size:12.5px; display:none; align-items:center; gap:8px; }
  .snr-status.show{ display:flex; }
  .snr-status.ok  { background:rgba(57,208,138,.12); color:#8ff0c4; border:1px solid rgba(57,208,138,.4); }
  .snr-status.bad { background:rgba(255,92,106,.12); color:#ffb3ba; border:1px solid rgba(255,92,106,.4); }
  .snr-status.info{ background:rgba(31,157,255,.12); color:#bfe0ff; border:1px solid rgba(31,157,255,.4); }
  .snr-spin{ width:13px; height:13px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; display:inline-block; animation:snrspin .7s linear infinite; }
  @keyframes snrspin{ to{ transform:rotate(360deg);} }

  .snr-foot{ display:flex; justify-content:space-between; gap:8px; margin-top:8px; }
  .snr-foot .right{ display:flex; gap:8px; }
  .snr-note{ color:var(--text-3,#7d8794); font-size:12px; padding:6px 0 12px; line-height:1.5; }

  /* ---- link-bar status links (series page) — blend into .linkbox, colour-coded ---- */
  a.snr-lb{
    text-decoration:none; cursor:pointer; white-space:nowrap;
    font-size:12.5px; font-weight:500; transition:color .15s, opacity .15s;
  }
  a.snr-lb.wait{ color:#f4c04e; opacity:.85; cursor:default; }
  a.snr-lb.ok  { color:#5fd39a; }
  a.snr-lb.ok:hover { color:#9af0c4; }
  a.snr-lb.bad { color:#ff6b76; }
  a.snr-lb.bad:hover{ color:#ff9aa2; }
  a.snr-lb.off { color:#ff6b76; opacity:.75; cursor:default; }

  /* ---- add-to-Sonarr modal (kept, themed) ---- */
  #snr-add-ov{ position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:99999; display:none; align-items:flex-start; justify-content:center; font-family:var(--ff,Arial,sans-serif); }
  #snr-add-ov.open{ display:flex; }
  #snr-add-modal{ background:var(--bg-2,#12151a); color:var(--text-1,#cdd4de); margin-top:8vh; width:560px; max-width:94vw; max-height:84vh;
    border:1px solid var(--line,#232830); border-radius:14px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.6); display:flex; flex-direction:column; font-size:13px; }
  #snr-add-modal *{ box-sizing:border-box; }
  .snr-addhead{ display:flex; gap:14px; padding:16px 20px; border-bottom:1px solid var(--line,#232830); }
  .snr-addhead img{ width:74px; height:auto; border-radius:8px; flex:0 0 auto; background:var(--bg-1,#0c0e12); }
  .snr-addhead .meta h3{ margin:0 0 4px; font-size:16px; color:var(--text,#f4f7fb); font-family:var(--fd,inherit); }
  .snr-addhead .meta .sub{ color:var(--text-2,#9aa4b2); font-size:12px; }
  .snr-addhead .meta .srv{ margin-top:8px; font-size:12px; color:var(--accent-bright,#3fc8ff); }
  .snr-addbody{ padding:18px 20px; overflow-y:auto; }
  .snr-addfoot{ display:flex; justify-content:space-between; gap:8px; padding:12px 20px; border-top:1px solid var(--line,#232830); }

  /* ---- trailer pop-up player ---- */
  #snr-trailer-ov{ position:fixed; inset:0; background:rgba(4,6,10,.9); z-index:2147483000; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .15s; }
  #snr-trailer-ov.open{ opacity:1; }
  #snr-trailer-ov .snr-tr-box{ position:relative; width:min(92vw,1180px); }
  #snr-trailer-ov .snr-tr-frame{ position:relative; width:100%; aspect-ratio:16/9; background:#000; border:1px solid var(--line,#232830); border-radius:12px; overflow:hidden; box-shadow:0 24px 70px rgba(0,0,0,.7); }
  #snr-trailer-ov .snr-tr-frame iframe{ position:absolute; inset:0; width:100%; height:100%; border:0; }
  #snr-trailer-ov .snr-tr-msg{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:10px; color:var(--text-2,#9aa4b2); font-size:14px; }
  #snr-trailer-ov .snr-tr-x{ position:absolute; top:-44px; right:0; width:36px; height:36px; border-radius:50%; border:1px solid var(--line-2,#2d333c); background:var(--bg-2,#12151a); color:var(--text-1,#cdd4de); font-size:20px; line-height:1; cursor:pointer; transition:.15s; }
  #snr-trailer-ov .snr-tr-x:hover{ color:#fff; border-color:var(--accent,#1f9dff); }

  /* ---- cast row (TMDb photos, BTN links) ---- */
  #snr-cast .snr-cast-row{ display:flex; gap:14px; overflow-x:auto; padding:14px 16px 16px; scrollbar-width:thin; scrollbar-color:var(--line-2,#2d333c) transparent; }
  #snr-cast .snr-cast-row::-webkit-scrollbar{ height:8px; }
  #snr-cast .snr-cast-row::-webkit-scrollbar-thumb{ background:var(--line-2,#2d333c); border-radius:4px; }
  #snr-cast a.snr-cast-card{ flex:0 0 auto; width:88px; text-align:center; text-decoration:none; color:var(--text-1,#cdd4de); }
  #snr-cast .snr-cast-av{ width:78px; height:78px; border-radius:50%; background:var(--bg-3,#181c22); border:2px solid var(--line,#232830); margin:0 auto 8px; display:flex; align-items:center; justify-content:center; font-family:var(--fd,inherit); font-weight:600; font-size:22px; color:var(--text-3,#7d8794); overflow:hidden; transition:border-color .15s, transform .15s; }
  #snr-cast .snr-cast-av img{ width:100%; height:100%; object-fit:cover; display:block; }
  #snr-cast a.snr-cast-card:hover .snr-cast-av{ border-color:var(--accent,#1f9dff); transform:translateY(-2px); }
  #snr-cast a.snr-cast-card:hover .snr-cast-name{ color:var(--accent-bright,#3fc8ff); }
  #snr-cast .snr-cast-name{ font-size:12px; font-weight:600; line-height:1.25; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  #snr-cast .snr-cast-char{ font-size:11px; color:var(--text-3,#7d8794); line-height:1.25; margin-top:2px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; }

  /* ---- enhanced series summary ---- */
  #summary .ess-meta{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:14px 20px 2px; }
  #summary .ess-chip{ display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; padding:4px 10px; border-radius:999px; border:1px solid var(--line-2,#2d333c); background:var(--bg-3,#181c22); color:var(--text-1,#cdd4de); }
  #summary .ess-chip.star{ color:#f4c04e; border-color:rgba(244,192,78,.4); }
  #summary .ess-chip.status-on{ color:#7ee2a8; border-color:rgba(57,208,138,.45); }
  #summary a.ess-chip{ text-decoration:none; }
  #summary a.ess-chip:hover{ border-color:var(--accent,#1f9dff); color:var(--accent-bright,#3fc8ff); }
  #summary .ess-eps{ display:flex; gap:14px; flex-wrap:wrap; padding:6px 20px 16px; }
  #summary .ess-ep{ flex:1 1 240px; display:flex; gap:12px; background:var(--bg-2,#12151a); border:1px solid var(--line,#232830); border-radius:10px; padding:10px; min-width:0; }
  #summary .ess-ep .thumb{ flex:0 0 96px; width:96px; height:54px; border-radius:6px; object-fit:cover; background:var(--bg-3,#181c22); }
  #summary .ess-ep .who{ min-width:0; }
  #summary .ess-ep .lbl{ font-size:10.5px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--text-3,#7d8794); margin-bottom:3px; }
  #summary .ess-ep .se{ font-size:13px; font-weight:600; color:var(--text,#f4f7fb); }
  #summary .ess-ep .nm{ font-size:12px; color:var(--text-1,#cdd4de); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #summary .ess-ep .dt{ font-size:11.5px; color:var(--text-2,#9aa4b2); margin-top:3px; }
  #summary .ess-ep .cd{ color:var(--accent-bright,#3fc8ff); font-weight:600; }

  /* ---- stamps row (moved to bottom of main column) ---- */
  #snr-stamps ul.nobullet{ display:flex !important; flex-wrap:wrap; gap:12px; list-style:none; padding:14px 16px 16px; margin:0; }
  #snr-stamps ul.nobullet li{ margin:0 !important; padding:0 !important; display:inline-flex; }
  #snr-stamps ul.nobullet li a{ display:inline-flex; }
  #snr-stamps ul.nobullet li img{ height:56px; width:auto; border-radius:6px; border:1px solid var(--line,#232830); transition:.15s; display:block; }
  #snr-stamps ul.nobullet li a:hover img{ border-color:var(--accent,#1f9dff); transform:translateY(-2px); }

  /* ---- fan art carousels ---- */
  .snr-cars{ padding:14px 16px 16px; display:flex; flex-direction:column; gap:18px; }
  .snr-car-lbl{ display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:600; color:var(--text-1,#cdd4de); margin-bottom:7px; }
  .snr-car-count{ font-size:11px; color:var(--text-3,#7d8794); font-weight:500; }
  .snr-car-stage{ position:relative; width:100%; height:300px; background:transparent; border:0; border-radius:10px; overflow:hidden; display:flex; align-items:center; justify-content:center; }
  .snr-car-img{ max-width:100%; max-height:100%; object-fit:contain; display:block; }
  .snr-car-nav{ position:absolute; top:50%; transform:translateY(-50%); width:38px; height:38px; border-radius:50%; border:1px solid var(--line-2,#2d333c); background:rgba(12,14,18,.72); color:var(--text,#f4f7fb); font-size:20px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:.15s; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
  .snr-car-nav:hover{ border-color:var(--accent,#1f9dff); color:var(--accent-bright,#3fc8ff); }
  .snr-car-nav.prev{ left:12px; } .snr-car-nav.next{ right:12px; }
  .snr-car-dl{ position:absolute; bottom:10px; right:12px; font-size:11px; color:var(--text-2,#9aa4b2); text-decoration:none; background:rgba(12,14,18,.72); padding:3px 9px; border-radius:6px; border:1px solid var(--line-2,#2d333c); }
  .snr-car-dl:hover{ color:var(--accent-bright,#3fc8ff); border-color:var(--accent,#1f9dff); }
  `;

  function injectStyle() {
    if (document.getElementById('snr-style')) return;
    const st = document.createElement('style');
    st.id = 'snr-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Generic one-shot CSS injector used by the bundled feature modules.
  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* =========================================================================
   * Utils
   * =======================================================================*/
  function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s){ return escapeHtml(s); }
  function hostFrom(u){ try { return new URL(normBase(u)).host; } catch(e){ return 'Sonarr'; } }
  function bytes(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB','TB','PB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return n.toFixed(1)+' '+u[i]; }

  /* =========================================================================
   * SETTINGS PAGE — two panels injected into the profile settings grid
   * =======================================================================*/
  let servers = [];
  let activeTab = 0;

  function injectSettingsPanels() {
    const sc = document.querySelector('#slider .scrollContainer');
    if (!sc) return false;
    if (document.getElementById('snr-manager-panel')) return true;

    const mgr = document.createElement('div');
    mgr.className = 'snr snr-panel';
    mgr.id = 'snr-manager-panel';
    sc.appendChild(mgr);

    const set = document.createElement('div');
    set.className = 'snr snr-panel';
    set.id = 'snr-settings-panel';
    sc.appendChild(set);

    renderManager();
    renderSonarrSettings();
    return true;
  }

  /* ---- Userscript Manager panel ---- */
  function renderManager() {
    const p = document.getElementById('snr-manager-panel');
    if (!p) return;
    p.innerHTML = '<div class="snr-panel-title">Userscript Manager</div>';
    FEATURE_DEFS.forEach(f => {
      const row = document.createElement('div');
      row.className = 'snr-feat';
      // API-key slot for features that need one (stored as plain text so the
      // browser's password manager doesn't pop up on every click / focus).
      const keyHtml = f.needsKey ?
        `<div class="snr-keyrow"><label>${escapeHtml(f.keyLabel || 'API Key')}</label>` +
        `<input type="text" class="snr-keyinput" spellcheck="false" autocomplete="off" ` +
        `autocapitalize="off" autocorrect="off" name="snr_${escapeAttr(f.id)}_key_${Date.now().toString(36)}" ` +
        `data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" ` +
        `data-key-id="${escapeAttr(f.id)}" value="${escapeAttr(getKey(f.id))}" ` +
        `placeholder="${escapeAttr(f.keyPlaceholder || 'Paste your API key')}"></div>` : '';
      row.innerHTML =
        `<div class="meta"><b>${escapeHtml(f.name)}</b><div class="d">${escapeHtml(f.desc)}</div>${keyHtml}</div>` +
        `<label class="snr-switch"><input type="checkbox" ${isEnabled(f.id) ? 'checked' : ''}>` +
        `<span class="track"></span><span class="thumb"></span></label>`;
      row.querySelector('.snr-switch input').addEventListener('change', (e) => {
        setFeature(f.id, e.target.checked);
        if (f.id === 'sonarr') renderSonarrSettings(); // reflect enabled/disabled note
      });
      const keyInput = row.querySelector('.snr-keyinput');
      if (keyInput) {
        const save = () => setKey(keyInput.dataset.keyId, keyInput.value.trim());
        keyInput.addEventListener('change', save);
        keyInput.addEventListener('blur', save);
      }
      p.appendChild(row);
    });
  }

  /* ---- Sonarr Settings panel (the server config the script creates) ---- */
  function sq(sel) { const r = document.getElementById('snr-settings-panel'); return r ? r.querySelector(sel) : null; }

  function renderSonarrSettings() {
    const p = document.getElementById('snr-settings-panel');
    if (!p) return;
    servers = loadServers();
    if (servers.length === 0) servers.push(blankServer());
    if (activeTab < 0 || activeTab >= servers.length) activeTab = 0;

    const disabledNote = isEnabled('sonarr') ? '' :
      '<div class="snr-note">Sonarr Integration is currently turned <b>off</b> in the Userscript Manager above — ' +
      'these settings are saved but the banner pills won’t appear on series pages until you switch it on.</div>';

    p.innerHTML =
      '<div class="snr-panel-title">Sonarr Settings</div>' + disabledNote +
      '<div class="snr-tabs" data-el="tabs"></div>' +
      '<div class="snr-body" data-el="body"></div>' +
      '<div class="snr-status" data-el="status"></div>' +
      '<div class="snr-foot">' +
        '<button class="snr-btn danger" data-act="delete">Delete server</button>' +
        '<div class="right"><button class="snr-btn" data-act="test">Test</button>' +
        '<button class="snr-btn good" data-act="save">Save</button></div>' +
      '</div>';

    p.querySelector('[data-act="delete"]').addEventListener('click', onDeleteClick);
    p.querySelector('[data-act="save"]').addEventListener('click', onSaveClick);
    p.querySelector('[data-act="test"]').addEventListener('click', () => { commitCurrentForm(); testAndPopulate(servers[activeTab]); });

    renderTabs();
    renderBody();
  }

  function renderTabs() {
    const tabs = sq('[data-el="tabs"]');
    if (!tabs) return;
    tabs.innerHTML = '';
    servers.forEach((s, i) => {
      const t = document.createElement('div');
      t.className = 'snr-tab' + (i === activeTab ? ' active' : '');
      const dot = s._live === true ? 'ok' : (s._live === false ? 'bad' : '');
      t.innerHTML = `<span class="dot ${dot}"></span><span>${escapeHtml(s.name || ('Server ' + (i + 1)))}</span>`;
      t.addEventListener('click', () => { commitCurrentForm(); activeTab = i; renderTabs(); renderBody(); });
      tabs.appendChild(t);
    });
    const add = document.createElement('div');
    add.className = 'snr-tab add';
    add.textContent = '+ Add';
    add.title = 'Add another Sonarr server';
    add.addEventListener('click', () => { commitCurrentForm(); servers.push(blankServer()); activeTab = servers.length - 1; renderTabs(); renderBody(); });
    tabs.appendChild(add);
  }

  function renderBody() {
    const body = sq('[data-el="body"]');
    const s = servers[activeTab];
    if (!body) return;
    if (!s) { body.innerHTML = '<div class="snr-note">No server selected.</div>'; return; }

    body.innerHTML = `
      <div class="snr-field">
        <label>Server name</label>
        <input type="text" data-f="name" placeholder="e.g. Home Sonarr" value="${escapeAttr(s.name)}">
      </div>
      <div class="snr-field">
        <label>URL</label>
        <input type="text" data-f="url" placeholder="http://192.168.1.50:8989" value="${escapeAttr(s.url)}">
        <div class="snr-hint">Include http/https, host and port. Add a base path if Sonarr sits behind a reverse proxy (e.g. https://host/sonarr).</div>
      </div>
      <div class="snr-field">
        <label>API Key</label>
        <input type="text" data-f="apiKey" spellcheck="false" autocomplete="off" autocapitalize="off"
          autocorrect="off" name="snr_sonarr_key_${Date.now().toString(36)}"
          data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"
          placeholder="Sonarr → Settings → General → API Key" value="${escapeAttr(s.apiKey)}">
      </div>
      <div class="snr-row">
        <div class="snr-field">
          <label>Quality Profile</label>
          <select data-f="qualityProfileId"><option value="">— test connection first —</option></select>
        </div>
        <div class="snr-field">
          <label>Root Folder</label>
          <select data-f="rootFolderPath"><option value="">— test connection first —</option></select>
        </div>
      </div>
      <div class="snr-row">
        <div class="snr-field" data-el="langWrap" style="display:none;">
          <label>Language Profile</label>
          <select data-f="languageProfileId"></select>
        </div>
        <div class="snr-field">
          <label>Default monitor</label>
          <select data-f="monitor">
            ${['all','future','missing','existing','firstSeason','lastSeason','pilot','none']
              .map(v=>`<option value="${v}" ${s.monitor===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="snr-field"><label class="snr-toggle"><input type="checkbox" data-f="seasonFolder" ${s.seasonFolder?'checked':''}> Use season folders</label></div>
      <div class="snr-field">
        <label class="snr-toggle"><input type="checkbox" data-f="searchOnAdd" ${s.searchOnAdd?'checked':''}> Search for missing episodes on add</label>
        <div class="snr-hint">When adding a show, tell Sonarr to immediately start searching indexers for episodes.</div>
      </div>
    `;

    body.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f;
      const handler = () => {
        if (el.type === 'checkbox') s[f] = el.checked;
        else if (f === 'qualityProfileId' || f === 'languageProfileId') s[f] = el.value ? Number(el.value) : null;
        else s[f] = el.value;
      };
      el.addEventListener('change', handler);
      el.addEventListener('input', handler);
    });

    // auto-test when both url + key filled and dropdowns still empty
    const urlEl = body.querySelector('[data-f="url"]');
    const keyEl = body.querySelector('[data-f="apiKey"]');
    const maybeAuto = () => {
      if (urlEl.value.trim() && keyEl.value.trim() && (!s._profiles || !s._profiles.length)) { commitCurrentForm(); testAndPopulate(s); }
    };
    urlEl.addEventListener('blur', maybeAuto);
    keyEl.addEventListener('blur', maybeAuto);

    if (s._profiles && s._profiles.length) fillProfiles(s);
    if (s._rootFolders && s._rootFolders.length) fillRootFolders(s);
    if (s._languageProfiles && s._languageProfiles.length) fillLanguageProfiles(s);
    if (s._live === true) setStatus('ok', `Connected — Sonarr v${s._version || '?'}`);
  }

  function commitCurrentForm() {
    const body = sq('[data-el="body"]');
    const s = servers[activeTab];
    if (!body || !s) return;
    body.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') s[f] = el.checked;
      else if (f === 'qualityProfileId' || f === 'languageProfileId') s[f] = el.value ? Number(el.value) : null;
      else s[f] = el.value;
    });
  }

  function setStatus(kind, html) {
    const el = sq('[data-el="status"]');
    if (!el) return;
    el.className = 'snr-status show ' + kind;
    el.innerHTML = (kind === 'info' ? '<span class="snr-spin"></span>' : '') + html;
  }

  function fillProfiles(s) {
    const sel = sq('[data-f="qualityProfileId"]');
    if (!sel) return;
    sel.innerHTML = '<option value="">— select —</option>' +
      s._profiles.map(p => `<option value="${p.id}" ${s.qualityProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
  }
  function fillRootFolders(s) {
    const sel = sq('[data-f="rootFolderPath"]');
    if (!sel) return;
    sel.innerHTML = '<option value="">— select —</option>' +
      s._rootFolders.map(r => {
        const free = r.freeSpace ? ' (' + bytes(r.freeSpace) + ' free)' : '';
        return `<option value="${escapeAttr(r.path)}" ${s.rootFolderPath===r.path?'selected':''}>${escapeHtml(r.path)}${free}</option>`;
      }).join('');
  }
  function fillLanguageProfiles(s) {
    const wrap = sq('[data-el="langWrap"]');
    const sel = sq('[data-f="languageProfileId"]');
    if (!wrap || !sel) return;
    if (!s._languageProfiles.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    sel.innerHTML = s._languageProfiles.map(p => `<option value="${p.id}" ${s.languageProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
  }

  async function testAndPopulate(s) {
    if (!s) return;
    if (!s.url || !s.url.trim()) { setStatus('bad', 'Enter a URL first.'); return; }
    if (!s.apiKey || !s.apiKey.trim()) { setStatus('bad', 'Enter an API key first.'); return; }
    setStatus('info', 'Testing connection…');
    try {
      const st = await SonarrAPI.status(s);
      s._live = true;
      s._version = st.data && st.data.version;
      if (!s.name) s.name = (st.data && st.data.instanceName) || hostFrom(s.url);
      const [qp, rf] = await Promise.all([
        SonarrAPI.qualityProfiles(s).catch(() => ({ data: [] })),
        SonarrAPI.rootFolders(s).catch(() => ({ data: [] }))
      ]);
      s._profiles = qp.data || [];
      s._rootFolders = rf.data || [];
      try { const lp = await SonarrAPI.languageProfiles(s); s._languageProfiles = lp.data || []; }
      catch (e) { s._languageProfiles = []; }

      fillProfiles(s); fillRootFolders(s); fillLanguageProfiles(s);
      if (!s.qualityProfileId && s._profiles[0]) { s.qualityProfileId = s._profiles[0].id; fillProfiles(s); }
      if (!s.rootFolderPath && s._rootFolders[0]) { s.rootFolderPath = s._rootFolders[0].path; fillRootFolders(s); }

      const nameField = sq('[data-f="name"]');
      if (nameField && !nameField.value) nameField.value = s.name;

      setStatus('ok', `Connected — Sonarr v${s._version || '?'}. Loaded ${s._profiles.length} profile(s), ${s._rootFolders.length} root folder(s).`);
      renderTabs();
    } catch (err) {
      s._live = false;
      setStatus('bad', 'Failed: ' + escapeHtml(err.message || 'unknown error'));
      renderTabs();
    }
  }

  function onSaveClick() {
    commitCurrentForm();
    const clean = servers.filter(s => (s.url && s.url.trim()) || (s.name && s.name.trim()));
    saveServers(clean);
    servers = loadServers();
    if (servers.length === 0) servers.push(blankServer());
    if (activeTab >= servers.length) activeTab = servers.length - 1;
    setStatus('ok', 'Saved.');
    renderTabs();
  }

  function onDeleteClick() {
    const s = servers[activeTab];
    if (!s) return;
    if (!confirm('Delete server "' + (s.name || 'Server ' + (activeTab + 1)) + '"?')) return;
    servers.splice(activeTab, 1);
    if (servers.length === 0) servers.push(blankServer());
    activeTab = Math.max(0, activeTab - 1);
    saveServers(servers.filter(x => (x.url && x.url.trim())));
    renderTabs(); renderBody();
    setStatus('ok', 'Deleted.');
  }

  /* =========================================================================
   * SERIES PAGE — per-server status links on the .linkbox link bar
   *   (blend in with [Notify of New Uploads] etc. — just colour-coded:
   *    green = on Sonarr, red = not on Sonarr / offline)
   * =======================================================================*/
  function injectLinkbar() {
    if (document.getElementById('snr-lb-wrap')) return true;
    const lb = document.querySelector('.linkbox');
    if (!lb) return false;

    // marker span so we don't double-inject and can find our links again
    const marker = document.createElement('span');
    marker.id = 'snr-lb-wrap';
    marker.style.display = 'none';
    lb.appendChild(marker);

    const info = window.__btnSeries || seriesInfo();
    const list = loadServers().filter(s => s.url && s.url.trim() && s.apiKey && s.apiKey.trim());

    if (list.length === 0) {
      const a = document.createElement('a');
      a.className = 'snr-lb off';
      a.href = '/user.php?action=edit';
      a.textContent = '[Set up Sonarr]';
      a.title = 'No Sonarr server configured — open profile settings';
      a.style.cursor = 'pointer';
      lb.appendChild(a);
      return true;
    }

    list.forEach(s => {
      const link = document.createElement('a');
      link.className = 'snr-lb wait snr-lb-item';
      link.href = 'javascript:void(0)';
      link.textContent = '[' + (s.name || hostFrom(s.url)) + '…]';
      link.title = 'Checking ' + (s.name || 'Sonarr') + '…';
      lb.appendChild(link);
      resolveLinkStatus(s, info, link);
    });
    return true;
  }

  async function resolveLinkStatus(s, info, link) {
    const label = s.name || hostFrom(s.url);
    try {
      await SonarrAPI.status(s);
      let existing = null;
      if (info.tvdbId) {
        try { const r = await SonarrAPI.seriesByTvdb(s, info.tvdbId); existing = (r.data && r.data[0]) || null; } catch (e) {}
      }
      link.classList.remove('wait');
      if (existing) {
        link.classList.add('ok');
        link.textContent = '[' + label + ']';
        link.href = normBase(s.url) + '/series/' + encodeURIComponent(existing.titleSlug);
        link.target = '_blank'; link.rel = 'noopener';
        link.title = 'On ' + label + ' — click to open in Sonarr';
      } else {
        link.classList.add('bad');
        link.textContent = '[+ ' + label + ']';
        link.title = 'Not on ' + label + ' — click to add';
        link.addEventListener('click', (e) => { e.preventDefault(); openAddModal(s, info); });
      }
    } catch (err) {
      link.classList.remove('wait');
      link.classList.add('off');
      link.textContent = '[' + label + ' offline]';
      link.title = label + ' offline: ' + ((err && err.message) || 'unreachable');
      link.addEventListener('click', (e) => e.preventDefault());
    }
  }

  /* =========================================================================
   * Add-to-Sonarr confirm modal
   * =======================================================================*/
  let addState = null;

  function buildAddSkeleton() {
    if (document.getElementById('snr-add-ov')) return;
    const ov = document.createElement('div');
    ov.id = 'snr-add-ov';
    ov.className = 'snr';
    ov.innerHTML = `
      <div id="snr-add-modal">
        <div class="snr-addhead">
          <img data-el="poster" alt="">
          <div class="meta">
            <h3 data-el="title">…</h3>
            <div class="sub" data-el="sub"></div>
            <div class="srv" data-el="srv"></div>
          </div>
        </div>
        <div class="snr-addbody">
          <div class="snr-status" data-el="status"></div>
          <div class="snr-row">
            <div class="snr-field"><label>Quality Profile</label><select data-f="qualityProfileId"></select></div>
            <div class="snr-field"><label>Root Folder</label><select data-f="rootFolderPath"></select></div>
          </div>
          <div class="snr-row">
            <div class="snr-field" data-el="langWrap" style="display:none;"><label>Language Profile</label><select data-f="languageProfileId"></select></div>
            <div class="snr-field"><label>Monitor</label><select data-f="monitor">
              ${['all','future','missing','existing','firstSeason','lastSeason','pilot','none'].map(v=>`<option value="${v}">${v}</option>`).join('')}
            </select></div>
          </div>
          <div class="snr-field"><label class="snr-toggle"><input type="checkbox" data-f="seasonFolder"> Use season folders</label></div>
          <div class="snr-field"><label class="snr-toggle"><input type="checkbox" data-f="searchOnAdd"> Search for missing episodes on add</label></div>
        </div>
        <div class="snr-addfoot">
          <button class="snr-btn" data-act="cancel">Cancel</button>
          <div class="right"><button class="snr-btn good" data-act="add">Add to Sonarr</button></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
    ov.querySelector('[data-act="cancel"]').addEventListener('click', () => ov.classList.remove('open'));
  }

  async function openAddModal(server, info) {
    buildAddSkeleton();
    const ov = document.getElementById('snr-add-ov');
    ov.classList.add('open');
    const q = (sel) => ov.querySelector(sel);
    const setStat = (k, h) => { const el = q('[data-el="status"]'); el.className = 'snr-status show ' + k; el.innerHTML = (k === 'info' ? '<span class="snr-spin"></span>' : '') + h; };
    const hideStat = () => { q('[data-el="status"]').className = 'snr-status'; };

    q('[data-el="srv"]').textContent = 'Server: ' + (server.name || hostFrom(server.url));
    q('[data-el="title"]').textContent = info.title || 'Resolving…';
    q('[data-el="sub"]').textContent = '';
    q('[data-el="poster"]').src = '';
    const addBtn = q('[data-act="add"]'); addBtn.disabled = true;
    setStat('info', 'Resolving series & loading options…');

    try {
      const term = info.tvdbId ? ('tvdb:' + info.tvdbId) : info.title;
      const [qp, rf, lk] = await Promise.all([
        SonarrAPI.qualityProfiles(server),
        SonarrAPI.rootFolders(server),
        SonarrAPI.lookup(server, term)
      ]);
      let lang = [];
      try { const lp = await SonarrAPI.languageProfiles(server); lang = lp.data || []; } catch (e) {}
      const profiles = qp.data || [], roots = rf.data || [];
      const found = (lk.data || []).find(x => String(x.tvdbId) === String(info.tvdbId)) || (lk.data || [])[0];
      if (!found) { setStat('bad', 'Could not find this series in Sonarr’s lookup.'); return; }
      addState = { server, lookup: found };

      q('[data-el="title"]').textContent = (found.title || info.title) + (found.year ? (' (' + found.year + ')') : '');
      q('[data-el="sub"]').textContent = [found.network, found.status,
        (found.seasons ? found.seasons.filter(se => se.seasonNumber > 0).length + ' seasons' : '')].filter(Boolean).join(' · ');
      const poster = (found.images || []).find(i => i.coverType === 'poster');
      if (poster) q('[data-el="poster"]').src = poster.remoteUrl || poster.url;

      q('[data-f="qualityProfileId"]').innerHTML = profiles.map(p =>
        `<option value="${p.id}" ${server.qualityProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
      q('[data-f="rootFolderPath"]').innerHTML = roots.map(r =>
        `<option value="${escapeAttr(r.path)}" ${server.rootFolderPath===r.path?'selected':''}>${escapeHtml(r.path)}${r.freeSpace?(' ('+bytes(r.freeSpace)+' free)'):''}</option>`).join('');
      const langWrap = q('[data-el="langWrap"]');
      if (lang.length) {
        langWrap.style.display = '';
        q('[data-f="languageProfileId"]').innerHTML = lang.map(p =>
          `<option value="${p.id}" ${server.languageProfileId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
      } else { langWrap.style.display = 'none'; }
      q('[data-f="monitor"]').value = server.monitor || 'all';
      q('[data-f="seasonFolder"]').checked = server.seasonFolder !== false;
      q('[data-f="searchOnAdd"]').checked = server.searchOnAdd !== false;

      hideStat();
      addBtn.disabled = false;
      addBtn.onclick = () => doAdd(ov, q, setStat, addBtn);
    } catch (err) {
      setStat('bad', 'Error: ' + escapeHtml(err.message || 'unknown'));
    }
  }

  async function doAdd(ov, q, setStat, addBtn) {
    if (!addState) return;
    const { server, lookup } = addState;
    const qpId = Number(q('[data-f="qualityProfileId"]').value) || null;
    const rootPath = q('[data-f="rootFolderPath"]').value;
    const langWrap = q('[data-el="langWrap"]');
    const langId = (langWrap.style.display !== 'none' && q('[data-f="languageProfileId"]').value)
      ? Number(q('[data-f="languageProfileId"]').value) : null;
    const monitor = q('[data-f="monitor"]').value;
    const seasonFolder = q('[data-f="seasonFolder"]').checked;
    const searchOnAdd = q('[data-f="searchOnAdd"]').checked;
    if (!qpId) { setStat('bad', 'Pick a quality profile.'); return; }
    if (!rootPath) { setStat('bad', 'Pick a root folder.'); return; }

    const payload = Object.assign({}, lookup, {
      qualityProfileId: qpId, rootFolderPath: rootPath, monitored: true, seasonFolder: seasonFolder,
      addOptions: { monitor: monitor, searchForMissingEpisodes: searchOnAdd, searchForCutoffUnmetEpisodes: false }
    });
    if (langId) payload.languageProfileId = langId;

    addBtn.disabled = true;
    setStat('info', 'Adding to ' + (server.name || 'Sonarr') + '…');
    try {
      await SonarrAPI.addSeries(server, payload);
      setStat('ok', 'Added! ' + (searchOnAdd ? 'Sonarr is searching for episodes.' : 'Monitoring set.'));
      // flip the matching banner pill to green
      setTimeout(() => { ov.classList.remove('open'); refreshPills(); }, 1300);
    } catch (err) {
      addBtn.disabled = false;
      setStat('bad', 'Add failed: ' + escapeHtml(err.message || 'unknown'));
    }
  }

  function refreshPills() {
    const lb = document.querySelector('.linkbox');
    if (!lb) return;
    const marker = document.getElementById('snr-lb-wrap');
    if (marker) marker.remove();
    lb.querySelectorAll('a.snr-lb').forEach(a => a.remove());
    injectLinkbar();
  }

  /* =========================================================================
   * Fanart.tv Logo — HD clear logo at the top of the series sidebar
   * =======================================================================*/
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      try {
        gmXhr({
          method: 'GET', url, timeout: 15000,
          onload: (res) => resolve(res.responseText || ''),
          ontimeout: () => reject(new Error('timeout')),
          onerror: () => reject(new Error('network error'))
        });
      } catch (e) { reject(e); }
    });
  }

  // Resolve a TVDB id — prefer what seriesInfo() already found, otherwise
  // follow the thetvdb.com link and scrape the id off the target page.
  async function resolveTvdbId() {
    const info = window.__btnSeries || seriesInfo();
    if (info && info.tvdbId) return info.tvdbId;
    const a = document.querySelector('a[href*="thetvdb.com"]');
    if (!a) return null;
    try {
      const html = await gmGet(a.href);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const span = doc.querySelector('#series_basic_info > ul > li:nth-child(1) > span');
      const id = span && span.textContent ? span.textContent.replace(/\D+/g, '') : '';
      return id || null;
    } catch (e) { return null; }
  }

  async function fetchFanartLogo(tvdbId, key) {
    const url = 'https://webservice.fanart.tv/v3/tv/' + encodeURIComponent(tvdbId) + '?api_key=' + encodeURIComponent(key);
    let json;
    try { json = JSON.parse(await gmGet(url)); } catch (e) { return null; }
    const logos = (json && json.hdtvlogo) || (json && json.clearlogo) || [];
    if (!logos.length) return null;
    const en = logos.find(l => l && l.lang === 'en');
    return (en || logos[0]).url || null;
  }

  function addFanartLogo(logoUrl) {
    if (!logoUrl || document.getElementById('snr-fanart-logo')) return;
    const sidebar = document.querySelector('div.sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return;
    const box = document.createElement('div');
    box.className = 'box snr';
    box.id = 'snr-fanart-logo';
    box.innerHTML = '<div style="padding:18px 20px;display:flex;align-items:center;justify-content:center;">' +
      '<img alt="" style="width:100%;max-width:100%;height:auto;filter:drop-shadow(0 3px 10px rgba(0,0,0,.5));"></div>';
    box.querySelector('img').src = logoUrl;
    sidebar.insertBefore(box, sidebar.firstChild);
  }

  async function runFanart() {
    if (document.getElementById('snr-fanart-logo')) return;
    const key = (getKey('fanart') || '').trim();
    if (!key) return; // no key configured — silently skip
    try {
      const tvdbId = await resolveTvdbId();
      if (!tvdbId) return;
      const url = await fetchFanartLogo(tvdbId, key);
      if (url) addFanartLogo(url);
    } catch (e) { /* non-fatal */ }
  }

  /* =========================================================================
   * FEATURE: IMDb Parents Guide (series page, card grid below torrents)
   *   Self-contained module — all helpers are local so nothing collides with
   *   the Sonarr/Fanart code above. Uses IMDb's internal GraphQL endpoint.
   * =======================================================================*/
  function runParentsGuide() {
    if (document.getElementById('btn-parents-guide')) return;

    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const CACHE_PREFIX = 'btn_pg_cache_';
    const PREF_BOX_COLLAPSED = 'btn_pg_box_collapsed';
    const PREF_CAT_COLLAPSED = 'btn_pg_cat_collapsed';
    const GQL_ENDPOINT = 'https://api.graphql.imdb.com/';
    const GQL_CLIENT_NAME = 'imdb-web-next-localized';
    const CERT_PREF = ['GB', 'US'];
    const ITEMS_PREVIEW = 3;
    const LOG = (...a) => console.log('[STMPE-PG]', ...a);

    const CAT_META = {
      NUDITY:      { icon: '🔞', order: 0 },
      VIOLENCE:    { icon: '🔪', order: 1 },
      PROFANITY:   { icon: '🤬', order: 2 },
      ALCOHOL:     { icon: '🍸', order: 3 },
      FRIGHTENING: { icon: '😱', order: 4 }
    };
    const SEV = {
      'None':     { color: '#9a9998', rank: 0 },
      'Mild':     { color: '#8cb844', rank: 1 },
      'Moderate': { color: '#ed9a02', rank: 2 },
      'Severe':   { color: '#fa6f64', rank: 3 }
    };
    const SEV_UNKNOWN = { color: '#8a94a6', rank: -1 };

    function sevInfo(level) { return (level && SEV[level]) || SEV_UNKNOWN; }
    function loadPref(k, d) { try { return GM_getValue(k, d); } catch (e) { return d; } }
    function savePref(k, v) { try { GM_setValue(k, v); } catch (e) {} }
    function delPref(k)     { try { GM_deleteValue(k); } catch (e) {} }
    function getCatCollapsedMap() { try { return JSON.parse(loadPref(PREF_CAT_COLLAPSED, '{}')) || {}; } catch (e) { return {}; } }
    function setCatCollapsed(catId, collapsed) {
      const m = getCatCollapsedMap();
      if (collapsed) m[catId] = true; else delete m[catId];
      savePref(PREF_CAT_COLLAPSED, JSON.stringify(m));
    }
    function sanitize(html) {
      const t = document.createElement('div');
      t.innerHTML = html || '';
      t.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());
      t.querySelectorAll('*').forEach(el2 => {
        [...el2.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          if (n.startsWith('on') || (n === 'href' && /^\s*javascript:/i.test(a.value))) el2.removeAttribute(a.name);
        });
      });
      return t.innerHTML;
    }
    function esc(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

    function findImdbId() {
      const a = document.querySelector('a[href*="imdb.com/title/tt"]');
      if (a) { const m = a.href.match(/tt\d{7,9}/); if (m) return m[0]; }
      const m2 = document.documentElement.innerHTML.match(/imdb\.com\/title\/(tt\d{7,9})/);
      return m2 ? m2[1] : null;
    }

    function gmPostJson(url, bodyObj, extraHeaders) {
      return new Promise((resolve, reject) => {
        gmXhr({
          method: 'POST', url: url,
          headers: Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json' }, extraHeaders || {}),
          data: JSON.stringify(bodyObj), timeout: 8000,
          onload: (r) => resolve(r),
          onerror: () => reject(new Error('Network error contacting IMDb GraphQL')),
          ontimeout: () => reject(new Error('IMDb GraphQL request timed out'))
        });
      });
    }

    const PG_QUERY = `
      query BTN_ParentsGuide($id: ID!) {
        title(id: $id) {
          id
          certificate { rating }
          parentsGuide {
            categories {
              category { id text }
              severity { text votedFor }
              totalSeverityVotes
              guideItems(first: 100) {
                edges { node { ... on ParentsGuideItem { isSpoiler text { plaidHtml plainText } } } }
              }
            }
          }
        }
      }`;

    function normalizeTitle(title) {
      const pg = title && title.parentsGuide;
      const certificate = (title && title.certificate && title.certificate.rating) || null;
      if (!pg) return { ok: false, reason: 'No parents-guide data for this title.', certificate };
      const categories = (pg.categories || []).map(c => {
        const id = (c && c.category && c.category.id) || null;
        const label = (c && c.category && c.category.text) || id || '?';
        let level = (c && c.severity && c.severity.text) || null;
        if (level === 'Unknown') level = null;
        const items = ((c && c.guideItems && c.guideItems.edges) || [])
          .map(e => { const n = e && e.node; if (!n) return null; const html = (n.text && (n.text.plaidHtml || n.text.plainText)) || ''; return html ? { html, spoiler: !!n.isSpoiler } : null; })
          .filter(Boolean)
          .sort((a, b) => (a.spoiler ? 1 : 0) - (b.spoiler ? 1 : 0));
        return { id: id || label, label, level, votedFor: (c && c.severity && c.severity.votedFor) || 0, total: (c && c.totalSeverityVotes) || 0, items };
      }).sort((a, b) => (CAT_META[a.id]?.order ?? 99) - (CAT_META[b.id]?.order ?? 99));
      const hasAny = categories.some(c => c.level || c.items.length);
      if (!hasAny) return { ok: false, reason: 'No parents-guide entries submitted for this title yet.', certificate };
      return { ok: true, certificate, categories };
    }

    async function fetchViaGraphQL(ttId) {
      const body = { query: PG_QUERY, operationName: 'BTN_ParentsGuide', variables: { id: ttId } };
      let r;
      try { r = await gmPostJson(GQL_ENDPOINT, body, { 'x-imdb-client-name': GQL_CLIENT_NAME }); }
      catch (e) { return { ok: false, reason: e.message || 'GraphQL network error' }; }
      if (r.status === 202 || !(r.responseText || '').trim()) return { ok: false, reason: 'GraphQL endpoint throttled/empty (HTTP ' + r.status + ').' };
      if (r.status >= 400) return { ok: false, reason: 'GraphQL endpoint returned HTTP ' + r.status + '.', rawText: r.responseText };
      let json;
      try { json = JSON.parse(r.responseText); } catch (e) { return { ok: false, reason: 'GraphQL response was not JSON.', rawText: r.responseText }; }
      if (json.errors && json.errors.length) return { ok: false, reason: 'GraphQL errors: ' + json.errors.map(e => e.message).join('; '), raw: json };
      const title = json && json.data && json.data.title;
      if (!title) return { ok: false, reason: 'GraphQL returned no title data.', raw: json };
      const norm = normalizeTitle(title); norm.raw = json; return norm;
    }

    const CERT_QUERY = `
      query BTN_Certs($id: ID!) {
        title(id: $id) { certificates(first: 80) { edges { node { rating country { id text } ratingsBody { id } } } } }
      }`;

    async function fetchPreferredCert(ttId) {
      let r;
      try { r = await gmPostJson(GQL_ENDPOINT, { query: CERT_QUERY, operationName: 'BTN_Certs', variables: { id: ttId } }, { 'x-imdb-client-name': GQL_CLIENT_NAME }); }
      catch (e) { return null; }
      if (r.status >= 400 || !(r.responseText || '').trim()) return null;
      let j; try { j = JSON.parse(r.responseText); } catch (e) { return null; }
      if (j.errors && j.errors.length) return null;
      const edges = (j && j.data && j.data.title && j.data.title.certificates && j.data.title.certificates.edges) || [];
      const byCountry = {};
      edges.forEach(e => { const n = e && e.node; if (!n) return; const c = n.country && n.country.id; if (!c) return; if (!byCountry[c]) byCountry[c] = { rating: n.rating, body: (n.ratingsBody && n.ratingsBody.id) || null }; });
      for (const c of CERT_PREF) { if (byCountry[c] && byCountry[c].rating) return { country: c, rating: byCountry[c].rating, body: byCountry[c].body }; }
      return null;
    }

    const inflight = {};
    function fetchGuide(ttId, force) {
      if (!force && inflight[ttId]) return inflight[ttId];
      const p = _fetchGuide(ttId, force).finally(() => { if (inflight[ttId] === p) delete inflight[ttId]; });
      inflight[ttId] = p; return p;
    }
    async function _fetchGuide(ttId, force) {
      const cacheKey = CACHE_PREFIX + ttId;
      if (!force) { try { const cached = JSON.parse(loadPref(cacheKey, 'null')); if (cached && cached.data && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.data; } catch (e) {} }
      let res;
      try { res = await fetchViaGraphQL(ttId); } catch (e) { res = { ok: false, reason: (e && e.message) || 'GraphQL failed' }; }
      if (res.ok) {
        try { const c = await fetchPreferredCert(ttId); if (c) { res.certificate = c.rating; res.certCountry = c.country; res.certBody = c.body; } } catch (e) {}
        savePref(cacheKey, JSON.stringify({ at: Date.now(), data: res }));
      }
      return res;
    }

    function fullLink(ttId) { const p = el('div', 'pg-fulllink'); p.innerHTML = '<a href="https://www.imdb.com/title/' + ttId + '/parentalguide/" target="_blank" rel="noopener">View full guide on IMDb →</a>'; return p; }
    function sourceBadge() { return '<span class="pg-src" title="Fetched from IMDb\'s internal GraphQL endpoint">GraphQL API</span>'; }
    function certSpan(data) {
      if (!data || !data.certificate) return null;
      const country = data.certCountry ? data.certCountry + ' ' : '';
      const s = el('span', 'pg-cert', esc(country + data.certificate));
      s.title = ((data.certBody || data.certCountry || '') + ' rating').trim();
      return s;
    }
    function buildBox(ttId) {
      const box = el('div', 'box pg-box'); box.id = 'btn-parents-guide';
      const head = el('div', 'head pg-head');
      const collapsedBox = loadPref(PREF_BOX_COLLAPSED, true);
      head.innerHTML = '<span class="pg-caret">' + (collapsedBox ? '▸' : '▾') + '</span><span class="pg-title">🎬 IMDb Parents Guide</span><span class="pg-head-right"></span>';
      const body = el('div', 'body pg-body');
      if (collapsedBox) body.style.display = 'none';
      head.addEventListener('click', () => {
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        head.querySelector('.pg-caret').textContent = hidden ? '▾' : '▸';
        savePref(PREF_BOX_COLLAPSED, !hidden);
      });
      box.appendChild(head); box.appendChild(body);
      load(box, head, body, ttId, false);
      return box;
    }
    function load(box, head, body, ttId, force) {
      body.innerHTML = '';
      body.appendChild(el('div', 'pg-status', 'Loading parents guide…'));
      fetchGuide(ttId, force)
        .then(res => res.ok ? renderData(box, head, body, res, ttId) : renderMessage(box, head, body, ttId, res))
        .catch(err => renderMessage(box, head, body, ttId, { reason: (err && err.message) || 'Unknown error' }, true));
    }
    function renderMessage(box, head, body, ttId, res, isError) {
      body.innerHTML = '';
      const rightM = head.querySelector('.pg-head-right'); rightM.innerHTML = '';
      const cM = certSpan(res); if (cM) rightM.appendChild(cM);
      body.appendChild(el('div', 'pg-status' + (isError ? ' pg-error' : ''), (isError ? '⚠️ ' : '') + (res.reason || 'No data.')));
      const retry = el('button', 'pg-retry', '↻ Retry');
      retry.addEventListener('click', () => { delPref(CACHE_PREFIX + ttId); load(box, head, body, ttId, true); });
      body.appendChild(retry);
      body.appendChild(fullLink(ttId));
    }
    function renderData(box, head, body, data, ttId) {
      body.innerHTML = '';
      let worst = SEV_UNKNOWN, worstLevel = null;
      data.categories.forEach(c => { const inf = sevInfo(c.level); if (inf.rank > worst.rank) { worst = inf; worstLevel = c.level; } });
      box.style.setProperty('--pg-accent', worst.color);
      const right = head.querySelector('.pg-head-right'); right.innerHTML = '';
      right.insertAdjacentHTML('beforeend', sourceBadge());
      const cD = certSpan(data); if (cD) right.appendChild(cD);
      if (worstLevel) { const o = el('span', 'pg-overall', worstLevel); o.style.background = worst.color; right.appendChild(o); }
      const catCollapsed = getCatCollapsedMap();
      data.categories.forEach(cat => {
        const meta = CAT_META[cat.id] || { icon: '•' };
        const inf = sevInfo(cat.level);
        const hasItems = cat.items.length > 0;
        const catEl = el('div', 'pg-cat'); catEl.style.setProperty('--sev', inf.color);
        let collapsed = (cat.id in catCollapsed) ? catCollapsed[cat.id] : (cat.level === 'None' || !hasItems);
        const cHead = el('div', 'pg-cat-head');
        cHead.innerHTML = '<span class="pg-cat-caret">' + (collapsed ? '▸' : '▾') + '</span><span class="pg-cat-icon">' + meta.icon + '</span><span class="pg-cat-label">' + esc(cat.label) + '</span>' + (hasItems ? '<span class="pg-cat-count">' + cat.items.length + '</span>' : '') + '<span class="pg-sev-badge">' + (cat.level || '—') + '</span>';
        const cBody = el('div', 'pg-cat-body');
        if (collapsed) cBody.style.display = 'none';
        if (cat.total > 0) {
          const vp = pct(cat.votedFor, cat.total);
          const bar = el('div', 'pg-votebar'); bar.title = cat.votedFor + ' of ' + cat.total + ' voters (' + vp + '%)';
          const fill = el('div', 'pg-votebar-fill'); fill.style.width = vp + '%'; fill.style.background = inf.color;
          bar.appendChild(fill); cBody.appendChild(bar);
          cBody.appendChild(el('div', 'pg-votemeta', cat.votedFor + '/' + cat.total + ' voters (' + vp + '%)'));
        }
        if (hasItems) {
          const makeLi = (item) => {
            const li = el('li', 'pg-item' + (item.spoiler ? ' pg-spoiler' : ''));
            li.innerHTML = sanitize(item.html);
            if (item.spoiler) { li.title = 'Spoiler — click to reveal'; li.addEventListener('click', () => li.classList.toggle('revealed')); }
            return li;
          };
          const shown = cat.items.slice(0, ITEMS_PREVIEW);
          const rest  = cat.items.slice(ITEMS_PREVIEW);
          const ul = el('ul', 'pg-items'); shown.forEach(item => ul.appendChild(makeLi(item))); cBody.appendChild(ul);
          if (rest.length) {
            const moreUl = el('ul', 'pg-items pg-more-items'); moreUl.style.display = 'none';
            rest.forEach(item => moreUl.appendChild(makeLi(item))); cBody.appendChild(moreUl);
            const moreBtn = el('button', 'pg-more', '+ ' + rest.length + ' more');
            moreBtn.addEventListener('click', (e) => { e.stopPropagation(); const hidden = moreUl.style.display === 'none'; moreUl.style.display = hidden ? '' : 'none'; moreBtn.textContent = hidden ? '− show less' : ('+ ' + rest.length + ' more'); });
            cBody.appendChild(moreBtn);
          }
        } else { cBody.appendChild(el('div', 'pg-noitems', 'No detailed notes listed.')); }
        cHead.addEventListener('click', () => { const hidden = cBody.style.display === 'none'; cBody.style.display = hidden ? '' : 'none'; cHead.querySelector('.pg-cat-caret').textContent = hidden ? '▾' : '▸'; setCatCollapsed(cat.id, !hidden); });
        catEl.appendChild(cHead); catEl.appendChild(cBody); body.appendChild(catEl);
      });
      body.appendChild(fullLink(ttId));
    }
    function placeBox(box) {
      const mc = document.querySelector('.main_column');
      if (mc) {
        const tables = mc.querySelectorAll('.torrent_table');
        if (tables.length) { const last = tables[tables.length - 1]; last.parentNode.insertBefore(box, last.nextSibling); return true; }
        mc.appendChild(box); return true;
      }
      const thin = document.querySelector('.thin');
      if (thin) { thin.appendChild(box); return true; }
      return false;
    }
    function tryInjectPg() {
      if (document.getElementById('btn-parents-guide')) return true;
      const ttId = findImdbId();
      if (!ttId) return false;
      if (!document.querySelector('.main_column')) return false;
      const box = buildBox(ttId);
      return placeBox(box);
    }

    injectCss('snr-pg-style', `
      #btn-parents-guide { --pg-accent:#8a94a6; clear:both; width:100%; box-sizing:border-box; margin:0 0 10px; overflow:hidden; }
      #btn-parents-guide .pg-head { display:flex; align-items:center; gap:6px; cursor:pointer; border-left:4px solid var(--pg-accent); }
      #btn-parents-guide .pg-caret { width:12px; display:inline-block; opacity:.8; }
      #btn-parents-guide .pg-title { font-weight:bold; }
      #btn-parents-guide .pg-head-right { margin-left:auto; display:flex; gap:6px; align-items:center; }
      #btn-parents-guide .pg-cert { font-size:11px; font-weight:700; letter-spacing:.3px; border:1px solid currentColor; border-radius:3px; padding:0 5px; opacity:.85; }
      #btn-parents-guide .pg-overall { font-size:11px; font-weight:700; color:#0e0e0e; border-radius:3px; padding:1px 6px; }
      #btn-parents-guide .pg-src { font-size:10px; font-weight:600; opacity:.55; border:1px solid rgba(255,255,255,.2); border-radius:3px; padding:0 5px; }
      #btn-parents-guide .pg-body { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px; align-items:start; padding:12px; }
      #btn-parents-guide .pg-status { grid-column:1 / -1; padding:6px 2px; opacity:.85; font-size:12px; }
      #btn-parents-guide .pg-error { color:#ff8a80; }
      #btn-parents-guide .pg-retry { cursor:pointer; font:inherit; font-size:11px; padding:3px 10px; border-radius:4px; border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.06); color:inherit; justify-self:start; }
      #btn-parents-guide .pg-retry:hover { background:rgba(255,255,255,.14); }
      #btn-parents-guide .pg-cat { min-width:0; box-sizing:border-box; border:1px solid rgba(255,255,255,.08); border-top:3px solid var(--sev); border-radius:5px; background:rgba(255,255,255,.03); overflow:hidden; }
      #btn-parents-guide .pg-cat-head { display:flex; align-items:center; gap:6px; cursor:pointer; padding:7px 9px; user-select:none; }
      #btn-parents-guide .pg-cat-head:hover { background:rgba(255,255,255,.05); }
      #btn-parents-guide .pg-cat-caret { width:11px; opacity:.7; font-size:11px; }
      #btn-parents-guide .pg-cat-icon { font-size:15px; }
      #btn-parents-guide .pg-cat-label { flex:1 1 auto; font-weight:600; font-size:13px; line-height:1.2; }
      #btn-parents-guide .pg-cat-count { font-size:10px; opacity:.55; }
      #btn-parents-guide .pg-sev-badge { font-size:10px; font-weight:700; color:#0e0e0e; background:var(--sev); border-radius:3px; padding:1px 6px; white-space:nowrap; }
      #btn-parents-guide .pg-cat-body { padding:6px 9px 9px; }
      #btn-parents-guide .pg-votebar { height:5px; border-radius:3px; background:rgba(255,255,255,.1); overflow:hidden; margin:2px 0 3px; }
      #btn-parents-guide .pg-votebar-fill { height:100%; }
      #btn-parents-guide .pg-votemeta { font-size:10px; opacity:.6; margin-bottom:5px; }
      #btn-parents-guide .pg-items { list-style:none; margin:0; padding:0; }
      #btn-parents-guide .pg-item { font-size:12px; line-height:1.45; padding:5px 0; border-top:1px solid rgba(255,255,255,.06); }
      #btn-parents-guide .pg-item:first-child { border-top:none; }
      #btn-parents-guide .pg-item a { text-decoration:underline; }
      #btn-parents-guide .pg-noitems { font-size:11px; opacity:.55; padding:2px 0; }
      #btn-parents-guide .pg-more { cursor:pointer; font:inherit; font-size:11px; margin-top:6px; padding:2px 8px; border-radius:4px; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.05); color:inherit; opacity:.85; }
      #btn-parents-guide .pg-more:hover { background:rgba(255,255,255,.13); opacity:1; }
      #btn-parents-guide .pg-spoiler { filter:blur(4px); cursor:pointer; transition:filter .15s; background:rgba(250,111,100,.06); border-radius:3px; }
      #btn-parents-guide .pg-spoiler::after { content:" 🔒 spoiler"; font-size:9px; opacity:.7; }
      #btn-parents-guide .pg-spoiler.revealed { filter:none; background:transparent; }
      #btn-parents-guide .pg-spoiler.revealed::after { content:""; }
      #btn-parents-guide .pg-fulllink { grid-column:1 / -1; margin-top:2px; font-size:11px; text-align:right; }
    `);

    const ttEarly = findImdbId();
    if (ttEarly) fetchGuide(ttEarly, false);
    if (tryInjectPg()) return;
    let done = false;
    const finish = () => { done = true; obs.disconnect(); clearInterval(poll); clearTimeout(stop); };
    const obs = new MutationObserver(() => { if (!done && tryInjectPg()) finish(); });
    obs.observe(document.body, { childList: true, subtree: true });
    const poll = setInterval(() => { if (!done && tryInjectPg()) finish(); }, 800);
    const stop = setTimeout(() => { if (!done) { finish(); LOG('gave up: no IMDb link / target found'); } }, 12000);
  }

  /* =========================================================================
   * FEATURE: Trending Shows (homepage, TMDb trending-TV row)
   * =======================================================================*/
  function runTrending() {
    if (document.getElementById('snr-trending')) return;
    const key = (getKey('trending') || '').trim();
    if (!key) return;
    const mainColumn = document.querySelector('#content > div.thin > div.main_column') || document.querySelector('.main_column');
    if (!mainColumn) return;

    injectCss('snr-trending-style', `
      #snr-trending .snr-tr-grid{ display:flex; flex-wrap:wrap; gap:1.5%; }
      #snr-trending .snr-tr-item{ width:12.7%; margin-bottom:10px; }
      #snr-trending .snr-tr-item img{ width:100%; border-radius:6px; display:block; box-shadow:0 3px 10px rgba(0,0,0,.4); }
      #snr-trending .snr-tr-name{ text-align:center; cursor:pointer; font-size:12px; margin-top:5px; line-height:1.3; color:var(--text-1,#cdd4de); }
      #snr-trending .snr-tr-name:hover{ color:var(--accent-bright,#3fc8ff); }
      @media (max-width:900px){ #snr-trending .snr-tr-item{ width:23%; } }
    `);

    const box = document.createElement('div');
    box.className = 'box';
    box.id = 'snr-trending';
    const head = document.createElement('div');
    head.className = 'head';
    head.style.fontWeight = 'bold';
    head.textContent = 'Trending Shows From TMDb';
    box.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'snr-tr-grid pad';
    grid.style.padding = '12px';
    box.appendChild(grid);
    mainColumn.insertBefore(box, mainColumn.firstChild);

    const api = (path) => 'https://api.themoviedb.org/3' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key);

    fetch(api('/trending/tv/day?language=en-US'))
      .then(r => r.json())
      .then(data => {
        const shows = (data && data.results ? data.results : []).slice(0, 7);
        shows.forEach(show => {
          fetch(api('/tv/' + show.id))
            .then(r => r.json())
            .then(showData => {
              if (!showData) return;
              const item = document.createElement('div');
              item.className = 'snr-tr-item';
              const img = document.createElement('img');
              img.src = showData.poster_path ? ('https://media.themoviedb.org/t/p/w440_and_h660_face' + showData.poster_path) : '';
              img.alt = showData.name || '';
              const name = document.createElement('div');
              name.className = 'snr-tr-name';
              name.textContent = showData.name || '';
              name.onclick = () => { window.location.href = 'https://broadcasthe.net/series.php?name=' + encodeURIComponent(showData.name || ''); };
              item.appendChild(img);
              item.appendChild(name);
              grid.appendChild(item);
            })
            .catch(() => {});
        });
      })
      .catch((e) => { console.warn('[STMPE-Trending] fetch failed', e); });
  }

  /* =========================================================================
   * FEATURE: Collapse Old Seasons (series page)
   *   BTN's own (hide)/(show) links only flip their label on these discog-style
   *   season tables — they don't actually collapse the rows. We take over: wire
   *   each season's toggle to really show/hide its torrent rows, and collapse
   *   every season except the most recent (the first season table in the DOM).
   * =======================================================================*/
  function runSeasonCollapse() {
    // Season tables are .torrent_table blocks whose first row is a colhead_dark
    // header reading "Season N (hide)" / "Other (hide)".
    const seasonTables = [...document.querySelectorAll('.main_column .torrent_table')].filter(t => {
      const h = t.rows && t.rows[0];
      return h && /colhead/.test(h.className) && t.querySelector('tr.group_torrent');
    });
    if (seasonTables.length < 2) return true; // nothing worth collapsing

    seasonTables.forEach((table, idx) => {
      if (table.dataset.snrSeason) return; // already wired
      table.dataset.snrSeason = '1';
      const header = table.rows[0];
      const rows = () => [...table.querySelectorAll('tr.group_torrent')];

      const setCollapsed = (collapsed) => {
        rows().forEach(r => { r.style.display = collapsed ? 'none' : ''; });
        table.dataset.snrCollapsed = collapsed ? '1' : '0';
        // reflect state on the toggle link label
        const lnk = header.querySelector('a.toggle') || header.querySelector('a');
        if (lnk) lnk.textContent = collapsed ? 'show' : 'hide';
      };

      // Replace the toggle link with a clone to drop BTN's (no-op) handler,
      // then wire our own that genuinely toggles the rows.
      let link = header.querySelector('a.toggle') || header.querySelector('a');
      if (link) {
        const fresh = link.cloneNode(true);
        link.replaceWith(fresh);
        link = fresh;
        link.style.cursor = 'pointer';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          setCollapsed(table.dataset.snrCollapsed !== '1');
        });
      }

      // Collapse everything except the most recent season (idx 0).
      setCollapsed(idx !== 0);
    });
    return true;
  }

  /* =========================================================================
   * FEATURE: Artwork Placeholders (all pages)
   *   BTN falls back to a set of shared imgur images for shows with no poster /
   *   banner / fan art. We detect those by id and swap in a clean themed SVG,
   *   choosing banner vs poster styling from the element's aspect ratio so it
   *   works for banners, sidebar posters AND torrent-table thumbnails alike.
   * =======================================================================*/
  const PLACEHOLDER_IDS = ['hIq9qAn', 'qHx6IsI', '55K4Dww']; // No Banner / No Poster / No Fan Art
  const PH_C = { bg1: '#141821', bg2: '#0a0c10', line: '#2b313b', accent: '#1f9dff', accentB: '#3fc8ff', text: '#e8edf4', muted: '#7d8794' };

  function phIsDefault(src) {
    if (!src) return false;
    return PLACEHOLDER_IDS.some(id => src.indexOf('/' + id) !== -1);
  }
  function phWrap(t, maxChars, maxLines) {
    const words = (t || '').replace(/\s*\(\d{4}\)\s*$/, '').split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (cand.length > maxChars && cur) { lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
      else cur = cand;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines) {
      // if we ran out of room, mark truncation
      let joined = lines.join(' ');
      if (joined.length < (t || '').replace(/\s*\(\d{4}\)\s*$/, '').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    }
    return lines;
  }
  function phEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function phDataUri(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }

  function phPosterSvg(title) {
    const lines = phWrap(title, 15, 3);
    const startY = 300;
    const tspans = lines.map((ln, i) =>
      `<text x='150' y='${startY + i * 26}' text-anchor='middle' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='19' font-weight='600' fill='${PH_C.text}'>${phEsc(ln)}</text>`
    ).join('');
    return phDataUri(
`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 450' preserveAspectRatio='xMidYMid slice'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${PH_C.bg1}'/><stop offset='1' stop-color='${PH_C.bg2}'/></linearGradient>
    <radialGradient id='glow' cx='0.5' cy='0.4' r='0.62'><stop offset='0' stop-color='${PH_C.accent}' stop-opacity='0.18'/><stop offset='1' stop-color='${PH_C.accent}' stop-opacity='0'/></radialGradient>
  </defs>
  <rect width='300' height='450' fill='url(#g)'/>
  <rect width='300' height='450' fill='url(#glow)'/>
  <rect x='6' y='6' width='288' height='438' rx='12' fill='none' stroke='${PH_C.line}' stroke-width='1.5'/>
  <g transform='translate(150,182)' fill='none' stroke='${PH_C.accentB}' stroke-opacity='0.6' stroke-width='7' stroke-linecap='round'>
    <path d='M 21 -36.4 A 42 42 0 1 1 -21 -36.4'/><line x1='0' y1='-50' x2='0' y2='-8'/>
  </g>
  <text x='150' y='258' text-anchor='middle' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='12' font-weight='700' letter-spacing='3' fill='${PH_C.muted}'>NO POSTER</text>
  ${tspans}
</svg>`);
  }

  function phBannerSvg(title) {
    const lines = phWrap(title, 34, 2);
    const tspans = lines.map((ln, i) =>
      `<text x='150' y='${lines.length === 1 ? 108 : 98 + i * 34}' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='30' font-weight='700' fill='${PH_C.text}'>${phEsc(ln)}</text>`
    ).join('');
    return phDataUri(
`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1114 206' preserveAspectRatio='xMidYMid slice'>
  <defs>
    <linearGradient id='gb' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${PH_C.bg1}'/><stop offset='1' stop-color='${PH_C.bg2}'/></linearGradient>
    <radialGradient id='glb' cx='0.12' cy='0.5' r='0.5'><stop offset='0' stop-color='${PH_C.accent}' stop-opacity='0.2'/><stop offset='1' stop-color='${PH_C.accent}' stop-opacity='0'/></radialGradient>
  </defs>
  <rect width='1114' height='206' fill='url(#gb)'/>
  <rect width='1114' height='206' fill='url(#glb)'/>
  <g transform='translate(80,103)' fill='none' stroke='${PH_C.accentB}' stroke-opacity='0.6' stroke-width='6' stroke-linecap='round'>
    <path d='M 16 -27.7 A 32 32 0 1 1 -16 -27.7'/><line x1='0' y1='-38' x2='0' y2='-6'/>
  </g>
  ${tspans}
  <text x='150' y='${lines.length === 1 ? 134 : 150}' font-family='Segoe UI,Roboto,Helvetica,Arial,sans-serif' font-size='13' font-weight='600' letter-spacing='2' fill='${PH_C.muted}'>NO BANNER ARTWORK</text>
</svg>`);
  }

  function phReplace(img) {
    try {
      if (!img || img.dataset.snrPh) return;
      const src = img.currentSrc || img.src || img.getAttribute('src') || '';
      if (!phIsDefault(src)) return;
      let w = img.naturalWidth || 0, h = img.naturalHeight || 0;
      if (!w || !h) { w = w || parseInt(img.getAttribute('width'), 10) || 0; h = h || parseInt(img.getAttribute('height'), 10) || 0; }
      // Aspect ratio decides poster vs banner. If we can't tell yet (image not
      // loaded, no size attributes), wait for load rather than guess wrong.
      if ((!w || !h) && !img.complete) { img.addEventListener('load', () => phReplace(img), { once: true }); return; }
      const ratio = (w && h) ? (w / h) : 1;
      const title = (img.alt || img.title || '').trim();
      img.dataset.snrPh = '1';
      // Kill the site's onerror fallback + any srcset first, so the swap sticks.
      img.onerror = null; img.removeAttribute('onerror'); img.removeAttribute('srcset');
      img.src = ratio <= 0.85 ? phPosterSvg(title) : phBannerSvg(title);
    } catch (e) {}
  }

  function runPlaceholders() {
    const scan = (root) => {
      const list = (root && root.querySelectorAll) ? root.querySelectorAll('img') : [];
      list.forEach(phReplace);
      if (root && root.tagName === 'IMG') phReplace(root);
    };
    scan(document);
    // Some default imgs report naturalWidth 0 until they load — re-check on load.
    document.querySelectorAll('img').forEach(img => {
      if (img.dataset.snrPh) return;
      const src = img.currentSrc || img.src || '';
      if (phIsDefault(src) && !img.complete) img.addEventListener('load', () => phReplace(img), { once: true });
    });
    // Catch AJAX / cover-view / lazy content.
    try {
      const obs = new MutationObserver((muts) => {
        muts.forEach(m => m.addedNodes && m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'IMG') phReplace(n);
          else if (n.querySelectorAll) n.querySelectorAll('img').forEach(phReplace);
        }));
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  /* =========================================================================
   * FEATURE: Hide Empty Requests (series page)
   *   The Requests block is a <table class="border"> whose header row is a
   *   colhead reading "Request Name … Requested on"; when empty its body just
   *   says "Nothing found!". Hide the whole table (and any leading heading) then.
   * =======================================================================*/
  function runHideEmptyRequests() {
    let hidden = false;
    document.querySelectorAll('.main_column table.border').forEach(t => {
      if (t.dataset.snrReq) return;
      const head = t.querySelector('tr.colhead_dark, tr.colhead');
      if (!head || !/request\s*name/i.test(head.textContent || '')) return;
      if (!/nothing found/i.test(t.textContent || '')) return; // only when empty
      t.dataset.snrReq = '1';
      t.style.display = 'none';
      hidden = true;
      // hide a leading section heading if one sits right before the table
      const prev = t.previousElementSibling;
      if (prev && /request/i.test(prev.textContent || '') &&
          (prev.classList.contains('head') || /head/i.test(prev.className || ''))) {
        prev.style.display = 'none';
      }
    });
    return hidden;
  }

  /* =========================================================================
   * FEATURE: Trailer Player (series page)
   *   BTN embeds trailers as a dead Flash <object>, and its page sets
   *   <meta name="referrer" content="never"> which strips the Referer and makes
   *   YouTube reject a normal embed (Error 153). We intercept the play button
   *   and open a clean pop-up iframe with referrerPolicy restored + an origin
   *   param, so it just plays. If BTN has no trailer we look one up on TMDb.
   * =======================================================================*/
  function trailerGrabId(s) {
    if (!s) return null;
    const m = String(s).match(/(?:\/v\/|\/embed\/|[?&]v=|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function trailerBtnId() {
    for (const el of document.querySelectorAll('object[data], object param[value], embed[src]')) {
      const v = el.getAttribute('data') || el.getAttribute('value') || el.getAttribute('src');
      const id = trailerGrabId(v);
      if (id) return id;
    }
    return null;
  }
  async function trailerFromTmdb() {
    const key = (getKey('trending') || '').trim(); // shared TMDb key
    if (!key) return null;
    const info = window.__btnSeries || seriesInfo();
    const findTv = async (ext, src) => {
      if (!ext) return null;
      try {
        const d = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(ext) +
          '?external_source=' + src + '&api_key=' + encodeURIComponent(key)).then(r => r.json());
        return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
      } catch (e) { return null; }
    };
    try {
      let tmdbId = await findTv(info.imdbId, 'imdb_id');
      if (!tmdbId) tmdbId = await findTv(info.tvdbId, 'tvdb_id');
      if (!tmdbId) return null;
      const v = await fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/videos?api_key=' + encodeURIComponent(key)).then(r => r.json());
      const vids = (v.results || []).filter(x => x.site === 'YouTube');
      const pick = vids.find(x => x.type === 'Trailer' && x.official) ||
                   vids.find(x => x.type === 'Trailer') ||
                   vids.find(x => x.type === 'Teaser') || vids[0];
      return pick ? pick.key : null;
    } catch (e) { return null; }
  }

  let trailerEscBound = null;
  function trailerClose() {
    const ov = document.getElementById('snr-trailer-ov');
    if (ov) {
      ov.classList.remove('open');
      const f = ov.querySelector('iframe'); if (f) f.src = 'about:blank'; // stop playback
      setTimeout(() => ov.remove(), 160);
    }
    if (trailerEscBound) { document.removeEventListener('keydown', trailerEscBound); trailerEscBound = null; }
  }
  function trailerOpen(id) {
    trailerClose();
    const ov = document.createElement('div');
    ov.id = 'snr-trailer-ov'; ov.className = 'snr';
    ov.innerHTML = '<div class="snr-tr-box"><button class="snr-tr-x" title="Close (Esc)">×</button><div class="snr-tr-frame"></div></div>';
    document.body.appendChild(ov);
    const frame = ov.querySelector('.snr-tr-frame');
    if (id) {
      const ifr = document.createElement('iframe');
      // The key fix: restore a referrer (BTN forces none) + pass origin so YouTube accepts the embed.
      ifr.referrerPolicy = 'strict-origin-when-cross-origin';
      ifr.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
      ifr.allowFullscreen = true;
      ifr.src = 'https://www.youtube.com/embed/' + encodeURIComponent(id) +
        '?autoplay=1&rel=0&modestbranding=1&origin=' + encodeURIComponent(location.origin);
      frame.appendChild(ifr);
    } else {
      frame.innerHTML = '<div class="snr-tr-msg">No trailer found for this show.</div>';
    }
    ov.addEventListener('click', (e) => { if (e.target === ov) trailerClose(); });
    ov.querySelector('.snr-tr-x').addEventListener('click', trailerClose);
    trailerEscBound = (e) => { if (e.key === 'Escape') trailerClose(); };
    document.addEventListener('keydown', trailerEscBound);
    requestAnimationFrame(() => ov.classList.add('open'));
  }

  function runTrailer(pb) {
    if (!pb || pb.dataset.snrTrailerInit) return;
    pb.dataset.snrTrailerInit = '1';
    // BTN binds the trailer click on BOTH #banner and #playbutton (and delegates
    // on document), so we intercept any click inside the banner container. A
    // capture-phase listener on document runs before BTN's handlers, so its dead
    // Flash overlay never opens. The container only holds the banner + play
    // button, so blanket-intercepting clicks in it is safe.
    const box = pb.closest('center') || pb.closest('h2') || pb.parentElement;
    const bind = (id) => {
      document.addEventListener('click', function (e) {
        const t = e.target;
        const inBox = (box && box.contains(t)) ||
          (t && (t.id === 'banner' || t.id === 'playbutton' ||
                 (t.closest && t.closest('#banner, #playbutton'))));
        if (inBox) {
          e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
          trailerOpen(id);
        }
      }, true);
    };
    const btnId = trailerBtnId();
    if (btnId) { bind(btnId); return; }
    // No BTN trailer — look one up on TMDb; only hook if we actually find one,
    // so shows with no trailer keep their normal "add a trailer" behaviour.
    trailerFromTmdb().then(id => { if (id) bind(id); }).catch(() => {});
  }

  /* =========================================================================
   * FEATURE: Cast Row (series page)
   *   Save the actor links out of BTN's plain sidebar list, remove that list,
   *   and build a horizontal TMDb-powered cast row (photos + character names)
   *   above the Fan Art in the main column. Each card links to the actor's BTN
   *   page when BTN lists them (falls back to the TMDb person page otherwise).
   * =======================================================================*/
  function castNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ''); }
  function castInitials(n) { const p = String(n || '').trim().split(/\s+/); return (((p[0] || '')[0]) || '').toUpperCase() + (((p[p.length - 1] || '')[0]) || '').toUpperCase(); }

  async function runActors() {
    if (window.__snrActors || document.getElementById('snr-cast')) return true;
    window.__snrActors = true;
    const main = document.querySelector('.main_column');
    if (!main) { window.__snrActors = false; return false; }

    // 1. Save BTN's actor links (name -> href) before we remove the panel.
    const actorBox = [...document.querySelectorAll('.sidebar .box')]
      .find(b => /actors?/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    const btnMap = {}; const btnList = [];
    if (actorBox) {
      [...actorBox.querySelectorAll('a')].forEach(a => {
        const name = a.textContent.trim();
        const href = a.getAttribute('href');
        if (name && href) { btnMap[castNorm(name)] = { name, href }; btnList.push({ name, href }); }
      });
    }

    // 2. Fetch the TMDb cast (photos, character, billing order).
    let cast = [];
    const key = (getKey('trending') || '').trim();
    if (key) {
      try {
        const info = window.__btnSeries || seriesInfo();
        const findTv = async (ext, src) => {
          if (!ext) return null;
          try {
            const d = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(ext) +
              '?external_source=' + src + '&api_key=' + encodeURIComponent(key)).then(r => r.json());
            return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
          } catch (e) { return null; }
        };
        let tvId = await findTv(info.imdbId, 'imdb_id');
        if (!tvId) tvId = await findTv(info.tvdbId, 'tvdb_id');
        if (tvId) {
          const c = await fetch('https://api.themoviedb.org/3/tv/' + tvId + '/credits?api_key=' + encodeURIComponent(key)).then(r => r.json());
          cast = (c && c.cast) || [];
        }
      } catch (e) { cast = []; }
    }

    // 3. Build display entries — TMDb cast if we got it, else fall back to the
    //    plain BTN list so removing the panel never leaves the user with nothing.
    let entries = [];
    if (cast.length) {
      entries = cast.slice(0, 20).map(p => {
        const m = btnMap[castNorm(p.name)];
        return {
          name: p.name, character: p.character || '',
          photo: p.profile_path ? ('https://image.tmdb.org/t/p/w185' + p.profile_path) : null,
          href: m ? m.href : ('https://www.themoviedb.org/person/' + p.id), external: !m
        };
      });
    } else if (btnList.length) {
      entries = btnList.map(a => ({ name: a.name, character: '', photo: null, href: a.href, external: false }));
    }
    if (!entries.length) { return true; } // nothing to show; leave the page as-is

    // 4. Remove BTN's sidebar panel and build our row.
    if (actorBox) actorBox.remove();
    const box = document.createElement('div');
    box.className = 'box snr'; box.id = 'snr-cast';
    box.innerHTML = '<div class="head"><strong>Cast</strong></div>';
    const row = document.createElement('div'); row.className = 'snr-cast-row'; box.appendChild(row);
    entries.forEach(e => {
      const a = document.createElement('a');
      a.className = 'snr-cast-card'; a.href = e.href;
      if (e.external) { a.target = '_blank'; a.rel = 'noopener'; }
      a.title = e.external ? (e.name + ' — not listed on BTN (opens TMDb)') : e.name;
      const av = document.createElement('div'); av.className = 'snr-cast-av';
      if (e.photo) { const im = document.createElement('img'); im.loading = 'lazy'; im.alt = e.name; im.src = e.photo; av.appendChild(im); }
      else { av.textContent = castInitials(e.name); }
      const nm = document.createElement('div'); nm.className = 'snr-cast-name'; nm.textContent = e.name;
      a.appendChild(av); a.appendChild(nm);
      if (e.character) { const ch = document.createElement('div'); ch.className = 'snr-cast-char'; ch.textContent = e.character; a.appendChild(ch); }
      row.appendChild(a);
    });

    // 5. Place it above the Fan Art box (or at the end of the main column).
    const fanBox = [...main.querySelectorAll('.box')]
      .find(b => /fan\s*art/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    if (fanBox) main.insertBefore(box, fanBox); else main.appendChild(box);
    return true;
  }

  /* =========================================================================
   * FEATURE: Enhanced Series Summary (series page)
   *   Fold the sidebar Latest Episode / Next Episode / Genres panels into the
   *   Series Summary card, enriched with TMDb (rating, status, network, run,
   *   episode stills + dates). The existing description and external-link icons
   *   are left untouched, and the broken YouTube/Flash sidebar card is hidden.
   * =======================================================================*/
  function essSidebarBox(re) {
    return [...document.querySelectorAll('.sidebar .box')]
      .find(b => re.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
  }
  function essFmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso; }
  }
  function essCountdown(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    if (days < 0) return 'aired';
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return 'in ' + days + ' days';
  }
  function essEpCard(label, ep, fallbackText) {
    if (!ep) {
      const txt = (fallbackText && !/not available/i.test(fallbackText)) ? escapeHtml(fallbackText) : '—';
      return '<div class="ess-ep"><div class="who"><div class="lbl">' + label + '</div>' +
        '<div class="nm" style="color:var(--text-3,#7d8794)">' + txt + '</div></div></div>';
    }
    const still = ep.still_path ? ('<img class="thumb" loading="lazy" src="https://image.tmdb.org/t/p/w300' + ep.still_path + '">') : '';
    const se = 'S' + String(ep.season_number).padStart(2, '0') + 'E' + String(ep.episode_number).padStart(2, '0');
    const cd = essCountdown(ep.air_date);
    return '<div class="ess-ep">' + still + '<div class="who"><div class="lbl">' + label + '</div>' +
      '<div class="se">' + se + '</div><div class="nm">' + escapeHtml(ep.name || '') + '</div>' +
      '<div class="dt">' + escapeHtml(essFmtDate(ep.air_date)) + (cd ? ' · <span class="cd">' + cd + '</span>' : '') + '</div></div></div>';
  }

  async function runEnhancedSummary() {
    if (window.__snrEss || document.querySelector('#summary .ess-meta')) return true;
    window.__snrEss = true;
    const sum = document.querySelector('#summary');
    if (!sum) { window.__snrEss = false; return false; }

    // Always hide the broken YouTube/Flash sidebar card.
    const yb = essSidebarBox(/youtube/i); if (yb) yb.style.display = 'none';

    // Gather the sidebar panels we're folding in (before removing them).
    const gbox = essSidebarBox(/genres/i);
    const genreLinks = gbox ? [...gbox.querySelectorAll('a')].map(a => ({ t: a.textContent.trim(), href: a.getAttribute('href') })) : [];
    const latestBox = essSidebarBox(/latest episode/i);
    const nextBox = essSidebarBox(/next episode/i);
    const btnLatestTxt = latestBox ? (latestBox.querySelector('td, li') || {}).textContent : '';
    const btnNextTxt = nextBox ? (nextBox.querySelector('td, li') || {}).textContent : '';

    // TMDb enrichment.
    let tv = null;
    const key = (getKey('trending') || '').trim();
    if (key) {
      try {
        const info = window.__btnSeries || seriesInfo();
        const findTv = async (ext, src) => {
          if (!ext) return null;
          try {
            const d = await fetch('https://api.themoviedb.org/3/find/' + encodeURIComponent(ext) +
              '?external_source=' + src + '&api_key=' + encodeURIComponent(key)).then(r => r.json());
            return (d && d.tv_results && d.tv_results[0] && d.tv_results[0].id) || null;
          } catch (e) { return null; }
        };
        let tvId = await findTv(info.imdbId, 'imdb_id');
        if (!tvId) tvId = await findTv(info.tvdbId, 'tvdb_id');
        if (tvId) tv = await fetch('https://api.themoviedb.org/3/tv/' + tvId + '?api_key=' + encodeURIComponent(key)).then(r => r.json());
      } catch (e) { tv = null; }
    }

    // Build the meta-chip strip.
    const chips = [];
    if (tv) {
      if (tv.vote_average) chips.push('<span class="ess-chip star">★ ' + tv.vote_average.toFixed(1) + '</span>');
      if (tv.status) {
        const on = /return|airing|progress/i.test(tv.status);
        chips.push('<span class="ess-chip ' + (on ? 'status-on' : '') + '">' + escapeHtml(tv.status) + '</span>');
      }
      (tv.networks || []).slice(0, 1).forEach(n => chips.push('<span class="ess-chip">' + escapeHtml(n.name) + '</span>'));
      const y1 = (tv.first_air_date || '').slice(0, 4), y2 = (tv.last_air_date || '').slice(0, 4);
      if (y1) chips.push('<span class="ess-chip">' + y1 + (y2 && y2 !== y1 ? '–' + y2 : '') + '</span>');
      if (tv.number_of_seasons) chips.push('<span class="ess-chip">' + tv.number_of_seasons + ' season' + (tv.number_of_seasons > 1 ? 's' : '') + ' · ' + tv.number_of_episodes + ' eps</span>');
    }
    if (genreLinks.length) {
      genreLinks.forEach(g => chips.push('<a class="ess-chip" href="' + escapeAttr(g.href) + '">' + escapeHtml(g.t) + '</a>'));
    } else if (tv && tv.genres) {
      tv.genres.forEach(g => chips.push('<span class="ess-chip">' + escapeHtml(g.name) + '</span>'));
    }
    if (chips.length) {
      const meta = document.createElement('div');
      meta.className = 'ess-meta snr';
      meta.innerHTML = chips.join('');
      sum.insertBefore(meta, sum.firstChild);
    }

    // Build the Latest / Next episode strip.
    const latestEp = tv && tv.last_episode_to_air;
    const nextEp = tv && tv.next_episode_to_air;
    if (latestEp || nextEp || btnLatestTxt || btnNextTxt) {
      const eps = document.createElement('div');
      eps.className = 'ess-eps snr';
      eps.innerHTML = essEpCard('Latest Episode', latestEp, btnLatestTxt) +
                      essEpCard('Next Episode', nextEp, btnNextTxt);
      sum.appendChild(eps);
    }

    // Remove the folded-in sidebar panels.
    [gbox, latestBox, nextBox].forEach(b => { if (b) b.remove(); });
    return true;
  }

  /* =========================================================================
   * FEATURE: Stamps Row (series page)
   *   Move BTN's Buy Stamps panel out of the sidebar into a horizontal row
   *   across the bottom of the main column.
   * =======================================================================*/
  function runStamps() {
    const main = document.querySelector('.main_column');
    if (!main) return false;
    const box = [...document.querySelectorAll('.sidebar .box')]
      .find(b => /stamp/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    if (!box) return true; // no stamps panel on this page — nothing to do
    if (box.id === 'snr-stamps' && box.parentElement === main) return true;
    box.id = 'snr-stamps';
    main.appendChild(box); // relocate to the very bottom of the main column
    return true;
  }

  /* =========================================================================
   * FEATURE: Fan Art Carousels (series page)
   *   Fill the Series Fan Art card with fanart.tv artwork as controllable
   *   single-image carousels — one per artwork type that exists.
   * =======================================================================*/
  const ARTWORK_TYPES = [
    ['showbackground', 'Backgrounds'], ['tvbanner', 'Banners']
  ];

  function buildCarousel(label, imgs) {
    const car = document.createElement('div');
    car.className = 'snr-car';
    car.innerHTML =
      '<div class="snr-car-lbl"><span>' + escapeHtml(label) + '</span><span class="snr-car-count"></span></div>' +
      '<div class="snr-car-stage"><img class="snr-car-img" alt="">' +
      '<button class="snr-car-nav prev" type="button" title="Previous">‹</button>' +
      '<button class="snr-car-nav next" type="button" title="Next">›</button>' +
      '<a class="snr-car-dl" target="_blank" rel="noopener">open ↗</a></div>';
    let i = 0;
    const im = car.querySelector('.snr-car-img');
    const cnt = car.querySelector('.snr-car-count');
    const dl = car.querySelector('.snr-car-dl');
    const show = () => { im.src = imgs[i].url; dl.href = imgs[i].url; cnt.textContent = (i + 1) + ' / ' + imgs.length; };
    car.querySelector('.prev').addEventListener('click', () => { i = (i - 1 + imgs.length) % imgs.length; show(); });
    car.querySelector('.next').addEventListener('click', () => { i = (i + 1) % imgs.length; show(); });
    show();
    return car;
  }

  async function runArtwork() {
    if (window.__snrArtwork) return true;
    const fanBox = [...document.querySelectorAll('.main_column .box')]
      .find(b => /fan\s*art/i.test((b.querySelector('.head') && b.querySelector('.head').textContent) || ''));
    if (!fanBox) return false;
    window.__snrArtwork = true;
    const key = (getKey('fanart') || '').trim();
    if (!key) return true;
    let tvdbId = null;
    try { tvdbId = await resolveTvdbId(); } catch (e) {}
    if (!tvdbId) return true;
    let data = null;
    try {
      const raw = await gmGet('https://webservice.fanart.tv/v3/tv/' + encodeURIComponent(tvdbId) + '?api_key=' + encodeURIComponent(key));
      data = JSON.parse(raw);
    } catch (e) { return true; }
    if (!data) return true;

    // English only — keep English-tagged and text-free artwork (backgrounds are
    // usually untagged), drop other languages. Sort by community likes.
    const sortImgs = arr => (arr || [])
      .filter(x => !x.lang || x.lang === 'en' || x.lang === '00')
      .sort((a, b) => (+b.likes || 0) - (+a.likes || 0));

    const wrap = document.createElement('div');
    wrap.className = 'snr-cars snr';
    const seenLabels = {};
    ARTWORK_TYPES.forEach(([k, label]) => {
      if (seenLabels[label]) return; // e.g. don't add "Clear Art" twice (hd + sd)
      const imgs = sortImgs(data[k]);
      if (!imgs.length) return;
      seenLabels[label] = true;
      wrap.appendChild(buildCarousel(label, imgs));
    });
    if (!wrap.children.length) return true; // no artwork — leave BTN's card as-is

    const body = fanBox.querySelector('.body') || fanBox;
    body.innerHTML = '';
    body.appendChild(wrap);
    return true;
  }

  /* =========================================================================
   * Boot
   * =======================================================================*/
  function tryInject(fn) {
    try { if (fn()) return true; } catch (e) { console.warn('[BTN-Sonarr] inject failed', e); return true; }
    let tries = 0;
    const iv = setInterval(() => {
      try { if (fn() || ++tries > 25) clearInterval(iv); }
      catch (e) { clearInterval(iv); console.warn('[BTN-Sonarr] retry failed', e); }
    }, 400);
    return false;
  }

  function boot() {
    injectStyle();
    // Runs on every BTN page.
    if (isEnabled('placeholder')) {
      try { runPlaceholders(); } catch (e) { console.error('[STMPE] placeholder error', e); }
    }
    if (IS_EDIT) {
      tryInject(injectSettingsPanels);
    }
    if (IS_SERIES) {
      window.__btnSeries = seriesInfo();
      if (isEnabled('sonarr')) {
        tryInject(() => (document.querySelector('.linkbox') ? injectLinkbar() : false));
      }
      if (isEnabled('fanart')) {
        runFanart();
      }
      if (isEnabled('parents')) {
        try { runParentsGuide(); } catch (e) { console.error('[STMPE] parents guide error', e); }
      }
      if (isEnabled('seasons')) {
        tryInject(() => {
          const t = document.querySelector('.main_column .torrent_table tr.group_torrent');
          return t ? runSeasonCollapse() : false;
        });
      }
      if (isEnabled('hidereq')) {
        tryInject(() => {
          const t = document.querySelector('.main_column table.border tr.colhead_dark, .main_column table.border tr.colhead');
          return t ? (runHideEmptyRequests() || true) : false;
        });
      }
      if (isEnabled('trailer')) {
        tryInject(() => {
          const pb = document.querySelector('#playbutton');
          if (!pb) return false;
          runTrailer(pb);
          return true;
        });
      }
      if (isEnabled('actors')) {
        tryInject(() => {
          if (!document.querySelector('.main_column')) return false;
          runActors();
          return true;
        });
      }
      if (isEnabled('enhsummary')) {
        tryInject(() => {
          if (!document.querySelector('#summary')) return false;
          runEnhancedSummary();
          return true;
        });
      }
      if (isEnabled('stamps')) {
        tryInject(() => {
          if (!document.querySelector('.main_column')) return false;
          return runStamps();
        });
      }
      if (isEnabled('artwork')) {
        tryInject(() => {
          if (!document.querySelector('.main_column .box')) return false;
          runArtwork();
          return true;
        });
      }
    }
    if (IS_HOME) {
      if (isEnabled('trending')) {
        tryInject(() => {
          const mc = document.querySelector('#content > div.thin > div.main_column') || document.querySelector('.main_column');
          if (!mc) return false;
          runTrending();
          return true;
        });
      }
    }
  }

  (async () => {
    try { await initStorage(); } catch (e) { console.error('[BTN-Sonarr] storage init error', e); }
    try { boot(); } catch (e) { console.error('[BTN-Sonarr] boot error', e); }
  })();
})();
