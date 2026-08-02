export const UI_CSS_PART_3 = String.raw`.provider-facts dt { color: var(--muted); font-size: 9px; }
.provider-facts dd { margin: 0; font: 10px ui-monospace, monospace; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-foot { min-height: 42px; padding: 0 16px; display: flex; align-items: center; gap: 9px; border-top: 1px solid var(--border); color: var(--muted); font-size: 9px; }
.tiny-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted-2); }
.tiny-dot.is-online { background: var(--green); }

.request-list { min-height: 294px; }
.request-row { min-height: 59px; display: grid; grid-template-columns: 50px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 15px; border-bottom: 1px solid var(--border); }
.request-row:last-child { border-bottom: 0; }
.method-badge { justify-self: start; padding: 4px 7px; border-radius: 6px; color: #7feca0; background: rgba(64, 213, 107, 0.09); font: 750 8px ui-monospace, monospace; }
.method-badge.is-get { color: #86afff; background: rgba(76, 134, 255, 0.09); }
.request-path { min-width: 0; }
.request-path strong, .request-path small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-path strong { font: 10px ui-monospace, monospace; }
.request-path small { margin-top: 4px; color: var(--muted); font-size: 8px; }
.request-result { text-align: right; }
.request-result strong, .request-result small { display: block; }
.request-result strong { color: var(--green); font: 10px ui-monospace, monospace; }
.request-result strong.is-error { color: var(--danger); }
.request-result small { margin-top: 4px; color: var(--muted); font-size: 8px; }

.quick-panel { display: flex; flex-direction: column; }
.quick-copy { flex: 1; display: grid; place-items: center; align-content: center; padding: 22px 20px; text-align: center; }
.quick-copy h4 { margin-top: 16px; font-size: 14px; }
.quick-copy p { max-width: 330px; margin-top: 8px; color: var(--muted); font-size: 10px; line-height: 1.6; }
.quick-panel > .button { width: calc(100% - 30px); margin: 0 15px 15px; }
.quick-orbit { position: relative; width: 72px; height: 72px; display: grid; place-items: center; }
.quick-orbit strong { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 13px; background: linear-gradient(145deg, #8051ff, #5a2bcc); box-shadow: 0 15px 36px rgba(124, 77, 255, 0.24); font: 850 12px ui-monospace, monospace; }
.quick-orbit span { position: absolute; border: 1px solid rgba(124, 77, 255, 0.25); border-radius: 50%; }
.quick-orbit span:nth-child(1) { inset: 0; }
.quick-orbit span:nth-child(2) { inset: 8px; transform: rotate(45deg); border-style: dashed; }
.quick-orbit span:nth-child(3) { width: 7px; height: 7px; top: 5px; right: 13px; border: 0; background: var(--green); box-shadow: 0 0 13px var(--green); }

.toolbar { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 13px; border-bottom: 1px solid var(--border); }
.search-field { position: relative; width: min(420px, 100%); }
.search-field span { position: absolute; left: 12px; top: 9px; color: var(--muted); }
input, textarea, select { width: 100%; color: var(--text); border: 1px solid var(--border-strong); background: #0a0e14; transition: 0.16s ease; }
input { height: 38px; padding: 0 12px; border-radius: 8px; }
.search-field input { padding-left: 34px; }
textarea { min-height: 240px; resize: vertical; padding: 13px; border-radius: 9px; line-height: 1.6; }
select { height: 40px; padding: 0 11px; border-radius: 8px; }
input:focus, textarea:focus, select:focus { border-color: rgba(124, 77, 255, 0.62); box-shadow: 0 0 0 3px rgba(124, 77, 255, 0.08); outline: none; }
input[type="range"] { height: 4px; padding: 0; margin: 4px 0 20px; border: 0; accent-color: var(--purple); }
.model-list { min-height: 300px; }
.model-row { min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(130px, 0.4fr) 90px; gap: 15px; align-items: center; padding: 10px 15px; border-bottom: 1px solid var(--border); }
.model-row:last-child { border-bottom: 0; }
.model-name { min-width: 0; display: flex; align-items: center; gap: 11px; }
.model-avatar { width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 9px; color: #b6a5ff; background: var(--purple-soft); font: 850 10px ui-monospace, monospace; }
.model-name strong, .model-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-name strong { font-size: 11px; }
.model-name small, .model-owner { margin-top: 4px; color: var(--muted); font-size: 9px; }
.model-state { justify-self: end; color: var(--green); font: 750 8px ui-monospace, monospace; letter-spacing: 0.08em; }

.playground-grid { display: grid; grid-template-columns: minmax(320px, 0.72fr) minmax(0, 1.28fr); gap: 12px; }
.composer-panel { padding: 17px; }
`;
