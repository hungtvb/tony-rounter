export const UI_JS_PART_5 = String.raw`    renderModels();
    renderModelSelect();
    renderMetrics();
    renderRequests();
    setPill(elements.globalStatus, state.health ? 'is-online' : 'is-error', state.health ? 'Online' : 'Offline');
    toast('Disconnected');
  }

  function extractText(payload) {
    if (!payload || !Array.isArray(payload.choices) || !payload.choices[0]) return '';
    const choice = payload.choices[0];
    if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
    if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
    return '';
  }

  async function readEventStream(response, onText) {
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
        const text = extractText(payload);
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

  function setResponseState(mode, title) {
    elements.responseDot.className = 'response-dot' + (mode ? ' ' + mode : '');
    elements.responseTitle.textContent = title;
    setPill(elements.playgroundStatus, mode === 'is-error' ? 'is-error' : mode === 'is-success' ? 'is-online' : 'is-pending', title);
  }

  async function runChat() {
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
    elements.responseModel.textContent = model;
    elements.responseLatency.textContent = 'running';
    setResponseState('is-running', 'Streaming');
    const started = performance.now();

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          model,
          stream: true,
          temperature: Number(elements.temperatureInput.value),
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!response.ok) throw new Error(await responseError(response));

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        await readEventStream(response, (text) => {
          elements.responseOutput.textContent += text;
          elements.responseOutput.scrollTop = elements.responseOutput.scrollHeight;
        });
      } else {
        const payload = await response.json();
        elements.responseOutput.textContent = extractText(payload) || JSON.stringify(payload, null, 2);
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

  document.querySelectorAll('[data-view-target]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.viewTarget));
  });
  elements.connectButton.addEventListener('click', connect);
  elements.disconnectButton.addEventListener('click', disconnect);
  elements.refreshButton.addEventListener('click', refreshAll);
`;
