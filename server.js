const http = require("http");
const os = require("os");
const { execSync } = require("child_process");

const PORT = process.env.PORT || 3000;
const START_TIME = Date.now();

/* ================= METRICS STATE ================= */
let lastCpu = os.cpus();
let requestCount = 0;
let totalResponseTime = 0;
let lastRequestTime = null;

/* ================= HELPERS ================= */
const mb = b => Math.round(b / 1024 / 1024);

function formatDuration(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function cpuUsage() {
  const cpus = os.cpus();
  let idle = 0, total = 0;

  cpus.forEach((c, i) => {
    const prev = lastCpu[i].times;
    const curr = c.times;

    const idleDiff = curr.idle - prev.idle;
    const totalDiff =
      curr.user + curr.sys + curr.idle + curr.nice + curr.irq -
      (prev.user + prev.sys + prev.idle + prev.nice + prev.irq);

    idle += idleDiff;
    total += totalDiff;
  });

  lastCpu = cpus;
  return Math.round((1 - idle / total) * 100);
}

function diskUsage() {
  try {
    const out = execSync("df -k /").toString().split("\n")[1].split(/\s+/);
    return Math.round(out[4].replace("%", ""));
  } catch {
    return 0;
  }
}

/* ================= SNAPSHOT ================= */
function getSnapshot() {
  return {
    timestamp: Date.now(),
    cpu: cpuUsage(),
    memory: mb(process.memoryUsage().rss),
    disk: diskUsage(),
    uptime: formatDuration(process.uptime()),
    requests: requestCount,
    rpm: Math.round(requestCount / (process.uptime() / 60 || 1)),
    avgResponseMs: requestCount
      ? Math.round(totalResponseTime / requestCount)
      : 0,
    lastRequest: lastRequestTime
  };
}

/* ================= HTML ================= */
function renderHTML() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Realtime Node Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />

<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">

<style>
body{
  margin:0;
  font-family:Inter,sans-serif;
  background:#0b1220;
  color:#e5e7eb;
}
header{
  padding:16px;
  border-bottom:1px solid #1e293b;
}
main{
  padding:16px;
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(320px,1fr));
  gap:16px;
}
.card{
  background:#020617;
  padding:16px;
  border-radius:12px;
}
h2{margin-top:0;color:#38bdf8;font-size:15px}
.stat{font-size:14px;margin:4px 0}
canvas{width:100%;height:140px}
</style>
</head>

<body>
<header>
  <strong>🚀 Realtime Node.js Monitoring</strong>
</header>

<main>
  <div class="card">
    <h2>CPU Usage (%)</h2>
    <canvas id="cpu"></canvas>
  </div>

  <div class="card">
    <h2>Memory (MB)</h2>
    <canvas id="mem"></canvas>
  </div>

  <div class="card">
    <h2>Disk Usage (%)</h2>
    <canvas id="disk"></canvas>
  </div>

  <div class="card">
    <h2>Runtime Info</h2>
    <div class="stat">Uptime: <span id="uptime"></span></div>
    <div class="stat">Requests: <span id="req"></span></div>
    <div class="stat">RPM: <span id="rpm"></span></div>
    <div class="stat">Avg Response: <span id="avg"></span> ms</div>
    <div class="stat">Last Request: <span id="last"></span></div>
  </div>
</main>

<script>
const MAX = 60;
const cpu=[], mem=[], disk=[];
const src = new EventSource("/events");

function draw(id,data,color){
  const c=document.getElementById(id);
  const ctx=c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  ctx.strokeStyle=color;
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x=i*(c.width/MAX);
    const y=c.height-(v/100)*c.height;
    if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

src.onmessage=e=>{
  const d=JSON.parse(e.data);

  cpu.push(d.cpu); if(cpu.length>MAX)cpu.shift();
  mem.push(d.memory/10); if(mem.length>MAX)mem.shift();
  disk.push(d.disk); if(disk.length>MAX)disk.shift();

  draw("cpu",cpu,"#22c55e");
  draw("mem",mem,"#38bdf8");
  draw("disk",disk,"#f97316");

  uptime.textContent=d.uptime;
  req.textContent=d.requests;
  rpm.textContent=d.rpm;
  avg.textContent=d.avgResponseMs;
  last.textContent=d.lastRequest||"-";
};
</script>
</body>
</html>`;
}

/* ================= SERVER ================= */
const server = http.createServer((req, res) => {
  const start = Date.now();
  requestCount++;
  lastRequestTime = new Date().toISOString();

  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(renderHTML());
  }

  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    const timer = setInterval(() => {
      res.write(`data: ${JSON.stringify(getSnapshot())}\n\n`);
    }, 2000);

    req.on("close", () => clearInterval(timer));
    return;
  }

  res.writeHead(404);
  res.end();
  totalResponseTime += Date.now() - start;
});

server.listen(PORT, () =>
  console.log(`🚀 Realtime dashboard on http://localhost:${PORT}`)
);
