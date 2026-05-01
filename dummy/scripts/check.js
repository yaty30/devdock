const http = require("node:http");

const checks = [
  ["frontend", "http://localhost:5174/health"],
  ["wildfly", "http://localhost:8080/health"],
  ["wildfly-management", "http://localhost:9990/management"],
];

function request([name, url]) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve({ name, url, status: res.statusCode });
    });

    req.on("error", (error) => {
      resolve({ name, url, error: error.message });
    });

    req.setTimeout(3000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

Promise.all(checks.map(request)).then((results) => {
  let failed = false;

  for (const result of results) {
    if (result.error || result.status < 200 || result.status >= 300) {
      failed = true;
      console.log(`${result.name}: failed (${result.error || result.status}) ${result.url}`);
    } else {
      console.log(`${result.name}: ok (${result.status}) ${result.url}`);
    }
  }

  process.exit(failed ? 1 : 0);
});
