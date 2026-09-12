// Diagnostic traces only: never use this instrumented run as a performance gate.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../packages/e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
if (process.argv.slice(2).some((value) => value !== "--software")) throw new Error("Only --software is supported");
const software = process.argv.includes("--software");
const label = software ? "software" : "chrome";
const server = spawn(process.execPath, ["packages/e2e/start-pages-test-server.mjs"], { cwd: root, env: process.env, stdio: "inherit", windowsHide: true });
let browser;
try {
  const deadline = Date.now() + 120_000;
  while (true) {
    if (server.exitCode !== null) throw new Error("Profile server exited");
    try { if ((await fetch("http://127.0.0.1:43175/CNC-Render/")).ok) break; } catch { /* build pending */ }
    if (Date.now() > deadline) throw new Error("Profile server timeout");
    await new Promise((done) => setTimeout(done, 1000));
  }
  browser = await chromium.launch({ headless: true, ...(software ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-unsafe-webgpu", "--enable-features=Vulkan"] } : { channel: "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await browser.newBrowserCDPSession();
  const pageCdp = await context.newCDPSession(page);
  const dumps = [];
  await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { includedCategories: ["disabled-by-default-memory-infra"], excludedCategories: ["*"], memoryDumpConfig: {} } });
  const dump = async (stage) => {
    const result = await cdp.send("Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" });
    if (!result.success) throw new Error("Memory dump failed");
    dumps.push({ stage, ...result, processes: (await cdp.send("SystemInfo.getProcessInfo")).processInfo });
  };
  await dump("blank");
  await page.goto("http://127.0.0.1:43175/CNC-Render/?renderer=webgpu");
  await page.waitForFunction(() => Boolean(window.__CNC_RENDER_M7__));
  await dump("shell");
  await pageCdp.send("Profiler.enable");
  await pageCdp.send("Profiler.start");
  const result = await page.evaluate(async () => {
    let handlerMs = 0;
    for (let repetition = 0; repetition < 50; repetition++) {
      for (const fixture of ["milling", "turning", "drilling"]) {
        await window.__CNC_RENDER_M7__.runPipelineFixture(fixture, { qualityPreset: "precision", playbackSpeed: 100, executionMode: "realtime" });
        handlerMs = Math.max(handlerMs, window.__CNC_RENDER_M7__.getPipelineState().metrics.maximumMainHandlerMs);
      }
    }
    return { handlerMs, repetitions: 50 };
  });
  const { profile } = await pageCdp.send("Profiler.stop");
  await dump("after-150-processes");
  await page.goto("about:blank");
  await dump("tab-unloaded");
  const completed = new Promise((done) => cdp.once("Tracing.tracingComplete", done));
  await cdp.send("Tracing.end");
  const complete = await completed;
  if (complete.dataLossOccurred || !complete.stream) throw new Error("Incomplete diagnostic trace");
  let data = "";
  while (true) {
    const part = await cdp.send("IO.read", { handle: complete.stream });
    data += part.base64Encoded ? Buffer.from(part.data, "base64").toString("utf8") : part.data;
    if (part.eof) break;
  }
  await cdp.send("IO.close", { handle: complete.stream });
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  await writeFile(resolve(root, `artifacts/profile-${label}-memory.json`), data);
  await writeFile(resolve(root, `artifacts/profile-${label}-cpu.cpuprofile`), JSON.stringify(profile));
  await writeFile(resolve(root, `artifacts/profile-${label}-stages.json`), JSON.stringify({ scope: "diagnostic-not-a-performance-gate", result, dumps }, null, 2));
  console.info(`[profile] ${label}: ${JSON.stringify(result)}`);
} finally { if (browser) await browser.close(); server.kill(); }
