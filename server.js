const http = require("http");
const os = require("os");
const { execSync } = require("child_process");
const v8 = require("v8");

const PORT = process.env.PORT || 3000;
const START_TIME = Date.now();
const START_DATE = new Date().toISOString();

/* ================= METRICS STATE ================= */
let lastCpu = os.cpus();
let requestCount = 0;
let totalResponseTime = 0;
let lastRequestTime = null;
let minResponseTime = Infinity;
let maxResponseTime = 0;
let errorCount = 0;
let requestHistory = [];
let activeConnections = 0;
let totalBytesReceived = 0;
let totalBytesSent = 0;
let statusCodeCounts = {};
let requestsPerEndpoint = {};
let lastMinuteRequests = [];
let lastHourRequests = [];

/* ================= HELPERS ================= */
const mb = b => (b / 1024 / 1024).toFixed(2);
const kb = b => (b / 1024).toFixed(2);
const gb = b => (b / 1024 / 1024 / 1024).toFixed(2);
const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) : 0;

function formatDuration(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return gb(bytes) + " GB";
  if (bytes >= 1048576) return mb(bytes) + " MB";
  if (bytes >= 1024) return kb(bytes) + " KB";
  return bytes + " B";
}

function cpuUsage() {
  const cpus = os.cpus();
  let idle = 0, total = 0;

  cpus.forEach((c, i) => {
    const prev = lastCpu[i]?.times || c.times;
    const curr = c.times;

    const idleDiff = curr.idle - prev.idle;
    const totalDiff =
      curr.user + curr.sys + curr.idle + curr.nice + curr.irq -
      (prev.user + prev.sys + prev.idle + prev.nice + prev.irq);

    idle += idleDiff;
    total += totalDiff;
  });

  lastCpu = cpus;
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
}

function diskUsage() {
  try {
    const out = execSync("df -k / 2>/dev/null || echo '0 0 0 0 0%'")
      .toString().split("\n")[1].split(/\s+/);
    return {
      total: parseInt(out[1]) * 1024,
      used: parseInt(out[2]) * 1024,
      free: parseInt(out[3]) * 1024,
      percent: parseInt(out[4].replace("%", "")) || 0
    };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (!addr.internal) {
        result.push({
          interface: name,
          address: addr.address,
          family: addr.family,
          mac: addr.mac
        });
      }
    }
  }
  return result;
}

function getCPUDetails() {
  const cpus = os.cpus();
  return {
    model: cpus[0]?.model || "Unknown",
    speed: cpus[0]?.speed || 0,
    cores: cpus.length,
    physicalCores: cpus.length / 2 || cpus.length
  };
}

function getLoadAverages() {
  const load = os.loadavg();
  return {
    "1min": load[0].toFixed(2),
    "5min": load[1].toFixed(2),
    "15min": load[2].toFixed(2)
  };
}

function getHealthStatus(cpu, memPct, diskPct) {
  if (cpu > 90 || memPct > 90 || diskPct > 95) return { status: "CRITICAL", color: "#ef4444" };
  if (cpu > 70 || memPct > 70 || diskPct > 80) return { status: "WARNING", color: "#f59e0b" };
  return { status: "HEALTHY", color: "#22c55e" };
}

function cleanupOldRequests() {
  const now = Date.now();
  lastMinuteRequests = lastMinuteRequests.filter(t => now - t < 60000);
  lastHourRequests = lastHourRequests.filter(t => now - t < 3600000);
}

/* ================= SNAPSHOT ================= */
function getSnapshot() {
  cleanupOldRequests();
  
  const mem = process.memoryUsage();
  const sysMemTotal = os.totalmem();
  const sysMemFree = os.freemem();
  const sysMemUsed = sysMemTotal - sysMemFree;
  const disk = diskUsage();
  const cpu = cpuUsage();
  const cpuDetails = getCPUDetails();
  const heapStats = v8.getHeapStatistics();
  const uptime = process.uptime();
  const sysUptime = os.uptime();
  const memPct = parseFloat(pct(sysMemUsed, sysMemTotal));
  const health = getHealthStatus(cpu, memPct, disk.percent);

  return {
    // Timestamps
    timestamp: Date.now(),
    serverStartTime: START_DATE,
    currentTime: new Date().toISOString(),
    
    // Health
    health: health.status,
    healthColor: health.color,
    
    // CPU
    cpu,
    cpuModel: cpuDetails.model,
    cpuSpeed: cpuDetails.speed,
    cpuCores: cpuDetails.cores,
    loadAvg: getLoadAverages(),
    
    // Process Memory
    memoryRss: parseFloat(mb(mem.rss)),
    memoryHeapUsed: parseFloat(mb(mem.heapUsed)),
    memoryHeapTotal: parseFloat(mb(mem.heapTotal)),
    memoryExternal: parseFloat(mb(mem.external)),
    memoryArrayBuffers: parseFloat(mb(mem.arrayBuffers || 0)),
    
    // V8 Heap
    heapSizeLimit: parseFloat(mb(heapStats.heap_size_limit)),
    totalHeapSize: parseFloat(mb(heapStats.total_heap_size)),
    usedHeapSize: parseFloat(mb(heapStats.used_heap_size)),
    mallocedMemory: parseFloat(mb(heapStats.malloced_memory)),
    heapUsagePercent: parseFloat(pct(heapStats.used_heap_size, heapStats.heap_size_limit)),
    
    // System Memory
    sysMemTotal: parseFloat(gb(sysMemTotal)),
    sysMemFree: parseFloat(gb(sysMemFree)),
    sysMemUsed: parseFloat(gb(sysMemUsed)),
    sysMemPercent: memPct,
    
    // Disk
    diskTotal: parseFloat(gb(disk.total)),
    diskUsed: parseFloat(gb(disk.used)),
    diskFree: parseFloat(gb(disk.free)),
    diskPercent: disk.percent,
    
    // Uptime
    processUptime: formatDuration(uptime),
    processUptimeSec: Math.floor(uptime),
    systemUptime: formatDuration(sysUptime),
    systemUptimeSec: Math.floor(sysUptime),
    
    // Request Stats
    totalRequests: requestCount,
    rpm: Math.round(lastMinuteRequests.length),
    rps: (lastMinuteRequests.length / 60).toFixed(2),
    rph: lastHourRequests.length,
    avgLifetimeRpm: (requestCount / (uptime / 60 || 1)).toFixed(2),
    
    // Response Times
    avgResponseMs: requestCount ? Math.round(totalResponseTime / requestCount) : 0,
    minResponseMs: minResponseTime === Infinity ? 0 : minResponseTime,
    maxResponseMs: maxResponseTime,
    totalResponseTime,
    
    // Errors & Success
    errorCount,
    successCount: requestCount - errorCount,
    errorRate: pct(errorCount, requestCount),
    successRate: pct(requestCount - errorCount, requestCount),
    
    // Connections & Data
    activeConnections,
    totalBytesReceived: formatBytes(totalBytesReceived),
    totalBytesSent: formatBytes(totalBytesSent),
    bytesReceivedRaw: totalBytesReceived,
    bytesSentRaw: totalBytesSent,
    
    // Status Codes
    statusCodes: statusCodeCounts,
    
    // Endpoints
    endpoints: requestsPerEndpoint,
    
    // Last Request
    lastRequest: lastRequestTime,
    timeSinceLastRequest: lastRequestTime 
      ? formatDuration((Date.now() - new Date(lastRequestTime).getTime()) / 1000)
      : "N/A",
    
    // System Info
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    osType: os.type(),
    osRelease: os.release(),
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    pid: process.pid,
    ppid: process.ppid,
    
    // Network
    network: getNetworkInfo(),
    
    // Event Loop
    activeHandles: process._getActiveHandles?.()?.length || 0,
    activeRequests: process._getActiveRequests?.()?.length || 0
  };
}

/* ================= HTML ================= */
function renderHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>🚀 Advanced Node.js Monitoring Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg-primary: #0a0e17;
  --bg-secondary: #0f1629;
  --bg-card: #151d2e;
  --bg-card-hover: #1a2540;
  --border: #1e3a5f;
  --text-primary: #f0f4f8;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --accent-blue: #3b82f6;
  --accent-cyan: #22d3ee;
  --accent-green: #22c55e;
  --accent-yellow: #eab308;
  --accent-orange: #f97316;
  --accent-red: #ef4444;
  --accent-purple: #a855f7;
  --accent-pink: #ec4899;
  --gradient-1: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --gradient-2: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  --gradient-3: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  --gradient-4: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  --shadow-glow: 0 0 40px rgba(59, 130, 246, 0.15);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  line-height: 1.5;
}

/* Scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent-blue); }

/* Header */
header {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(10px);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  width: 42px;
  height: 42px;
  background: var(--gradient-3);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  box-shadow: var(--shadow);
}

.logo h1 {
  font-size: 20px;
  font-weight: 700;
  background: var(--gradient-3);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.header-stats {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.header-stat {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.header-stat-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.header-stat-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
}

.health-badge {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* Main Content */
main {
  padding: 20px;
  max-width: 1800px;
  margin: 0 auto;
}

/* Grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.grid-wide {
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
}

/* Cards */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.3s ease;
}

.card:hover {
  border-color: var(--accent-blue);
  box-shadow: var(--shadow-glow);
  transform: translateY(-2px);
}

.card-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.05) 0%, transparent 100%);
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.card-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}

.card-body {
  padding: 16px 20px;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stats-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}

.stat-item {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 10px;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.stat-item:hover {
  border-color: var(--border);
  background: var(--bg-card-hover);
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.stat-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-value.small {
  font-size: 14px;
}

.stat-value.large {
  font-size: 24px;
}

.stat-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Progress Bars */
.progress-container {
  margin-top: 8px;
}

.progress-bar {
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.progress-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

/* Charts */
.chart-container {
  padding: 12px 0;
}

canvas {
  width: 100% !important;
  height: 120px !important;
}

/* Tables */
.table-container {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th, td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

th {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

td {
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-primary);
}

tr:hover td {
  background: var(--bg-card-hover);
}

/* Tags */
.tag {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

/* Colors */
.blue { color: var(--accent-blue); }
.cyan { color: var(--accent-cyan); }
.green { color: var(--accent-green); }
.yellow { color: var(--accent-yellow); }
.orange { color: var(--accent-orange); }
.red { color: var(--accent-red); }
.purple { color: var(--accent-purple); }
.pink { color: var(--accent-pink); }

.bg-blue { background: rgba(59, 130, 246, 0.2); }
.bg-cyan { background: rgba(34, 211, 238, 0.2); }
.bg-green { background: rgba(34, 197, 94, 0.2); }
.bg-yellow { background: rgba(234, 179, 8, 0.2); }
.bg-orange { background: rgba(249, 115, 22, 0.2); }
.bg-red { background: rgba(239, 68, 68, 0.2); }
.bg-purple { background: rgba(168, 85, 247, 0.2); }

/* Gauges */
.gauge-container {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

.gauge {
  position: relative;
  width: 140px;
  height: 140px;
}

.gauge svg {
  transform: rotate(-90deg);
}

.gauge-bg {
  fill: none;
  stroke: var(--bg-primary);
  stroke-width: 12;
}

.gauge-fill {
  fill: none;
  stroke-width: 12;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s ease;
}

.gauge-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.gauge-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 28px;
  font-weight: 700;
}

.gauge-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
}

/* List Items */
.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  margin-bottom: 8px;
}

.list-item:last-child {
  margin-bottom: 0;
}

.list-key {
  font-size: 12px;
  color: var(--text-secondary);
}

.list-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
}

/* Status Indicators */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 6px;
  animation: blink 1.5s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Live indicator */
.live-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--accent-green);
}

.live-dot {
  width: 8px;
  height: 8px;
  background: var(--accent-green);
  border-radius: 50%;
  animation: livePulse 1.5s infinite;
}

@keyframes livePulse {
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}

/* Responsive */
@media (max-width: 768px) {
  header { padding: 12px 16px; }
  main { padding: 12px; }
  .grid { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: 1fr; }
  .stats-grid-3 { grid-template-columns: repeat(2, 1fr); }
  .header-stats { display: none; }
}

/* Connection status */
.connection-status {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.connected { background: rgba(34, 197, 94, 0.1); color: var(--accent-green); }
.disconnected { background: rgba(239, 68, 68, 0.1); color: var(--accent-red); }

/* Animations */
.fade-in {
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Full width card */
.card-full {
  grid-column: 1 / -1;
}

/* Metrics bar */
.metrics-bar {
  display: flex;
  gap: 4px;
  height: 30px;
  border-radius: 6px;
  overflow: hidden;
  margin-top: 12px;
}

.metrics-bar-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: white;
  min-width: 30px;
  transition: flex 0.3s ease;
}

/* Timeline */
.timeline {
  position: relative;
  padding-left: 24px;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border);
}

.timeline-item {
  position: relative;
  padding-bottom: 16px;
}

.timeline-item::before {
  content: '';
  position: absolute;
  left: -20px;
  top: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent-blue);
  border: 2px solid var(--bg-card);
}

.network-grid {
  display: grid;
  gap: 8px;
}

.network-item {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border-left: 3px solid var(--accent-cyan);
}

.network-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.network-interface {
  font-weight: 600;
  color: var(--accent-cyan);
}

.network-family {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--bg-card);
  border-radius: 4px;
  color: var(--text-muted);
}

.network-address {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}

.network-mac {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}
</style>
</head>

<body>
<header>
  <div class="logo">
    <div class="logo-icon">⚡</div>
    <div>
      <h1>Node.js Monitor</h1>
    </div>
  </div>
  
  <div class="header-stats">
    <div class="header-stat">
      <div>
        <div class="header-stat-label">Status</div>
        <div id="health-status" class="health-badge" style="background: var(--accent-green);">HEALTHY</div>
      </div>
    </div>
    <div class="header-stat">
      <div>
        <div class="header-stat-label">Uptime</div>
        <div class="header-stat-value green" id="header-uptime">0h 0m 0s</div>
      </div>
    </div>
    <div class="header-stat">
      <div>
        <div class="header-stat-label">Requests</div>
        <div class="header-stat-value cyan" id="header-requests">0</div>
      </div>
    </div>
    <div class="header-stat">
      <div>
        <div class="header-stat-label">Active Conn</div>
        <div class="header-stat-value purple" id="header-connections">0</div>
      </div>
    </div>
  </div>
  
  <div class="live-indicator" id="connection-indicator">
    <div class="live-dot"></div>
    <span>LIVE</span>
  </div>
</header>

<main>
  <!-- Health Overview -->
  <div class="grid">
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-green" style="color: var(--accent-green);">💓</div>
          CPU Usage
        </div>
        <div class="card-badge bg-blue blue" id="cpu-value">0%</div>
      </div>
      <div class="card-body">
        <div class="gauge-container">
          <div class="gauge">
            <svg viewBox="0 0 140 140">
              <circle class="gauge-bg" cx="70" cy="70" r="60"/>
              <circle class="gauge-fill" id="cpu-gauge" cx="70" cy="70" r="60" 
                stroke="var(--accent-green)" stroke-dasharray="377" stroke-dashoffset="377"/>
            </svg>
            <div class="gauge-text">
              <div class="gauge-value" id="cpu-gauge-value">0%</div>
              <div class="gauge-label">CPU</div>
            </div>
          </div>
        </div>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">Model</div>
            <div class="stat-value small" id="cpu-model">-</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Speed</div>
            <div class="stat-value small" id="cpu-speed">- MHz</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Cores</div>
            <div class="stat-value" id="cpu-cores">-</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Load (1m)</div>
            <div class="stat-value" id="load-1m">-</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-cyan" style="color: var(--accent-cyan);">🧠</div>
          Memory Usage
        </div>
        <div class="card-badge bg-cyan cyan" id="mem-value">0 MB</div>
      </div>
      <div class="card-body">
        <div class="gauge-container">
          <div class="gauge">
            <svg viewBox="0 0 140 140">
              <circle class="gauge-bg" cx="70" cy="70" r="60"/>
              <circle class="gauge-fill" id="mem-gauge" cx="70" cy="70" r="60" 
                stroke="var(--accent-cyan)" stroke-dasharray="377" stroke-dashoffset="377"/>
            </svg>
            <div class="gauge-text">
              <div class="gauge-value" id="mem-gauge-value">0%</div>
              <div class="gauge-label">MEM</div>
            </div>
          </div>
        </div>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">RSS</div>
            <div class="stat-value" id="mem-rss">- MB</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Heap Used</div>
            <div class="stat-value" id="mem-heap-used">- MB</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Heap Total</div>
            <div class="stat-value" id="mem-heap-total">- MB</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">External</div>
            <div class="stat-value" id="mem-external">- MB</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-orange" style="color: var(--accent-orange);">💾</div>
          Disk Usage
        </div>
        <div class="card-badge bg-orange orange" id="disk-value">0%</div>
      </div>
      <div class="card-body">
        <div class="gauge-container">
          <div class="gauge">
            <svg viewBox="0 0 140 140">
              <circle class="gauge-bg" cx="70" cy="70" r="60"/>
              <circle class="gauge-fill" id="disk-gauge" cx="70" cy="70" r="60" 
                stroke="var(--accent-orange)" stroke-dasharray="377" stroke-dashoffset="377"/>
            </svg>
            <div class="gauge-text">
              <div class="gauge-value" id="disk-gauge-value">0%</div>
              <div class="gauge-label">DISK</div>
            </div>
          </div>
        </div>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">Total</div>
            <div class="stat-value" id="disk-total">- GB</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Used</div>
            <div class="stat-value" id="disk-used">- GB</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Free</div>
            <div class="stat-value" id="disk-free">- GB</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Used %</div>
            <div class="stat-value" id="disk-percent">-%</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Charts -->
  <div class="grid grid-wide">
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-green" style="color: var(--accent-green);">📈</div>
          CPU History (60s)
        </div>
      </div>
      <div class="card-body chart-container">
        <canvas id="cpu-chart"></canvas>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-cyan" style="color: var(--accent-cyan);">📊</div>
          Memory History (60s)
        </div>
      </div>
      <div class="card-body chart-container">
        <canvas id="mem-chart"></canvas>
      </div>
    </div>
  </div>

  <!-- V8 Heap & System Memory -->
  <div class="grid">
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-purple" style="color: var(--accent-purple);">⚙️</div>
          V8 Heap Statistics
        </div>
      </div>
      <div class="card-body">
        <div class="list-item">
          <span class="list-key">Heap Size Limit</span>
          <span class="list-value purple" id="v8-limit">- MB</span>
        </div>
        <div class="list-item">
          <span class="list-key">Total Heap Size</span>
          <span class="list-value cyan" id="v8-total">- MB</span>
        </div>
        <div class="list-item">
          <span class="list-key">Used Heap Size</span>
          <span class="list-value green" id="v8-used">- MB</span>
        </div>
        <div class="list-item">
          <span class="list-key">Malloced Memory</span>
          <span class="list-value orange" id="v8-malloc">- MB</span>
        </div>
        <div class="list-item">
          <span class="list-key">Heap Usage</span>
          <span class="list-value yellow" id="v8-usage">- %</span>
        </div>
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" id="v8-progress" style="width: 0%; background: var(--gradient-1);"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-pink" style="color: var(--accent-pink);">🖥️</div>
          System Memory
        </div>
      </div>
      <div class="card-body">
        <div class="list-item">
          <span class="list-key">Total Memory</span>
          <span class="list-value purple" id="sys-mem-total">- GB</span>
        </div>
        <div class="list-item">
          <span class="list-key">Used Memory</span>
          <span class="list-value cyan" id="sys-mem-used">- GB</span>
        </div>
        <div class="list-item">
          <span class="list-key">Free Memory</span>
          <span class="list-value green" id="sys-mem-free">- GB</span>
        </div>
        <div class="list-item">
          <span class="list-key">Usage Percentage</span>
          <span class="list-value yellow" id="sys-mem-percent">- %</span>
        </div>
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" id="sys-mem-progress" style="width: 0%; background: var(--gradient-2);"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-yellow" style="color: var(--accent-yellow);">⏱️</div>
          Load Averages
        </div>
      </div>
      <div class="card-body">
        <div class="stats-grid stats-grid-3">
          <div class="stat-item">
            <div class="stat-label">1 Minute</div>
            <div class="stat-value green" id="load-avg-1">-</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">5 Minutes</div>
            <div class="stat-value yellow" id="load-avg-5">-</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">15 Minutes</div>
            <div class="stat-value orange" id="load-avg-15">-</div>
          </div>
        </div>
        <div class="metrics-bar" style="margin-top: 16px;">
          <div class="metrics-bar-segment" id="load-bar-1" style="flex: 1; background: var(--accent-green);">1m</div>
          <div class="metrics-bar-segment" id="load-bar-5" style="flex: 1; background: var(--accent-yellow);">5m</div>
          <div class="metrics-bar-segment" id="load-bar-15" style="flex: 1; background: var(--accent-orange);">15m</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Request Statistics -->
  <div class="grid">
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-blue" style="color: var(--accent-blue);">📡</div>
          Request Statistics
        </div>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">Total Requests</div>
            <div class="stat-value large cyan" id="total-requests">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Requests/Min (Current)</div>
            <div class="stat-value large green" id="rpm">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Requests/Sec</div>
            <div class="stat-value" id="rps">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Requests/Hour</div>
            <div class="stat-value" id="rph">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Avg Lifetime RPM</div>
            <div class="stat-value" id="avg-rpm">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Active Connections</div>
            <div class="stat-value purple" id="active-conn">0</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-green" style="color: var(--accent-green);">⚡</div>
          Response Times
        </div>
      </div>
      <div class="card-body">
        <div class="stats-grid stats-grid-3">
          <div class="stat-item">
            <div class="stat-label">Average</div>
            <div class="stat-value green" id="avg-response">0 ms</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Minimum</div>
            <div class="stat-value cyan" id="min-response">0 ms</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Maximum</div>
            <div class="stat-value orange" id="max-response">0 ms</div>
          </div>
        </div>
        <div class="list-item" style="margin-top: 12px;">
          <span class="list-key">Total Response Time</span>
          <span class="list-value" id="total-response">0 ms</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-red" style="color: var(--accent-red);">🎯</div>
          Success & Errors
        </div>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">Success Count</div>
            <div class="stat-value green" id="success-count">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Error Count</div>
            <div class="stat-value red" id="error-count">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Success Rate</div>
            <div class="stat-value green" id="success-rate">100%</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Error Rate</div>
            <div class="stat-value red" id="error-rate">0%</div>
          </div>
        </div>
        <div class="metrics-bar" style="margin-top: 12px;">
          <div class="metrics-bar-segment" id="success-bar" style="flex: 100; background: var(--accent-green);">✓</div>
          <div class="metrics-bar-segment" id="error-bar" style="flex: 0; background: var(--accent-red);">✗</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Data Transfer -->
  <div class="grid">
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-cyan" style="color: var(--accent-cyan);">📥</div>
          Data Transfer
        </div>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">Total Received</div>
            <div class="stat-value cyan" id="bytes-received">0 B</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Total Sent</div>
            <div class="stat-value green" id="bytes-sent">0 B</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-purple" style="color: var(--accent-purple);">🔄</div>
          Event Loop
        </div>
      </div>
      <div class="card-body">
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-label">Active Handles</div>
            <div class="stat-value purple" id="active-handles">0</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Active Requests</div>
            <div class="stat-value cyan" id="active-requests">0</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Time Information -->
  <div class="grid">
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-green" style="color: var(--accent-green);">🕐</div>
          Time Information
        </div>
      </div>
      <div class="card-body">
        <div class="list-item">
          <span class="list-key">Server Start Time</span>
          <span class="list-value green" id="start-time">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Current Server Time</span>
          <span class="list-value cyan" id="current-time">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Process Uptime</span>
          <span class="list-value yellow" id="process-uptime">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">System Uptime</span>
          <span class="list-value orange" id="system-uptime">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Last Request</span>
          <span class="list-value" id="last-request">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Time Since Last Request</span>
          <span class="list-value" id="since-last-request">-</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-blue" style="color: var(--accent-blue);">🖥️</div>
          System Information
        </div>
      </div>
      <div class="card-body">
        <div class="list-item">
          <span class="list-key">Hostname</span>
          <span class="list-value" id="hostname">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Platform</span>
          <span class="list-value" id="platform">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Architecture</span>
          <span class="list-value" id="arch">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">OS Type</span>
          <span class="list-value" id="os-type">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">OS Release</span>
          <span class="list-value" id="os-release">-</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-yellow" style="color: var(--accent-yellow);">📦</div>
          Process Information
        </div>
      </div>
      <div class="card-body">
        <div class="list-item">
          <span class="list-key">Node.js Version</span>
          <span class="list-value green" id="node-version">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">V8 Version</span>
          <span class="list-value cyan" id="v8-version">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Process ID (PID)</span>
          <span class="list-value yellow" id="pid">-</span>
        </div>
        <div class="list-item">
          <span class="list-key">Parent PID (PPID)</span>
          <span class="list-value orange" id="ppid">-</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Network Interfaces -->
  <div class="grid">
    <div class="card card-full">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-cyan" style="color: var(--accent-cyan);">🌐</div>
          Network Interfaces
        </div>
      </div>
      <div class="card-body">
        <div class="network-grid" id="network-list">
          <div class="network-item">
            <div class="network-address">Loading network interfaces...</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Status Codes -->
  <div class="grid">
    <div class="card card-full">
      <div class="card-header">
        <div class="card-title">
          <div class="card-icon bg-purple" style="color: var(--accent-purple);">📋</div>
          HTTP Status Codes
        </div>
      </div>
      <div class="card-body">
        <div class="stats-grid" id="status-codes">
          <div class="stat-item">
            <div class="stat-label">No requests yet</div>
            <div class="stat-value">-</div>
          </div>
        </div>
      </div>
    </div>
  </div>

</main>

<script>
const MAX_HISTORY = 60;
const cpuHistory = [];
const memHistory = [];

const src = new EventSource("/events");
let connected = true;

// Connection handling
src.onopen = () => {
  connected = true;
  document.getElementById('connection-indicator').innerHTML = '<div class="live-dot"></div><span>LIVE</span>';
  document.getElementById('connection-indicator').className = 'live-indicator';
};

src.onerror = () => {
  connected = false;
  document.getElementById('connection-indicator').innerHTML = '<span style="color: var(--accent-red);">⚠️ DISCONNECTED</span>';
};

function updateGauge(id, value, max = 100) {
  const circumference = 377;
  const offset = circumference - (value / max) * circumference;
  const gauge = document.getElementById(id);
  if (gauge) {
    gauge.style.strokeDashoffset = offset;
    
    // Color based on value
    let color = 'var(--accent-green)';
    if (value > 70) color = 'var(--accent-yellow)';
    if (value > 85) color = 'var(--accent-orange)';
    if (value > 95) color = 'var(--accent-red)';
    gauge.style.stroke = color;
  }
}

function drawChart(canvasId, data, color, maxVal = 100) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  
  const width = rect.width;
  const height = rect.height;
  const padding = 10;
  
  ctx.clearRect(0, 0, width, height);
  
  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (height - 2 * padding) * (i / 4);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }
  
  if (data.length < 2) return;
  
  // Fill area
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color + '40');
  gradient.addColorStop(1, color + '00');
  
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  
  data.forEach((val, i) => {
    const x = padding + (i / (MAX_HISTORY - 1)) * (width - 2 * padding);
    const y = height - padding - (val / maxVal) * (height - 2 * padding);
    ctx.lineTo(x, y);
  });
  
  ctx.lineTo(padding + ((data.length - 1) / (MAX_HISTORY - 1)) * (width - 2 * padding), height - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Line
  ctx.beginPath();
  data.forEach((val, i) => {
    const x = padding + (i / (MAX_HISTORY - 1)) * (width - 2 * padding);
    const y = height - padding - (val / maxVal) * (height - 2 * padding);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  
  // Current value dot
  if (data.length > 0) {
    const lastX = padding + ((data.length - 1) / (MAX_HISTORY - 1)) * (width - 2 * padding);
    const lastY = height - padding - (data[data.length - 1] / maxVal) * (height - 2 * padding);
    
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleString();
}

src.onmessage = (e) => {
  const d = JSON.parse(e.data);
  
  // Update histories
  cpuHistory.push(d.cpu);
  if (cpuHistory.length > MAX_HISTORY) cpuHistory.shift();
  
  memHistory.push(d.sysMemPercent);
  if (memHistory.length > MAX_HISTORY) memHistory.shift();
  
  // Health Status
  document.getElementById('health-status').textContent = d.health;
  document.getElementById('health-status').style.background = d.healthColor;
  
  // Header stats
  document.getElementById('header-uptime').textContent = d.processUptime;
  document.getElementById('header-requests').textContent = d.totalRequests.toLocaleString();
  document.getElementById('header-connections').textContent = d.activeConnections;
  
  // CPU
  document.getElementById('cpu-value').textContent = d.cpu + '%';
  document.getElementById('cpu-gauge-value').textContent = d.cpu + '%';
  updateGauge('cpu-gauge', d.cpu);
  document.getElementById('cpu-model').textContent = d.cpuModel.substring(0, 30) + (d.cpuModel.length > 30 ? '...' : '');
  document.getElementById('cpu-speed').textContent = d.cpuSpeed + ' MHz';
  document.getElementById('cpu-cores').textContent = d.cpuCores;
  document.getElementById('load-1m').textContent = d.loadAvg['1min'];
  
  // Memory
  document.getElementById('mem-value').textContent = d.memoryRss + ' MB';
  document.getElementById('mem-gauge-value').textContent = Math.round(d.sysMemPercent) + '%';
  updateGauge('mem-gauge', d.sysMemPercent);
  document.getElementById('mem-rss').textContent = d.memoryRss + ' MB';
  document.getElementById('mem-heap-used').textContent = d.memoryHeapUsed + ' MB';
  document.getElementById('mem-heap-total').textContent = d.memoryHeapTotal + ' MB';
  document.getElementById('mem-external').textContent = d.memoryExternal + ' MB';
  
  // Disk
  document.getElementById('disk-value').textContent = d.diskPercent + '%';
  document.getElementById('disk-gauge-value').textContent = d.diskPercent + '%';
  updateGauge('disk-gauge', d.diskPercent);
  document.getElementById('disk-total').textContent = d.diskTotal + ' GB';
  document.getElementById('disk-used').textContent = d.diskUsed + ' GB';
  document.getElementById('disk-free').textContent = d.diskFree + ' GB';
  document.getElementById('disk-percent').textContent = d.diskPercent + '%';
  
  // V8 Heap
  document.getElementById('v8-limit').textContent = d.heapSizeLimit + ' MB';
  document.getElementById('v8-total').textContent = d.totalHeapSize + ' MB';
  document.getElementById('v8-used').textContent = d.usedHeapSize + ' MB';
  document.getElementById('v8-malloc').textContent = d.mallocedMemory + ' MB';
  document.getElementById('v8-usage').textContent = d.heapUsagePercent + '%';
  document.getElementById('v8-progress').style.width = d.heapUsagePercent + '%';
  
  // System Memory
  document.getElementById('sys-mem-total').textContent = d.sysMemTotal + ' GB';
  document.getElementById('sys-mem-used').textContent = d.sysMemUsed + ' GB';
  document.getElementById('sys-mem-free').textContent = d.sysMemFree + ' GB';
  document.getElementById('sys-mem-percent').textContent = d.sysMemPercent + '%';
  document.getElementById('sys-mem-progress').style.width = d.sysMemPercent + '%';
  
  // Load Averages
  document.getElementById('load-avg-1').textContent = d.loadAvg['1min'];
  document.getElementById('load-avg-5').textContent = d.loadAvg['5min'];
  document.getElementById('load-avg-15').textContent = d.loadAvg['15min'];
  
  // Request Stats
  document.getElementById('total-requests').textContent = d.totalRequests.toLocaleString();
  document.getElementById('rpm').textContent = d.rpm;
  document.getElementById('rps').textContent = d.rps;
  document.getElementById('rph').textContent = d.rph.toLocaleString();
  document.getElementById('avg-rpm').textContent = d.avgLifetimeRpm;
  document.getElementById('active-conn').textContent = d.activeConnections;
  
  // Response Times
  document.getElementById('avg-response').textContent = d.avgResponseMs + ' ms';
  document.getElementById('min-response').textContent = d.minResponseMs + ' ms';
  document.getElementById('max-response').textContent = d.maxResponseMs + ' ms';
  document.getElementById('total-response').textContent = d.totalResponseTime + ' ms';
  
  // Success & Errors
  document.getElementById('success-count').textContent = d.successCount;
  document.getElementById('error-count').textContent = d.errorCount;
  document.getElementById('success-rate').textContent = d.successRate + '%';
  document.getElementById('error-rate').textContent = d.errorRate + '%';
  document.getElementById('success-bar').style.flex = d.successCount || 1;
  document.getElementById('error-bar').style.flex = d.errorCount || 0;
  
  // Data Transfer
  document.getElementById('bytes-received').textContent = d.totalBytesReceived;
  document.getElementById('bytes-sent').textContent = d.totalBytesSent;
  
  // Event Loop
  document.getElementById('active-handles').textContent = d.activeHandles;
  document.getElementById('active-requests').textContent = d.activeRequests;
  
  // Time Information
  document.getElementById('start-time').textContent = formatTime(d.serverStartTime);
  document.getElementById('current-time').textContent = formatTime(d.currentTime);
  document.getElementById('process-uptime').textContent = d.processUptime;
  document.getElementById('system-uptime').textContent = d.systemUptime;
  document.getElementById('last-request').textContent = formatTime(d.lastRequest);
  document.getElementById('since-last-request').textContent = d.timeSinceLastRequest;
  
  // System Info
  document.getElementById('hostname').textContent = d.hostname;
  document.getElementById('platform').textContent = d.platform;
  document.getElementById('arch').textContent = d.arch;
  document.getElementById('os-type').textContent = d.osType;
  document.getElementById('os-release').textContent = d.osRelease;
  
  // Process Info
  document.getElementById('node-version').textContent = d.nodeVersion;
  document.getElementById('v8-version').textContent = d.v8Version;
  document.getElementById('pid').textContent = d.pid;
  document.getElementById('ppid').textContent = d.ppid;
  
  // Network Interfaces
  if (d.network && d.network.length > 0) {
    const networkHtml = d.network.map(n => \`
      <div class="network-item">
        <div class="network-item-header">
          <span class="network-interface">\${n.interface}</span>
          <span class="network-family">\${n.family}</span>
        </div>
        <div class="network-address">\${n.address}</div>
        <div class="network-mac">MAC: \${n.mac}</div>
      </div>
    \`).join('');
    document.getElementById('network-list').innerHTML = networkHtml;
  }
  
  // Status Codes
  if (Object.keys(d.statusCodes).length > 0) {
    const statusHtml = Object.entries(d.statusCodes).map(([code, count]) => {
      let colorClass = 'green';
      if (code.startsWith('3')) colorClass = 'yellow';
      if (code.startsWith('4')) colorClass = 'orange';
      if (code.startsWith('5')) colorClass = 'red';
      return \`
        <div class="stat-item">
          <div class="stat-label">HTTP \${code}</div>
          <div class="stat-value \${colorClass}">\${count}</div>
        </div>
      \`;
    }).join('');
    document.getElementById('status-codes').innerHTML = statusHtml;
  }
  
  // Draw Charts
  drawChart('cpu-chart', cpuHistory, '#22c55e');
  drawChart('mem-chart', memHistory, '#22d3ee');
};

// Resize handler for charts
window.addEventListener('resize', () => {
  drawChart('cpu-chart', cpuHistory, '#22c55e');
  drawChart('mem-chart', memHistory, '#22d3ee');
});
</script>
</body>
</html>`;
}

/* ================= SERVER ================= */
const server = http.createServer((req, res) => {
  const start = Date.now();
  requestCount++;
  lastRequestTime = new Date().toISOString();
  lastMinuteRequests.push(Date.now());
  lastHourRequests.push(Date.now());
  
  // Track bytes received
  let bytesReceived = 0;
  req.on('data', chunk => bytesReceived += chunk.length);
  req.on('end', () => totalBytesReceived += bytesReceived);
  
  // Track endpoint
  requestsPerEndpoint[req.url] = (requestsPerEndpoint[req.url] || 0) + 1;

  if (req.url === "/" || req.url === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html" });
    const html = renderHTML();
    totalBytesSent += Buffer.byteLength(html);
    statusCodeCounts["200"] = (statusCodeCounts["200"] || 0) + 1;
    res.end(html);
    
    const elapsed = Date.now() - start;
    totalResponseTime += elapsed;
    minResponseTime = Math.min(minResponseTime, elapsed);
    maxResponseTime = Math.max(maxResponseTime, elapsed);
    return;
  }

  if (req.url === "/events") {
    activeConnections++;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    const sendData = () => {
      const data = JSON.stringify(getSnapshot());
      res.write(`data: ${data}\n\n`);
      totalBytesSent += Buffer.byteLength(data) + 8;
    };
    
    sendData(); // Send immediately
    const timer = setInterval(sendData, 2000);

    req.on("close", () => {
      clearInterval(timer);
      activeConnections--;
    });
    return;
  }

  if (req.url === "/api/snapshot") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const json = JSON.stringify(getSnapshot(), null, 2);
    totalBytesSent += Buffer.byteLength(json);
    statusCodeCounts["200"] = (statusCodeCounts["200"] || 0) + 1;
    res.end(json);
    
    const elapsed = Date.now() - start;
    totalResponseTime += elapsed;
    minResponseTime = Math.min(minResponseTime, elapsed);
    maxResponseTime = Math.max(maxResponseTime, elapsed);
    return;
  }

  if (req.url === "/health") {
    const snapshot = getSnapshot();
    res.writeHead(200, { "Content-Type": "application/json" });
    const health = JSON.stringify({
      status: snapshot.health,
      uptime: snapshot.processUptime,
      cpu: snapshot.cpu,
      memory: snapshot.sysMemPercent,
      disk: snapshot.diskPercent
    });
    totalBytesSent += Buffer.byteLength(health);
    statusCodeCounts["200"] = (statusCodeCounts["200"] || 0) + 1;
    res.end(health);
    return;
  }

  // 404
  statusCodeCounts["404"] = (statusCodeCounts["404"] || 0) + 1;
  errorCount++;
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found", path: req.url }));
  
  const elapsed = Date.now() - start;
  totalResponseTime += elapsed;
  minResponseTime = Math.min(minResponseTime, elapsed);
  maxResponseTime = Math.max(maxResponseTime, elapsed);
});

server.on('connection', () => {
  // Track new connections if needed
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 Advanced Node.js Monitoring Dashboard                    ║
║                                                               ║
║   Dashboard:  http://localhost:${PORT}                          ║
║   API:        http://localhost:${PORT}/api/snapshot              ║
║   Health:     http://localhost:${PORT}/health                    ║
║   Events:     http://localhost:${PORT}/events (SSE)              ║
║                                                               ║
║   Started at: ${new Date().toISOString()}             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
