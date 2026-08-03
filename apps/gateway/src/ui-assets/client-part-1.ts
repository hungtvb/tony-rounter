export const UI_JS_PART_1 = String.raw`(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const state = {
    token: sessionStorage.getItem('tony-router-token') || '',
    health: null,
    dashboard: null,
    models: [],
    running: false,
    currentView: 'dashboard'
  };

  const elements = {
    pageTitle: byId('pageTitle'),
    pageSubtitle: byId('pageSubtitle'),
    globalStatus: byId('globalStatus'),
    sidebarStatusDot: byId('sidebarStatusDot'),
    sidebarVersion: byId('sidebarVersion'),
    sidebarUptime: byId('sidebarUptime'),
    footerVersion: byId('footerVersion'),
    footerAddress: byId('footerAddress'),
    gatewayMetric: byId('gatewayMetric'),
    gatewayDetail: byId('gatewayDetail'),
    providerMetric: byId('providerMetric'),
    providerDetail: byId('providerDetail'),
    modelMetric: byId('modelMetric'),
    requestMetric: byId('requestMetric'),
    requestDetail: byId('requestDetail'),
    successMetric: byId('successMetric'),
    providerLogo: byId('providerLogo'),
    providerName: byId('providerName'),
    providerBaseUrl: byId('providerBaseUrl'),
    providerHealth: byId('providerHealth'),
    providerMode: byId('providerMode'),
    providerCredential: byId('providerCredential'),
    providerModels: byId('providerModels'),
    providerFootDot: byId('providerFootDot'),
    providerFoot: byId('providerFoot'),
    providerModeBadge: byId('providerModeBadge'),
    providerCountLabel: byId('providerCountLabel'),
    providerPageProviderCount: byId('providerPageProviderCount'),
    providerPageAccountCount: byId('providerPageAccountCount'),
    providerPageProfileCount: byId('providerPageProfileCount'),
    providerPageCredentialCount: byId('providerPageCredentialCount'),
    providerInventoryStatus: byId('providerInventoryStatus'),
    providerInventory: byId('providerInventory'),
    profileInventory: byId('profileInventory'),
    setupProviderId: byId('setupProviderId'),
    setupAccountId: byId('setupAccountId'),
    setupBaseUrl: byId('setupBaseUrl'),
    setupApiKeyEnv: byId('setupApiKeyEnv'),
    setupTimeoutMs: byId('setupTimeoutMs'),
    setupUpstreamModel: byId('setupUpstreamModel'),
    setupProfileId: byId('setupProfileId'),
    generateSetupButton: byId('generateSetupButton'),
    setupValidation: byId('setupValidation'),
    routingConfigOutput: byId('routingConfigOutput'),
    providerBindingOutput: byId('providerBindingOutput'),
    copyRoutingConfigButton: byId('copyRoutingConfigButton'),
    copyProviderBindingButton: byId('copyProviderBindingButton'),
    recentRequestList: byId('recentRequestList'),
    quickModelBadge: byId('quickModelBadge'),
    modelCountLabel: byId('modelCountLabel'),
    modelSearch: byId('modelSearch'),
    reloadModelsButton: byId('reloadModelsButton'),
    modelList: byId('modelList'),
    modelSelect: byId('modelSelect'),
    temperatureInput: byId('temperatureInput'),
    temperatureValue: byId('temperatureValue'),
    promptInput: byId('promptInput'),
    sendButton: byId('sendButton'),
    copyButton: byId('copyButton'),
    responseOutput: byId('responseOutput'),
    responseTitle: byId('responseTitle'),
    responseDot: byId('responseDot'),
    responseModel: byId('responseModel'),
    responseLatency: byId('responseLatency'),
    playgroundStatus: byId('playgroundStatus'),
    traceCountLabel: byId('traceCountLabel'),
    traceList: byId('traceList'),
    tokenInput: byId('tokenInput'),
    connectButton: byId('connectButton'),
    disconnectButton: byId('disconnectButton'),
    connectionBadge: byId('connectionBadge'),
    connectionTitle: byId('connectionTitle'),
    connectionSubtitle: byId('connectionSubtitle'),
    refreshButton: byId('refreshButton'),
    healthButton: byId('healthButton'),
    toast: byId('toast')
  };

  const viewMetadata = {
    dashboard: ['Dashboard', 'Overview of your Tony Router gateway'],
    providers: ['Providers', 'Inspect accounts and generate safe routed configuration'],
    models: ['Models', 'Browse models exposed by the active provider'],
    playground: ['Chat Playground', 'Send a real streaming Chat Completions request'],
    traces: ['Request Traces', 'Inspect bounded in-memory request metadata'],
    connection: ['Connection', 'Authenticate this browser tab with your local token']
  };

  function messageOf(error) {
    if (error instanceof Error) return error.message;
    return String(error || 'Unknown error');
  }

  function shortText(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').slice(0, limit || 180);
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    if (state.token) headers.authorization = 'Bearer ' + state.token;
    return headers;
  }

  async function responseError(response) {
    try {
      const body = await response.json();
      if (body && body.error && body.error.message) return body.error.message;
    } catch (_) {
      // Use the HTTP fallback below.
    }
    return 'Request failed with HTTP ' + response.status;
  }

  let toastTimer;
  function toast(message) {
    elements.toast.textContent = shortText(message, 220);
    elements.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2600);
  }

  function setPill(element, mode, label) {
    element.className = 'connection-pill ' + mode;
    element.lastChild.textContent = label;
  }

  function setView(view) {
    if (!viewMetadata[view]) return;
    state.currentView = view;
    document.querySelectorAll('[data-view]').forEach((section) => {
      section.classList.toggle('is-active', section.dataset.view === view);
    });
    document.querySelectorAll('.nav-item[data-view-target]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.viewTarget === view);
    });
    elements.pageTitle.textContent = viewMetadata[view][0];
    elements.pageSubtitle.textContent = viewMetadata[view][1];
    history.replaceState(null, '', '#'+ view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
`;
