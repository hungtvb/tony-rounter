import type { FastifyInstance, FastifyReply } from 'fastify';

const UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Tony Router</title>
  <link rel="stylesheet" href="/ui/styles.css">
  <script src="/ui/app.js" defer></script>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/ui" aria-label="Tony Router dashboard">
        <span class="brand-mark">TR</span>
        <span>
          <strong>Tony Router</strong>
          <small>Local control plane</small>
        </span>
      </a>

      <nav class="nav" aria-label="Dashboard sections">
        <a class="nav-item is-active" href="#overview"><span>01</span> Overview</a>
        <a class="nav-item" href="#models"><span>02</span> Models</a>
        <a class="nav-item" href="#playground"><span>03</span> Playground</a>
        <a class="nav-item" href="#connection"><span>04</span> Connection</a>
      </nav>

      <div class="sidebar-footer">
        <div class="privacy-note">
          <span class="privacy-dot"></span>
          <div><strong>Local-first</strong><small>Token stays in this tab</small></div>
        </div>
        <button class="button button-ghost button-full" id="disconnectButton" type="button">Disconnect</button>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">CONTROL PLANE</p>
          <h1>Router dashboard</h1>
        </div>
        <div class="topbar-actions">
          <span class="status-pill is-pending" id="globalStatus"><span></span> Checking gateway</span>
          <button class="icon-button" id="refreshButton" type="button" aria-label="Refresh dashboard" title="Refresh">↻</button>
        </div>
      </header>

      <section class="section" id="overview">
        <div class="metric-grid">
          <article class="metric-card">
            <div class="metric-label"><span>Gateway</span><span class="mini-state" id="gatewayState">—</span></div>
            <strong id="gatewayMetric">Checking</strong>
            <small id="gatewayDetail">Connecting to /health</small>
          </article>
          <article class="metric-card">
            <div class="metric-label"><span>Provider</span><span class="mini-state" id="providerState">—</span></div>
            <strong id="providerMetric">Locked</strong>
            <small id="providerDetail">Enter the local bearer token</small>
          </article>
          <article class="metric-card">
            <div class="metric-label"><span>Models</span><span class="mini-state">LIVE</span></div>
            <strong id="modelMetric">0</strong>
            <small>Available through /v1/models</small>
          </article>
          <article class="metric-card">
            <div class="metric-label"><span>Protocol</span><span class="mini-state is-accent">API</span></div>
            <strong>OpenAI</strong>
            <small>Chat Completions + SSE</small>
          </article>
        </div>
      </section>

      <section class="section" id="connection">
        <div class="section-heading">
          <div><p class="eyebrow">AUTHENTICATION</p><h2>Connect to this gateway</h2></div>
          <p>The UI shell is public on loopback. Protected API calls still require your local bearer token.</p>
        </div>
        <article class="panel connection-panel">
          <div class="token-field">
            <label for="tokenInput">Bearer token</label>
            <div class="input-row">
              <input id="tokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="Paste ~/.tony-router/token">
              <button class="button button-primary" id="connectButton" type="button">Connect</button>
            </div>
            <small>Stored only in sessionStorage for this browser tab.</small>
          </div>
          <div class="connection-summary">
            <span class="connection-icon">⌁</span>
            <div><strong id="connectionTitle">Not connected</strong><small id="connectionSubtitle">Gateway APIs are locked</small></div>
          </div>
        </article>
      </section>

      <section class="section" id="models">
        <div class="section-heading">
          <div><p class="eyebrow">REGISTRY</p><h2>Available models</h2></div>
          <p>Live data from the configured OpenAI-compatible upstream or static gateway registry.</p>
        </div>
        <article class="panel table-panel">
          <div class="table-toolbar">
            <div class="search-box"><span>⌕</span><input id="modelSearch" type="search" placeholder="Filter models" aria-label="Filter models"></div>
            <span class="count-label" id="modelCountLabel">0 models</span>
          </div>
          <div class="model-list" id="modelList">
            <div class="empty-state"><strong>Connect to load models</strong><small>Your token is never embedded in this page.</small></div>
          </div>
        </article>
      </section>

      <section class="section" id="playground">
        <div class="section-heading">
          <div><p class="eyebrow">LIVE TEST</p><h2>Chat playground</h2></div>
          <p>Send a streaming Chat Completions request through Tony Router and inspect the result.</p>
        </div>
        <div class="playground-grid">
          <article class="panel composer-panel">
            <label for="modelSelect">Model</label>
            <select id="modelSelect"><option value="">Connect to load models</option></select>
            <label for="promptInput">Prompt</label>
            <textarea id="promptInput" rows="10" placeholder="Ask the selected model something...">Explain why a capability-aware router is useful for coding agents in three concise points.</textarea>
            <div class="composer-footer">
              <small>Ctrl / Cmd + Enter to send</small>
              <button class="button button-primary" id="sendButton" type="button">Run request</button>
            </div>
          </article>
          <article class="panel response-panel">
            <div class="response-toolbar">
              <div><span class="response-dot" id="responseDot"></span><strong id="responseTitle">Ready</strong></div>
              <button class="button button-ghost" id="copyButton" type="button">Copy</button>
            </div>
            <pre id="responseOutput">Connect to the gateway, choose a model, then run a request.</pre>
            <div class="response-meta"><span id="responseModel">No model</span><span id="responseLatency">—</span></div>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="section-heading">
          <div><p class="eyebrow">ACTIVITY</p><h2>Session events</h2></div>
          <p>Client-side operational events only. Prompts and tokens are not written to gateway logs by this UI.</p>
        </div>
        <article class="panel event-panel" id="eventList"></article>
      </section>
    </main>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>`;

const UI_CSS = String.raw`:root {
  --bg: #090c12;
  --surface: #10151e;
  --surface-2: #151c27;
  --surface-3: #1b2431;
  --border: rgba(255,255,255,.08);
  --border-strong: rgba(255,255,255,.14);
  --text: #f4f7fb;
  --muted: #8e9aad;
  --accent: #78f0c5;
  --accent-2: #6ba8ff;
  --danger: #ff7b8b;
  --warning: #f6c76b;
  --shadow: 0 24px 80px rgba(0,0,0,.34);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: radial-gradient(circle at 82% -10%, rgba(107,168,255,.12), transparent 34%), var(--bg); color: var(--text); min-height: 100vh; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }
.app-shell { min-height: 100vh; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
.sidebar { position: sticky; top: 0; height: 100vh; padding: 28px 20px; border-right: 1px solid var(--border); background: rgba(10,13,19,.86); backdrop-filter: blur(18px); display: flex; flex-direction: column; z-index: 5; }
.brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 26px; }
.brand-mark { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 13px; background: linear-gradient(145deg, var(--accent), #3ecaa8); color: #07110e; font-weight: 900; letter-spacing: -.04em; box-shadow: 0 10px 28px rgba(120,240,197,.18); }
.brand strong, .brand small { display: block; }
.brand strong { font-size: 15px; letter-spacing: -.01em; }
.brand small { color: var(--muted); margin-top: 3px; font-size: 11px; }
.nav { display: grid; gap: 6px; }
.nav-item { display: flex; align-items: center; gap: 13px; padding: 12px 13px; border-radius: 11px; color: var(--muted); font-size: 13px; transition: .18s ease; }
.nav-item span { color: #596477; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.nav-item:hover, .nav-item.is-active { background: var(--surface-2); color: var(--text); }
.nav-item.is-active span { color: var(--accent); }
.sidebar-footer { margin-top: auto; display: grid; gap: 14px; }
.privacy-note { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,.025); }
.privacy-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 5px rgba(120,240,197,.08); }
.privacy-note strong, .privacy-note small { display: block; }
.privacy-note strong { font-size: 12px; }
.privacy-note small { color: var(--muted); font-size: 10px; margin-top: 2px; }
.main { min-width: 0; padding: 32px clamp(22px, 4vw, 62px) 72px; max-width: 1580px; width: 100%; margin: 0 auto; }
.topbar { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 34px; }
h1, h2, p { margin: 0; }
h1 { font-size: clamp(27px, 3vw, 39px); letter-spacing: -.045em; line-height: 1.05; }
h2 { font-size: 22px; letter-spacing: -.025em; }
.eyebrow { color: var(--accent); font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .15em; margin-bottom: 8px; }
.topbar-actions { display: flex; align-items: center; gap: 10px; }
.status-pill { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 13px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 12px; }
.status-pill span { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
.status-pill.is-online span { background: var(--accent); box-shadow: 0 0 0 4px rgba(120,240,197,.08); }
.status-pill.is-error span { background: var(--danger); }
.icon-button { width: 38px; height: 38px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); color: var(--text); font-size: 20px; }
.icon-button:hover { background: var(--surface-2); border-color: var(--border-strong); }
.section { margin-top: 40px; scroll-margin-top: 24px; }
.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.metric-card, .panel { border: 1px solid var(--border); background: linear-gradient(145deg, rgba(21,28,39,.94), rgba(14,19,27,.94)); box-shadow: var(--shadow); }
.metric-card { min-height: 138px; border-radius: 17px; padding: 19px; display: flex; flex-direction: column; }
.metric-label { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.metric-card > strong { margin-top: auto; font-size: 25px; letter-spacing: -.04em; }
.metric-card > small { color: var(--muted); margin-top: 5px; font-size: 11px; }
.mini-state { color: var(--accent); font: 700 9px ui-monospace, monospace; }
.mini-state.is-accent { color: var(--accent-2); }
.section-heading { display: flex; justify-content: space-between; align-items: end; gap: 32px; margin-bottom: 15px; }
.section-heading > p { max-width: 520px; color: var(--muted); font-size: 12px; line-height: 1.6; text-align: right; }
.panel { border-radius: 18px; overflow: hidden; }
.connection-panel { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, .7fr); }
.token-field { padding: 22px; border-right: 1px solid var(--border); }
.token-field label, .composer-panel label { display: block; color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 9px; }
.input-row { display: flex; gap: 10px; }
input, textarea, select { width: 100%; border: 1px solid var(--border-strong); background: #0b0f16; color: var(--text); outline: none; transition: .18s ease; }
input { height: 44px; padding: 0 13px; border-radius: 11px; }
textarea { resize: vertical; min-height: 190px; padding: 14px; border-radius: 12px; line-height: 1.55; }
select { height: 44px; padding: 0 12px; border-radius: 11px; margin-bottom: 20px; }
input:focus, textarea:focus, select:focus { border-color: rgba(120,240,197,.55); box-shadow: 0 0 0 3px rgba(120,240,197,.07); }
.token-field > small { color: var(--muted); display: block; margin-top: 9px; font-size: 10px; }
.button { min-height: 40px; padding: 0 15px; border-radius: 10px; border: 1px solid transparent; font-weight: 750; font-size: 12px; transition: .16s ease; }
.button:disabled { opacity: .45; cursor: not-allowed; }
.button-primary { background: var(--accent); color: #07110e; }
.button-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 9px 24px rgba(120,240,197,.17); }
.button-ghost { background: transparent; color: var(--muted); border-color: var(--border); }
.button-ghost:hover { color: var(--text); background: var(--surface-2); }
.button-full { width: 100%; }
.connection-summary { padding: 22px; display: flex; align-items: center; gap: 14px; }
.connection-icon { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 13px; background: rgba(107,168,255,.1); color: var(--accent-2); font-size: 24px; }
.connection-summary strong, .connection-summary small { display: block; }
.connection-summary strong { font-size: 13px; }
.connection-summary small { color: var(--muted); font-size: 10px; margin-top: 4px; }
.table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.search-box { position: relative; max-width: 310px; width: 100%; }
.search-box span { position: absolute; left: 13px; top: 11px; color: var(--muted); }
.search-box input { padding-left: 35px; height: 38px; }
.count-label { color: var(--muted); font-size: 11px; }
.model-list { min-height: 188px; }
.model-row { display: grid; grid-template-columns: minmax(0, 1fr) 160px 100px; gap: 16px; align-items: center; padding: 15px 18px; border-bottom: 1px solid var(--border); }
.model-row:last-child { border-bottom: 0; }
.model-name { display: flex; align-items: center; gap: 11px; min-width: 0; }
.model-avatar { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; background: rgba(120,240,197,.08); color: var(--accent); font: 800 11px ui-monospace, monospace; }
.model-name strong, .model-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-name strong { font-size: 12px; }
.model-name small, .model-owner { color: var(--muted); font-size: 10px; }
.model-status { justify-self: end; color: var(--accent); font: 700 9px ui-monospace, monospace; letter-spacing: .08em; }
.empty-state { min-height: 188px; display: grid; place-content: center; text-align: center; padding: 28px; }
.empty-state strong, .empty-state small { display: block; }
.empty-state strong { font-size: 13px; }
.empty-state small { color: var(--muted); margin-top: 7px; font-size: 10px; }
.playground-grid { display: grid; grid-template-columns: minmax(330px, .85fr) minmax(0, 1.15fr); gap: 14px; }
.composer-panel { padding: 20px; }
.composer-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 13px; }
.composer-footer small { color: var(--muted); font-size: 10px; }
.response-panel { display: flex; flex-direction: column; min-height: 420px; }
.response-toolbar { height: 58px; padding: 0 17px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
.response-toolbar > div { display: flex; align-items: center; gap: 9px; }
.response-toolbar strong { font-size: 12px; }
.response-dot { width: 8px; height: 8px; border-radius: 50%; background: #566174; }
.response-dot.is-running { background: var(--warning); animation: pulse 1s infinite; }
.response-dot.is-success { background: var(--accent); }
.response-dot.is-error { background: var(--danger); }
@keyframes pulse { 50% { opacity: .3; } }
.response-panel pre { margin: 0; padding: 20px; flex: 1; min-height: 280px; white-space: pre-wrap; overflow-wrap: anywhere; color: #dce5f2; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: auto; }
.response-meta { display: flex; justify-content: space-between; gap: 12px; padding: 12px 17px; border-top: 1px solid var(--border); color: var(--muted); font: 10px ui-monospace, monospace; }
.event-panel { min-height: 120px; padding: 4px 18px; }
.event-row { display: grid; grid-template-columns: 82px 92px minmax(0, 1fr); gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--border); color: var(--muted); font: 10px/1.5 ui-monospace, monospace; }
.event-row:last-child { border-bottom: 0; }
.event-kind { color: var(--accent-2); text-transform: uppercase; }
.event-row.is-error .event-kind { color: var(--danger); }
.toast { position: fixed; right: 22px; bottom: 22px; max-width: 380px; padding: 12px 15px; border: 1px solid var(--border-strong); border-radius: 11px; background: #151c27; color: var(--text); box-shadow: var(--shadow); font-size: 12px; opacity: 0; transform: translateY(10px); pointer-events: none; transition: .2s ease; z-index: 20; }
.toast.is-visible { opacity: 1; transform: translateY(0); }
@media (max-width: 1050px) {
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .playground-grid { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .app-shell { display: block; }
  .sidebar { position: static; height: auto; padding: 16px; border-right: 0; border-bottom: 1px solid var(--border); }
  .brand { padding-bottom: 14px; }
  .nav { grid-template-columns: repeat(4, minmax(0, 1fr)); overflow-x: auto; }
  .nav-item { justify-content: center; white-space: nowrap; padding: 10px; }
  .nav-item span, .sidebar-footer { display: none; }
  .main { padding: 24px 16px 56px; }
  .topbar, .section-heading { align-items: flex-start; }
  .section-heading { display: block; }
  .section-heading > p { text-align: left; margin-top: 10px; }
  .connection-panel { grid-template-columns: 1fr; }
  .token-field { border-right: 0; border-bottom: 1px solid var(--border); }
  .model-row { grid-template-columns: minmax(0, 1fr) 72px; }
  .model-owner { display: none; }
}
@media (max-width: 520px) {
  .topbar { display: block; }
  .topbar-actions { margin-top: 16px; }
  .metric-grid { grid-template-columns: 1fr; }
  .input-row { display: grid; }
  .composer-footer { align-items: stretch; flex-direction: column; }
  .composer-footer .button { width: 100%; }
  .event-row { grid-template-columns: 70px 1fr; }
  .event-row span:last-child { grid-column: 1 / -1; }
}`;

const UI_JS = String.raw`(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    token: sessionStorage.getItem('tony-router-token') || '',
    health: null,
    models: [],
    filteredModels: [],
    events: [],
    running: false
  };

  const elements = {
    globalStatus: $('globalStatus'),
    gatewayState: $('gatewayState'),
    gatewayMetric: $('gatewayMetric'),
    gatewayDetail: $('gatewayDetail'),
    providerState: $('providerState'),
    providerMetric: $('providerMetric'),
    providerDetail: $('providerDetail'),
    modelMetric: $('modelMetric'),
    tokenInput: $('tokenInput'),
    connectButton: $('connectButton'),
    disconnectButton: $('disconnectButton'),
    connectionTitle: $('connectionTitle'),
    connectionSubtitle: $('connectionSubtitle'),
    refreshButton: $('refreshButton'),
    modelSearch: $('modelSearch'),
    modelCountLabel: $('modelCountLabel'),
    modelList: $('modelList'),
    modelSelect: $('modelSelect'),
    promptInput: $('promptInput'),
    sendButton: $('sendButton'),
    copyButton: $('copyButton'),
    responseOutput: $('responseOutput'),
    responseTitle: $('responseTitle'),
    responseDot: $('responseDot'),
    responseModel: $('responseModel'),
    responseLatency: $('responseLatency'),
    eventList: $('eventList'),
    toast: $('toast')
  };

  function nowLabel() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function escapeSummary(value) {
    if (!value) return 'Unknown error';
    return String(value).replace(/\s+/g, ' ').slice(0, 180);
  }

  function addEvent(kind, message, isError) {
    state.events.unshift({ time: nowLabel(), kind, message: escapeSummary(message), isError: Boolean(isError) });
    state.events = state.events.slice(0, 8);
    renderEvents();
  }

  function renderEvents() {
    elements.eventList.replaceChildren();
    const events = state.events.length ? state.events : [{ time: nowLabel(), kind: 'ready', message: 'Dashboard loaded', isError: false }];
    events.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'event-row' + (event.isError ? ' is-error' : '');
      const time = document.createElement('span');
      time.textContent = event.time;
      const kind = document.createElement('span');
      kind.className = 'event-kind';
      kind.textContent = event.kind;
      const message = document.createElement('span');
      message.textContent = event.message;
      row.append(time, kind, message);
      elements.eventList.append(row);
    });
  }

  let toastTimer;
  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2400);
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (state.token) headers.authorization = 'Bearer ' + state.token;
    return headers;
  }

  async function parseError(response) {
    try {
      const body = await response.json();
      return body && body.error && body.error.message ? body.error.message : 'Request failed with HTTP ' + response.status;
    } catch (_) {
      return 'Request failed with HTTP ' + response.status;
    }
  }

  function setGlobalStatus(mode, label) {
    elements.globalStatus.className = 'status-pill ' + mode;
    elements.globalStatus.lastChild.textContent = ' ' + label;
  }

  async function loadHealth() {
    try {
      const response = await fetch('/health', { cache: 'no-store' });
      if (!response.ok) throw new Error('Health returned HTTP ' + response.status);
      state.health = await response.json();
      elements.gatewayState.textContent = 'ONLINE';
      elements.gatewayMetric.textContent = 'Online';
      elements.gatewayDetail.textContent = 'Version ' + (state.health.version || 'unknown');
      setGlobalStatus('is-online', 'Gateway online');
      addEvent('health', 'Gateway is online, version ' + (state.health.version || 'unknown'));
      return true;
    } catch (error) {
      elements.gatewayState.textContent = 'OFFLINE';
      elements.gatewayMetric.textContent = 'Offline';
      elements.gatewayDetail.textContent = escapeSummary(error.message);
      setGlobalStatus('is-error', 'Gateway offline');
      addEvent('error', error.message, true);
      return false;
    }
  }

  function renderConnection(connected, detail) {
    elements.providerState.textContent = connected ? 'READY' : 'LOCKED';
    elements.providerMetric.textContent = connected ? 'Connected' : 'Locked';
    elements.providerDetail.textContent = detail;
    elements.connectionTitle.textContent = connected ? 'Authenticated' : 'Not connected';
    elements.connectionSubtitle.textContent = detail;
    elements.disconnectButton.disabled = !state.token;
  }

  function modelInitials(id) {
    return String(id).split(/[-_/.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'AI';
  }

  function renderModels() {
    const query = elements.modelSearch.value.trim().toLowerCase();
    state.filteredModels = state.models.filter((model) => {
      return !query || model.id.toLowerCase().includes(query) || String(model.owned_by || '').toLowerCase().includes(query);
    });
    elements.modelCountLabel.textContent = state.filteredModels.length + (state.filteredModels.length === 1 ? ' model' : ' models');
    elements.modelMetric.textContent = String(state.models.length);
    elements.modelList.replaceChildren();

    if (!state.filteredModels.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const strong = document.createElement('strong');
      strong.textContent = state.models.length ? 'No models match the filter' : 'No models available';
      const small = document.createElement('small');
      small.textContent = state.models.length ? 'Try another search term.' : 'Check provider configuration or authentication.';
      empty.append(strong, small);
      elements.modelList.append(empty);
      return;
    }

    state.filteredModels.forEach((model) => {
      const row = document.createElement('div');
      row.className = 'model-row';
      const name = document.createElement('div');
      name.className = 'model-name';
      const avatar = document.createElement('span');
      avatar.className = 'model-avatar';
      avatar.textContent = modelInitials(model.id);
      const copy = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = model.id;
      const small = document.createElement('small');
      small.textContent = model.object || 'model';
      copy.append(strong, small);
      name.append(avatar, copy);
      const owner = document.createElement('span');
      owner.className = 'model-owner';
      owner.textContent = model.owned_by || 'unknown';
      const status = document.createElement('span');
      status.className = 'model-status';
      status.textContent = 'AVAILABLE';
      row.append(name, owner, status);
      elements.modelList.append(row);
    });
  }

  function renderModelSelect() {
    const previous = elements.modelSelect.value;
    elements.modelSelect.replaceChildren();
    if (!state.models.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models available';
      elements.modelSelect.append(option);
      return;
    }
    state.models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.id;
      elements.modelSelect.append(option);
    });
    if (state.models.some((model) => model.id === previous)) elements.modelSelect.value = previous;
  }

  async function loadModels() {
    if (!state.token) {
      state.models = [];
      renderModels();
      renderModelSelect();
      renderConnection(false, 'Enter the local bearer token');
      return false;
    }

    try {
      const response = await fetch('/v1/models', { headers: authHeaders(), cache: 'no-store' });
      if (!response.ok) throw new Error(await parseError(response));
      const body = await response.json();
      state.models = Array.isArray(body.data) ? body.data.filter((model) => model && typeof model.id === 'string') : [];
      renderModels();
      renderModelSelect();
      renderConnection(true, state.models.length + ' models available');
      addEvent('models', 'Loaded ' + state.models.length + ' models');
      return true;
    } catch (error) {
      state.models = [];
      renderModels();
      renderModelSelect();
      renderConnection(false, escapeSummary(error.message));
      addEvent('auth', error.message, true);
      return false;
    }
  }

  async function refreshAll() {
    elements.refreshButton.disabled = true;
    await loadHealth();
    await loadModels();
    elements.refreshButton.disabled = false;
  }

  async function connect() {
    const token = elements.tokenInput.value.trim();
    if (!token) {
      toast('Paste the local gateway token first');
      elements.tokenInput.focus();
      return;
    }
    state.token = token;
    sessionStorage.setItem('tony-router-token', token);
    elements.connectButton.disabled = true;
    const connected = await loadModels();
    elements.connectButton.disabled = false;
    if (connected) {
      elements.tokenInput.value = '';
      toast('Gateway connected');
    } else {
      toast('Token or provider configuration is invalid');
    }
  }

  function disconnect() {
    state.token = '';
    state.models = [];
    sessionStorage.removeItem('tony-router-token');
    elements.tokenInput.value = '';
    renderModels();
    renderModelSelect();
    renderConnection(false, 'Gateway APIs are locked');
    addEvent('auth', 'Disconnected from protected APIs');
    toast('Disconnected');
  }

  function extractDelta(payload) {
    if (!payload || !Array.isArray(payload.choices)) return '';
    const choice = payload.choices[0];
    if (!choice) return '';
    if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
    if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
    return '';
  }

  async function readEventStream(response, onText) {
    if (!response.body) throw new Error('Streaming body is unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) {
        const lines = event.split(/\r?\n/);
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let payload;
          try { payload = JSON.parse(data); } catch (_) { continue; }
          if (payload.error) throw new Error(payload.error.message || 'Streaming request failed');
          const text = extractDelta(payload);
          if (text) onText(text);
        }
      }
    }
  }

  function setResponseState(mode, title) {
    elements.responseDot.className = 'response-dot' + (mode ? ' ' + mode : '');
    elements.responseTitle.textContent = title;
  }

  async function runChat() {
    if (state.running) return;
    if (!state.token) {
      toast('Connect to the gateway first');
      return;
    }
    const model = elements.modelSelect.value;
    const prompt = elements.promptInput.value.trim();
    if (!model || !prompt) {
      toast('Choose a model and enter a prompt');
      return;
    }

    state.running = true;
    elements.sendButton.disabled = true;
    elements.responseOutput.textContent = '';
    elements.responseModel.textContent = model;
    elements.responseLatency.textContent = 'running';
    setResponseState('is-running', 'Streaming response');
    addEvent('request', 'Started chat request with ' + model);
    const started = performance.now();

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!response.ok) throw new Error(await parseError(response));

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        await readEventStream(response, (text) => {
          elements.responseOutput.textContent += text;
          elements.responseOutput.scrollTop = elements.responseOutput.scrollHeight;
        });
      } else {
        const payload = await response.json();
        elements.responseOutput.textContent = extractDelta(payload) || JSON.stringify(payload, null, 2);
      }

      const latency = Math.round(performance.now() - started);
      elements.responseLatency.textContent = latency + ' ms';
      setResponseState('is-success', 'Completed');
      addEvent('success', 'Chat completed in ' + latency + ' ms');
    } catch (error) {
      const latency = Math.round(performance.now() - started);
      elements.responseOutput.textContent = 'Error: ' + escapeSummary(error.message);
      elements.responseLatency.textContent = latency + ' ms';
      setResponseState('is-error', 'Request failed');
      addEvent('error', error.message, true);
    } finally {
      state.running = false;
      elements.sendButton.disabled = false;
    }
  }

  async function copyResponse() {
    const text = elements.responseOutput.textContent || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('Response copied');
    } catch (_) {
      toast('Clipboard access is unavailable');
    }
  }

  elements.connectButton.addEventListener('click', connect);
  elements.disconnectButton.addEventListener('click', disconnect);
  elements.refreshButton.addEventListener('click', refreshAll);
  elements.modelSearch.addEventListener('input', renderModels);
  elements.sendButton.addEventListener('click', runChat);
  elements.copyButton.addEventListener('click', copyResponse);
  elements.tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connect();
  });
  elements.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) runChat();
  });

  if (state.token) {
    elements.connectionTitle.textContent = 'Restoring session';
    elements.connectionSubtitle.textContent = 'Validating saved tab token';
  }
  renderEvents();
  refreshAll();
})();`;

function secureUiHeaders(reply: FastifyReply): void {
  reply.header(
    'content-security-policy',
    "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('cache-control', 'no-store');
}

export function installUiRoutes(app: FastifyInstance): void {
  app.get('/', (_request, reply) => {
    reply.code(302).header('location', '/ui').send();
  });

  const renderUi = (_request: unknown, reply: FastifyReply) => {
    secureUiHeaders(reply);
    return reply.type('text/html; charset=utf-8').send(UI_HTML);
  };

  app.get('/ui', renderUi);
  app.get('/ui/', renderUi);

  app.get('/ui/styles.css', (_request, reply) => {
    secureUiHeaders(reply);
    return reply.type('text/css; charset=utf-8').send(UI_CSS);
  });

  app.get('/ui/app.js', (_request, reply) => {
    secureUiHeaders(reply);
    return reply.type('text/javascript; charset=utf-8').send(UI_JS);
  });
}
