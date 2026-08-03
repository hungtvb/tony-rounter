export const UI_JS_PART_4 = String.raw`      elements.recentRequestList.append(emptyState('No requests yet', 'Protected API traffic will appear here.'));
      elements.traceList.append(emptyState('No traces yet', 'Request metadata is bounded and held only in memory.'));
      return;
    }

    records.slice(0, 5).forEach((record) => elements.recentRequestList.append(createRequestRow(record)));
    records.forEach((record) => {
      const row = document.createElement('div');
      row.className = 'trace-row';
      const request = document.createElement('span');
      request.className = 'trace-request';
      request.textContent = shortText(record.requestId, 20);
      const path = document.createElement('span');
      path.className = 'trace-path';
      path.textContent = record.method + ' ' + record.path;
      const status = document.createElement('span');
      status.className = 'trace-status' + (record.statusCode >= 400 ? ' is-error' : '');
      status.textContent = String(record.statusCode);
      const duration = document.createElement('span');
      duration.className = 'trace-duration';
      duration.textContent = record.durationMs + ' ms';
      const completed = document.createElement('span');
      completed.className = 'trace-time';
      completed.textContent = relativeTime(record.completedAt);
      row.append(request, path, status, duration, completed);
      elements.traceList.append(row);
    });
  }

  async function loadHealth() {
    try {
      const response = await fetch('/health', { cache: 'no-store' });
      if (!response.ok) throw new Error('Health returned HTTP ' + response.status);
      state.health = await response.json();
      renderHealth();
      return true;
    } catch (error) {
      state.health = null;
      renderHealth();
      toast(messageOf(error));
      return false;
    }
  }

  async function loadDashboard() {
    if (!state.token) {
      state.dashboard = null;
      state.generations = [];
      renderMetrics();
      renderRequests();
      return false;
    }
    try {
      const response = await fetch('/ui/api/dashboard', { headers: authHeaders(), cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response));
      state.dashboard = await response.json();
      renderMetrics();
      renderRequests();
      setPill(elements.globalStatus, 'is-online', 'Connected');
      return true;
    } catch (error) {
      state.dashboard = null;
      renderMetrics();
      renderRequests();
      setPill(elements.globalStatus, 'is-error', 'Auth failed');
      throw error;
    }
  }

  async function loadModels() {
    if (!state.token) {
      state.models = [];
      renderModels();
      renderModelSelect();
      renderMetrics();
      return false;
    }
    const response = await fetch('/v1/models', { headers: authHeaders(), cache: 'no-store' });
    if (!response.ok) throw new Error(await responseError(response));
    const body = await response.json();
    state.models = Array.isArray(body.data)
      ? body.data.filter((model) => model && typeof model.id === 'string')
      : [];
    renderModels();
    renderModelSelect();
    renderMetrics();
    return true;
  }

  async function refreshProtected() {
    if (!state.token) return false;
    await loadDashboard();
    await loadControlGenerations();
    try {
      await loadModels();
    } catch (error) {
      state.models = [];
      renderModels();
      renderModelSelect();
      renderMetrics();
      toast('Connected, but models are unavailable: ' + messageOf(error));
    }
    await loadDashboard();
    return true;
  }

  async function refreshAll() {
    elements.refreshButton.disabled = true;
    try {
      await loadHealth();
      if (state.token) await refreshProtected();
      else {
        renderMetrics();
        renderRequests();
        renderModels();
        renderModelSelect();
      }
    } catch (error) {
      toast(messageOf(error));
    } finally {
      elements.refreshButton.disabled = false;
    }
  }

  async function connect() {
    const token = elements.tokenInput.value.trim();
    if (!token) {
      toast('Paste the local gateway token first');
      elements.tokenInput.focus();
      return;
    }

    elements.connectButton.disabled = true;
    state.token = token;
    try {
      await refreshProtected();
      sessionStorage.setItem('tony-router-token', token);
      elements.tokenInput.value = '';
      renderConnection();
      toast('Gateway connected');
      setView('dashboard');
    } catch (error) {
      state.token = '';
      state.dashboard = null;
      state.models = [];
      sessionStorage.removeItem('tony-router-token');
      renderModels();
      renderModelSelect();
      renderMetrics();
      renderRequests();
      toast(messageOf(error));
    } finally {
      elements.connectButton.disabled = false;
    }
  }

  function disconnect() {
    state.token = '';
    state.dashboard = null;
    state.models = [];
    sessionStorage.removeItem('tony-router-token');
    elements.tokenInput.value = '';
`;
