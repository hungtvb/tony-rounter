export const UI_JS_PART_6 = String.raw`  elements.reloadModelsButton.addEventListener('click', () => loadModels().catch((error) => toast(messageOf(error))));
  elements.modelSearch.addEventListener('input', renderModels);
  elements.generateSetupButton.addEventListener('click', generateSetupConfiguration);
  elements.validateSetupButton.addEventListener('click', validateSetupLocally);
  elements.applySetupButton.addEventListener('click', applySetupLocally);
  elements.copyRoutingConfigButton.addEventListener('click', () => copyText(elements.routingConfigOutput.textContent || '', 'router.yaml copied'));
  elements.copyProviderBindingButton.addEventListener('click', () => copyText(elements.providerBindingOutput.textContent || '', 'providers.json copied'));
  elements.providerInventory.addEventListener('click', (event) => {
    const button = event.target.closest('[data-setup-provider]');
    if (button) useProviderInSetup(button);
    const healthButton = event.target.closest('[data-health-account]');
    if (healthButton) probeAccount(healthButton);
  });
  elements.generationList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rollback-generation]');
    if (button) rollbackGeneration(button);
  });
  elements.temperatureInput.addEventListener('input', () => {
    elements.temperatureValue.textContent = Number(elements.temperatureInput.value).toFixed(1);
  });
  elements.sendButton.addEventListener('click', runPlayground);
  elements.copyButton.addEventListener('click', copyResponse);
  elements.healthButton.addEventListener('click', () => window.open('/health', '_blank', 'noopener,noreferrer'));
  elements.tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connect();
  });
  elements.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) runPlayground();
  });

  const hashView = location.hash.slice(1);
  setView(viewMetadata[hashView] ? hashView : 'overview');
  renderModels();
  renderModelSelect();
  renderMetrics();
  renderRequests();
  generateSetupConfiguration();
  refreshAll();

  setInterval(updateUptime, 1000);
  setInterval(() => {
    if (state.token && document.visibilityState === 'visible') {
      loadDashboard().catch(() => undefined);
    }
  }, 5000);
})();`;
