const http = require("node:http");

const appPort = Number(process.env.WILDFLY_HTTP_PORT || 8080);
const managementPort = Number(process.env.WILDFLY_MANAGEMENT_PORT || 9990);
const startedAt = Date.now();

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

function log(message) {
  console.log(`${timestamp()} ${message}`);
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

function uptimeSeconds() {
  return Math.floor((Date.now() - startedAt) / 1000);
}

const appServer = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    json(res, 200, {
      service: "dummy-wildfly",
      status: "running",
      deployment: "iap.war",
      uptimeSeconds: uptimeSeconds(),
    });
    return;
  }

  if (url.pathname === "/api/builds") {
    json(res, 200, {
      builds: [
        { id: 10245, branch: "main", environment: "Production", status: "Success" },
        { id: 10244, branch: "develop", environment: "SIT", status: "Success" },
      ],
    });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/iap") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Dummy WildFly</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #f4f6f9; color: #172033; }
      main { max-width: 760px; margin: 12vh auto; padding: 32px; background: white; border: 1px solid #d7dee9; border-radius: 8px; }
      h1 { margin: 0 0 12px; }
      code { padding: 2px 6px; background: #eef2ff; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Dummy WildFly is running</h1>
      <p>Deployment <code>iap.war</code> is available on port ${appPort}.</p>
      <p>Health endpoint: <code>/health</code></p>
      <p>Sample API endpoint: <code>/api/builds</code></p>
    </main>
  </body>
</html>`);
    return;
  }

  json(res, 404, { error: "not_found" });
});

const managementServer = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/management") {
    json(res, 200, {
      outcome: "success",
      result: {
        serverState: "running",
        releaseVersion: "Dummy WildFly 28.0.1.Final",
        managementPort,
        deployments: ["iap.war"],
      },
    });
    return;
  }

  json(res, 404, { outcome: "failed", failureDescription: "unknown management resource" });
});

log("Starting WildFly 28.0.1.Final");
log("WFLYCTL0184: WildFly Core 28.0.1.Final");
log("Server configuration: standalone.xml");

appServer.listen(appPort, () => {
  log(`HTTP listener started on port ${appPort}`);
  log('Deployed "iap.war" runtime-name: iap.war');
});

managementServer.listen(managementPort, () => {
  log(`Management interface listening on port ${managementPort}`);
  log(`HTTP management interface listening on port ${managementPort}`);
  log("WildFly started in 1,024ms - Started 517 of 817");
});

function shutdown() {
  log("WFLYSRV0050: WildFly stopped");
  appServer.close(() => undefined);
  managementServer.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
