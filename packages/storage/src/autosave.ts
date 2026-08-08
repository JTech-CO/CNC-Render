import { DEFAULT_AUTOSAVE_INTERVAL_S } from "@cnc-render/contracts";

export interface AutosaveClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveControllerOptions {
  readonly intervalMs?: number;
  readonly clock?: AutosaveClock;
}

const BROWSER_CLOCK: AutosaveClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Coalesces ordinary edits into the 30-second autosave window while allowing
 * important process changes to flush immediately. Saves are always serialized.
 */
export class ProjectAutosaveController {
  readonly #intervalMs: number;
  readonly #clock: AutosaveClock;
  readonly #save: () => Promise<void>;

  #timer: unknown = null;
  #inFlight: Promise<void> | null = null;
  #dirty = false;
  #urgent = false;
  #started = false;
  #disposed = false;

  constructor(
    save: () => Promise<void>,
    options: AutosaveControllerOptions = {},
  ) {
    const intervalMs =
      options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_S * 1_000;
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new RangeError("autosave intervalMs must be a positive safe integer");
    }
    this.#save = save;
    this.#intervalMs = intervalMs;
    this.#clock = options.clock ?? BROWSER_CLOCK;
  }

  get intervalMs(): number {
    return this.#intervalMs;
  }

  start(): void {
    if (this.#disposed) {
      throw new Error("autosave controller is disposed");
    }
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#schedule();
  }

  notifyChange(priority: "ordinary" | "important" = "ordinary"): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(new Error("autosave controller is disposed"));
    }
    this.#dirty = true;
    if (priority === "important") {
      this.#urgent = true;
      return this.flush();
    }
    if (this.#started && this.#timer === null) {
      this.#schedule();
    }
    return Promise.resolve();
  }

  async flush(): Promise<void> {
    if (this.#disposed || !this.#dirty) {
      return;
    }
    if (this.#inFlight) {
      await this.#inFlight;
      if (this.#urgent && this.#dirty) {
        await this.flush();
      }
      return;
    }
    this.#cancelTimer();
    this.#dirty = false;
    this.#urgent = false;
    const operation = this.#save();
    this.#inFlight = operation;
    try {
      await operation;
    } catch (error) {
      this.#dirty = true;
      throw error;
    } finally {
      this.#inFlight = null;
      if (this.#started && !this.#disposed) {
        this.#schedule();
      }
    }
    if (this.#urgent && this.#dirty) {
      await this.flush();
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#started = false;
    this.#cancelTimer();
  }

  #schedule(): void {
    if (this.#timer !== null || this.#disposed) {
      return;
    }
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = null;
      void this.flush().catch(() => {
        // A failed autosave remains dirty and is retried on the next window.
      });
    }, this.#intervalMs);
  }

  #cancelTimer(): void {
    if (this.#timer === null) {
      return;
    }
    this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
  }
}
