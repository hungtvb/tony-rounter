export const UI_CSS_PROVIDERS = String.raw`
.provider-view-heading { align-items: center; }
.provider-heading-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.provider-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
.provider-summary-card { min-height: 112px; padding: 15px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 11px; background: linear-gradient(145deg, rgba(18, 24, 34, 0.96), rgba(13, 18, 26, 0.96)); box-shadow: var(--shadow); }
.provider-summary-card span { color: #c6ccd6; font-size: 10px; }
.provider-summary-card strong { margin-top: auto; font-size: 26px; letter-spacing: -0.045em; }
.provider-summary-card small { margin-top: 5px; color: var(--muted); font-size: 9px; }
.providers-layout { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(390px, 0.95fr); gap: 12px; align-items: start; }
.provider-catalog-panel, .setup-panel { min-width: 0; }
.provider-inventory-list { display: grid; gap: 12px; padding: 12px; }
.provider-inventory-list > .empty-state { min-height: 420px; }
.provider-record { overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: rgba(255, 255, 255, 0.018); }
.provider-record-head { min-height: 66px; padding: 12px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--border); }
.provider-record-identity { min-width: 0; display: flex; align-items: center; gap: 11px; }
.provider-record-logo, .account-avatar { flex: 0 0 auto; display: grid; place-items: center; color: #b6a5ff; background: var(--purple-soft); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 850; }
.provider-record-logo { width: 38px; height: 38px; border-radius: 10px; font-size: 10px; }
.account-avatar { width: 30px; height: 30px; border-radius: 8px; font-size: 8px; }
.provider-record-identity > div, .provider-account-identity > div { min-width: 0; }
.provider-record-identity strong, .provider-record-identity small, .provider-account-identity strong, .provider-account-identity small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-record-identity strong, .provider-account-identity strong { font-size: 11px; }
.provider-record-identity small, .provider-account-identity small { margin-top: 4px; color: var(--muted); font-size: 9px; }
.provider-use-button { min-height: 32px; flex: 0 0 auto; }
.provider-record-facts { margin: 0; padding: 11px 12px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; border-bottom: 1px solid var(--border); }
.provider-record-facts div { min-width: 0; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255, 255, 255, 0.018); }
.provider-record-facts dt { color: var(--muted); font-size: 8px; text-transform: uppercase; letter-spacing: 0.07em; }
.provider-record-facts dd { margin: 5px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #dce3ed; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.provider-account-list { display: grid; }
.provider-account-list > .empty-state { min-height: 130px; }
.provider-account-row { min-height: 60px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(150px, auto); gap: 13px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.provider-account-row:last-child { border-bottom: 0; }
.provider-account-identity { min-width: 0; display: flex; align-items: center; gap: 10px; }
.provider-account-facts { display: flex; align-items: center; justify-content: flex-end; gap: 8px; color: var(--muted); font: 8px ui-monospace, SFMono-Regular, Menlo, monospace; }
.provider-account-facts span { padding: 5px 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.025); white-space: nowrap; }
.provider-account-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; }
.account-health-button { min-height: 30px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 8px; }
.account-health-button[data-health-status="healthy"] { border-color: rgba(64, 213, 107, 0.28); color: #92eca8; }
.account-health-button[data-health-status="authentication_failed"], .account-health-button[data-health-status="unavailable"], .account-health-button[data-health-status="invalid_response"] { border-color: rgba(255, 92, 119, 0.28); color: #ff9cac; }
.profile-coverage-block { padding: 12px; border-top: 1px solid var(--border); background: rgba(255, 255, 255, 0.012); }
.profile-coverage-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.profile-coverage-heading span { color: #c6ccd6; font-size: 9px; font-weight: 750; text-transform: uppercase; letter-spacing: 0.07em; }
.profile-coverage-heading small { color: var(--muted); font-size: 8px; }
.profile-coverage-list { display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; }
.profile-chip { min-width: 150px; display: grid; gap: 4px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255, 255, 255, 0.02); }
.profile-chip strong { overflow: hidden; text-overflow: ellipsis; color: #dce3ed; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.profile-chip small, .profile-chip.is-muted { color: var(--muted); font-size: 8px; line-height: 1.45; }
.profile-chip.is-default { border-color: rgba(124, 77, 255, 0.22); background: var(--purple-soft); }
.setup-body { padding: 15px; }
.setup-intro { color: var(--muted); font-size: 10px; line-height: 1.65; }
.setup-field-grid { margin-top: 15px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }
.setup-field-grid label { min-width: 0; display: grid; gap: 7px; }
.setup-field-grid label > span { color: #bfc7d2; font-size: 9px; font-weight: 750; text-transform: uppercase; letter-spacing: 0.07em; }
.setup-field-wide { grid-column: 1 / -1; }
.setup-generate-button { margin-top: 13px; min-height: 42px; }
.setup-action-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 9px; }
.setup-action-row .button { min-height: 38px; }
.setup-validation { min-height: 18px; margin-top: 9px; color: var(--muted); font-size: 9px; line-height: 1.5; }
.setup-validation.is-success { color: #92eca8; }
.setup-validation.is-error { color: #ff9cac; }
.config-output-stack { margin-top: 14px; display: grid; gap: 10px; }
.config-output-card { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 9px; background: #0a0e14; }
.config-output-card > div { min-height: 40px; padding: 0 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); }
.config-output-card strong { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.config-output-card pre { max-height: 300px; margin: 0; padding: 12px; overflow: auto; white-space: pre; color: #dce3ed; font: 9px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; }
.config-output-card pre:focus-visible { outline: 2px solid rgba(124, 77, 255, 0.8); outline-offset: -2px; }
.setup-next-step { margin-top: 13px; display: flex; align-items: flex-start; gap: 9px; padding: 11px; border: 1px solid rgba(64, 213, 107, 0.12); border-radius: 9px; background: rgba(64, 213, 107, 0.05); }
.setup-next-step .tiny-dot { margin-top: 4px; background: var(--green); }
.setup-next-step p { color: #b9c4d2; font-size: 9px; line-height: 1.6; }
.setup-next-step code { color: #a98eff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-history { margin-top: 14px; overflow: hidden; border: 1px solid var(--border); border-radius: 9px; background: rgba(255, 255, 255, 0.012); }
.control-history-head { min-height: 54px; padding: 10px 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); }
.control-history-head h4 { margin-top: 3px; font-size: 11px; }
.control-history > p { padding: 10px 11px; color: var(--muted); font-size: 9px; line-height: 1.55; border-bottom: 1px solid var(--border); }
.control-history > p code { color: #a98eff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.generation-list { display: grid; }
.generation-list > .empty-state { min-height: 120px; }
.generation-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 9px; align-items: center; padding: 10px 11px; border-bottom: 1px solid var(--border); }
.generation-row:last-child { border-bottom: 0; }
.generation-row.is-active { background: rgba(64, 213, 107, 0.035); }
.generation-row > div { min-width: 0; }
.generation-row strong, .generation-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.generation-row strong { font-size: 9px; }
.generation-row small { margin-top: 4px; color: var(--muted); font: 8px ui-monospace, SFMono-Regular, Menlo, monospace; }
.generation-rollback-button { min-height: 30px; font-size: 8px; }

@media (max-width: 1220px) {
  .providers-layout { grid-template-columns: 1fr; }
  .provider-inventory-list > .empty-state { min-height: 240px; }
}
@media (max-width: 900px) {
  .provider-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .provider-view-heading { display: block; }
  .provider-heading-actions { justify-content: flex-start; margin-top: 12px; }
  .provider-record-head { align-items: flex-start; }
  .provider-record-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .provider-account-row { grid-template-columns: minmax(0, 1fr) auto; }
  .provider-account-actions { align-items: flex-end; flex-direction: column; }
  .provider-account-facts { grid-column: 1 / -1; justify-content: flex-start; padding-left: 40px; }
}
@media (max-width: 480px) {
  .provider-summary-grid, .setup-field-grid, .setup-action-row { grid-template-columns: 1fr; }
  .profile-chip { width: 100%; }
  .setup-field-wide { grid-column: auto; }
  .provider-record-head { display: grid; }
  .provider-use-button { width: 100%; }
  .provider-account-row { grid-template-columns: 1fr; }
  .provider-account-actions { align-items: flex-start; }
  .generation-row { grid-template-columns: 1fr; }
  .generation-row > .health-badge, .generation-rollback-button { justify-self: start; }
  .provider-account-facts { grid-column: auto; padding-left: 0; justify-content: flex-start; flex-wrap: wrap; }
}
`;
