const http = require("http");
const os = require("os");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    const health = {
      status: "OK",
      timestamp: new Date().toISOString(),

      server: {
        uptime_seconds: process.uptime(),
        node_version: process.version,
        platform: process.platform,
        arch: process.arch
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
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`Health server running on port ${PORT}`);
});
