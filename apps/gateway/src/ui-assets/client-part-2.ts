export const UI_JS_PART_2 = String.raw`    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  function relativeTime(iso) {
    const delta = Math.max(0, Date.now() - new Date(iso).getTime());
    if (delta < 1000) return 'now';
    if (delta < 60_000) return Math.floor(delta / 1000) + 's ago';
    if (delta < 3_600_000) return Math.floor(delta / 60_000) + 'm ago';
    return Math.floor(delta / 3_600_000) + 'h ago';
  }

  function modelInitials(id) {
    const parts = String(id).split(/[-_/.]+/).filter(Boolean).slice(0, 2);
    return parts.map((part) => part.charAt(0)).join('').toUpperCase() || 'AI';
  }

  function providerLabel(runtime) {
    const provider = runtime && runtime.provider;
    if (!provider) return 'Not configured';
    if (provider.mode === 'static-registry') return 'Static model registry';
    if (provider.baseUrl) {
      try { return new URL(provider.baseUrl).hostname; } catch (_) { return 'OpenAI-compatible'; }
    }
    return provider.mode === 'openai-compatible' ? 'OpenAI-compatible' : 'Not configured';
  }

  function renderHealth() {
    if (!state.health) {
      elements.gatewayMetric.textContent = 'Offline';
      elements.gatewayDetail.textContent = 'Health endpoint is unavailable';
      elements.sidebarStatusDot.className = 'status-dot is-error';
      setPill(elements.globalStatus, 'is-error', 'Offline');
      return;
    }

    elements.gatewayMetric.textContent = 'Online';
    elements.gatewayDetail.textContent = 'Version ' + (state.health.version || 'unknown');
    elements.sidebarVersion.textContent = state.health.version || 'unknown';
    elements.footerVersion.textContent = state.health.version || 'unknown';
    elements.sidebarStatusDot.className = 'status-dot is-online';
    setPill(elements.globalStatus, 'is-online', state.token ? 'Connected' : 'Online');
  }

  function renderConnection() {
    const connected = Boolean(state.token && state.dashboard);
    elements.disconnectButton.disabled = !state.token;
    elements.connectionBadge.className = 'health-badge ' + (connected ? '' : 'is-muted');
    elements.connectionBadge.textContent = connected ? 'Connected' : 'Disconnected';
    elements.connectionTitle.textContent = connected ? 'Protected APIs unlocked' : 'Protected APIs locked';
    elements.connectionSubtitle.textContent = connected
      ? 'Runtime metadata, models, and chat are available in this browser tab.'
      : 'Enter the generated local token to unlock models, runtime telemetry, and chat.';
  }

  function renderProvider() {
    const runtime = state.dashboard && state.dashboard.gateway;
    const provider = state.dashboard && state.dashboard.provider;
    const connected = Boolean(state.dashboard);
    const configured = Boolean(provider && provider.mode !== 'unconfigured');
    const label = providerLabel(state.dashboard);

    elements.providerMetric.textContent = connected ? (configured ? '1 / 1' : '0 / 1') : 'Locked';
    elements.providerDetail.textContent = connected
      ? (configured ? 'Provider configured' : 'No upstream configured')
      : 'Connect with your local token';
    elements.providerName.textContent = connected ? label : 'Not connected';
    elements.providerBaseUrl.textContent = connected
      ? (provider.baseUrl || (provider.mode === 'static-registry' ? 'Local static registry' : 'No upstream URL'))
      : 'Protected runtime data is locked';
    elements.providerLogo.textContent = connected ? modelInitials(label) : 'AI';
    elements.providerHealth.className = 'health-badge ' + (!connected ? 'is-muted' : configured ? '' : 'is-error');
    elements.providerHealth.textContent = !connected ? 'Locked' : configured ? 'Ready' : 'Missing';
    elements.providerMode.textContent = connected ? provider.mode : '—';
    elements.providerCredential.textContent = connected
      ? (provider.credentialConfigured ? 'Configured' : 'Not required')
      : '—';
    elements.providerModels.textContent = String(state.models.length);
    elements.providerFootDot.className = 'tiny-dot ' + (connected && configured ? 'is-online' : '');
    elements.providerFoot.textContent = !connected
      ? 'Connect to inspect provider status'
      : configured
        ? 'Provider metadata is available'
        : 'Configure an upstream or static registry';

    if (runtime) {
      elements.footerAddress.textContent = runtime.host + ':' + runtime.port;
    }
  }

  function renderMetrics() {
    const telemetry = state.dashboard && state.dashboard.telemetry;
    elements.modelMetric.textContent = String(state.models.length);
    elements.providerModels.textContent = String(state.models.length);
    elements.quickModelBadge.textContent = state.models[0] ? state.models[0].id : 'No model';
    elements.requestMetric.textContent = telemetry ? String(telemetry.requestsSinceStart) : '—';
    elements.requestDetail.textContent = telemetry
`;
