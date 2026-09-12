export const MAX_RESULT_DISPLAY_SAMPLES = 4096;

export interface ResultDisplaySampling {
  readonly indices: Uint32Array;
  readonly columns: number;
  readonly rows: number;
  readonly totalSamples: number;
  readonly displayedSamples: number;
  readonly reduced: boolean;
}

/** Bounded endpoint-preserving selection; each index is an actual input cell. */
export function selectResultDisplaySamples(kind: "milling" | "turning", columns: number, rows: number): ResultDisplaySampling {
  const totalSamples = columns * rows;
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 1 || rows < 1 ||
      !Number.isSafeInteger(totalSamples) || totalSamples > 8_388_608 || (kind === "turning" && rows !== 2)) {
    throw new RangeError("결과 표시 격자 크기가 올바르지 않습니다.");
  }
  let sampledColumns = columns; let sampledRows = rows;
  if (totalSamples > MAX_RESULT_DISPLAY_SAMPLES) {
    sampledColumns = kind === "turning" ? Math.min(columns, MAX_RESULT_DISPLAY_SAMPLES / 2)
      : Math.min(columns, MAX_RESULT_DISPLAY_SAMPLES, Math.max(1, Math.floor(Math.sqrt(MAX_RESULT_DISPLAY_SAMPLES * columns / rows))));
    sampledRows = Math.min(rows, Math.max(1, Math.floor(MAX_RESULT_DISPLAY_SAMPLES / sampledColumns)));
  }
  const indices = new Uint32Array(sampledColumns * sampledRows);
  for (let row = 0; row < sampledRows; row += 1) {
    const actualRow = sampledRows === 1 ? 0 : Math.floor(row * (rows - 1) / (sampledRows - 1));
    for (let column = 0; column < sampledColumns; column += 1) {
      const actualColumn = sampledColumns === 1 ? 0 : Math.floor(column * (columns - 1) / (sampledColumns - 1));
      indices[row * sampledColumns + column] = actualRow * columns + actualColumn;
    }
  }
  return { indices, columns: sampledColumns, rows: sampledRows, totalSamples, displayedSamples: indices.length, reduced: indices.length < totalSamples };
}
