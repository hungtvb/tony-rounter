export const UI_CSS_PART_2 = String.raw`.eyebrow { display: block; margin-bottom: 7px; color: #9c83ff; font: 750 9px ui-monospace, monospace; letter-spacing: 0.14em; }

.button { min-height: 36px; padding: 0 13px; border: 1px solid transparent; border-radius: 8px; font-size: 11px; font-weight: 750; transition: 0.16s ease; }
.button:disabled { opacity: 0.48; cursor: not-allowed; }
.button-primary { color: white; background: linear-gradient(145deg, #8051ff, #6531e8); box-shadow: 0 10px 28px rgba(124, 77, 255, 0.16); }
.button-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 13px 30px rgba(124, 77, 255, 0.25); }
.button-secondary { color: #dfe4ec; border-color: var(--border); background: rgba(255, 255, 255, 0.025); }
.button-secondary:hover:not(:disabled), .button-ghost:hover:not(:disabled) { border-color: var(--border-strong); background: var(--surface-2); color: white; }
.button-ghost { color: var(--muted); border-color: var(--border); background: transparent; }
.button-full { width: 100%; }
.icon-button { width: 36px; height: 36px; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: rgba(255, 255, 255, 0.025); color: white; font-size: 17px; }
.icon-button:hover { background: var(--surface-2); }
.text-button { padding: 0; border: 0; background: none; color: var(--muted); font-size: 10px; }
.text-button:hover { color: white; }
.connection-pill, .count-badge, .health-badge { display: inline-flex; align-items: center; gap: 7px; min-height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 10px; white-space: nowrap; }
.connection-pill { color: var(--muted); background: var(--surface); }
.connection-pill span { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
.connection-pill.is-online { color: #92eca8; border-color: rgba(64, 213, 107, 0.16); background: rgba(64, 213, 107, 0.07); }
.connection-pill.is-online span { background: var(--green); }
.connection-pill.is-error { color: #ff9cac; }
.connection-pill.is-error span { background: var(--danger); }
.count-badge { color: var(--muted); background: rgba(255, 255, 255, 0.025); }
.health-badge { min-height: 24px; padding: 0 8px; color: #85e69c; border-color: rgba(64, 213, 107, 0.12); background: rgba(64, 213, 107, 0.08); }
.health-badge.is-muted { color: var(--muted); border-color: var(--border); background: rgba(255, 255, 255, 0.02); }
.health-badge.is-error { color: #ff98a9; border-color: rgba(255, 111, 133, 0.14); background: rgba(255, 111, 133, 0.07); }

.metric-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.metric-card, .panel { border: 1px solid var(--border); background: linear-gradient(145deg, rgba(18, 24, 34, 0.96), rgba(13, 18, 26, 0.96)); box-shadow: var(--shadow); }
.metric-card { min-height: 132px; padding: 16px; border-radius: 11px; display: flex; flex-direction: column; }
.metric-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #c6ccd6; font-size: 10px; }
.metric-icon { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 9px; font: 800 16px ui-monospace, monospace; }
.metric-icon.is-green { color: var(--green); background: var(--green-soft); }
.metric-icon.is-blue { color: var(--blue); background: rgba(76, 134, 255, 0.1); }
.metric-icon.is-purple { color: #9874ff; background: var(--purple-soft); }
.metric-icon.is-cyan { color: var(--cyan); background: rgba(36, 199, 199, 0.1); }
.metric-value { margin-top: auto; font-size: 23px; letter-spacing: -0.04em; }
.metric-value.is-green { color: var(--green); }
.metric-card small { margin-top: 6px; color: var(--muted); font-size: 9px; }

.dashboard-grid { margin-top: 14px; display: grid; grid-template-columns: minmax(260px, 0.85fr) minmax(340px, 1.15fr) minmax(290px, 0.9fr); gap: 12px; align-items: stretch; }
.panel { border-radius: 11px; overflow: hidden; }
.panel-head { min-height: 55px; padding: 12px 15px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border); }
.panel-head h3 { font-size: 13px; letter-spacing: -0.02em; }
.provider-body { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 16px; }
.provider-logo { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 11px; color: white; background: linear-gradient(145deg, #2f8c65, #17573e); font: 850 13px ui-monospace, monospace; }
.provider-copy { min-width: 0; }
.provider-copy strong, .provider-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-copy strong { font-size: 12px; }
.provider-copy small { margin-top: 4px; color: var(--muted); font-size: 9px; }
.provider-facts { margin: 0; padding: 0 16px 16px; display: grid; gap: 8px; }
.provider-facts div { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
`;
