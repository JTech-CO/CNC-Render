import { ResultReportSchema, type ResultReport } from "../../contracts/src/result-report";

export const RESULT_METRICS = [
  ["collisionCount", "충돌", "건"],
  ["warningCount", "가공 경고", "건"],
  ["diagnosticCount", "실행 진단", "건"],
  ["logicalTimeS", "가공 논리 시간", "s"],
  ["representationResolutionMm", "Stock 해상도", "mm"],
  ["numericToleranceMm", "수치 허용 오차", "mm"],
  ["maxDeviationMm", "최대 절대 편차", "mm"],
  ["meanAbsoluteDeviationMm", "평균 절대 편차", "mm"],
  ["p95AbsoluteDeviationMm", "P95 절대 편차", "mm"],
  ["overcutVolumeMm3", "과절삭 체적", "mm³"],
  ["undercutVolumeMm3", "미절삭 체적", "mm³"],
  ["actualRemovedVolumeMm3", "실제 제거 체적", "mm³"],
  ["targetRemovedVolumeMm3", "목표 제거 체적", "mm³"],
] as const;

export function resultReportRows(input: ResultReport) {
  const report = ResultReportSchema.parse(input);
  return [
    ...RESULT_METRICS.map(([key, label, unit]) => ({ key, label, value: report[key], unit })),
    ...report.measurements.map((measurement, index) => ({
      key: `measurement.${index}.${measurement.kind}`, label: `측정 ${index + 1} (${measurement.kind})`,
      value: measurement.canonicalValue, unit: measurement.canonicalUnit,
    })),
  ];
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Every format consumes the same validated canonical report as the screen. */
export function serializeResultReport(input: ResultReport, format: "json" | "csv" | "html"): string {
  const report = ResultReportSchema.parse(input);
  if (format === "json") return JSON.stringify(report, null, 2);
  const rows = resultReportRows(report);
  const identity = ["schemaVersion", "accuracyGrade", "runId", "fixtureId", "stateHash", "stockHash", "targetId", "process", "outcome", "comparedCells", "quantileMethod"] as const;
  if (format === "csv") {
    return [["key", "label", "value", "unit"],
      ...identity.map((key) => [key, key, report[key], ""]),
      ...rows.map((row) => [row.key, row.label, row.value, row.unit]),
    ].map((row) => row.map(csvCell).join(",")).join("\r\n");
  }
  const metadata = identity.map((key) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(report[key]))}</dd>`).join("");
  const body = rows.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td data-key="${escapeHtml(row.key)}">${row.value}</td><td>${escapeHtml(row.unit)}</td></tr>`).join("");
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="color-scheme" content="light"><title>CNC Render 결과 리포트</title><style>body{font:14px system-ui;color:#172b3a;background:#fff;margin:32px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bac6d1;padding:8px;text-align:left}dd{overflow-wrap:anywhere}@media print{body{margin:0}}</style><h1>CNC Render 결과 리포트</h1><p>E2 교육용 근사 · 산업용 공차 검증이 아닙니다. 해상도 미만 형상은 평가하지 않습니다.</p><dl>${metadata}</dl><table><thead><tr><th>항목</th><th>정규 값</th><th>단위</th></tr></thead><tbody>${body}</tbody></table></html>`;
}
