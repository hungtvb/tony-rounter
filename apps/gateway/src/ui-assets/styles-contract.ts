export const UI_CSS_CONTRACT = String.raw`
:root {
  color-scheme: light;
  --font-sans: Inter, "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  --tony-lime-100: #efffc2;
  --tony-lime-300: #d4ff40;
  --tony-lime-400: #c8f500;
  --tony-lime-700: #637900;
  --color-bg-canvas: #f7f7f5;
  --color-bg-surface: #ffffff;
  --color-bg-subtle: #f1f1ef;
  --color-bg-elevated: #ffffff;
  --color-bg-hover: #ececea;
  --color-bg-selected: #efffc2;
  --color-fg-primary: #191917;
  --color-fg-secondary: #555550;
  --color-fg-muted: #73736e;
  --color-fg-disabled: #a4a49f;
  --color-on-brand: #101204;
  --color-border-subtle: #e7e7e5;
  --color-border-default: #d4d4d0;
  --color-border-strong: #73736e;
  --color-action-primary: #191917;
  --color-action-hover: #282825;
  --color-focus-ring: #2563eb;
  --color-info: #2563eb;
  --color-info-bg: #eff6ff;
  --color-success: #16803a;
  --color-success-bg: #ecfdf3;
  --color-warning: #b65c00;
  --color-warning-bg: #fff7ed;
  --color-danger: #d1242f;
  --color-danger-bg: #fff1f2;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
  --shadow-md: 0 6px 20px rgb(0 0 0 / 0.1);
  --duration-fast: 120ms;
  --duration-standard: 180ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --sidebar-width: 232px;
}

[data-theme="dark"] {
  color-scheme: dark;
  --color-bg-canvas: #10100f;
  --color-bg-surface: #191917;
  --color-bg-subtle: #222220;
  --color-bg-elevated: #282825;
  --color-bg-hover: #2d2d2a;
  --color-bg-selected: #2d350b;
  --color-fg-primary: #f5f5f4;
  --color-fg-secondary: #c6c6c1;
  --color-fg-muted: #999994;
  --color-fg-disabled: #73736e;
  --color-border-subtle: #2d2d2a;
  --color-border-default: #3d3d39;
  --color-border-strong: #73736e;
  --color-action-primary: #f5f5f4;
  --color-action-hover: #ffffff;
  --color-info-bg: #172033;
  --color-success-bg: #13271a;
  --color-warning-bg: #2c2114;
  --color-danger-bg: #32191d;
}

* { box-sizing: border-box; }
html { min-width: 320px; background: var(--color-bg-canvas); scroll-behavior: smooth; }
body { min-width: 320px; min-height: 100vh; min-height: 100dvh; margin: 0; overflow-x: hidden; color: var(--color-fg-primary); background: var(--color-bg-canvas); font: 400 14px/1.5 var(--font-sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
button, input, textarea, select { font: inherit; }
button { color: inherit; touch-action: manipulation; }
a { color: inherit; }
h1, h2, h3, h4, p, dl, dd { margin: 0; }
code, pre, .technical, .request-id, .runtime-mini dd, .route-index { font-family: var(--font-mono); }
svg { display: block; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[hidden], .legacy-runtime-hooks { display: none !important; }
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.skip-link { position: fixed; top: 8px; left: 8px; z-index: 1000; transform: translateY(-150%); padding: 10px 14px; border-radius: var(--radius-md); background: var(--color-action-primary); color: var(--color-bg-canvas); text-decoration: none; transition: transform var(--duration-standard) var(--ease-standard); }
.skip-link:focus { transform: translateY(0); }
.icon-sprite { position: absolute; overflow: hidden; }

.app-shell { min-height: 100vh; min-height: 100dvh; display: grid; grid-template-columns: var(--sidebar-width) minmax(0, 1fr); }
.sidebar { position: sticky; top: 0; z-index: 20; height: 100vh; height: 100dvh; display: flex; flex-direction: column; padding: var(--space-4) var(--space-3); border-right: 1px solid var(--color-border-subtle); background: var(--color-bg-surface); }
.brand { min-height: 48px; display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-2); text-decoration: none; }
.brand-mark { width: 32px; height: 32px; display: grid; place-items: center; flex: 0 0 auto; border-radius: var(--radius-md); background: var(--tony-lime-400); color: var(--color-on-brand); font-size: 15px; font-weight: 750; letter-spacing: -0.02em; }
.brand-copy { min-width: 0; }
.brand-copy strong, .brand-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.brand-copy strong { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
.brand-copy small { margin-top: 1px; color: var(--color-fg-muted); font-size: 12px; }
.nav-label { padding: var(--space-6) var(--space-3) var(--space-2); color: var(--color-fg-muted); font-size: 11px; font-weight: 650; }
.nav { display: grid; gap: var(--space-1); }
.nav-item { min-height: 40px; display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-fg-secondary); text-align: left; cursor: pointer; transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard); }
.nav-item:hover { background: var(--color-bg-subtle); color: var(--color-fg-primary); }
.nav-item.is-active { background: var(--color-bg-selected); color: var(--color-fg-primary); font-weight: 600; }
.nav-item.is-active .nav-icon { color: var(--tony-lime-700); }
[data-theme="dark"] .nav-item.is-active .nav-icon { color: var(--tony-lime-300); }
.nav-icon { width: 18px; height: 18px; flex: 0 0 auto; color: var(--color-fg-muted); }
.nav-item span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-footer { margin-top: auto; display: grid; gap: var(--space-3); }
.sidebar-footer .button svg { width: 16px; height: 16px; flex: 0 0 auto; }
.runtime-mini { padding: var(--space-3); border-top: 1px solid var(--color-border-subtle); border-bottom: 1px solid var(--color-border-subtle); }
.runtime-heading, .runtime-mini dl div { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.runtime-mini dl { margin: var(--space-2) 0 0; display: grid; gap: var(--space-2); }
.runtime-mini dt { color: var(--color-fg-muted); font-size: 12px; }
.runtime-mini dd { color: var(--color-fg-primary); font-size: 12px; }

.workspace { min-width: 0; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
.topbar { min-height: 64px; position: sticky; top: 0; z-index: 15; display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: 0 clamp(20px, 3vw, 40px); border-bottom: 1px solid var(--color-border-subtle); background: color-mix(in srgb, var(--color-bg-canvas) 92%, transparent); backdrop-filter: blur(14px); }
.crumbs { min-width: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--color-fg-muted); font-size: 12px; }
.crumbs strong { overflow: hidden; text-overflow: ellipsis; color: var(--color-fg-primary); font-weight: 650; white-space: nowrap; }
.topbar-actions { display: flex; align-items: center; gap: var(--space-2); }
.content { min-width: 0; width: 100%; max-width: 1580px; margin: 0 auto; padding: var(--space-8) clamp(20px, 3vw, 40px) var(--space-12); }
.view { min-width: 0; display: none; }
.view.is-active { display: block; animation: view-in var(--duration-standard) var(--ease-standard); }
@keyframes view-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

.page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-8); margin-bottom: var(--space-8); }
.page-heading h1 { font-size: clamp(26px, 3vw, 34px); line-height: 1.15; letter-spacing: -0.025em; }
.page-heading p { max-width: 720px; margin-top: var(--space-2); color: var(--color-fg-secondary); }
.page-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
.section-block + .section-block { margin-top: var(--space-10); }
.section-heading, .entity-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); margin-bottom: var(--space-3); }
.section-heading h2, .entity-toolbar h2 { font-size: 16px; line-height: 1.4; font-weight: 650; letter-spacing: -0.01em; }
.section-heading p, .section-description, .entity-toolbar p { margin-top: 2px; color: var(--color-fg-muted); font-size: 12px; }

.icon-button, .button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); border-radius: var(--radius-md); cursor: pointer; transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard); }
.icon-button { width: 36px; padding: 0; border: 1px solid var(--color-border-subtle); background: var(--color-bg-surface); }
.icon-button:hover { background: var(--color-bg-subtle); }
.icon-button svg { width: 17px; height: 17px; }
.button { padding: 0 var(--space-3); border: 1px solid transparent; font-size: 13px; font-weight: 600; }
.button:disabled, .icon-button:disabled { cursor: not-allowed; opacity: 0.55; }
.button-primary { background: var(--color-action-primary); color: var(--color-bg-canvas); }
[data-theme="dark"] .button-primary { color: #10100f; }
.button-primary:hover:not(:disabled) { background: var(--color-action-hover); }
.button-brand { background: var(--tony-lime-400); color: var(--color-on-brand); }
.button-brand:hover:not(:disabled) { background: var(--tony-lime-300); }
.button-secondary { border-color: var(--color-border-default); background: var(--color-bg-surface); color: var(--color-fg-primary); }
.button-secondary:hover:not(:disabled) { background: var(--color-bg-subtle); }
.button-quiet, .button-ghost { border-color: transparent; background: transparent; color: var(--color-fg-secondary); }
.button-quiet:hover:not(:disabled), .button-ghost:hover:not(:disabled) { background: var(--color-bg-subtle); color: var(--color-fg-primary); }
.button-full { width: 100%; }
.text-button { min-height: 32px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-fg-secondary); cursor: pointer; }
.text-button:hover { background: var(--color-bg-subtle); color: var(--color-fg-primary); }

.connection-pill, .status-pill, .health-badge, .count-badge { min-height: 28px; display: inline-flex; align-items: center; gap: var(--space-2); padding: 0 10px; border: 1px solid var(--color-border-default); border-radius: var(--radius-full); background: var(--color-bg-surface); color: var(--color-fg-secondary); font-size: 11px; white-space: nowrap; }
.connection-pill > span { width: 7px; height: 7px; border-radius: 50%; background: var(--color-fg-disabled); }
.connection-pill.is-online > span, .status-dot.is-online, .tiny-dot.is-online { background: var(--color-success); }
.connection-pill.is-error > span, .status-dot.is-error { background: var(--color-danger); }
.health-badge.is-muted { color: var(--color-fg-muted); }
.health-badge.is-error, .trace-status.is-error, .request-result .is-error { color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 35%, var(--color-border-default)); }
.count-badge { min-width: 30px; justify-content: center; }
.status-dot, .tiny-dot { width: 7px; height: 7px; display: inline-block; flex: 0 0 auto; border-radius: 50%; background: var(--color-fg-disabled); }
.status-dot.is-pending { background: var(--color-warning); }
.inline-status { display: flex !important; align-items: center; gap: var(--space-2); }

.runtime-strip { display: grid; grid-template-columns: minmax(190px, 1.2fr) repeat(4, minmax(120px, 0.8fr)); margin-bottom: var(--space-8); border-top: 1px solid var(--color-border-subtle); border-bottom: 1px solid var(--color-border-subtle); }
.runtime-stat { min-width: 0; padding: var(--space-4) var(--space-5); }
.runtime-stat + .runtime-stat { border-left: 1px solid var(--color-border-subtle); }
.runtime-stat > span { display: block; color: var(--color-fg-muted); font-size: 12px; }
.runtime-stat strong { display: block; margin-top: var(--space-1); overflow: hidden; text-overflow: ellipsis; font-size: 17px; line-height: 1.4; font-weight: 650; letter-spacing: -0.015em; white-space: nowrap; }
.runtime-stat small { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; color: var(--color-fg-muted); font-size: 11px; white-space: nowrap; }
.provider-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }

.overview-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.65fr); gap: var(--space-8); align-items: start; }
.overview-grid > *, .providers-layout > * { min-width: 0; }
.routing-list, .attention-list, .request-list, .boundary-list, .generation-list { border-top: 1px solid var(--color-border-default); }
.route-row { min-height: 88px; display: grid; grid-template-columns: minmax(170px, 1.1fr) minmax(145px, 0.9fr) minmax(170px, 1.05fr) auto; gap: var(--space-2) var(--space-4); align-items: center; padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border-subtle); }
.route-primary { min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
.route-primary > div, .cell-stack { min-width: 0; }
.route-index { width: 28px; height: 28px; display: grid; place-items: center; flex: 0 0 28px; border-radius: var(--radius-sm); background: var(--color-bg-subtle); color: var(--color-fg-secondary); font-size: 11px; font-weight: 650; }
.route-primary strong, .route-primary span, .cell-stack strong, .cell-stack span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.route-primary strong, .cell-stack strong { font-size: 13px; font-weight: 650; }
.route-primary span, .cell-stack span { margin-top: 2px; color: var(--color-fg-muted); font-size: 12px; }
.route-row .capabilities { grid-column: 2 / 4; }
.capabilities { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.capability { min-height: 22px; display: inline-flex; align-items: center; padding: 0 7px; border-radius: var(--radius-sm); background: var(--color-bg-subtle); color: var(--color-fg-secondary); font: 500 11px/1 var(--font-mono); }
.route-state { min-width: 78px; display: inline-flex; align-items: center; gap: var(--space-2); grid-column: 4; grid-row: 1 / span 2; color: var(--color-fg-secondary); font-size: 12px; }
.attention-row { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-4) 0; border-bottom: 1px solid var(--color-border-subtle); }
.attention-icon { width: 22px; height: 22px; display: grid; place-items: center; border-radius: var(--radius-sm); }
.attention-icon svg { width: 15px; height: 15px; }
.attention-icon.warning { color: var(--color-warning); background: var(--color-warning-bg); }
.attention-icon.danger { color: var(--color-danger); background: var(--color-danger-bg); }
.attention-icon.info { color: var(--color-info); background: var(--color-info-bg); }
.attention-copy strong { display: block; font-size: 13px; font-weight: 650; }
.attention-copy p { margin-top: 3px; color: var(--color-fg-secondary); font-size: 12px; line-height: 1.55; }

.request-row { min-height: 58px; display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: 9px 0; border-bottom: 1px solid var(--color-border-subtle); }
.method-badge { width: fit-content; padding: 5px 7px; border-radius: var(--radius-sm); background: var(--color-warning-bg); color: var(--color-warning); font: 650 10px/1 var(--font-mono); }
.method-badge.is-get { background: var(--color-info-bg); color: var(--color-info); }
.request-path, .request-result { min-width: 0; }
.request-path strong, .request-path small, .request-result strong, .request-result small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-path strong { font: 600 12px/1.4 var(--font-mono); }
.request-path small, .request-result small { margin-top: 2px; color: var(--color-fg-muted); font-size: 11px; }
.request-result { text-align: right; }
.request-result strong { color: var(--color-success); font: 650 12px/1.4 var(--font-mono); }

.table-shell { min-width: 0; max-width: 100%; overflow: hidden; border-top: 1px solid var(--color-border-default); }
.table-scroll { width: 100%; min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
table { width: 100%; border-collapse: collapse; min-width: 760px; }
th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--color-border-subtle); vertical-align: middle; }
th { color: var(--color-fg-muted); font-size: 11px; font-weight: 650; }
td { color: var(--color-fg-secondary); font-size: 12px; }
td strong { color: var(--color-fg-primary); font-weight: 650; }
.table-actions { text-align: right; }
.provider-table { min-width: 920px; }
.trace-table { min-width: 780px; }
.model-table { min-width: 900px; }
.provider-identity, .provider-account-identity { min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
.account-avatar, .model-avatar, .provider-record-logo { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; border-radius: var(--radius-sm); background: var(--color-bg-selected); color: var(--tony-lime-700); font: 700 10px/1 var(--font-mono); }
[data-theme="dark"] .account-avatar, [data-theme="dark"] .model-avatar, [data-theme="dark"] .provider-record-logo { color: var(--tony-lime-300); }
.provider-account-identity strong, .provider-account-identity small, .model-name strong, .model-name small { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-account-identity strong, .model-name strong { color: var(--color-fg-primary); font: 600 12px/1.4 var(--font-mono); }
.provider-account-identity small, .model-name small { margin-top: 2px; color: var(--color-fg-muted); font-size: 11px; }
.provider-account-facts { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.provider-account-facts span { padding: 4px 6px; border-radius: var(--radius-sm); background: var(--color-bg-subtle); color: var(--color-fg-secondary); font: 500 10px/1.2 var(--font-mono); }
.provider-account-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.account-health-button, .provider-use-button, .generation-rollback-button { min-height: 30px; font-size: 11px; }
.account-health-button[data-health-status="healthy"] { color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 35%, var(--color-border-default)); }
.account-health-button[data-health-status="authentication_failed"], .account-health-button[data-health-status="unavailable"], .account-health-button[data-health-status="invalid_response"] { color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 35%, var(--color-border-default)); }
.profile-coverage-block { padding: var(--space-4) 0; border-bottom: 1px solid var(--color-border-subtle); }
.profile-coverage-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
.profile-coverage-heading span { color: var(--color-fg-secondary); font-size: 12px; font-weight: 650; }
.profile-coverage-heading small { color: var(--color-fg-muted); font-size: 11px; }
.profile-coverage-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.profile-chip { min-width: 150px; display: grid; gap: 3px; padding: 8px 10px; border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-bg-surface); }
.profile-chip strong { overflow: hidden; text-overflow: ellipsis; font: 600 11px/1.3 var(--font-mono); white-space: nowrap; }
.profile-chip small, .profile-chip.is-muted { color: var(--color-fg-muted); font-size: 10px; }
.profile-chip.is-default { border-color: var(--tony-lime-700); background: var(--color-bg-selected); }

.providers-layout { margin-top: var(--space-10); display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.55fr); gap: var(--space-10); align-items: start; }
.setup-body { min-width: 0; }
.setup-intro { color: var(--color-fg-secondary); font-size: 12px; line-height: 1.6; }
.setup-field-grid { margin-top: var(--space-5); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.setup-field-grid label, .field { min-width: 0; display: grid; gap: var(--space-2); }
.setup-field-grid label > span, .field label { color: var(--color-fg-secondary); font-size: 12px; font-weight: 650; }
.setup-field-wide { grid-column: 1 / -1; }
input, textarea, select { width: 100%; border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-bg-surface); color: var(--color-fg-primary); }
input, select { min-height: 40px; padding: 0 var(--space-3); }
textarea { min-height: 190px; padding: var(--space-3); resize: vertical; line-height: 1.6; }
input:hover, textarea:hover, select:hover { border-color: var(--color-border-strong); }
input[type="range"] { min-height: 24px; padding: 0; accent-color: var(--tony-lime-400); }
.setup-primary-actions { margin-top: var(--space-4); display: flex; flex-wrap: wrap; gap: var(--space-2); }
.setup-validation { min-height: 20px; margin-top: var(--space-3); color: var(--color-fg-muted); font-size: 12px; }
.setup-validation.is-success { color: var(--color-success); }
.setup-validation.is-error { color: var(--color-danger); }
.config-output-stack { margin-top: var(--space-4); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.config-output-card { min-width: 0; overflow: hidden; border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-bg-surface); }
.config-output-card > div { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: 0 var(--space-3); border-bottom: 1px solid var(--color-border-subtle); }
.config-output-card strong { font: 600 11px/1.4 var(--font-mono); }
.config-output-card pre { max-height: 300px; margin: 0; padding: var(--space-3); overflow: auto; color: var(--color-fg-secondary); font: 11px/1.65 var(--font-mono); white-space: pre; tab-size: 2; }
.security-note { margin-top: var(--space-4); padding: var(--space-4); border-left: 3px solid var(--color-info); background: var(--color-info-bg); }
.security-note strong { display: block; font-size: 13px; }
.security-note p { margin-top: var(--space-1); color: var(--color-fg-secondary); font-size: 12px; }
.control-history { padding-left: var(--space-6); border-left: 1px solid var(--color-border-subtle); }
.control-history .section-heading { padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border-subtle); }
.generation-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--space-2); align-items: center; padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border-subtle); }
.generation-row.is-active { background: color-mix(in srgb, var(--color-success-bg) 35%, transparent); }
.generation-row strong, .generation-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.generation-row strong { font-size: 12px; }
.generation-row small { margin-top: 3px; color: var(--color-fg-muted); font: 10px/1.4 var(--font-mono); }

.entity-toolbar { align-items: center; }
.search-field { min-height: 40px; min-width: min(380px, 100%); display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-bg-surface); }
.search-field svg { width: 16px; height: 16px; flex: 0 0 auto; color: var(--color-fg-muted); }
.search-field input { min-height: 36px; padding: 0; border: 0; outline: 0; background: transparent; }
.model-name { min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
.model-owner, .model-state { font-family: var(--font-mono); }
.model-state { color: var(--color-success); font-size: 11px; }

.playground-shell { min-height: 610px; display: grid; grid-template-columns: minmax(340px, 0.8fr) minmax(0, 1.2fr); border-top: 1px solid var(--color-border-default); }
.composer { padding: var(--space-6) var(--space-6) var(--space-6) 0; border-right: 1px solid var(--color-border-subtle); }
.response { min-width: 0; padding: var(--space-6) 0 var(--space-6) var(--space-6); display: flex; flex-direction: column; }
.segmented { display: inline-flex; padding: 3px; border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-bg-subtle); }
.segment { min-height: 30px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-fg-secondary); cursor: pointer; font-size: 12px; }
.segment.is-active { background: var(--color-bg-surface); color: var(--color-fg-primary); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
.form-stack { margin-top: var(--space-5); display: grid; gap: var(--space-4); }
.field-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.field-help { color: var(--color-fg-muted); font-size: 12px; }
.composer-actions { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.composer-actions small { color: var(--color-fg-muted); font-size: 11px; }
.response-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding-bottom: var(--space-4); border-bottom: 1px solid var(--color-border-subtle); }
.response-title { display: flex; align-items: center; gap: var(--space-2); }
.response-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-fg-disabled); }
.response-dot.is-running { background: var(--color-info); }
.response-dot.is-success { background: var(--color-success); }
.response-dot.is-error { background: var(--color-danger); }
.event-stream { flex: 1; min-height: 420px; max-width: 100%; margin: 0; overflow: auto; padding: var(--space-4) 0; color: var(--color-fg-secondary); background: transparent; border: 0; border-radius: 0; font: 12px/1.7 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.response-foot { display: flex; justify-content: space-between; gap: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--color-border-subtle); color: var(--color-fg-muted); font: 11px/1.4 var(--font-mono); }

.trace-request, .trace-path, .trace-status, .trace-duration, .trace-time { font-family: var(--font-mono); }
.trace-status { color: var(--color-success); }
.connection-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 0.55fr); gap: var(--space-10); align-items: start; }
.connection-form { max-width: 700px; }
.input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); }
.identity-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--color-bg-selected); color: var(--tony-lime-700); }
[data-theme="dark"] .identity-mark { color: var(--tony-lime-300); }
.identity-mark svg { width: 22px; height: 22px; }
.connection-grid aside h2 { margin-top: var(--space-4); font-size: 18px; }
.boundary-intro { margin-top: var(--space-2); color: var(--color-fg-secondary); }
.boundary-list { margin-top: var(--space-5); }
.boundary-row { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border-subtle); }
.boundary-row svg { width: 18px; height: 18px; margin-top: 1px; color: var(--color-success); }
.boundary-row strong { display: block; font-size: 13px; }
.boundary-row p { margin-top: 2px; color: var(--color-fg-muted); font-size: 12px; }

.empty-state { min-height: 100px; display: grid; place-content: center; gap: var(--space-1); padding: var(--space-5); color: var(--color-fg-secondary); text-align: center; }
.empty-state strong { color: var(--color-fg-primary); font-size: 13px; }
.empty-state small { color: var(--color-fg-muted); font-size: 12px; }
.footer { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-top: auto; padding: 0 clamp(20px, 3vw, 40px); border-top: 1px solid var(--color-border-subtle); color: var(--color-fg-muted); font-size: 11px; }
.footer > span { display: flex; align-items: center; gap: var(--space-2); }
.font-status { font-family: var(--font-mono); }
.mobile-nav { display: none; }
.toast { position: fixed; right: var(--space-5); bottom: var(--space-5); z-index: 100; max-width: min(360px, calc(100vw - 40px)); padding: var(--space-3) var(--space-4); border: 1px solid var(--color-border-default); border-radius: var(--radius-lg); background: var(--color-bg-elevated); box-shadow: var(--shadow-md); color: var(--color-fg-primary); transform: translateY(20px); opacity: 0; pointer-events: none; transition: opacity var(--duration-standard) var(--ease-standard), transform var(--duration-standard) var(--ease-standard); }
.toast.is-visible { transform: translateY(0); opacity: 1; }

@media (max-width: 1120px) {
  :root { --sidebar-width: 76px; }
  .brand-copy, .nav-item span:last-child, .nav-label, .runtime-mini, .sidebar-footer .button span { display: none; }
  .brand { justify-content: center; padding: 0; }
  .nav-item { justify-content: center; padding: 0; }
  .nav-icon { width: 20px; height: 20px; }
  .sidebar-footer .button { padding: 0; overflow: hidden; }
  .topbar { gap: var(--space-3); }
  .crumbs > span:first-child, .connection-label { display: none; }
  .topbar-actions { min-width: 0; gap: var(--space-1); }
  .topbar-connection { width: 36px; min-height: 36px; padding: 0; font-size: 0; }
  .topbar-connection::before { content: '↔'; font-size: 16px; line-height: 1; }
  .connection-pill { width: 32px; min-height: 32px; justify-content: center; padding: 0; }
  .runtime-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .runtime-stat:nth-child(4), .runtime-stat:nth-child(5) { border-top: 1px solid var(--color-border-subtle); }
  .runtime-stat:nth-child(4) { border-left: 0; }
  .overview-grid, .providers-layout { grid-template-columns: minmax(0, 1fr); }
  .control-history { padding: var(--space-6) 0 0; border-top: 1px solid var(--color-border-subtle); border-left: 0; }
  .route-row { grid-template-columns: minmax(170px, 1fr) minmax(150px, 1fr) minmax(170px, 1fr) auto; }
  .playground-shell { grid-template-columns: 1fr; }
  .composer { padding-right: 0; border-right: 0; border-bottom: 1px solid var(--color-border-subtle); }
  .response { padding-left: 0; }
}

@media (max-width: 720px) {
  .app-shell { display: block; }
  .sidebar { display: none; }
  .topbar { min-height: 56px; padding: 0 var(--space-4); }
  .content { padding: var(--space-6) var(--space-4) 92px; }
  .page-heading { display: grid; gap: var(--space-4); margin-bottom: var(--space-6); }
  .page-heading h1 { font-size: 28px; }
  .page-actions { justify-content: stretch; }
  .page-actions .button { flex: 1; min-height: 44px; }
  .runtime-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: var(--space-6); }
  .runtime-stat { padding: var(--space-3); }
  .runtime-stat:nth-child(3), .runtime-stat:nth-child(5) { border-left: 0; }
  .runtime-stat:nth-child(n + 3) { border-top: 1px solid var(--color-border-subtle); }
  .runtime-stat:first-child { grid-column: 1 / -1; }
  .provider-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .provider-summary .runtime-stat:first-child { grid-column: auto; }
  .overview-grid { gap: var(--space-8); }
  .route-row { grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2) var(--space-3); padding: var(--space-4) 0; }
  .route-row > :nth-child(2), .route-row > :nth-child(3), .route-row .capabilities { grid-column: 1 / -1; margin-left: 40px; }
  .route-row .route-state { grid-column: 2; grid-row: 1; margin-left: 0; justify-self: end; }
  .entity-toolbar { align-items: stretch; flex-direction: column; }
  .search-field { width: 100%; min-width: 0; min-height: 44px; }
  .entity-toolbar .button { min-height: 44px; }
  .setup-field-grid, .config-output-stack { grid-template-columns: 1fr; }
  .setup-field-wide { grid-column: auto; }
  .setup-primary-actions { display: grid; grid-template-columns: 1fr; }
  .setup-primary-actions .button { min-height: 44px; }
  .playground-shell { min-height: auto; }
  .composer, .response { padding-top: var(--space-5); padding-bottom: var(--space-5); }
  .section-heading:has(.segmented) { display: grid; }
  .segmented { width: 100%; }
  .segment { flex: 1; min-height: 40px; }
  .composer-actions { align-items: stretch; flex-direction: column; }
  .composer-actions .button { min-height: 44px; }
  .event-stream { min-height: 360px; }
  .connection-grid { grid-template-columns: 1fr; gap: var(--space-8); }
  .input-row { grid-template-columns: 1fr; }
  .input-row .button { min-height: 44px; }
  .footer { display: none; }
  .mobile-nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: grid; grid-template-columns: repeat(5, 1fr); padding: 6px max(6px, env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(6px, env(safe-area-inset-left)); border-top: 1px solid var(--color-border-subtle); background: color-mix(in srgb, var(--color-bg-surface) 94%, transparent); backdrop-filter: blur(18px); }
  .mobile-nav button { min-width: 0; min-height: 52px; display: grid; place-items: center; gap: 2px; padding: 0 2px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-fg-muted); font-size: 10px; }
  .mobile-nav button svg { width: 19px; height: 19px; }
  .mobile-nav button span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-nav button.is-active { background: var(--color-bg-selected); color: var(--color-fg-primary); }
  .toast { right: var(--space-3); bottom: calc(78px + env(safe-area-inset-bottom)); }
}

@media (max-width: 390px) {
  .content { padding-left: var(--space-3); padding-right: var(--space-3); }
  .page-heading h1 { font-size: 25px; }
  .page-actions { display: grid; grid-template-columns: 1fr; }
  .runtime-stat strong { font-size: 15px; }
  .topbar-actions { gap: var(--space-1); }
  .icon-button { width: 34px; min-height: 34px; }
  .request-row { grid-template-columns: 52px minmax(0, 1fr); }
  .request-result { grid-column: 2; text-align: left; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
`;
