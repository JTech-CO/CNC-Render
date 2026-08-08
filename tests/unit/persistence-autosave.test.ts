import {
  ProjectAutosaveController,
  type AutosaveClock,
} from "@cnc-render/storage";
import { describe, expect, test } from "vitest";

class ManualClock implements AutosaveClock {
  callback: (() => void) | null = null;
  delayMs: number | null = null;
  #nextHandle = 0;
  #handle: number | null = null;

  setTimeout(callback: () => void, delayMs: number): unknown {
    this.#nextHandle += 1;
    this.#handle = this.#nextHandle;
    this.callback = callback;
    this.delayMs = delayMs;
    return this.#handle;
  }

  clearTimeout(handle: unknown): void {
    if (handle === this.#handle) {
      this.#handle = null;
      this.callback = null;
      this.delayMs = null;
    }
  }

  fire(): void {
    const callback = this.callback;
    this.#handle = null;
    this.callback = null;
    this.delayMs = null;
    callback?.();
  }
}

describe("M8 persistence autosave policy", () => {
  test("coalesces ordinary changes into the documented 30-second window", async () => {
    const clock = new ManualClock();
    let saves = 0;
    const controller = new ProjectAutosaveController(
      async () => {
        saves += 1;
      },
      { clock },
    );
    controller.start();
    await controller.notifyChange("ordinary");
    await controller.notifyChange("ordinary");

    expect(clock.delayMs).toBe(30_000);
    expect(saves).toBe(0);
    clock.fire();
    expect(saves).toBe(1);
    controller.dispose();
  });

  test("flushes important changes immediately", async () => {
    let saves = 0;
    const controller = new ProjectAutosaveController(async () => {
      saves += 1;
    });
    await controller.notifyChange("important");
    expect(saves).toBe(1);
    controller.dispose();
  });

  test("serializes an important change that arrives during a save", async () => {
    let saves = 0;
    let resolveFirst: () => void = () => {
      throw new Error("first save has not started");
    };
    const controller = new ProjectAutosaveController(() => {
      saves += 1;
      if (saves === 1) {
        return new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve();
    });

    const first = controller.notifyChange("important");
    const second = controller.notifyChange("important");
    expect(saves).toBe(1);
    resolveFirst();
    await Promise.all([first, second]);
    expect(saves).toBe(2);
    controller.dispose();
  });
});
