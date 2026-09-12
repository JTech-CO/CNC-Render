export interface M11ResultSnapshot {
  readonly runId: string | null;
  readonly requiresRerun: boolean;
}

/** Only a mounted result loader subscribes; Stock and frame data never enter React. */
export class M11ResultBridge {
  #snapshot: M11ResultSnapshot = Object.freeze({ runId: null, requiresRerun: false });
  readonly #listeners = new Set<() => void>();

  readonly getSnapshot = (): M11ResultSnapshot => this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  started(): void {
    this.#publish(null, false);
  }

  publishRun(runId: string): void {
    if (runId.length === 0) throw new RangeError("Result run identity must not be empty.");
    // A restored renderer checkpoint must not be legitimized by a late summary
    // from the still-existing Worker session. Only a new start clears this flag.
    if (!this.#snapshot.requiresRerun) this.#publish(runId, false);
  }

  restored(): void {
    this.#publish(null, true);
  }

  #publish(runId: string | null, requiresRerun: boolean): void {
    if (this.#snapshot.runId === runId && this.#snapshot.requiresRerun === requiresRerun) return;
    this.#snapshot = Object.freeze({ runId, requiresRerun });
    for (const listener of this.#listeners) listener();
  }
}
