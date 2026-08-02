export const UI_CSS_PART_1 = String.raw`:root {
  --bg: #090b10;
  --sidebar: #0c1017;
  --surface: #10161f;
  --surface-2: #151c27;
  --surface-3: #1b2431;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --text: #f4f7fb;
  --muted: #8c98aa;
  --muted-2: #5d697b;
  --purple: #7c4dff;
  --purple-soft: rgba(124, 77, 255, 0.14);
  --green: #40d56b;
  --green-soft: rgba(64, 213, 107, 0.12);
  --blue: #4c86ff;
  --cyan: #24c7c7;
  --danger: #ff6f85;
  --warning: #f1c15f;
  --shadow: 0 22px 70px rgba(0, 0, 0, 0.32);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html { min-width: 320px; background: var(--bg); }
body { min-height: 100vh; margin: 0; color: var(--text); background: radial-gradient(circle at 78% -12%, rgba(88, 58, 171, 0.14), transparent 32%), var(--bg); }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }
h1, h2, h3, h4, p { margin: 0; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid rgba(124, 77, 255, 0.8); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

.app-shell { min-height: 100vh; display: grid; grid-template-columns: 238px minmax(0, 1fr); }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 20px; padding: 20px 15px 16px; border-right: 1px solid var(--border); background: rgba(10, 14, 20, 0.93); backdrop-filter: blur(20px); z-index: 10; }
.brand { display: flex; align-items: center; gap: 12px; padding: 4px 7px 18px; }
.brand-mark { width: 38px; height: 38px; border-radius: 9px; display: grid; place-items: center; font-size: 22px; font-weight: 900; color: white; background: linear-gradient(145deg, #8c5cff, #5423c9); box-shadow: 0 10px 30px rgba(124, 77, 255, 0.24); }
.brand-copy strong, .brand-copy small { display: block; }
.brand-copy strong { font-size: 15px; letter-spacing: -0.02em; }
.brand-copy small { margin-top: 3px; color: var(--muted); font-size: 10px; }
.nav { display: grid; gap: 5px; }
.nav-item { width: 100%; min-height: 42px; display: flex; align-items: center; gap: 12px; padding: 0 12px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: #c3cad5; text-align: left; font-size: 12px; transition: 0.16s ease; }
.nav-item:hover { background: rgba(255, 255, 255, 0.04); color: white; }
.nav-item.is-active { color: white; border-color: rgba(124, 77, 255, 0.16); background: linear-gradient(90deg, rgba(124, 77, 255, 0.22), rgba(124, 77, 255, 0.1)); }
.nav-icon { width: 18px; color: var(--muted); font: 700 15px ui-monospace, monospace; text-align: center; }
.nav-item.is-active .nav-icon { color: #a98eff; }
.sidebar-runtime { margin-top: auto; padding: 13px 12px 12px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255, 255, 255, 0.02); }
.runtime-heading { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 750; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
.status-dot.is-online { background: var(--green); box-shadow: 0 0 0 4px rgba(64, 213, 107, 0.08); }
.status-dot.is-error { background: var(--danger); }
.sidebar-runtime dl { margin: 12px 0; display: grid; gap: 8px; }
.sidebar-runtime dl div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.sidebar-runtime dt { color: var(--muted); font-size: 10px; }
.sidebar-runtime dd { margin: 0; font: 10px ui-monospace, monospace; }

.workspace { min-width: 0; display: flex; flex-direction: column; min-height: 100vh; }
.topbar { min-height: 84px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px clamp(20px, 3.2vw, 46px); border-bottom: 1px solid var(--border); background: rgba(9, 12, 17, 0.72); backdrop-filter: blur(18px); position: sticky; top: 0; z-index: 8; }
.topbar h1 { font-size: 21px; letter-spacing: -0.035em; }
.topbar p { margin-top: 4px; color: var(--muted); font-size: 11px; }
.topbar-actions { display: flex; align-items: center; gap: 9px; }
.content { flex: 1; width: 100%; max-width: 1660px; margin: 0 auto; padding: 22px clamp(20px, 3.2vw, 46px) 50px; }
.view { display: none; animation: view-in 0.2s ease; }
.view.is-active { display: block; }
@keyframes view-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
.view-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
.view-heading h2 { font-size: 24px; letter-spacing: -0.035em; }
.view-heading p { max-width: 650px; margin-top: 7px; color: var(--muted); font-size: 11px; line-height: 1.6; }
`;
