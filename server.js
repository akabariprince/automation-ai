const http = require("http");
const os = require("os");

const PORT = process.env.PORT || 3000;
const START_TIME = Date.now();

/* ---------- Helpers ---------- */
function formatMB(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

function getHealth() {
  return {
    status: "OK",
    timestamp: new Date().toISOString(),

    server: {
      uptime_seconds: process.uptime().toFixed(2),
      node_version: process.version,
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      execPath: process.execPath
    },

    memory: {
      rss_mb: formatMB(process.memoryUsage().rss),
      heap_total_mb: formatMB(process.memoryUsage().heapTotal),
      heap_used_mb: formatMB(process.memoryUsage().heapUsed),
      external_mb: formatMB(process.memoryUsage().external)
    },

    system: {
      hostname: os.hostname(),
      os_type: os.type(),
      os_release: os.release(),
      cpu_model: os.cpus()[0].model,
      cpu_cores: os.cpus().length,
      total_memory_mb: formatMB(os.totalmem()),
      free_memory_mb: formatMB(os.freemem()),
      load_average: os.loadavg()
    },

    process: {
      uptime_seconds: process.uptime().toFixed(2),
      start_time: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      env: process.env.NODE_ENV || "development"
    }
  };
}

/* ---------- HTML Renderer ---------- */
function renderHTML(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Node.js Server Health</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: #0f172a;
    color: #e5e7eb;
  }
  header {
    padding: 20px;
    background: #020617;
    border-bottom: 1px solid #1e293b;
  }
  h1 { margin: 0; font-size: 22px; }
  .status {
    color: #22c55e;
    font-weight: bold;
  }
  main {
    padding: 20px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
  }
  .card {
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 16px;
  }
  .card h2 {
    margin-top: 0;
    font-size: 16px;
    color: #38bdf8;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 6px 0;
    font-size: 14px;
  }
  td.key {
    color: #94a3b8;
  }
  footer {
    text-align: center;
    padding: 12px;
    color: #64748b;
    font-size: 13px;
  }
</style>
</head>
<body>

<header>
  <h1>🚀 Node.js Server Health Dashboard</h1>
  <div>Status: <span class="status">${data.status}</span></div>
  <div>Updated: ${data.timestamp}</div>
</header>

<main>

  <div class="card">
    <h2>🧠 Server</h2>
    <table>
      <tr><td class="key">Node Version</td><td>${data.server.node_version}</td></tr>
      <tr><td class="key">PID</td><td>${data.server.pid}</td></tr>
      <tr><td class="key">Platform</td><td>${data.server.platform}</td></tr>
      <tr><td class="key">Arch</td><td>${data.server.arch}</td></tr>
      <tr><td class="key">Uptime (s)</td><td>${data.server.uptime_seconds}</td></tr>
    </table>
  </div>

  <div class="card">
    <h2>💾 Memory</h2>
    <table>
      <tr><td class="key">RSS</td><td>${data.memory.rss_mb} MB</td></tr>
      <tr><td class="key">Heap Used</td><td>${data.memory.heap_used_mb} MB</td></tr>
      <tr><td class="key">Heap Total</td><td>${data.memory.heap_total_mb} MB</td></tr>
      <tr><td class="key">External</td><td>${data.memory.external_mb} MB</td></tr>
    </table>
  </div>

  <div class="card">
    <h2>🖥 System</h2>
    <table>
      <tr><td class="key">Hostname</td><td>${data.system.hostname}</td></tr>
      <tr><td class="key">OS</td><td>${data.system.os_type} ${data.system.os_release}</td></tr>
      <tr><td class="key">CPU</td><td>${data.system.cpu_model}</td></tr>
      <tr><td class="key">Cores</td><td>${data.system.cpu_cores}</td></tr>
      <tr><td class="key">Load Avg</td><td>${data.system.load_average.join(", ")}</td></tr>
    </table>
  </div>

  <div class="card">
    <h2>⚙️ Process</h2>
    <table>
      <tr><td class="key">Env</td><td>${data.process.env}</td></tr>
      <tr><td class="key">Start Time</td><td>${data.process.start_time}</td></tr>
      <tr><td class="key">Uptime (s)</td><td>${data.process.uptime_seconds}</td></tr>
    </table>
  </div>

</main>

<footer>
  Auto-refresh every 30s | Node.js Health UI
</footer>

<script>
  setTimeout(() => location.reload(), 30000);
</script>

</body>
</html>`;
}

/* ---------- Server ---------- */
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    const health = getHealth();
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(renderHTML(health));
  }

  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(getHealth(), null, 2));
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

/* ---------- Start ---------- */
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
