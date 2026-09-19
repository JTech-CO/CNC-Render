import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Browser } from "@playwright/test";

const execute = promisify(execFile);
export interface SoftwareGpuScheduling {
  readonly policy: "windows-software-gpu-normal";
  readonly before: "Normal" | "AboveNormal";
  readonly after: "Normal";
}

export async function normalizeSoftwareGpuScheduling(
  browser: Browser,
  softwareRequested: boolean,
  platform: NodeJS.Platform = process.platform,
): Promise<SoftwareGpuScheduling | null> {
  if (!softwareRequested || platform !== "win32") return null;
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    const gpu = processInfo.filter((entry) => entry.type === "GPU");
    const owner = processInfo.filter((entry) => entry.type === "browser");
    if (gpu.length !== 1 || !Number.isSafeInteger(gpu[0].id) || gpu[0].id <= 0 ||
      owner.length !== 1 || !Number.isSafeInteger(owner[0].id) || owner[0].id <= 0) {
      throw new Error("Cannot identify the task-owned software GPU process");
    }
    const { stdout } = await execute("powershell.exe", [
      "-NoProfile", "-File", fileURLToPath(new URL("../../scripts/normalize-software-gpu-priority.ps1", import.meta.url)),
      "-GpuProcessId", String(gpu[0].id), "-BrowserProcessId", String(owner[0].id),
    ], { windowsHide: true, timeout: 15000 });
    const result: SoftwareGpuScheduling = JSON.parse(stdout);
    if (result.policy !== "windows-software-gpu-normal" || result.after !== "Normal" || !["Normal", "AboveNormal"].includes(result.before)) {
      throw new Error("Invalid software GPU scheduling evidence");
    }
    return result;
  } finally { await cdp.detach(); }
}
