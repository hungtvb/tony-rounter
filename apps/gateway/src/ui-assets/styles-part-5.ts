export const UI_CSS_PART_5 = String.raw`  .brand { justify-content: center; padding-left: 0; padding-right: 0; }
  .brand-copy, .nav-item > span:last-child, .sidebar-runtime, #disconnectButton { display: none; }
  .nav-item { justify-content: center; padding: 0; }
  .nav-icon { width: auto; }
  .playground-grid, .connection-grid { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .app-shell { display: block; }
  .sidebar { position: sticky; height: auto; top: 0; flex-direction: row; align-items: center; gap: 8px; padding: 9px 12px; border-right: 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .brand { padding: 0; }
  .brand-mark { width: 34px; height: 34px; }
  .nav { display: flex; gap: 5px; }
  .nav-item { min-width: 38px; min-height: 36px; }
  .topbar { position: static; padding: 16px; align-items: flex-start; }
  .topbar-actions > .button { display: none; }
  .content { padding: 16px 14px 38px; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard-grid { grid-template-columns: 1fr; }
  .quick-panel { grid-column: auto; }
  .view-heading { display: block; }
  .view-heading > .count-badge, .view-heading > .connection-pill { margin-top: 12px; }
  .model-row { grid-template-columns: minmax(0, 1fr) 70px; }
  .model-owner { display: none; }
  .trace-header { display: none; }
  .trace-row { grid-template-columns: minmax(0, 1fr) 65px 70px; }
  .trace-path { grid-column: 1 / -1; grid-row: 2; }
  .trace-time { display: none; }
  .footer { padding: 0 14px; }
}
@media (max-width: 480px) {
  .topbar { display: block; }
  .topbar-actions { margin-top: 13px; }
  .metric-grid { grid-template-columns: 1fr; }
  .toolbar, .composer-actions, .input-row { align-items: stretch; flex-direction: column; }
  .toolbar .button, .composer-actions .button, .input-row .button { width: 100%; }
  .footer { display: grid; justify-content: start; padding-top: 10px; padding-bottom: 10px; }
}`;
