export const UI_JS_PART_6 = String.raw`  elements.reloadModelsButton.addEventListener('click', () => loadModels().catch((error) => toast(messageOf(error))));
  elements.modelSearch.addEventListener('input', renderModels);
  elements.temperatureInput.addEventListener('input', () => {
    elements.temperatureValue.textContent = Number(elements.temperatureInput.value).toFixed(1);
  });
  elements.sendButton.addEventListener('click', runChat);
  elements.copyButton.addEventListener('click', copyResponse);
  elements.healthButton.addEventListener('click', () => window.open('/health', '_blank', 'noopener,noreferrer'));
  elements.tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connect();
  });
  elements.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) runChat();
  });

  const hashView = location.hash.slice(1);
  setView(viewMetadata[hashView] ? hashView : 'dashboard');
  renderModels();
  renderModelSelect();
  renderMetrics();
  renderRequests();
  refreshAll();

  setInterval(updateUptime, 1000);
  setInterval(() => {
    if (state.token && document.visibilityState === 'visible') {
      loadDashboard().catch(() => undefined);
    }
  }, 5000);
})();`;
