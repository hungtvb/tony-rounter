export const UI_JS_PROVIDERS = String.raw`
  function safeHostname(value) {
    try { return new URL(value).hostname; } catch (_) { return value || 'Not configured'; }
  }

  function appendFact(list, label, value) {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = String(value);
    item.append(term, detail);
    list.append(item);
  }

  function createAccountRow(account) {
    const row = document.createElement('div');
    row.className = 'provider-account-row';

    const identity = document.createElement('div');
    identity.className = 'provider-account-identity';
    const avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.textContent = modelInitials(account.id);
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = account.id;
    const endpoint = document.createElement('small');
    endpoint.textContent = safeHostname(account.baseUrl);
    copy.append(name, endpoint);
    identity.append(avatar, copy);

    const facts = document.createElement('div');
    facts.className = 'provider-account-facts';
    const routes = document.createElement('span');
    routes.textContent = account.routeCount + (account.routeCount === 1 ? ' route' : ' routes');
    const timeout = document.createElement('span');
    timeout.textContent = account.timeoutMs ? account.timeoutMs + ' ms' : 'Default timeout';
    const models = document.createElement('span');
    models.textContent = account.modelCount + (account.modelCount === 1 ? ' model' : ' models');
    facts.append(models, routes, timeout);

    const actions = document.createElement('div');
    actions.className = 'provider-account-actions';
    const credential = document.createElement('span');
    credential.className = 'health-badge ' + (account.credentialConfigured ? '' : 'is-muted');
    credential.textContent = account.credentialConfigured ? 'Key loaded' : 'No key loaded';
    const probe = state.accountHealth[account.id];
    const running = Boolean(state.healthRunning[account.id]);
    const probeButton = document.createElement('button');
    probeButton.className = 'button button-secondary account-health-button';
    probeButton.type = 'button';
    probeButton.dataset.healthAccount = account.id;
    probeButton.disabled = running || !state.dashboard || state.dashboard.provider.mode !== 'routed';
    probeButton.textContent = running
      ? 'Testing…'
      : probe
        ? probe.status.replace(/_/g, ' ') + ' · ' + probe.latencyMs + ' ms'
        : 'Test health';
    if (probe) probeButton.dataset.healthStatus = probe.status;
    actions.append(credential, probeButton);

    row.append(identity, facts, actions);
    return row;
  }

  function createProviderRecord(provider, accounts) {
    const article = document.createElement('article');
    article.className = 'provider-record';

    const heading = document.createElement('div');
    heading.className = 'provider-record-head';
    const identity = document.createElement('div');
    identity.className = 'provider-record-identity';
    const logo = document.createElement('span');
    logo.className = 'provider-record-logo';
    logo.textContent = modelInitials(provider.id);
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = provider.id;
    const endpoint = document.createElement('small');
    endpoint.textContent = provider.baseUrl || 'No provider endpoint';
    copy.append(name, endpoint);
    identity.append(logo, copy);

    const useButton = document.createElement('button');
    useButton.className = 'button button-secondary provider-use-button';
    useButton.type = 'button';
    useButton.dataset.setupProvider = provider.id;
    useButton.dataset.setupBaseUrl = provider.baseUrl || '';
    useButton.textContent = 'Use in setup';
    heading.append(identity, useButton);

    const facts = document.createElement('dl');
    facts.className = 'provider-record-facts';
    appendFact(facts, 'Adapter', provider.kind || 'openai-compatible');
    appendFact(facts, 'Timeout', provider.timeoutMs ? provider.timeoutMs + ' ms' : 'Default');
    appendFact(facts, 'Accounts', provider.accountCount);
    appendFact(facts, 'Models', provider.modelCount);
    appendFact(facts, 'Routes', provider.routeCount);

    const accountList = document.createElement('div');
    accountList.className = 'provider-account-list';
    if (!accounts.length) {
      accountList.append(emptyState('No accounts attached', 'Add an account binding before this provider can route requests.'));
    } else {
      accounts.forEach((account) => accountList.append(createAccountRow(account)));
    }

    article.append(heading, facts, accountList);
    return article;
  }

  function createLegacyProviderRecord(provider) {
    return createProviderRecord({
      id: 'legacy-upstream',
      kind: 'openai-compatible',
      baseUrl: provider.baseUrl || '',
      timeoutMs: 0,
      accountCount: 1,
      modelCount: state.models.length,
      routeCount: 0
    }, [{
      id: 'legacy-upstream',
      providerId: 'legacy-upstream',
      baseUrl: provider.baseUrl || '',
      timeoutMs: 0,
      credentialConfigured: Boolean(provider.credentialConfigured),
      modelCount: state.models.length,
      routeCount: 0
    }]);
  }

  function renderProviders() {
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
      elements.providerInventory.append(emptyState('Connect to inspect providers', 'Protected routing metadata appears after local bearer authentication.'));
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
        detail.textContent = profile.routeCount + (profile.routeCount === 1 ? ' route' : ' routes') + ' · ' + profile.accountCount + (profile.accountCount === 1 ? ' account' : ' accounts');
        chip.append(name, detail);
        elements.profileInventory.append(chip);
      });

      if (!routing.providers.length) {
        elements.providerInventory.append(emptyState('No providers declared', 'The active routing registry does not expose a provider adapter.'));
        return;
      }

      routing.providers.forEach((item) => {
        const accounts = routing.accounts.filter((account) => account.providerId === item.id);
        elements.providerInventory.append(createProviderRecord(item, accounts));
      });
      return;
    }

    const mode = provider ? provider.mode : 'unconfigured';
    const configured = mode === 'openai-compatible';
    elements.providerPageProviderCount.textContent = configured ? '1' : '0';
    elements.providerPageAccountCount.textContent = configured ? '1' : '0';
    elements.providerPageProfileCount.textContent = '0';
    elements.providerPageCredentialCount.textContent = configured && provider.credentialConfigured ? '1' : '0';
    elements.providerModeBadge.className = 'health-badge ' + (configured ? '' : 'is-muted');
    elements.providerModeBadge.textContent = mode;
    elements.providerInventoryStatus.className = 'health-badge ' + (configured ? '' : 'is-muted');
    elements.providerInventoryStatus.textContent = configured ? 'Legacy mode' : 'No routed config';
    elements.providerCountLabel.textContent = configured ? '1 provider' : '0 providers';

    const profileState = document.createElement('span');
    profileState.className = 'profile-chip is-muted';
    profileState.textContent = configured ? 'Legacy mode has no public routing profiles' : mode === 'static-registry' ? 'Static registry has no routing profiles' : 'No profiles configured';
    elements.profileInventory.append(profileState);

    if (configured) {
      elements.providerInventory.append(createLegacyProviderRecord(provider));
    } else if (mode === 'static-registry') {
      elements.providerInventory.append(emptyState('Static model registry active', 'Static models do not define provider accounts. Generate routed configuration to add account fallback.'));
    } else {
      elements.providerInventory.append(emptyState('No provider configured', 'Use the setup assistant to generate routed configuration for an OpenAI-compatible account.'));
    }
  }

  function identifierValue(input, label) {
    const value = input.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
      throw new Error(label + ' must start with a letter or number and use at most 64 letters, numbers, dots, underscores, or dashes.');
    }
    return value;
  }

  function environmentNameValue(input) {
    const value = input.value.trim();
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(value)) {
      throw new Error('API key environment variable must use uppercase letters, numbers, and underscores.');
    }
    return value;
  }

  function baseUrlValue(input) {
    let url;
    try { url = new URL(input.value.trim()); } catch (_) { throw new Error('Base URL must be an absolute URL.'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Base URL must use HTTP or HTTPS.');
    if (url.username || url.password || url.search || url.hash) throw new Error('Base URL cannot contain credentials, query parameters, or a fragment.');
    const local = ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname.toLowerCase());
    if (url.protocol !== 'https:' && !local) throw new Error('Remote providers must use HTTPS.');
    return url.toString().replace(/\/$/, '');
  }

  function timeoutValue(input) {
    const value = Number(input.value);
    if (!Number.isSafeInteger(value) || value < 10 || value > 600000) {
      throw new Error('Timeout must be an integer between 10 and 600000 milliseconds.');
    }
    return value;
  }

  function upstreamModelValue(input) {
    const value = input.value.trim();
    if (!value || value.length > 200) throw new Error('Upstream model must contain between 1 and 200 characters.');
    return value;
  }

  function derivedIdentifier(base, suffix) {
    const maximumBaseLength = 63 - suffix.length;
    return base.slice(0, Math.max(1, maximumBaseLength)) + '-' + suffix;
  }

  function yamlKey(value) {
    return JSON.stringify(value);
  }

  function generateSetupConfiguration() {
    try {
      const providerId = identifierValue(elements.setupProviderId, 'Provider ID');
      const accountId = identifierValue(elements.setupAccountId, 'Account ID');
      const profileId = identifierValue(elements.setupProfileId, 'Public profile / model ID');
      const baseUrl = baseUrlValue(elements.setupBaseUrl);
      const apiKeyEnv = environmentNameValue(elements.setupApiKeyEnv);
      const timeoutMs = timeoutValue(elements.setupTimeoutMs);
      const upstreamModel = upstreamModelValue(elements.setupUpstreamModel);
      const modelId = derivedIdentifier(providerId, 'primary');
      const routeId = derivedIdentifier(accountId, 'primary');

      const routing = [
        'version: 2',
        'defaultProfile: ' + JSON.stringify(profileId),
        '',
        'providers:',
        '  ' + yamlKey(providerId) + ':',
        '    kind: openai-compatible',
        '',
        'accounts:',
        '  ' + yamlKey(accountId) + ':',
        '    provider: ' + JSON.stringify(providerId),
        '',
        'models:',
        '  ' + yamlKey(modelId) + ':',
        '    provider: ' + JSON.stringify(providerId),
        '    upstreamModel: ' + JSON.stringify(upstreamModel),
        '    capabilities:',
        '      tools: true',
        '      parallelToolCalls: true',
        '      vision: false',
        '      structuredOutput: true',
        '      reasoning: false',
        '      contextTokens: 128000',
        '',
        'routes:',
        '  ' + yamlKey(routeId) + ':',
        '    model: ' + JSON.stringify(modelId),
        '    account: ' + JSON.stringify(accountId),
        '    enabled: true',
        '    priority: 100',
        '',
        'profiles:',
        '  ' + yamlKey(profileId) + ':',
        '    routes:',
        '      - route: ' + JSON.stringify(routeId),
        '        priority: 100'
      ].join('\n');

      const bindings = JSON.stringify({
        version: 2,
        providers: {
          [providerId]: { baseUrl, timeoutMs }
        },
        accounts: {
          [accountId]: { provider: providerId, apiKeyEnv }
        }
      }, null, 2);

      elements.routingConfigOutput.textContent = routing;
      elements.providerBindingOutput.textContent = bindings;
      elements.setupValidation.className = 'setup-validation is-success';
      elements.setupValidation.textContent = 'Starter files generated. The API key itself was not requested or stored.';
      return true;
    } catch (error) {
      elements.setupValidation.className = 'setup-validation is-error';
      elements.setupValidation.textContent = messageOf(error);
      return false;
    }
  }

  function controlRequest(path, options) {
    const request = Object.assign({}, options || {});
    request.cache = 'no-store';
    request.headers = authHeaders(Object.assign(request.body ? { 'content-type': 'application/json' } : {}, request.headers || {}));
    return fetch(path, request).then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response));
      return response.json();
    });
  }

  function generatedSources() {
    if (!generateSetupConfiguration()) return null;
    return {
      routingSource: elements.routingConfigOutput.textContent || '',
      bindingSource: elements.providerBindingOutput.textContent || ''
    };
  }

  function setSetupStatus(mode, message) {
    elements.setupValidation.className = 'setup-validation ' + (mode ? 'is-' + mode : '');
    elements.setupValidation.textContent = message;
  }

  async function validateSetupLocally() {
    const sources = generatedSources();
    if (!sources) return;
    elements.validateSetupButton.disabled = true;
    try {
      const body = await controlRequest('/ui/api/control/validate', {
        method: 'POST',
        body: JSON.stringify(sources)
      });
      const validation = body.validation;
      const missing = validation.missingCredentialEnvironmentVariables || [];
      setSetupStatus(
        missing.length ? 'error' : 'success',
        'Valid routing v' + validation.routingVersion + ': ' + validation.providerCount + ' provider, ' + validation.accountCount + ' account, ' + validation.routeCount + ' route.' +
          (missing.length ? ' Export before restart: ' + missing.join(', ') + '.' : ' Credentials are available for restart.')
      );
    } catch (error) {
      setSetupStatus('error', messageOf(error));
    } finally {
      elements.validateSetupButton.disabled = false;
    }
  }

  async function applySetupLocally() {
    const sources = generatedSources();
    if (!sources) return;
    if (!window.confirm('Validate and atomically apply this configuration? The active generation remains available for rollback.')) return;
    elements.applySetupButton.disabled = true;
    try {
      const body = await controlRequest('/ui/api/control/apply', {
        method: 'POST',
        body: JSON.stringify(sources)
      });
      const result = body.result;
      setSetupStatus(
        'success',
        result.changed
          ? 'Configuration applied as ' + result.generation.generationId + '. Export the named key and restart Tony Router.'
          : 'This exact configuration is already active.'
      );
      await loadDashboard();
      await loadControlGenerations();
    } catch (error) {
      setSetupStatus('error', messageOf(error));
    } finally {
      elements.applySetupButton.disabled = false;
    }
  }

  function generationRow(generation) {
    const row = document.createElement('div');
    row.className = 'generation-row' + (generation.active ? ' is-active' : '');
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = generation.active ? 'Active generation' : 'Backup generation';
    const detail = document.createElement('small');
    detail.textContent = generation.generationId + ' · routing v' + generation.routingVersion + ' · ' + relativeTime(generation.createdAt);
    copy.append(title, detail);
    const status = document.createElement('span');
    status.className = 'health-badge ' + (generation.restartReady ? '' : 'is-muted');
    status.textContent = generation.restartReady ? 'Restart ready' : 'Missing env';
    row.append(copy, status);
    if (!generation.active) {
      const button = document.createElement('button');
      button.className = 'button button-secondary generation-rollback-button';
      button.type = 'button';
      button.dataset.rollbackGeneration = generation.generationId;
      button.textContent = 'Rollback';
      row.append(button);
    }
    return row;
  }

  function renderControlState() {
    const control = state.dashboard && state.dashboard.control;
    elements.generationList.replaceChildren();
    const enabled = Boolean(control && control.enabled);
    elements.validateSetupButton.disabled = !enabled;
    elements.applySetupButton.disabled = !enabled;
    if (!state.dashboard) {
      elements.controlModeBadge.className = 'health-badge is-muted';
      elements.controlModeBadge.textContent = 'Locked';
      elements.controlStateText.textContent = 'Connect to inspect local configuration control.';
      elements.generationList.append(emptyState('Connect to inspect generations', 'Applied configuration history is bearer-protected.'));
      return;
    }
    if (!enabled) {
      elements.controlModeBadge.className = 'health-badge is-muted';
      elements.controlModeBadge.textContent = 'Disabled';
      elements.controlStateText.textContent = 'Set TONY_ROUTER_CONTROL_DIR on loopback to enable atomic apply and rollback.';
      elements.setupNextStepText.textContent = 'Save both files, export the named key, set the two routed config file paths, then restart the gateway.';
      elements.generationList.append(emptyState('Local control disabled', 'Generated files can still be copied and applied manually.'));
      return;
    }
    elements.controlModeBadge.className = 'health-badge ' + (control.status === 'unavailable' ? 'is-muted' : '');
    elements.controlModeBadge.textContent = control.restartRequired ? 'Restart required' : control.status;
    elements.controlStateText.textContent = control.restartRequired
      ? 'A validated generation is active on disk. Restart Tony Router to load it.'
      : 'Atomic apply and rollback are enabled for this loopback gateway.';
    elements.setupNextStepText.textContent = 'Apply writes an immutable generation and switches one atomic pointer. Export the named key, then restart Tony Router.';
    if (!state.generations.length) {
      elements.generationList.append(emptyState('No applied generations', 'Generate, validate, and apply a configuration to create the first recoverable generation.'));
      return;
    }
    state.generations.forEach((generation) => elements.generationList.append(generationRow(generation)));
  }

  async function loadControlGenerations() {
    const control = state.dashboard && state.dashboard.control;
    if (!control || !control.enabled) {
      state.generations = [];
      renderControlState();
      return false;
    }
    try {
      const body = await controlRequest('/ui/api/control/generations', { method: 'GET', headers: {} });
      state.generations = Array.isArray(body.generations) ? body.generations : [];
      renderControlState();
      return true;
    } catch (error) {
      state.generations = [];
      renderControlState();
      toast(messageOf(error));
      return false;
    }
  }

  async function rollbackGeneration(button) {
    const generationId = button.dataset.rollbackGeneration || '';
    if (!generationId || !window.confirm('Rollback the active pointer to this generation? A gateway restart is still required.')) return;
    button.disabled = true;
    try {
      const body = await controlRequest('/ui/api/control/rollback', {
        method: 'POST',
        body: JSON.stringify({ generationId })
      });
      toast(body.result.changed ? 'Rollback selected. Restart Tony Router.' : 'Generation is already active.');
      await loadDashboard();
      await loadControlGenerations();
    } catch (error) {
      toast(messageOf(error));
    } finally {
      button.disabled = false;
    }
  }

  async function probeAccount(button) {
    const accountId = button.dataset.healthAccount || '';
    if (!accountId || state.healthRunning[accountId]) return;
    state.healthRunning[accountId] = true;
    renderProviders();
    try {
      const body = await controlRequest('/ui/api/providers/' + encodeURIComponent(accountId) + '/health', { method: 'POST', body: '{}' });
      state.accountHealth[accountId] = body.probe;
      toast(accountId + ': ' + body.probe.status.replace(/_/g, ' ') + ' in ' + body.probe.latencyMs + ' ms');
    } catch (error) {
      toast(messageOf(error));
    } finally {
      delete state.healthRunning[accountId];
      renderProviders();
    }
  }

  async function copyText(text, successMessage) {
    if (!text || text === 'Generate a starter configuration.') {
      toast('Generate the starter files first');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage);
    } catch (_) {
      toast('Clipboard access is unavailable');
    }
  }

  function useProviderInSetup(button) {
    const providerId = button.dataset.setupProvider || '';
    const baseUrl = button.dataset.setupBaseUrl || '';
    if (providerId) elements.setupProviderId.value = providerId;
    if (baseUrl) elements.setupBaseUrl.value = baseUrl;
    const suffix = 'backup';
    elements.setupAccountId.value = derivedIdentifier(providerId || 'provider', suffix);
    elements.setupApiKeyEnv.value = String(providerId || 'provider').replace(/[^A-Za-z0-9]/g, '_').toUpperCase() + '_BACKUP_KEY';
    generateSetupConfiguration();
    elements.setupAccountId.focus();
    toast('Provider copied into the setup assistant');
  }
`;
