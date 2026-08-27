/**
 * Static file server for dist/ + reverse-proxy for /sim_api.php → local PHP.
 *
 * Why: `npx serve` cannot execute PHP; SPA fallback returns index.html for
 * /sim_api.php (non-JSON). This keeps the browser on :8088 (same origin) and
 * only talks to PHP on 127.0.0.1 (not exposed publicly).
 *
 *   SIMULAI_DIST=/var/www/simulai-schematic/dist \
 *   SIM_PHP_PORT=8091 \
 *   PORT=8088 \
 *   node scripts/serve-static-with-sim.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(
  process.env.SIMULAI_DIST || path.join(__dirname, "..", "dist"),
);
const PHP_PORT = Number(process.env.SIM_PHP_PORT || 8091);
const PORT = Number(process.env.PORT || 8088);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function underDist(filePath) {
  const resolved = path.resolve(filePath);
  return resolved === DIST || resolved.startsWith(DIST + path.sep);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function proxyToPhp(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${PHP_PORT}` };
  delete headers["accept-encoding"];
  const p = http.request(
    {
      hostname: "127.0.0.1",
      port: PHP_PORT,
      path: "/sim_api.php",
      method: req.method,
      headers,
    },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers);
      pr.pipe(res);
    },
  );
  p.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Simulation PHP proxy is down. Is php -S running on 127.0.0.1:" +
          PHP_PORT +
          "? (" +
          e.message +
          ")",
      }),
    );
  });
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || "127.0.0.1";
  const url = new URL(req.url || "/", `http://${host}`);

  if (url.pathname === "/sim_api.php") {
    proxyToPhp(req, res);
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = path.join(DIST, rel);
  if (underDist(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  const index = path.join(DIST, "index.html");
  if (fs.existsSync(index)) {
    sendFile(res, index);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[simulai] static ${DIST} on :${PORT}; /sim_api.php → 127.0.0.1:${PHP_PORT}`,
  );
});
