// Entrypoint proxy for Render and Node.js hosting environments
const path = require("path");
const fs = require("fs");

const distEntry = path.join(__dirname, "dist", "index.js");

// If dist/index.js does not exist yet, build via tsc
if (!fs.existsSync(distEntry)) {
  console.log("[Render Startup] dist/index.js not found. Triggering automated build...");
  try {
    require("child_process").execSync("npx tsc", { stdio: "inherit" });
  } catch (err) {
    console.error("[Render Startup] Automated build failed:", err);
  }
}

// Delegate execution to compiled entrypoint
require("./dist/index.js");
