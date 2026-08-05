export const UI_JS_CONTRACT = String.raw`
  function tableEmpty(container, columns, title, detail) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.append(emptyState(title, detail));
    row.append(cell);
    container.append(row);
  }

  function capabilityNames(capabilities) {
    if (!capabilities) return [];
    const names = [];
    if (capabilities.tools) names.push('tools');
    if (capabilities.parallelToolCalls) names.push('parallel');
    if (capabilities.vision) names.push('vision');
    if (capabilities.fileInput) names.push('file');
    if (capabilities.structuredOutput) names.push('json');
    if (capabilities.reasoning) names.push('reasoning');
    return names;
  }

  function capabilityList(capabilities) {
    const list = document.createElement('div');
    list.className = 'capabilities';
    const names = capabilityNames(capabilities);
    if (!names.length) names.push('text');
    names.forEach((name) => {
      const chip = document.createElement('span');
      chip.className = 'capability';
      chip.textContent = name;
      list.append(chip);
    });
    return list;
  }

  function renderRoutingPlan() {
    elements.routingPlanList.replaceChildren();
    const routing = state.dashboard && state.dashboard.routing;
    if (!routing) {
      elements.routingPlanList.append(emptyState(
        state.dashboard ? 'No routed plan active' : 'Connect to inspect routing',
        state.dashboard ? 'The gateway is using legacy or static-registry mode.' : 'Protected routing metadata appears after local bearer authentication.'
      ));
      return;
    }
    const defaultRoutes = routing.routes.filter((route) => route.profileIds.includes(routing.defaultProfileId));
    const routes = defaultRoutes.length ? defaultRoutes : routing.routes;
    if (!routes.length) {
      elements.routingPlanList.append(emptyState('No routes declared', 'Add at least one enabled route to the active public profile.'));
      return;
    }
    routes.forEach((route, index) => {
      const model = routing.models.find((item) => item.id === route.modelId);
      const row = document.createElement('div');
      row.className = 'route-row';
      const primary = document.createElement('div');
      primary.className = 'route-primary';
      const order = document.createElement('span');
      order.className = 'route-index';
      order.textContent = String(index + 1).padStart(2, '0');
      const profileCopy = document.createElement('div');
      const profile = document.createElement('strong');
      profile.className = 'technical';
      profile.textContent = route.profileIds.includes(routing.defaultProfileId) ? routing.defaultProfileId : (route.profileIds[0] || 'unassigned');
      const routeId = document.createElement('span');
      routeId.className = 'technical';
      routeId.textContent = route.id + ' · priority ' + route.priority;
      profileCopy.append(profile, routeId);
      primary.append(order, profileCopy);

      const modelCopy = document.createElement('div');
      modelCopy.className = 'cell-stack';
      const modelId = document.createElement('strong');
      modelId.className = 'technical';
      modelId.textContent = route.modelId;
      const upstream = document.createElement('span');
      upstream.className = 'technical';
      upstream.textContent = model ? model.upstreamModel : 'upstream unknown';
      modelCopy.append(modelId, upstream);

      const accountCopy = document.createElement('div');
      accountCopy.className = 'cell-stack';
      const providerId = document.createElement('strong');
      providerId.className = 'technical';
      providerId.textContent = route.providerId || 'provider unknown';
      const accountId = document.createElement('span');
      accountId.className = 'technical';
      accountId.textContent = route.accountId;
      accountCopy.append(providerId, accountId);

      const stateCopy = document.createElement('span');
      stateCopy.className = 'route-state';
      const dot = document.createElement('span');
      dot.className = 'status-dot ' + (route.enabled ? 'is-online' : 'is-error');
      const label = document.createElement('span');
      label.textContent = route.enabled ? 'Enabled' : 'Disabled';
      stateCopy.append(dot, label);

      row.append(primary, modelCopy, accountCopy, stateCopy, capabilityList(model && model.capabilities));
      elements.routingPlanList.append(row);
    });
  }

  function attentionRow(mode, title, detail) {
    const row = document.createElement('div');
    row.className = 'attention-row';
    const icon = document.createElement('span');
    icon.className = 'attention-icon ' + mode;
    icon.innerHTML = '<svg><use href="#i-alert"></use></svg>';
    const copy = document.createElement('div');
    copy.className = 'attention-copy';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = detail;
    copy.append(strong, paragraph);
    row.append(icon, copy);
    return row;
  }

  function renderAttention() {
    elements.attentionList.replaceChildren();
    const items = [];
    const dashboard = state.dashboard;
    const routing = dashboard && dashboard.routing;
    if (!dashboard) {
      items.push(['info', 'Protected runtime is locked', 'Connect this browser tab to inspect account, route, and telemetry state.']);
    } else {
      if (routing) {
        const missing = routing.accounts.filter((account) => !account.credentialConfigured);
        if (missing.length) items.push(['danger', missing.length + ' account credential' + (missing.length === 1 ? '' : 's') + ' missing', missing.map((account) => account.id).slice(0, 3).join(', ') + (missing.length > 3 ? '…' : '')]);
        const disabled = routing.routes.filter((route) => !route.enabled);
        if (disabled.length) items.push(['warning', disabled.length + ' route' + (disabled.length === 1 ? '' : 's') + ' disabled', disabled.map((route) => route.id).slice(0, 3).join(', ') + (disabled.length > 3 ? '…' : '')]);
      }
      const telemetry = dashboard.telemetry;
      const failed = telemetry.recentRequests.filter((record) => record.statusCode >= 400);
      if (failed.length) items.push(['warning', failed.length + ' recent failed request' + (failed.length === 1 ? '' : 's'), 'Open Traces to inspect status, endpoint, duration, and request ID.']);
      if (dashboard.control && dashboard.control.restartRequired) items.push(['info', 'Gateway restart required', 'A validated managed configuration generation is active on disk.']);
    }
    elements.attentionCountLabel.textContent = String(items.length);
    if (!items.length) {
      const healthy = document.createElement('div');
      healthy.className = 'attention-row';
      const icon = document.createElement('span');
      icon.className = 'attention-icon info';
      icon.innerHTML = '<svg><use href="#i-check"></use></svg>';
      const copy = document.createElement('div');
      copy.className = 'attention-copy';
      const strong = document.createElement('strong');
      strong.textContent = 'No immediate action';
      const paragraph = document.createElement('p');
      paragraph.textContent = 'Configured accounts, active routes, recent requests, and restart state look ready.';
      copy.append(strong, paragraph);
      healthy.append(icon, copy);
      elements.attentionList.append(healthy);
      return;
    }
    items.forEach((item) => elements.attentionList.append(attentionRow(item[0], item[1], item[2])));
  }

  renderModels = function renderContractModels() {
    const routing = state.dashboard && state.dashboard.routing;
    const query = elements.modelSearch.value.trim().toLowerCase();
    const routedModels = routing ? routing.models : [];
    const rows = routedModels.length
      ? routedModels.map((model) => {
          const routes = routing.routes.filter((route) => route.modelId === model.id);
          const profiles = Array.from(new Set(routes.flatMap((route) => route.profileIds)));
          return { model, routes, profiles };
        })
      : state.models.map((model) => ({ model: { id: model.id, providerId: model.owned_by || 'unknown', upstreamModel: 'not exposed', capabilities: null }, routes: [], profiles: [model.id] }));
    const filtered = rows.filter((entry) => {
      const text = [entry.model.id, entry.model.providerId, entry.model.upstreamModel, entry.profiles.join(' '), capabilityNames(entry.model.capabilities).join(' ')].join(' ').toLowerCase();
      return !query || text.includes(query);
    });
    elements.modelCountLabel.textContent = filtered.length + (filtered.length === 1 ? ' model' : ' models');
    elements.modelList.replaceChildren();
    if (!filtered.length) {
      tableEmpty(elements.modelList, 6, rows.length ? 'No matching models' : state.token ? 'No models available' : 'Connect to load models', rows.length ? 'Try another search term.' : 'Check the active provider or local authentication.');
      return;
    }
    filtered.forEach((entry) => {
      const row = document.createElement('tr');
      const publicCell = document.createElement('td');
      const identity = document.createElement('div');
      identity.className = 'model-name';
      const avatar = document.createElement('span');
      avatar.className = 'model-avatar';
      avatar.textContent = modelInitials(entry.profiles[0] || entry.model.id);
      const copy = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = entry.profiles.length ? entry.profiles.join(', ') : 'No public profile';
      const small = document.createElement('small');
      small.textContent = 'routing model: ' + entry.model.id;
      copy.append(strong, small);
      identity.append(avatar, copy);
      publicCell.append(identity);
      const upstreamCell = document.createElement('td');
      upstreamCell.className = 'technical';
      upstreamCell.textContent = entry.model.upstreamModel;
      const providerCell = document.createElement('td');
      providerCell.className = 'technical';
      providerCell.textContent = entry.model.providerId;
      const capabilitiesCell = document.createElement('td');
      capabilitiesCell.append(capabilityList(entry.model.capabilities));
      const contextCell = document.createElement('td');
      contextCell.className = 'technical';
      contextCell.textContent = entry.model.capabilities ? entry.model.capabilities.contextTokens.toLocaleString() : '—';
      const stateCell = document.createElement('td');
      const enabled = entry.routes.length ? entry.routes.some((route) => route.enabled) : true;
      stateCell.className = 'model-state';
      stateCell.textContent = enabled ? 'AVAILABLE' : 'DISABLED';
      if (!enabled) stateCell.classList.add('is-error');
      row.append(publicCell, upstreamCell, providerCell, capabilitiesCell, contextCell, stateCell);
      elements.modelList.append(row);
    });
  };

  renderRequests = function renderContractRequests() {
    const records = state.dashboard && state.dashboard.telemetry ? state.dashboard.telemetry.recentRequests : [];
    elements.recentRequestList.replaceChildren();
    elements.traceList.replaceChildren();
    elements.traceCountLabel.textContent = records.length + (records.length === 1 ? ' trace' : ' traces');
    if (!records.length) {
      elements.recentRequestList.append(emptyState('No requests yet', 'Protected API traffic will appear here.'));
      tableEmpty(elements.traceList, 6, 'No traces yet', 'Request metadata is bounded and held only in memory.');
      return;
    }
    records.slice(0, 5).forEach((record) => elements.recentRequestList.append(createRequestRow(record)));
    records.forEach((record) => {
      const row = document.createElement('tr');
      const request = document.createElement('td');
      request.className = 'trace-request';
      request.textContent = shortText(record.requestId, 24);
      const method = document.createElement('td');
      const methodBadge = document.createElement('span');
      methodBadge.className = 'method-badge' + (record.method === 'GET' ? ' is-get' : '');
      methodBadge.textContent = record.method;
      method.append(methodBadge);
      const path = document.createElement('td');
      path.className = 'trace-path';
      path.textContent = record.path;
      const status = document.createElement('td');
      status.className = 'trace-status' + (record.statusCode >= 400 ? ' is-error' : '');
      status.textContent = String(record.statusCode);
      const duration = document.createElement('td');
      duration.className = 'trace-duration';
      duration.textContent = record.durationMs + ' ms';
      const completed = document.createElement('td');
      completed.className = 'trace-time';
      completed.textContent = relativeTime(record.completedAt);
      row.append(request, method, path, status, duration, completed);
      elements.traceList.append(row);
    });
  };

  function providerTableRow(provider, account) {
    const row = document.createElement('tr');
    const identityCell = document.createElement('td');
    const identity = document.createElement('div');
    identity.className = 'provider-account-identity';
    const avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.textContent = modelInitials(account ? account.id : provider.id);
    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = provider.id + ' / ' + (account ? account.id : 'no-account');
    const small = document.createElement('small');
    small.textContent = provider.kind || 'openai-compatible';
    copy.append(strong, small);
    identity.append(avatar, copy);
    identityCell.append(identity);
    const endpoint = document.createElement('td');
    endpoint.className = 'technical';
    endpoint.textContent = safeHostname(account ? account.baseUrl : provider.baseUrl);
    const credential = document.createElement('td');
    const credentialBadge = document.createElement('span');
    credentialBadge.className = 'health-badge ' + (account && account.credentialConfigured ? '' : 'is-muted');
    credentialBadge.textContent = account && account.credentialConfigured ? 'Configured' : 'Missing';
    credential.append(credentialBadge);
    const coverage = document.createElement('td');
    coverage.className = 'provider-account-facts';
    const modelFact = document.createElement('span');
    modelFact.textContent = (account ? account.modelCount : provider.modelCount) + ' models';
    const routeFact = document.createElement('span');
    routeFact.textContent = (account ? account.routeCount : provider.routeCount) + ' routes';
    coverage.append(modelFact, routeFact);
    const health = document.createElement('td');
    const probe = account && state.accountHealth[account.id];
    const healthBadge = document.createElement('span');
    healthBadge.className = 'health-badge ' + (!account || !probe ? 'is-muted' : probe.status === 'healthy' ? '' : 'is-error');
    healthBadge.textContent = !account ? 'Unavailable' : probe ? probe.status.replace(/_/g, ' ') + ' · ' + probe.latencyMs + ' ms' : 'Not tested';
    health.append(healthBadge);
    const actions = document.createElement('td');
    actions.className = 'provider-account-actions table-actions';
    const useButton = document.createElement('button');
    useButton.className = 'button button-secondary provider-use-button';
    useButton.type = 'button';
    useButton.dataset.setupProvider = provider.id;
    useButton.dataset.setupBaseUrl = provider.baseUrl || (account && account.baseUrl) || '';
    useButton.textContent = 'Use in setup';
    actions.append(useButton);
    if (account) {
      const healthButton = document.createElement('button');
      healthButton.className = 'button button-secondary account-health-button';
      healthButton.type = 'button';
      healthButton.dataset.healthAccount = account.id;
      healthButton.disabled = Boolean(state.healthRunning[account.id]) || !state.dashboard || state.dashboard.provider.mode !== 'routed';
      healthButton.textContent = state.healthRunning[account.id] ? 'Testing…' : 'Test health';
      if (probe) healthButton.dataset.healthStatus = probe.status;
      actions.append(healthButton);
    }
    row.append(identityCell, endpoint, credential, coverage, health, actions);
    return row;
  }

  renderProviders = function renderContractProviders() {
    const dashboard = state.dashboard;
    const routing = dashboard && dashboard.routing;
    const provider = dashboard && dashboard.provider;
    elements.providerInventory.replaceChildren();
    elements.profileInventory.replaceChildren();
    renderControlState();
    if (!dashboard) {
      elements.providerPageProviderCount.textContent = '0';
      elements.providerPageAccountCount.textContent = '0';
      elements.providerPageProfileCount.textContent = '0';
      elements.providerPageCredentialCount.textContent = '0';
      elements.providerModeBadge.className = 'health-badge is-muted';
      elements.providerModeBadge.textContent = 'Locked';
      elements.providerInventoryStatus.className = 'health-badge is-muted';
      elements.providerInventoryStatus.textContent = 'Locked';
      elements.providerCountLabel.textContent = '0 providers';
      const lockedProfile = document.createElement('span');
      lockedProfile.className = 'profile-chip is-muted';
      lockedProfile.textContent = 'Locked';
      elements.profileInventory.append(lockedProfile);
      tableEmpty(elements.providerInventory, 6, 'Connect to inspect providers', 'Protected routing metadata appears after local bearer authentication.');
      return;
    }
    if (routing) {
      const credentialCount = routing.accounts.filter((account) => account.credentialConfigured).length;
      elements.providerPageProviderCount.textContent = String(routing.providers.length);
      elements.providerPageAccountCount.textContent = String(routing.accounts.length);
      elements.providerPageProfileCount.textContent = String(routing.profiles.length);
      elements.providerPageCredentialCount.textContent = String(credentialCount);
      elements.providerModeBadge.className = 'health-badge';
      elements.providerModeBadge.textContent = 'Routing v' + routing.version;
      elements.providerInventoryStatus.className = 'health-badge';
      elements.providerInventoryStatus.textContent = 'Loaded';
      elements.providerCountLabel.textContent = routing.providers.length + (routing.providers.length === 1 ? ' provider' : ' providers');
      routing.profiles.forEach((profile) => {
        const chip = document.createElement('span');
        chip.className = 'profile-chip' + (profile.id === routing.defaultProfileId ? ' is-default' : '');
        const name = document.createElement('strong');
        name.textContent = profile.id;
        const detail = document.createElement('small');
        detail.textContent = profile.routeCount + ' routes · ' + profile.accountCount + ' accounts';
        chip.append(name, detail);
        elements.profileInventory.append(chip);
      });
      if (!routing.providers.length) {
        tableEmpty(elements.providerInventory, 6, 'No providers declared', 'The active routing registry does not expose a provider adapter.');
        return;
      }
      routing.providers.forEach((item) => {
        const accounts = routing.accounts.filter((account) => account.providerId === item.id);
        if (!accounts.length) elements.providerInventory.append(providerTableRow(item, null));
        else accounts.forEach((account) => elements.providerInventory.append(providerTableRow(item, account)));
      });
      return;
    }
    const configured = provider && provider.mode === 'openai-compatible';
    elements.providerPageProviderCount.textContent = configured ? '1' : '0';
    elements.providerPageAccountCount.textContent = configured ? '1' : '0';
    elements.providerPageProfileCount.textContent = '0';
    elements.providerPageCredentialCount.textContent = configured && provider.credentialConfigured ? '1' : '0';
    elements.providerModeBadge.className = 'health-badge ' + (configured ? '' : 'is-muted');
    elements.providerModeBadge.textContent = provider ? provider.mode : 'unconfigured';
    elements.providerInventoryStatus.className = 'health-badge ' + (configured ? '' : 'is-muted');
    elements.providerInventoryStatus.textContent = configured ? 'Legacy mode' : 'No routed config';
    elements.providerCountLabel.textContent = configured ? '1 provider' : '0 providers';
    const profileState = document.createElement('span');
    profileState.className = 'profile-chip is-muted';
    profileState.textContent = configured ? 'Legacy mode has no public routing profiles' : 'No profiles configured';
    elements.profileInventory.append(profileState);
    if (configured) {
      const item = { id: 'legacy-upstream', kind: 'openai-compatible', baseUrl: provider.baseUrl || '', timeoutMs: 0, modelCount: state.models.length, routeCount: 0 };
      const account = { id: 'legacy-upstream', baseUrl: provider.baseUrl || '', credentialConfigured: Boolean(provider.credentialConfigured), modelCount: state.models.length, routeCount: 0 };
      elements.providerInventory.append(providerTableRow(item, account));
    } else {
      tableEmpty(elements.providerInventory, 6, provider && provider.mode === 'static-registry' ? 'Static model registry active' : 'No provider configured', 'Use the environment-only setup assistant to add an OpenAI-compatible routed account.');
    }
  };

  function extractResponsesText(payload) {
    if (!payload) return '';
    if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') return payload.delta;
    if (payload.type === 'response.refusal.delta' && typeof payload.delta === 'string') return payload.delta;
    if (typeof payload.output_text === 'string') return payload.output_text;
    if (!Array.isArray(payload.output)) return '';
    return payload.output.flatMap((item) => Array.isArray(item.content) ? item.content : []).map((content) => typeof content.text === 'string' ? content.text : typeof content.refusal === 'string' ? content.refusal : '').join('');
  }

  async function readPlaygroundEventStream(response, onText) {
    if (!response.body) throw new Error('Streaming body is unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    function processEvent(event) {
      event.split(/\r?\n/).forEach((line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let payload;
        try { payload = JSON.parse(data); } catch (_) { return; }
        if (payload.error) throw new Error(payload.error.message || 'Streaming request failed');
        const text = state.apiMode === 'responses' ? extractResponsesText(payload) : extractText(payload);
        if (text) onText(text);
      });
    }
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      events.forEach(processEvent);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processEvent(buffer);
  }

  function setApiMode(mode) {
    if (mode !== 'responses' && mode !== 'chat') return;
    state.apiMode = mode;
    document.querySelectorAll('[data-api-mode]').forEach((button) => {
      const active = button.dataset.apiMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    elements.requestModeHint.textContent = mode === 'responses' ? 'Responses API text stream' : 'Chat Completions text stream';
  }

  async function runPlayground() {
    if (state.running) return;
    if (!state.token) {
      toast('Connect to the gateway first');
      setView('connection');
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
    elements.responseModel.textContent = model + ' · ' + (state.apiMode === 'responses' ? '/v1/responses' : '/v1/chat/completions');
    elements.responseLatency.textContent = 'running';
    setResponseState('is-running', 'Streaming');
    const started = performance.now();
    try {
      const responsesMode = state.apiMode === 'responses';
      const response = await fetch(responsesMode ? '/v1/responses' : '/v1/chat/completions', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(responsesMode
          ? { model, input: prompt, stream: true, temperature: Number(elements.temperatureInput.value) }
          : { model, stream: true, temperature: Number(elements.temperatureInput.value), messages: [{ role: 'user', content: prompt }] })
      });
      if (!response.ok) throw new Error(await responseError(response));
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        await readPlaygroundEventStream(response, (text) => {
          elements.responseOutput.textContent += text;
          elements.responseOutput.scrollTop = elements.responseOutput.scrollHeight;
        });
      } else {
        const payload = await response.json();
        elements.responseOutput.textContent = (responsesMode ? extractResponsesText(payload) : extractText(payload)) || JSON.stringify(payload, null, 2);
      }
      const latency = Math.round(performance.now() - started);
      elements.responseLatency.textContent = latency + ' ms';
      setResponseState('is-success', 'Completed');
      setTimeout(() => loadDashboard().catch(() => undefined), 80);
    } catch (error) {
      const latency = Math.round(performance.now() - started);
      elements.responseOutput.textContent = 'Error: ' + shortText(messageOf(error), 400);
      elements.responseLatency.textContent = latency + ' ms';
      setResponseState('is-error', 'Failed');
      setTimeout(() => loadDashboard().catch(() => undefined), 80);
    } finally {
      state.running = false;
      elements.sendButton.disabled = false;
    }
  }

  function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', state.theme === 'dark' ? '#10100f' : '#f7f7f5');
    elements.themeButton.setAttribute('aria-label', state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    sessionStorage.setItem('tony-router-theme', state.theme);
  }

  async function reportFonts() {
    if (!document.fonts) {
      elements.fontStatus.textContent = 'System font fallback';
      return;
    }
    await document.fonts.ready;
    const inter = document.fonts.check('14px Inter');
    const mono = document.fonts.check('12px "JetBrains Mono"');
    document.documentElement.dataset.fontSans = inter ? 'inter' : 'system-fallback';
    document.documentElement.dataset.fontMono = mono ? 'jetbrains-mono' : 'system-fallback';
    elements.fontStatus.textContent = inter && mono ? 'Inter + JetBrains Mono' : 'Documented local/system font fallback';
  }

  document.querySelectorAll('[data-api-mode]').forEach((button) => button.addEventListener('click', () => setApiMode(button.dataset.apiMode)));
  elements.themeButton.addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  applyTheme(sessionStorage.getItem('tony-router-theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  setApiMode('responses');
  reportFonts().catch(() => { elements.fontStatus.textContent = 'Documented local/system font fallback'; });
`;
