const http = require("http");
const os = require("os");

const PORT = process.env.PORT || 3000;
const START_TIME = Date.now();

/* ---------- Logger ---------- */
function log(level, message, meta = {}) {
  const logEntry = {
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  console.log(JSON.stringify(logEntry));
}

/* ---------- Server ---------- */
const server = http.createServer((req, res) => {
  const requestStart = Date.now();

  log("INFO", "Incoming request", {
    method: req.method,
    url: req.url,
    remoteAddress: req.socket.remoteAddress,
    userAgent: req.headers["user-agent"]
  });

  if (req.method === "GET" && req.url === "/") {
    const health = {
      status: "OK",
      timestamp: new Date().toISOString(),

      server: {
        uptime_seconds: process.uptime(),
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        memory_usage_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },

      system: {
        hostname: os.hostname(),
        cpu_cores: os.cpus().length,
        total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
        free_memory_mb: Math.round(os.freemem() / 1024 / 1024),
        load_average: os.loadavg()
      }
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health, null, 2));

    log("INFO", "Health check served", {
      responseTimeMs: Date.now() - requestStart
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));

  log("WARN", "Route not found", {
    url: req.url,
    responseTimeMs: Date.now() - requestStart
  });
});

/* ---------- Startup Logs ---------- */
server.listen(PORT, () => {
  log("INFO", "Server started", {
    port: PORT,
    node_version: process.version,
    platform: process.platform,
    pid: process.pid,
    startup_time_ms: Date.now() - START_TIME
  });
});

/* ---------- Process-level Logs ---------- */
process.on("uncaughtException", (err) => {
  log("ERROR", "Uncaught exception", {
    error: err.message,
    stack: err.stack
  });
});

process.on("unhandledRejection", (reason) => {
  log("ERROR", "Unhandled promise rejection", {
    reason
  });
});

process.on("SIGTERM", () => {
  log("INFO", "SIGTERM received, shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  log("INFO", "SIGINT received, shutting down");
  process.exit(0);
});
