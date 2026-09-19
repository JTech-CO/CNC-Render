import { describe, expect, it, vi } from "vitest";
import { normalizeSoftwareGpuScheduling } from "../../packages/e2e/software-gpu-scheduling";
type Browser = Parameters<typeof normalizeSoftwareGpuScheduling>[0];

describe("benchmark software GPU scheduling", () => {
  it("does not change hardware or non-Windows processes", async () => {
    const browser = { newBrowserCDPSession: vi.fn() };
    expect(await normalizeSoftwareGpuScheduling(browser as unknown as Browser, false, "win32")).toBeNull();
    expect(await normalizeSoftwareGpuScheduling(browser as unknown as Browser, true, "linux")).toBeNull();
    expect(browser.newBrowserCDPSession).not.toHaveBeenCalled();
  });
  it.each([
    { processInfo: [] },
    { processInfo: [{ type: "GPU", id: -1 }] },
    { processInfo: [{ type: "GPU", id: 1 }, { type: "GPU", id: 2 }] },
  ])("fails closed without a unique valid owned GPU id", async ({ processInfo }) => {
    const cdp = { send: vi.fn(async (command) => command === "SystemInfo.getProcessInfo" ? { processInfo } : { arguments: ["task-browser.exe"] }), detach: vi.fn() };
    const browser = { newBrowserCDPSession: vi.fn(async () => cdp) };
    await expect(normalizeSoftwareGpuScheduling(browser as unknown as Browser, true, "win32")).rejects.toThrow("Cannot identify");
    expect(cdp.detach).toHaveBeenCalledOnce();
  });
});
