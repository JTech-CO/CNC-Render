import type { Vec3Mm } from "@cnc-render/contracts";
import type { ResultComparison } from "../../packages/simulation/src/result-comparison";
import { selectResultDisplaySamples, type ResultDisplaySampling } from "./result-display-sampling";

export type ResultComparisonMode = "overlay" | "split" | "heatmap";
export interface ResultPickedSample { readonly index: number; readonly point: Vec3Mm; readonly actualMm: number; readonly targetMm: number; readonly deviationMm: number; }

/** Imperative renderer owns all full precision fields; React sees picked scalars only. */
export class ResultComparisonView {
  #result: ResultComparison | null = null;
  #samples: { x: number; y: number; index: number }[] = [];
  #sampling: ResultDisplaySampling | null = null;
  #drawIndices: readonly number[] = [];
  setResult(result: ResultComparison): void {
    this.#result = result;
    const { field } = result;
    this.#sampling = selectResultDisplaySamples(field.kind, field.columns, field.rows);
    const indices = Array.from(this.#sampling.indices);
    if (field.kind === "milling") indices.sort((a, b) => field.coordinatesMm[a * 3] + field.coordinatesMm[a * 3 + 1] - field.coordinatesMm[b * 3] - field.coordinatesMm[b * 3 + 1]);
    this.#drawIndices = indices;
  }
  getDisplaySummary() {
    const sampling = this.#sampling;
    return sampling ? { totalSamples: sampling.totalSamples, displayedSamples: sampling.displayedSamples, reduced: sampling.reduced, projectedSamples: this.#samples.length } : null;
  }
  clear(): void { this.#result = null; this.#samples = []; this.#sampling = null; this.#drawIndices = []; }
  draw(canvas: HTMLCanvasElement, mode: ResultComparisonMode): void {
    const context = canvas.getContext("2d");
    if (!context || !this.#result || !this.#sampling) return;
    const { field, report } = this.#result;
    const width = 900; const height = 380;
    canvas.width = width; canvas.height = height;
    context.fillStyle = "#f7f9fb"; context.fillRect(0, 0, width, height);
    context.font = "14px system-ui"; context.fillStyle = "#223647";
    context.fillText(field.kind === "milling" ? "Stock 표면 · XY / 높이 Z (mm)" : "Stock 반경 단면 · Z / 반경 (mm)", 16, 24);
    this.#samples = [];
    let minX = Number.POSITIVE_INFINITY; let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY; let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY; let maxZ = Number.NEGATIVE_INFINITY;
    for (const index of this.#drawIndices) {
      const coordinate = index * 3;
      minX = Math.min(minX, field.coordinatesMm[coordinate]); maxX = Math.max(maxX, field.coordinatesMm[coordinate]);
      minY = Math.min(minY, field.coordinatesMm[coordinate + 1]); maxY = Math.max(maxY, field.coordinatesMm[coordinate + 1]);
      minZ = Math.min(minZ, field.actualMm[index], field.targetMm[index]); maxZ = Math.max(maxZ, field.actualMm[index], field.targetMm[index]);
    }
    const halves = mode === "split" ? 2 : 1;
    for (let half = 0; half < halves; half += 1) {
      const offset = half * width / halves; const panelWidth = width / halves;
      const targetOnly = mode === "split" && half === 0;
      context.fillStyle = "#223647";
      context.fillText(targetOnly ? "목표 (독립 작성)" : mode === "split" ? "실제 Stock" : "실제 표면 / 목표 파선", offset + 16, 48);
      if (field.kind === "turning") {
        const startZ = field.coordinatesMm[2]; const endZ = field.coordinatesMm[(field.columns - 1) * 3 + 2];
        const xScale = (panelWidth - 48) / Math.max(1, endZ - startZ);
        const yScale = 260 / Math.max(1, maxZ);
        for (let row = 0; row < 2; row += 1) {
          context.beginPath(); context.setLineDash(targetOnly ? [5, 4] : []);
          context.strokeStyle = targetOnly ? "#275ac8" : "#34495d"; context.lineWidth = 2;
          for (let column = 0; column < this.#sampling.columns; column += 1) {
            const index = this.#sampling.indices[row * this.#sampling.columns + column];
            const x = offset + 24 + (field.coordinatesMm[index * 3 + 2] - startZ) * xScale;
            const y = 342 - (targetOnly ? field.targetMm[index] : field.actualMm[index]) * yScale;
            if (column === 0) context.moveTo(x, y); else context.lineTo(x, y);
            if (!targetOnly) this.#samples.push({ x, y, index });
            if (mode === "heatmap") {
              context.fillStyle = this.#color(field.signedDeviationMm[index], report.maxDeviationMm, report.numericToleranceMm);
              context.fillRect(x - 2, y - 8, Math.max(3, xScale * report.representationResolutionMm), 16);
            }
          }
          context.stroke(); context.setLineDash([]);
          if (mode !== "split") {
            context.beginPath(); context.strokeStyle = "#275ac8"; context.setLineDash([5, 4]);
            for (let column = 0; column < this.#sampling.columns; column += 1) {
              const index = this.#sampling.indices[row * this.#sampling.columns + column];
              const x = offset + 24 + (field.coordinatesMm[index * 3 + 2] - startZ) * xScale;
              const y = 342 - field.targetMm[index] * yScale;
              if (column === 0) context.moveTo(x, y); else context.lineTo(x, y);
            }
            context.stroke(); context.setLineDash([]);
          }
        }
      } else {
        const resolution = report.representationResolutionMm;
        const spanX = maxX - minX + resolution; const spanY = maxY - minY + resolution;
        const scale = Math.min((panelWidth - 60) / ((spanX + spanY) * 0.7), 270 / ((spanX + spanY) * 0.35 + (maxZ - minZ) * 0.8));
        const project = (x: number, y: number, z: number) => ({
          x: offset + panelWidth / 2 + ((x - minX - spanX / 2) - (y - minY - spanY / 2)) * scale * 0.7,
          y: 90 + ((x - minX) + (y - minY)) * scale * 0.35 + (maxZ - z) * scale * 0.8,
        });
        for (const index of this.#drawIndices) {
          const x = field.coordinatesMm[index * 3]; const y = field.coordinatesMm[index * 3 + 1];
          const z = targetOnly ? field.targetMm[index] : field.actualMm[index];
          const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
          context.beginPath();
          corners.forEach(([dx, dy], corner) => { const point = project(x + dx * resolution, y + dy * resolution, z); if (corner === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); });
          context.closePath();
          const intensity = Math.round(194 + 45 * (z - minZ) / Math.max(1, maxZ - minZ));
          context.fillStyle = mode === "heatmap" ? this.#color(field.signedDeviationMm[index], report.maxDeviationMm, report.numericToleranceMm) : `rgb(${intensity} ${intensity + 5} ${Math.min(255, intensity + 10)})`;
          context.fill(); context.strokeStyle = "#8999a6"; context.lineWidth = 0.25; context.stroke();
          if (!targetOnly) { const point = project(x, y, z); this.#samples.push({ ...point, index }); }
          if (targetOnly || mode === "overlay") {
            context.beginPath(); context.strokeStyle = "#275ac8"; context.lineWidth = 0.5; context.setLineDash([3, 2]);
            corners.forEach(([dx, dy], corner) => { const point = project(x + dx * resolution, y + dy * resolution, field.targetMm[index]); if (corner === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); });
            context.closePath(); context.stroke(); context.setLineDash([]);
          }
        }
      }
    }
    if (this.#sampling.reduced) {
      context.fillStyle = "#223647";
      context.fillText(`표시 LOD: 실제 ${this.#sampling.displayedSamples} / ${this.#sampling.totalSamples} 표본 · 통계는 전체 Stock`, 16, 370);
    }
  }
  #color(deviation: number, maximum: number, tolerance: number): string {
    if (Math.abs(deviation) <= tolerance) return "#d9e2e8";
    const amount = Math.min(1, Math.abs(deviation) / Math.max(maximum, tolerance));
    return deviation < 0 ? `rgb(${Math.round(160 - 125 * amount)} ${Math.round(185 - 90 * amount)} 190)` : `rgb(190 ${Math.round(175 - 90 * amount)} ${Math.round(130 - 100 * amount)})`;
  }
  pick(canvas: HTMLCanvasElement, clientX: number, clientY: number): ResultPickedSample | null {
    if (!this.#result || this.#samples.length === 0) return null;
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width * canvas.width;
    const y = (clientY - bounds.top) / bounds.height * canvas.height;
    let best = this.#samples[0]; let distance = Number.POSITIVE_INFINITY;
    for (const candidate of this.#samples) { const next = Math.hypot(candidate.x - x, candidate.y - y); if (next < distance) { best = candidate; distance = next; } }
    if (distance > 35) return null;
    const { field } = this.#result; const index = best.index;
    return { index, point: { xMm: field.coordinatesMm[index * 3], yMm: field.coordinatesMm[index * 3 + 1], zMm: field.coordinatesMm[index * 3 + 2] },
      actualMm: field.actualMm[index], targetMm: field.targetMm[index], deviationMm: field.signedDeviationMm[index] };
  }
}
