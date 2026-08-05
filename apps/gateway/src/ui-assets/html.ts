export const UI_HTML = String.raw`<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="theme-color" content="#10100f">
  <title>Tony Router</title>
  <link rel="stylesheet" href="/ui/styles.css">
  <script src="/ui/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#mainContent">Skip to main content</a>
  <svg class="icon-sprite" width="0" height="0" aria-hidden="true" focusable="false">
    <symbol id="i-overview" viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></symbol>
    <symbol id="i-provider" viewBox="0 0 24 24"><path d="M6 3v4m12-4v4M5 8h14a2 2 0 0 1 2 2v9H3v-9a2 2 0 0 1 2-2Zm2 4h4m2 0h4M7 16h3m4 0h3"/></symbol>
    <symbol id="i-model" viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5-8-4.5"/></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></symbol>
    <symbol id="i-trace" viewBox="0 0 24 24"><path d="M4 18V6m0 12h16M7 14l4-4 3 3 5-6"/></symbol>
    <symbol id="i-connection" viewBox="0 0 24 24"><path d="M7 12h10M9 8l-4 4 4 4m6-8 4 4-4 4"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5m9.5-3A7 7 0 0 0 6 7m-.5 8A7 7 0 0 0 18 17"/></symbol>
    <symbol id="i-theme" viewBox="0 0 24 24"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><path d="m21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol>
    <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Zm0 6v5m0 3h.01"/></symbol>
    <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Zm-3 9 2 2 4-5"/></symbol>
  </svg>

  <div class="app-shell">
    <aside class="sidebar" aria-label="Tony Router workspace">
      <a class="brand" href="#overview" data-view-target="overview" aria-label="Tony Router overview">
        <span class="brand-mark">T</span>
        <span class="brand-copy"><strong>Tony Router</strong><small>Local control plane</small></span>
      </a>

      <p class="nav-label">Workspace</p>
      <nav class="nav" aria-label="Primary navigation">
        <button class="nav-item is-active" data-view-target="overview" type="button"><svg class="nav-icon"><use href="#i-overview"/></svg><span>Overview</span></button>
        <button class="nav-item" data-view-target="providers" type="button"><svg class="nav-icon"><use href="#i-provider"/></svg><span>Providers</span></button>
        <button class="nav-item" data-view-target="models" type="button"><svg class="nav-icon"><use href="#i-model"/></svg><span>Models</span></button>
        <button class="nav-item" data-view-target="playground" type="button"><svg class="nav-icon"><use href="#i-play"/></svg><span>Playground</span></button>
        <button class="nav-item" data-view-target="traces" type="button"><svg class="nav-icon"><use href="#i-trace"/></svg><span>Traces</span></button>
        <button class="nav-item" data-view-target="connection" type="button"><svg class="nav-icon"><use href="#i-connection"/></svg><span>Connection</span></button>
      </nav>

      <div class="sidebar-footer">
        <div class="runtime-mini">
          <div class="runtime-heading"><span>Gateway</span><span class="status-dot is-pending" id="sidebarStatusDot"></span></div>
          <dl>
            <div><dt>Version</dt><dd id="sidebarVersion">—</dd></div>
            <div><dt>Uptime</dt><dd id="sidebarUptime">—</dd></div>
          </dl>
        </div>
        <button class="button button-secondary button-full" id="healthButton" type="button" aria-label="Open gateway health endpoint"><svg><use href="#i-shield"/></svg><span>Open /health</span></button>
        <button class="button button-quiet button-full" id="disconnectButton" type="button" aria-label="Disconnect local token"><svg><use href="#i-connection"/></svg><span>Disconnect</span></button>
      </div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="crumbs"><span>Tony Router</span><span aria-hidden="true">/</span><strong id="pageTitle">Overview</strong><span class="sr-only" id="pageSubtitle">Routing status and bounded local telemetry</span></div>
        <div class="topbar-actions">
          <button class="button button-secondary topbar-connection" data-view-target="connection" type="button" aria-label="Open connection settings"><span aria-hidden="true">Connection</span></button>
          <button class="icon-button" id="themeButton" type="button" aria-label="Switch color theme" title="Switch color theme"><svg><use href="#i-theme"/></svg></button>
          <button class="icon-button" id="refreshButton" type="button" aria-label="Refresh runtime data" title="Refresh"><svg><use href="#i-refresh"/></svg></button>
          <span class="connection-pill is-pending" id="globalStatus"><span></span><span class="connection-label">Checking</span></span>
        </div>
      </header>

      <main class="content" id="mainContent" tabindex="-1">
        <section class="view is-active" data-view="overview" aria-labelledby="overviewHeading">
          <div class="page-heading">
            <div><h1 id="overviewHeading">Routing at a glance</h1><p>See which public profile, route, provider account, and capabilities can handle requests—without exposing tokens, prompts, or upstream response bodies.</p></div>
            <div class="page-actions"><button class="button button-secondary" data-view-target="providers" type="button">Manage providers</button><button class="button button-brand" data-view-target="playground" type="button">Test route</button></div>
          </div>

          <div class="runtime-strip" aria-label="Runtime status">
            <div class="runtime-stat"><span>Gateway</span><strong class="inline-status"><span class="status-dot is-pending" id="gatewayStatusDot" aria-hidden="true"></span><span id="gatewayMetric">Checking</span></strong><small id="gatewayDetail">Connecting to /health</small></div>
            <div class="runtime-stat"><span>Providers</span><strong id="providerMetric">Locked</strong><small id="providerDetail">Connect with your local token</small></div>
            <div class="runtime-stat"><span>Public profiles</span><strong id="modelMetric">0</strong><small>OpenAI-compatible IDs</small></div>
            <div class="runtime-stat"><span>Requests</span><strong id="requestMetric">—</strong><small id="requestDetail">Runtime telemetry</small></div>
            <div class="runtime-stat"><span>Success rate</span><strong id="successMetric">—</strong><small>HTTP 2xx–3xx</small></div>
          </div>

          <div class="overview-grid">
            <div>
              <section class="section-block" aria-labelledby="routingPlanHeading">
                <div class="section-heading"><div><h2 id="routingPlanHeading">Active routing plan</h2><p>Profile → route → model → provider account</p></div><button class="text-button" data-view-target="models" type="button">Model registry</button></div>
                <div class="routing-list" id="routingPlanList"><div class="empty-state"><strong>Connect to inspect routing</strong><small>Protected routing metadata appears after local bearer authentication.</small></div></div>
              </section>

              <section class="section-block" aria-labelledby="recentHeading">
                <div class="section-heading"><div><h2 id="recentHeading">Recent requests</h2><p>Bounded secret-safe telemetry</p></div><button class="text-button" data-view-target="traces" type="button">View all</button></div>
                <div class="request-list" id="recentRequestList"><div class="empty-state"><strong>No runtime data</strong><small>Authenticate to view bounded in-memory telemetry.</small></div></div>
              </section>
            </div>

            <aside class="section-block attention-panel" aria-labelledby="attentionHeading">
              <div class="section-heading"><div><h2 id="attentionHeading">Needs attention</h2><p>Highest-priority operational states</p></div><span class="count-badge" id="attentionCountLabel">0</span></div>
              <div class="attention-list" id="attentionList"><div class="empty-state"><strong>Waiting for runtime data</strong><small>Connect to evaluate account, route, request, and restart states.</small></div></div>
            </aside>
          </div>

          <div class="legacy-runtime-hooks" aria-hidden="true">
            <span id="providerLogo">AI</span><span id="providerName">Not connected</span><span id="providerBaseUrl">Protected runtime data is locked</span><span id="providerHealth">Locked</span><span id="providerMode">—</span><span id="providerCredential">—</span><span id="providerModels">0</span><span id="providerFootDot"></span><span id="providerFoot">Connect to inspect provider status</span><span id="quickModelBadge">No model</span>
          </div>
        </section>

        <section class="view" data-view="providers" aria-labelledby="providersHeading">
          <div class="page-heading">
            <div><h1 id="providersHeading">Providers and accounts</h1><p>Compare adapter, account, endpoint, credential, health, and route coverage. Raw keys and provider payloads never appear here.</p></div>
            <div class="page-actions"><span class="health-badge is-muted" id="providerModeBadge">Locked</span><span class="count-badge" id="providerCountLabel">0 providers</span></div>
          </div>

          <div class="runtime-strip provider-summary" aria-label="Routing inventory summary">
            <div class="runtime-stat"><span>Providers</span><strong id="providerPageProviderCount">0</strong><small>Adapter definitions</small></div>
            <div class="runtime-stat"><span>Accounts</span><strong id="providerPageAccountCount">0</strong><small>Independent identities</small></div>
            <div class="runtime-stat"><span>Profiles</span><strong id="providerPageProfileCount">0</strong><small>Public model IDs</small></div>
            <div class="runtime-stat"><span>Credentials</span><strong id="providerPageCredentialCount">0</strong><small>Configured/missing only</small></div>
          </div>

          <section class="section-block" aria-labelledby="providerInventoryHeading">
            <div class="entity-toolbar"><div><h2 id="providerInventoryHeading">Provider-account inventory</h2><p class="section-description">Each row preserves provider and account identity boundaries.</p></div><span class="health-badge is-muted" id="providerInventoryStatus">Locked</span></div>
            <div class="table-shell"><div class="table-scroll"><table class="provider-table"><caption class="sr-only">Provider account inventory</caption><thead><tr><th scope="col">Provider / account</th><th scope="col">Endpoint</th><th scope="col">Credential</th><th scope="col">Coverage</th><th scope="col">Health</th><th scope="col" class="table-actions">Actions</th></tr></thead><tbody id="providerInventory"><tr><td colspan="6"><div class="empty-state"><strong>Connect to inspect providers</strong><small>Protected routing metadata appears after local bearer authentication.</small></div></td></tr></tbody></table></div></div>
            <div class="profile-coverage-block"><div class="profile-coverage-heading"><span>Public profiles</span><small>Route and account coverage</small></div><div class="profile-coverage-list" id="profileInventory"><span class="profile-chip is-muted">Locked</span></div></div>
          </section>

          <div class="providers-layout">
            <section class="section-block setup-panel" aria-labelledby="setupHeading">
              <div class="section-heading"><div><h2 id="setupHeading">Environment-only setup</h2><p>No provider secret is collected or stored in the browser.</p></div><span class="health-badge">No secrets stored</span></div>
              <div class="setup-body">
                <p class="setup-intro">Generate complete version 2 starter files. Provider bindings keep only the environment-variable name; export the real key in your shell before restart.</p>
                <div class="setup-field-grid">
                  <label for="setupProviderId"><span>Provider ID</span><input id="setupProviderId" value="openai" autocomplete="off" spellcheck="false"></label>
                  <label for="setupAccountId"><span>Account ID</span><input id="setupAccountId" value="personal" autocomplete="off" spellcheck="false"></label>
                  <label class="setup-field-wide" for="setupBaseUrl"><span>OpenAI-compatible base URL</span><input id="setupBaseUrl" type="url" value="https://api.openai.com/v1" autocomplete="url" spellcheck="false"></label>
                  <label for="setupApiKeyEnv"><span>API key environment variable</span><input id="setupApiKeyEnv" value="OPENAI_PERSONAL_KEY" autocomplete="off" spellcheck="false"></label>
                  <label for="setupTimeoutMs"><span>Timeout (milliseconds)</span><input id="setupTimeoutMs" type="number" min="10" max="600000" step="1000" value="60000"></label>
                  <label for="setupUpstreamModel"><span>Upstream model</span><input id="setupUpstreamModel" value="gpt-5" autocomplete="off" spellcheck="false"></label>
                  <label for="setupProfileId"><span>Public profile / model ID</span><input id="setupProfileId" value="tony-auto" autocomplete="off" spellcheck="false"></label>
                </div>
                <div class="setup-primary-actions"><button class="button button-brand setup-generate-button" id="generateSetupButton" type="button">Generate starter files</button><button class="button button-secondary" id="validateSetupButton" type="button">Validate locally</button><button class="button button-primary" id="applySetupButton" type="button">Apply and back up</button></div>
                <p class="setup-validation" id="setupValidation" role="status" aria-live="polite">Ready to generate configuration.</p>
                <div class="config-output-stack">
                  <section class="config-output-card" aria-labelledby="routingOutputHeading"><div><strong id="routingOutputHeading">router.yaml</strong><button class="text-button" id="copyRoutingConfigButton" type="button">Copy</button></div><pre id="routingConfigOutput" tabindex="0">Generate a starter configuration.</pre></section>
                  <section class="config-output-card" aria-labelledby="bindingOutputHeading"><div><strong id="bindingOutputHeading">providers.json</strong><button class="text-button" id="copyProviderBindingButton" type="button">Copy</button></div><pre id="providerBindingOutput" tabindex="0">Generate a starter configuration.</pre></section>
                </div>
                <div class="security-note"><strong>Next step</strong><p id="setupNextStepText">Save both files, export the named API key variable, set the two <code>TONY_ROUTER_*_CONFIG_FILE</code> paths, then restart the gateway.</p></div>
              </div>
            </section>

            <aside class="section-block control-history" aria-labelledby="controlHistoryHeading">
              <div class="section-heading"><div><h2 id="controlHistoryHeading">Applied generations</h2><p id="controlStateText">Set <code>TONY_ROUTER_CONTROL_DIR</code> on loopback to enable atomic apply and rollback.</p></div><span class="health-badge is-muted" id="controlModeBadge">Disabled</span></div>
              <div class="generation-list" id="generationList"><div class="empty-state"><strong>Local control disabled</strong><small>Generated files can still be copied and applied manually.</small></div></div>
            </aside>
          </div>
        </section>

        <section class="view" data-view="models" aria-labelledby="modelsHeading">
          <div class="page-heading"><div><h1 id="modelsHeading">Model registry</h1><p>Keep public profile IDs, route IDs, provider IDs, account IDs, and upstream model IDs explicit.</p></div><span class="count-badge" id="modelCountLabel">0 models</span></div>
          <div class="entity-toolbar"><label class="search-field"><svg><use href="#i-search"/></svg><span class="sr-only">Search models</span><input id="modelSearch" type="search" placeholder="Search IDs, owners, or capabilities" autocomplete="off"></label><button class="button button-secondary" id="reloadModelsButton" type="button">Reload models</button></div>
          <div class="table-shell"><div class="table-scroll"><table class="model-table"><caption class="sr-only">Public model and routing capability registry</caption><thead><tr><th scope="col">Public model / profile</th><th scope="col">Upstream model</th><th scope="col">Provider</th><th scope="col">Capabilities</th><th scope="col">Context</th><th scope="col">State</th></tr></thead><tbody id="modelList"><tr><td colspan="6"><div class="empty-state"><strong>Connect to load models</strong><small>The local bearer token is stored only in sessionStorage.</small></div></td></tr></tbody></table></div></div>
        </section>

        <section class="view" data-view="playground" aria-labelledby="playgroundHeading">
          <div class="page-heading"><div><h1 id="playgroundHeading">Playground</h1><p>Test the selected public model through the active route. Prompts are not stored in dashboard telemetry.</p></div><span class="connection-pill is-pending" id="playgroundStatus"><span></span><span class="connection-label">Ready</span></span></div>
          <div class="playground-shell">
            <section class="composer" aria-labelledby="requestComposerHeading">
              <div class="section-heading"><div><h2 id="requestComposerHeading">Request</h2><p id="requestModeHint">Responses API text stream</p></div><div class="segmented" aria-label="API mode"><button class="segment is-active" type="button" data-api-mode="responses">Responses</button><button class="segment" type="button" data-api-mode="chat">Chat Completions</button></div></div>
              <div class="form-stack">
                <div class="field"><label for="modelSelect">Public model / profile</label><select id="modelSelect"><option value="">Connect to load models</option></select></div>
                <div class="field"><div class="field-row"><label for="temperatureInput">Temperature</label><output id="temperatureValue">0.2</output></div><input id="temperatureInput" type="range" min="0" max="2" value="0.2" step="0.1"></div>
                <div class="field"><label for="promptInput">Input</label><textarea id="promptInput" rows="10" placeholder="Ask the selected model something...">Explain why a capability-aware router is useful for coding agents in three concise points.</textarea></div>
                <div class="composer-actions"><small>Ctrl / Cmd + Enter to send</small><button class="button button-brand" id="sendButton" type="button">Send request</button></div>
              </div>
            </section>
            <section class="response" aria-labelledby="responseHeading">
              <div class="response-head"><div class="response-title"><span class="response-dot" id="responseDot"></span><strong id="responseTitle">Ready</strong></div><button class="button button-secondary" id="copyButton" type="button">Copy</button></div>
              <pre class="event-stream" id="responseOutput" tabindex="0">Connect to the gateway, choose a model, then send a request.</pre>
              <div class="response-foot"><span id="responseModel">No model</span><span id="responseLatency">—</span></div>
            </section>
          </div>
        </section>

        <section class="view" data-view="traces" aria-labelledby="tracesHeading">
          <div class="page-heading"><div><h1 id="tracesHeading">Request traces</h1><p>Bounded in-memory metadata only. Prompt content, authorization headers, and upstream bodies remain outside telemetry.</p></div><span class="count-badge" id="traceCountLabel">0 traces</span></div>
          <div class="table-shell"><div class="table-scroll"><table class="trace-table"><caption class="sr-only">Recent Tony Router request traces</caption><thead><tr><th scope="col">Request ID</th><th scope="col">Method</th><th scope="col">Endpoint</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Completed</th></tr></thead><tbody id="traceList"><tr><td colspan="6"><div class="empty-state"><strong>No traces yet</strong><small>API requests will appear here after authentication.</small></div></td></tr></tbody></table></div></div>
        </section>

        <section class="view" data-view="connection" aria-labelledby="connectionHeading">
          <div class="page-heading"><div><h1 id="connectionHeading">Connection</h1><p>Authenticate this browser tab against the loopback gateway without rendering the token back into the page.</p></div></div>
          <div class="connection-grid">
            <section class="section-block connection-form" aria-labelledby="connectHeading">
              <div class="section-heading"><div><h2 id="connectHeading">Local bearer token</h2><p>Held only in sessionStorage for the active tab</p></div><span class="health-badge is-muted" id="connectionBadge">Disconnected</span></div>
              <div class="field"><label for="tokenInput">Gateway token</label><div class="input-row"><input id="tokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="Paste ~/.tony-router/token"><button class="button button-brand" id="connectButton" type="button">Connect</button></div><p class="field-help">Never embedded in HTML, runtime metadata, logs, or screenshots.</p></div>
            </section>
            <aside class="section-block" aria-labelledby="connectionTitle">
              <div class="identity-mark"><svg><use href="#i-shield"/></svg></div><h2 id="connectionTitle">Protected APIs locked</h2><p class="boundary-intro" id="connectionSubtitle">Enter the generated local token to unlock models, runtime telemetry, and playground requests.</p>
              <div class="boundary-list">
                <div class="boundary-row"><svg><use href="#i-check"/></svg><div><strong>Loopback first</strong><p>Non-loopback binding requires explicit opt-in.</p></div></div>
                <div class="boundary-row"><svg><use href="#i-check"/></svg><div><strong>Credential redaction</strong><p>Only configured or missing state is shown.</p></div></div>
                <div class="boundary-row"><svg><use href="#i-check"/></svg><div><strong>Bounded telemetry</strong><p>Request content and provider bodies are excluded.</p></div></div>
                <div class="boundary-row"><svg><use href="#i-check"/></svg><div><strong>Restrictive browser policy</strong><p>No remote scripts, styles, frames, or forms.</p></div></div>
              </div>
            </aside>
          </div>
        </section>
      </main>

      <footer class="footer"><span><span class="tiny-dot is-online"></span>Local gateway <strong id="footerAddress">127.0.0.1</strong></span><span>Tony Router <strong id="footerVersion">—</strong></span><span class="font-status" id="fontStatus">Local font check pending</span></footer>
    </div>
  </div>

  <nav class="mobile-nav" aria-label="Mobile navigation">
    <button class="is-active" type="button" data-view-target="overview"><svg><use href="#i-overview"/></svg><span>Overview</span></button>
    <button type="button" data-view-target="providers"><svg><use href="#i-provider"/></svg><span>Providers</span></button>
    <button type="button" data-view-target="models"><svg><use href="#i-model"/></svg><span>Models</span></button>
    <button type="button" data-view-target="playground"><svg><use href="#i-play"/></svg><span>Test</span></button>
    <button type="button" data-view-target="traces"><svg><use href="#i-trace"/></svg><span>Traces</span></button>
  </nav>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>`;
