/** Simple web UI for positions management. Served at GET /admin */
export function adminHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ETF 反弹监控 · 持仓管理</title>
  <style>
    :root {
      --bg: #0f1419; --card: #1a2332; --border: #2d3a4f;
      --text: #e7ecf3; --muted: #8b9bb4; --accent: #3b82f6;
      --ok: #22c55e; --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.5;
      min-height: 100vh; padding: 1.25rem;
    }
    h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
    .sub { color: var(--muted); font-size: 0.875rem; margin-bottom: 1.25rem; }
    .card {
      background: var(--card); border: 1px solid var(--border); border-radius: 12px;
      padding: 1rem 1.15rem; margin-bottom: 1rem;
    }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 0.25rem; }
    input, button {
      font: inherit; border-radius: 8px; border: 1px solid var(--border);
      background: #0c1118; color: var(--text); padding: 0.5rem 0.65rem; width: 100%;
    }
    button {
      background: var(--accent); border: none; cursor: pointer; font-weight: 600;
      padding: 0.55rem 1rem; width: auto;
    }
    button.secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
    button.danger { background: var(--danger); }
    .row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
    .row > div { flex: 1 1 120px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 0.5rem 0.4rem; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; }
    .badge {
      display: inline-block; padding: 0.15rem 0.45rem; border-radius: 999px;
      font-size: 0.75rem; font-weight: 600;
    }
    .badge.open { background: rgba(34,197,94,.15); color: var(--ok); }
    .badge.closed { background: rgba(139,155,180,.15); color: var(--muted); }
    .msg { font-size: 0.875rem; margin-top: 0.5rem; }
    .msg.err { color: var(--danger); }
    .msg.ok { color: var(--ok); }
    .auth-bar { display: flex; gap: 0.5rem; align-items: flex-end; flex-wrap: wrap; }
    .auth-bar > div { flex: 1 1 200px; }
    .muted { color: var(--muted); font-size: 0.8rem; }
    .actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  </style>
</head>
<body>
  <h1>A股 ETF / 场外基金 · 持仓管理</h1>
  <p class="sub">仅管理提醒用持仓记录，不自动下单。Token 使用 Cloudflare 中的 BARK_DEVICE_KEY。</p>

  <div class="card">
    <div class="auth-bar">
      <div>
        <label>Bearer Token（BARK_DEVICE_KEY）</label>
        <input id="token" type="password" placeholder="粘贴设备 key" autocomplete="off" />
      </div>
      <button type="button" id="btnSaveToken">保存并刷新</button>
      <button type="button" class="secondary" id="btnClearToken">清除</button>
    </div>
    <p class="muted" id="authStatus">未保存 token</p>
  </div>

  <div class="card">
    <h2 style="font-size:1rem;margin:0 0 0.75rem">当前持仓</h2>
    <div class="row" style="margin-bottom:0.75rem">
      <button type="button" id="btnRefresh">刷新列表</button>
      <button type="button" class="secondary" id="btnRun">手动扫描 /run</button>
      <span class="muted" id="listMeta"></span>
    </div>
    <div id="listMsg" class="msg"></div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>代码</th><th>状态</th><th>入场日</th><th>入场价</th>
            <th>止损</th><th>目标1/2</th><th>数量</th><th>剩余</th><th>持有天数</th><th>操作</th>
          </tr>
        </thead>
        <tbody id="posBody">
          <tr><td colspan="10" class="muted">加载中…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <h2 style="font-size:1rem;margin:0 0 0.75rem">登记持仓</h2>
    <form id="addForm">
      <div class="row">
        <div>
          <label>代码 symbol</label>
          <input name="symbol" list="watchSymbols" required placeholder="510300" />
          <datalist id="watchSymbols"></datalist>
        </div>
        <div>
          <label>入场日期</label>
          <input name="entry_date" type="date" required />
        </div>
        <div>
          <label>入场价 / 净值</label>
          <input name="entry_price" type="number" step="any" min="0" required />
        </div>
        <div>
          <label>数量（份）</label>
          <input name="quantity" type="number" step="1" min="1" required />
        </div>
      </div>
      <div style="margin-top:0.75rem" class="row">
        <button type="submit">提交登记</button>
      </div>
      <div id="addMsg" class="msg"></div>
    </form>
  </div>

  <div class="card">
    <h2 style="font-size:1rem;margin:0 0 0.5rem">监控列表</h2>
    <p class="muted" id="watchMeta">—</p>
    <pre id="watchList" class="muted" style="white-space:pre-wrap;font-size:0.8rem;margin:0"></pre>
  </div>

  <script>
    const KEY = "etf_admin_token";
    const $ = (id) => document.getElementById(id);
    const tokenInput = $("token");
    const authStatus = $("authStatus");

    function getToken() { return localStorage.getItem(KEY) || ""; }
    function setToken(t) {
      if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY);
      tokenInput.value = t || "";
      authStatus.textContent = t ? "已保存（仅存本机浏览器）" : "未保存 token";
    }
    setToken(getToken());

    async function api(path, opts = {}) {
      const t = getToken();
      if (!t) throw new Error("请先填写并保存 Token");
      const headers = Object.assign({ "Authorization": "Bearer " + t }, opts.headers || {});
      const res = await fetch(path, Object.assign({}, opts, { headers }));
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || text || res.statusText;
        throw new Error(msg);
      }
      return data;
    }

    function fmt(n, d = 3) {
      if (n == null || !Number.isFinite(Number(n))) return "—";
      return Number(n).toFixed(d);
    }

    async function loadWatch() {
      try {
        const data = await api("/api/watchlist");
        const list = data.watchlist || [];
        $("watchMeta").textContent = "共 " + list.length + " 只（含场内 ETF 与场外基金）";
        $("watchList").textContent = list.map(x => x.symbol + "  " + x.name + "  (" + x.secid + ")").join("\\n");
        const dl = $("watchSymbols");
        dl.innerHTML = list.map(x => '<option value="' + x.symbol + '">' + x.name + '</option>').join("");
      } catch (e) {
        $("watchMeta").textContent = String(e.message || e);
      }
    }

    async function loadPositions() {
      const msg = $("listMsg");
      msg.textContent = "";
      msg.className = "msg";
      try {
        const data = await api("/api/positions");
        const rows = data.positions || [];
        $("listMeta").textContent = "共 " + rows.length + " 条";
        const body = $("posBody");
        if (!rows.length) {
          body.innerHTML = '<tr><td colspan="10" class="muted">暂无持仓记录</td></tr>';
          return;
        }
        body.innerHTML = rows.map(p => {
          const st = p.status === "open" ? "open" : "closed";
          const closeBtn = p.status === "open"
            ? '<button type="button" class="danger btn-close" data-symbol="' + p.symbol + '">平仓</button>'
            : "";
          return '<tr>' +
            '<td>' + p.symbol + '</td>' +
            '<td><span class="badge ' + st + '">' + p.status + '</span></td>' +
            '<td>' + (p.entry_date || "") + '</td>' +
            '<td>' + fmt(p.entry_price) + '</td>' +
            '<td>' + fmt(p.stop_price) + '</td>' +
            '<td>' + fmt(p.target1) + ' / ' + fmt(p.target2) + '</td>' +
            '<td>' + p.quantity + '</td>' +
            '<td>' + (p.remaining_fraction != null ? (Number(p.remaining_fraction) * 100).toFixed(0) + "%" : "—") + '</td>' +
            '<td>' + (p.bars_held ?? "—") + '</td>' +
            '<td class="actions">' + closeBtn + '</td>' +
            '</tr>';
        }).join("");
        body.querySelectorAll(".btn-close").forEach(btn => {
          btn.addEventListener("click", async () => {
            if (!confirm("确认将 " + btn.dataset.symbol + " 标记为已平仓？")) return;
            try {
              await api("/api/positions/" + encodeURIComponent(btn.dataset.symbol) + "/close", { method: "POST" });
              msg.textContent = "已平仓 " + btn.dataset.symbol;
              msg.className = "msg ok";
              loadPositions();
            } catch (e) {
              msg.textContent = String(e.message || e);
              msg.className = "msg err";
            }
          });
        });
      } catch (e) {
        msg.textContent = String(e.message || e);
        msg.className = "msg err";
        $("posBody").innerHTML = '<tr><td colspan="10" class="muted">加载失败</td></tr>';
      }
    }

    $("btnSaveToken").onclick = () => {
      setToken(tokenInput.value.trim());
      loadWatch();
      loadPositions();
    };
    $("btnClearToken").onclick = () => { setToken(""); };
    $("btnRefresh").onclick = () => { loadPositions(); loadWatch(); };
    $("btnRun").onclick = async () => {
      const msg = $("listMsg");
      msg.textContent = "扫描中…";
      msg.className = "msg";
      try {
        const data = await api("/run", { method: "POST" });
        msg.textContent = "扫描完成 scanned=" + data.scanned + " alerts=" + data.alerts +
          (data.errors && data.errors.length ? " errors: " + data.errors.join("; ") : "");
        msg.className = data.errors && data.errors.length ? "msg err" : "msg ok";
        loadPositions();
      } catch (e) {
        msg.textContent = String(e.message || e);
        msg.className = "msg err";
      }
    };

    $("addForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const payload = {
        symbol: String(fd.get("symbol") || "").trim(),
        entry_date: String(fd.get("entry_date") || "").trim(),
        entry_price: Number(fd.get("entry_price")),
        quantity: Number(fd.get("quantity"))
      };
      const msg = $("addMsg");
      msg.textContent = "提交中…";
      msg.className = "msg";
      try {
        const data = await api("/positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        msg.textContent = "已登记 " + data.symbol + " 止损 " + fmt(data.stop) +
          " 目标 " + fmt(data.target1) + " / " + fmt(data.target2);
        msg.className = "msg ok";
        ev.target.reset();
        loadPositions();
      } catch (e) {
        msg.textContent = String(e.message || e);
        msg.className = "msg err";
      }
    };

    const d = new Date();
    $("addForm").entry_date.value = d.toISOString().slice(0, 10);
    if (getToken()) { loadWatch(); loadPositions(); }
  </script>
</body>
</html>`;
}
