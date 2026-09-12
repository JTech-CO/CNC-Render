import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import type { GcodeLabExecutionState } from "./gcode-lab-loader";

type LabSpatialDiagnostic = Pick<GcodeLabExecutionState["runtimeDiagnostics"][number], "id" | "positionMm">;

/** Bound scene work while keeping any selected engine diagnostic navigable. */
export function selectSpatialDiagnostics(diagnostics: readonly LabSpatialDiagnostic[], selectedId: string | null) {
  const selected = selectedId === null ? undefined : diagnostics.find((item) => item.id === selectedId && item.positionMm !== null);
  const markers: { id: string; positionMm: NonNullable<LabSpatialDiagnostic["positionMm"]> }[] = [];
  if (selected?.positionMm) markers.push({ id: selected.id, positionMm: selected.positionMm });
  for (const item of diagnostics) {
    if (markers.length === 256) break;
    if (item.positionMm !== null && item.id !== selected?.id) markers.push({ id: item.id, positionMm: item.positionMm });
  }
  return markers;
}

/** Only the mounted Lab subscribes: simulation sampling never rerenders the workspace tree. */
export class M11LabBridge {
  #state: GcodeLabExecutionState = { source: null, currentSourceLine: null, executionStatus: "idle", runtimeDiagnostics: [] };
  readonly #listeners = new Set<(state: GcodeLabExecutionState) => void>();

  readonly subscribe = (listener: (state: GcodeLabExecutionState) => void): (() => void) => {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => { this.#listeners.delete(listener); };
  };

  publish(summary: CoordinatorCoreSummary, executionStatus: string, source: string | null): void {
    this.#state = {
      source,
      currentSourceLine: summary.currentSourceLine ?? null,
      executionStatus,
      runtimeDiagnostics: summary.runtimeDiagnostics ?? [],
    };
    for (const listener of this.#listeners) listener(this.#state);
  }

  getState(): GcodeLabExecutionState { return this.#state; }

  publishStatus(executionStatus: string): void {
    this.#state = { ...this.#state, executionStatus };
    for (const listener of this.#listeners) listener(this.#state);
  }
}
