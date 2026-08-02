export const UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#090b10">
  <title>Tony Router</title>
  <link rel="stylesheet" href="/ui/styles.css">
  <script src="/ui/app.js" defer></script>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/ui" aria-label="Tony Router dashboard">
        <span class="brand-mark">T</span>
        <span class="brand-copy"><strong>Tony Router</strong><small>Local control plane</small></span>
      </a>

      <nav class="nav" aria-label="Primary navigation">
        <button class="nav-item is-active" data-view-target="dashboard" type="button"><span class="nav-icon">⌂</span><span>Dashboard</span></button>
        <button class="nav-item" data-view-target="models" type="button"><span class="nav-icon">◇</span><span>Models</span></button>
        <button class="nav-item" data-view-target="playground" type="button"><span class="nav-icon">▢</span><span>Chat Playground</span></button>
        <button class="nav-item" data-view-target="traces" type="button"><span class="nav-icon">↗</span><span>Request Traces</span></button>
        <button class="nav-item" data-view-target="connection" type="button"><span class="nav-icon">⚙</span><span>Connection</span></button>
      </nav>

      <div class="sidebar-runtime">
        <div class="runtime-heading"><span>Gateway</span><span class="status-dot is-pending" id="sidebarStatusDot"></span></div>
        <dl>
          <div><dt>Version</dt><dd id="sidebarVersion">—</dd></div>
          <div><dt>Uptime</dt><dd id="sidebarUptime">—</dd></div>
        </dl>
        <button class="button button-secondary button-full" id="healthButton" type="button">View /health</button>
      </div>

      <button class="button button-ghost button-full" id="disconnectButton" type="button">Disconnect</button>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div>
          <h1 id="pageTitle">Dashboard</h1>
          <p id="pageSubtitle">Overview of your Tony Router gateway</p>
        </div>
        <div class="topbar-actions">
          <button class="button button-secondary" data-view-target="connection" type="button">Connection</button>
          <button class="icon-button" id="refreshButton" type="button" aria-label="Refresh runtime data" title="Refresh">↻</button>
          <span class="connection-pill is-pending" id="globalStatus"><span></span>Checking</span>
        </div>
      </header>

      <main class="content">
        <section class="view is-active" data-view="dashboard" aria-labelledby="dashboardHeading">
          <h2 class="sr-only" id="dashboardHeading">Dashboard</h2>
          <div class="metric-grid">
            <article class="metric-card">
              <div class="metric-head"><span>Gateway Status</span><span class="metric-icon is-green">⌁</span></div>
              <strong class="metric-value is-green" id="gatewayMetric">Checking</strong>
              <small id="gatewayDetail">Connecting to /health</small>
            </article>
            <article class="metric-card">
              <div class="metric-head"><span>Provider</span><span class="metric-icon is-blue">▤</span></div>
              <strong class="metric-value" id="providerMetric">Locked</strong>
              <small id="providerDetail">Connect with your local token</small>
            </article>
            <article class="metric-card">
              <div class="metric-head"><span>Models</span><span class="metric-icon is-purple">◇</span></div>
              <strong class="metric-value" id="modelMetric">0</strong>
              <small>Available models</small>
            </article>
            <article class="metric-card">
              <div class="metric-head"><span>Requests (runtime)</span><span class="metric-icon is-cyan">⌁</span></div>
              <strong class="metric-value" id="requestMetric">—</strong>
              <small id="requestDetail">Runtime telemetry</small>
            </article>
            <article class="metric-card">
              <div class="metric-head"><span>Success Rate</span><span class="metric-icon is-green">◔</span></div>
              <strong class="metric-value is-green" id="successMetric">—</strong>
              <small>HTTP 2xx–3xx</small>
            </article>
          </div>

          <div class="dashboard-grid">
            <article class="panel provider-panel">
              <div class="panel-head"><div><span class="eyebrow">PROVIDER</span><h3>Runtime connection</h3></div><button class="text-button" data-view-target="connection" type="button">Manage</button></div>
              <div class="provider-body">
                <span class="provider-logo" id="providerLogo">AI</span>
                <div class="provider-copy"><strong id="providerName">Not connected</strong><small id="providerBaseUrl">Protected runtime data is locked</small></div>
                <span class="health-badge is-muted" id="providerHealth">Locked</span>
              </div>
              <dl class="provider-facts">
                <div><dt>Mode</dt><dd id="providerMode">—</dd></div>
                <div><dt>Credential</dt><dd id="providerCredential">—</dd></div>
                <div><dt>Models</dt><dd id="providerModels">0</dd></div>
              </dl>
              <div class="panel-foot"><span class="tiny-dot" id="providerFootDot"></span><span id="providerFoot">Connect to inspect provider status</span></div>
            </article>

            <article class="panel recent-panel">
              <div class="panel-head"><div><span class="eyebrow">LIVE</span><h3>Recent requests</h3></div><button class="text-button" data-view-target="traces" type="button">View all</button></div>
              <div class="request-list" id="recentRequestList">
                <div class="empty-state"><strong>No runtime data</strong><small>Authenticate to view bounded in-memory telemetry.</small></div>
              </div>
            </article>

            <article class="panel quick-panel">
              <div class="panel-head"><div><span class="eyebrow">PLAYGROUND</span><h3>Test the active route</h3></div><span class="health-badge is-muted" id="quickModelBadge">No model</span></div>
              <div class="quick-copy">
                <div class="quick-orbit"><span></span><span></span><span></span><strong>TR</strong></div>
                <h4>Send a real streaming request</h4>
                <p>Use the OpenAI-compatible Chat Completions endpoint and inspect output directly in this tab.</p>
              </div>
              <button class="button button-primary button-full" data-view-target="playground" type="button">Open Chat Playground</button>
            </article>
          </div>
        </section>

        <section class="view" data-view="models" aria-labelledby="modelsHeading">
          <div class="view-heading"><div><span class="eyebrow">REGISTRY</span><h2 id="modelsHeading">Available models</h2><p>Live data from the configured OpenAI-compatible provider or static registry.</p></div><span class="count-badge" id="modelCountLabel">0 models</span></div>
          <article class="panel model-panel">
            <div class="toolbar"><label class="search-field"><span>⌕</span><input id="modelSearch" type="search" placeholder="Search models or owners" autocomplete="off"></label><button class="button button-secondary" id="reloadModelsButton" type="button">Reload models</button></div>
            <div class="model-list" id="modelList"><div class="empty-state"><strong>Connect to load models</strong><small>The local bearer token is stored only in sessionStorage.</small></div></div>
          </article>
        </section>

        <section class="view" data-view="playground" aria-labelledby="playgroundHeading">
          <div class="view-heading"><div><span class="eyebrow">CHAT COMPLETIONS</span><h2 id="playgroundHeading">Chat Playground</h2><p>Run a real request through Tony Router. Prompts are not stored by dashboard telemetry.</p></div><span class="connection-pill is-pending" id="playgroundStatus"><span></span>Ready</span></div>
          <div class="playground-grid">
            <article class="panel composer-panel">
              <label for="modelSelect">Model</label>
              <select id="modelSelect"><option value="">Connect to load models</option></select>
              <div class="field-row"><label for="temperatureInput">Temperature</label><output id="temperatureValue">0.2</output></div>
              <input id="temperatureInput" type="range" min="0" max="2" value="0.2" step="0.1">
              <label for="promptInput">Prompt</label>
              <textarea id="promptInput" rows="12" placeholder="Ask the selected model something...">Explain why a capability-aware router is useful for coding agents in three concise points.</textarea>
              <div class="composer-actions"><small>Ctrl / Cmd + Enter to send</small><button class="button button-primary" id="sendButton" type="button">Send request</button></div>
            </article>
            <article class="panel response-panel">
              <div class="response-head"><div><span class="response-dot" id="responseDot"></span><strong id="responseTitle">Ready</strong></div><button class="button button-secondary" id="copyButton" type="button">Copy</button></div>
              <pre id="responseOutput">Connect to the gateway, choose a model, then send a request.</pre>
              <div class="response-foot"><span id="responseModel">No model</span><span id="responseLatency">—</span></div>
            </article>
          </div>
        </section>

        <section class="view" data-view="traces" aria-labelledby="tracesHeading">
          <div class="view-heading"><div><span class="eyebrow">TELEMETRY</span><h2 id="tracesHeading">Request Traces</h2><p>Bounded in-memory metadata only: request ID, method, path, status, and duration.</p></div><span class="count-badge" id="traceCountLabel">0 traces</span></div>
          <article class="panel trace-panel">
            <div class="trace-header"><span>Request</span><span>Path</span><span>Status</span><span>Duration</span><span>Completed</span></div>
            <div class="trace-list" id="traceList"><div class="empty-state"><strong>No traces yet</strong><small>API requests will appear here after authentication.</small></div></div>
          </article>
        </section>

        <section class="view" data-view="connection" aria-labelledby="connectionHeading">
          <div class="view-heading"><div><span class="eyebrow">LOCAL AUTH</span><h2 id="connectionHeading">Gateway Connection</h2><p>The UI shell is public on loopback. Protected APIs require your local bearer token.</p></div></div>
          <div class="connection-grid">
            <article class="panel connection-panel">
              <div class="panel-head"><div><span class="eyebrow">BEARER TOKEN</span><h3>Connect this browser tab</h3></div><span class="health-badge is-muted" id="connectionBadge">Disconnected</span></div>
              <label for="tokenInput">Local gateway token</label>
              <div class="input-row"><input id="tokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="Paste ~/.tony-router/token"><button class="button button-primary" id="connectButton" type="button">Connect</button></div>
              <p class="field-help">Stored only in sessionStorage for this tab. Never embedded in HTML, runtime metadata, or logs.</p>
            </article>
            <article class="panel security-panel">
              <span class="security-icon">⌾</span>
              <div><span class="eyebrow">SECURITY BOUNDARY</span><h3 id="connectionTitle">Protected APIs locked</h3><p id="connectionSubtitle">Enter the generated local token to unlock models, runtime telemetry, and chat.</p></div>
              <ul><li>Loopback-first gateway binding</li><li>Strict Content Security Policy</li><li>No prompt or token telemetry</li></ul>
            </article>
          </div>
        </section>
      </main>

      <footer class="footer"><span><span class="tiny-dot is-online"></span>Local gateway <strong id="footerAddress">127.0.0.1</strong></span><span>Tony Router <strong id="footerVersion">—</strong></span></footer>
    </div>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>`;
