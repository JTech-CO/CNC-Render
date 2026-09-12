import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const require = createRequire(new URL("../packages/e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const root = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--");
if (arguments_.some((argument) => !argument.startsWith("--output-path=")) || arguments_.length > 1) throw new Error("Only --output-path=artifacts/<name>.html is supported");
const output = resolve(root, arguments_[0]?.slice("--output-path=".length) ?? "artifacts/lighthouse.html");
if (!output.startsWith(resolve(root, "artifacts") + sep) || !output.endsWith(".html")) throw new Error("Lighthouse output must be artifacts/*.html");
await mkdir(dirname(output), { recursive: true });
const jsonOutput = output.replace(/\.html$/u, ".json");
await writeFile(jsonOutput, JSON.stringify({ status: "incomplete", runs: [] }));
const server = spawn(process.execPath, ["packages/e2e/start-pages-test-server.mjs"], { cwd: root, env: process.env, stdio: "inherit", windowsHide: true });
const url = "http://127.0.0.1:43175/CNC-Render/";
try {
  const deadline = Date.now() + 120000;
  while (true) {
    if (server.exitCode !== null) throw new Error("Pages server exited before Lighthouse");
    try { if ((await fetch(url)).ok) break; } catch { /* Server is still building. */ }
    if (Date.now() > deadline) throw new Error("Pages server readiness timeout");
    await new Promise((done) => setTimeout(done, 1000));
  }
  const runs = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    const port = await new Promise((done, reject) => {
      const reservation = createServer();
      reservation.on("error", reject);
      reservation.listen(0, "127.0.0.1", () => { const port = reservation.address().port; reservation.close(() => done(port)); });
    });
    await mkdir(resolve(root, ".cache"), { recursive: true });
    // A fresh, task-owned profile avoids chrome-launcher's Windows cleanup race.
    // Profiles remain ignored local evidence; never reuse a user's browser profile.
    const profile = await mkdtemp(resolve(root, ".cache/lighthouse-"));
    const context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true, args: [`--remote-debugging-port=${port}`] });
    const runOutput = output.replace(/\.html$/u, `-${iteration}.json`);
    const args = [resolve(root, "node_modules/lighthouse/cli/index.js"), url,
      "--quiet", "--no-enable-error-reporting", "--only-categories=performance", "--preset=desktop",
      `--port=${port}`, "--throttling-method=devtools",
      "--throttling.requestLatencyMs=40", "--throttling.downloadThroughputKbps=10240",
      "--throttling.uploadThroughputKbps=10240", "--throttling.cpuSlowdownMultiplier=1",
      "--screenEmulation.width=1440", "--screenEmulation.height=900", "--screenEmulation.deviceScaleFactor=1",
      "--output=json", "--output=html", `--output-path=${runOutput}`];
    try { await new Promise((done, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit", windowsHide: true });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("Lighthouse failed")));
    }); } finally { await context.close(); }
    const report = JSON.parse(await readFile(runOutput.replace(/\.json$/u, ".report.json"), "utf8"));
    runs.push({ lighthouseVersion: report.lighthouseVersion, browserUserAgent: report.environment.hostUserAgent,
      lcpMs: report.audits["largest-contentful-paint"].numericValue,
      runtimeError: report.runtimeError?.code ?? null,
      config: report.configSettings });
    if (iteration === 0) await writeFile(output, await readFile(runOutput.replace(/\.json$/u, ".report.html")));
  }
  const pass = runs.every((run) => run.runtimeError === null && Number.isFinite(run.lcpMs) && run.lcpMs <= 2500);
  await writeFile(jsonOutput, JSON.stringify({ status: pass ? "pass" : "fail", scope: `production Pages entrypoint on ${process.env.CI ? "CI runner (not reference hardware)" : "local desktop"}, fresh Chrome per run, 10 Mbps/40 ms broadband`, lcpMaximumMs: 2500,
    artifact: JSON.parse(await readFile(resolve(root, "dist/pages/release.json"), "utf8")), runs }, null, 2) + "\n");
  console.info(`[lighthouse] ${runs.map((run) => run.lcpMs.toFixed(1)).join(", ")} ms; ${pass ? "pass" : "fail"}`);
  if (!pass) process.exitCode = 1;
} finally { server.kill(); }
