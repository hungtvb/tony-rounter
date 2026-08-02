export const UI_JS_PART_3 = String.raw`      ? telemetry.inFlightRequests + ' currently in flight'
      : 'Runtime telemetry';
    elements.successMetric.textContent = telemetry && telemetry.successRate !== null
      ? telemetry.successRate.toFixed(1) + '%'
      : '—';
    renderProvider();
    renderConnection();
    updateUptime();
  }

  function updateUptime() {
    const telemetry = state.dashboard && state.dashboard.telemetry;
    if (!telemetry) {
      elements.sidebarUptime.textContent = '—';
      return;
    }
    const startedAt = new Date(telemetry.startedAt).getTime();
    elements.sidebarUptime.textContent = formatDuration(Date.now() - startedAt);
  }

  function emptyState(title, detail) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = detail;
    empty.append(strong, small);
    return empty;
  }

  function renderModels() {
    const query = elements.modelSearch.value.trim().toLowerCase();
    const filtered = state.models.filter((model) => {
      return !query || model.id.toLowerCase().includes(query) || String(model.owned_by || '').toLowerCase().includes(query);
    });

    elements.modelCountLabel.textContent = filtered.length + (filtered.length === 1 ? ' model' : ' models');
    elements.modelList.replaceChildren();
    if (!filtered.length) {
      elements.modelList.append(emptyState(
        state.models.length ? 'No matching models' : state.token ? 'No models available' : 'Connect to load models',
        state.models.length ? 'Try another search term.' : 'Check the active provider or local authentication.'
      ));
      return;
    }

    filtered.forEach((model) => {
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
      small.textContent = 'OpenAI-compatible model';
      copy.append(strong, small);
      name.append(avatar, copy);
      const owner = document.createElement('span');
      owner.className = 'model-owner';
      owner.textContent = model.owned_by || 'unknown';
      const status = document.createElement('span');
      status.className = 'model-state';
      status.textContent = 'AVAILABLE';
      row.append(name, owner, status);
      elements.modelList.append(row);
    });
  }

  function renderModelSelect() {
    const selected = elements.modelSelect.value;
    elements.modelSelect.replaceChildren();
    if (!state.models.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = state.token ? 'No models available' : 'Connect to load models';
      elements.modelSelect.append(option);
      return;
    }
    state.models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.id;
      elements.modelSelect.append(option);
    });
    if (state.models.some((model) => model.id === selected)) elements.modelSelect.value = selected;
  }

  function createRequestRow(record) {
    const row = document.createElement('div');
    row.className = 'request-row';
    const method = document.createElement('span');
    method.className = 'method-badge' + (record.method === 'GET' ? ' is-get' : '');
    method.textContent = record.method;
    const path = document.createElement('div');
    path.className = 'request-path';
    const strong = document.createElement('strong');
    strong.textContent = record.path;
    const small = document.createElement('small');
    small.textContent = shortText(record.requestId, 18);
    path.append(strong, small);
    const result = document.createElement('div');
    result.className = 'request-result';
    const status = document.createElement('strong');
    status.className = record.statusCode >= 400 ? 'is-error' : '';
    status.textContent = String(record.statusCode);
    const duration = document.createElement('small');
    duration.textContent = record.durationMs + ' ms · ' + relativeTime(record.completedAt);
    result.append(status, duration);
    row.append(method, path, result);
    return row;
  }

  function renderRequests() {
    const records = state.dashboard && state.dashboard.telemetry
      ? state.dashboard.telemetry.recentRequests
      : [];
    elements.recentRequestList.replaceChildren();
    elements.traceList.replaceChildren();
    elements.traceCountLabel.textContent = records.length + (records.length === 1 ? ' trace' : ' traces');

    if (!records.length) {
`;
