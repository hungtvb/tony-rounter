export const UI_CSS_PART_4 = String.raw`.composer-panel > label, .connection-panel > label { display: block; margin: 0 0 8px; color: #bfc7d2; font-size: 9px; font-weight: 750; text-transform: uppercase; letter-spacing: 0.08em; }
.field-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; color: #bfc7d2; font-size: 9px; font-weight: 750; text-transform: uppercase; letter-spacing: 0.08em; }
.field-row output { color: #a98eff; font: 10px ui-monospace, monospace; }
.composer-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 13px; }
.composer-actions small { color: var(--muted); font-size: 9px; }
.response-panel { min-height: 522px; display: flex; flex-direction: column; }
.response-head { min-height: 55px; padding: 0 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); }
.response-head > div { display: flex; align-items: center; gap: 9px; }
.response-head strong { font-size: 11px; }
.response-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted-2); }
.response-dot.is-running { background: var(--warning); animation: pulse 1s infinite; }
.response-dot.is-success { background: var(--green); }
.response-dot.is-error { background: var(--danger); }
@keyframes pulse { 50% { opacity: 0.35; } }
.response-panel pre { flex: 1; min-height: 390px; margin: 0; padding: 18px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: #dce3ed; font: 11px/1.72 ui-monospace, SFMono-Regular, Menlo, monospace; }
.response-foot { min-height: 42px; padding: 0 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--border); color: var(--muted); font: 9px ui-monospace, monospace; }

.trace-header, .trace-row { display: grid; grid-template-columns: minmax(120px, 0.8fr) minmax(220px, 1.6fr) 80px 90px 120px; gap: 15px; align-items: center; }
.trace-header { min-height: 42px; padding: 0 15px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; }
.trace-row { min-height: 57px; padding: 8px 15px; border-bottom: 1px solid var(--border); font-size: 9px; }
.trace-row:last-child { border-bottom: 0; }
.trace-request, .trace-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
.trace-status { color: var(--green); font-family: ui-monospace, monospace; }
.trace-status.is-error { color: var(--danger); }
.trace-duration, .trace-time { color: var(--muted); font-family: ui-monospace, monospace; }

.connection-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr); gap: 12px; }
.connection-panel { padding-bottom: 18px; }
.connection-panel > label, .connection-panel > .input-row, .connection-panel > .field-help { margin-left: 17px; margin-right: 17px; }
.input-row { display: flex; gap: 9px; }
.field-help { margin-top: 9px; color: var(--muted); font-size: 9px; line-height: 1.55; }
.security-panel { padding: 20px; }
.security-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; color: #a98eff; background: var(--purple-soft); font-size: 21px; }
.security-panel h3 { margin-top: 6px; font-size: 15px; }
.security-panel p { margin-top: 7px; color: var(--muted); font-size: 10px; line-height: 1.6; }
.security-panel ul { margin: 18px 0 0; padding-left: 17px; color: #c3cad5; font-size: 10px; line-height: 2; }
.empty-state { min-height: 210px; display: grid; place-content: center; padding: 25px; text-align: center; }
.empty-state strong, .empty-state small { display: block; }
.empty-state strong { font-size: 12px; }
.empty-state small { margin-top: 7px; color: var(--muted); font-size: 9px; line-height: 1.5; }
.footer { min-height: 48px; padding: 0 clamp(20px, 3.2vw, 46px); display: flex; align-items: center; justify-content: space-between; gap: 18px; border-top: 1px solid var(--border); color: var(--muted); font-size: 9px; }
.footer > span { display: flex; align-items: center; gap: 7px; }
.footer strong { color: #cbd2dc; font-weight: 650; }
.toast { position: fixed; right: 20px; bottom: 20px; z-index: 50; max-width: min(380px, calc(100vw - 40px)); padding: 11px 14px; border: 1px solid var(--border-strong); border-radius: 9px; background: #171e29; box-shadow: var(--shadow); color: white; font-size: 10px; opacity: 0; transform: translateY(9px); pointer-events: none; transition: 0.18s ease; }
.toast.is-visible { opacity: 1; transform: translateY(0); }

@media (max-width: 1220px) {
  .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dashboard-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .quick-panel { grid-column: 1 / -1; }
}
@media (max-width: 900px) {
  .app-shell { grid-template-columns: 82px minmax(0, 1fr); }
  .sidebar { padding-left: 10px; padding-right: 10px; }
`;
