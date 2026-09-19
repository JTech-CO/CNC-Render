"use client";

import { useEffect, useRef, useState } from "react";
import type { Vec3Mm } from "@cnc-render/contracts";
import type { GeometricMeasurement, ResultReport } from "../../packages/contracts/src/result-report";
import type { ResultComparisonInput } from "../../packages/simulation/src/result-comparison";
import { ResultComparisonClient } from "../../packages/simulation/src/result-comparison-client";
import { displayMeasurement, measureGeometry, type MeasurementKind } from "../../packages/simulation/src/result-measurement";
import { resultReportRows, serializeResultReport } from "../../packages/simulation/src/result-report-export";
import { ResultComparisonView, type ResultComparisonMode, type ResultPickedSample } from "./result-comparison-view";
import "./result-comparison.css";

export interface ResultComparisonPanelProps {
  readonly capture: () => Promise<ResultComparisonInput>;
  readonly enabled: boolean;
}
const MEASUREMENTS: readonly [MeasurementKind, string][] = [["distance", "거리"], ["diameter", "직경"], ["radius", "반경"], ["angle", "각도"], ["depth", "깊이"], ["wall-thickness", "벽 두께"]];
const AXES = ["xMm", "yMm", "zMm"] as const;
const INITIAL_POINTS: readonly Vec3Mm[] = [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 25.4, yMm: 0, zMm: 0 }, { xMm: 25.4, yMm: 25.4, zMm: 0 }];

export function ResultComparisonPanel({ capture, enabled }: ResultComparisonPanelProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<ResultComparisonView | null>(null);
  const worker = useRef<ResultComparisonClient | null>(null);
  const epoch = useRef(0);
  const [report, setReport] = useState<ResultReport | null>(null);
  const [displaySummary, setDisplaySummary] = useState<ReturnType<ResultComparisonView["getDisplaySummary"]>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ResultComparisonMode>("overlay");
  const [kind, setKind] = useState<MeasurementKind>("distance");
  const [points, setPoints] = useState<readonly Vec3Mm[]>(INITIAL_POINTS);
  const [normal, setNormal] = useState<Vec3Mm>({ xMm: 0, yMm: 0, zMm: 1 });
  const [pickPoint, setPickPoint] = useState(0);
  const [picked, setPicked] = useState<ResultPickedSample | null>(null);
  const [lengthUnit, setLengthUnit] = useState<"mm" | "in">("mm");
  const [angleUnit, setAngleUnit] = useState<"deg" | "rad">("deg");
  const [measurement, setMeasurement] = useState<GeometricMeasurement | null>(null);
  const [lastExport, setLastExport] = useState("");

  useEffect(() => () => { epoch.current += 1; worker.current?.dispose(); view.current?.clear(); }, []);
  useEffect(() => { if (canvas.current && report) view.current?.draw(canvas.current, mode); }, [mode, report]);

  async function compare() {
    const current = ++epoch.current;
    setBusy(true); setError(null);
    try {
      const input = await capture();
      if (current !== epoch.current) return;
      worker.current ??= new ResultComparisonClient();
      const result = await worker.current.compare(input);
      if (current !== epoch.current) return;
      view.current ??= new ResultComparisonView();
      view.current.setResult(result);
      setDisplaySummary(view.current.getDisplaySummary());
      setReport(result.report); setPicked(null); setMeasurement(null);
    } catch (reason) {
      if (current === epoch.current) setError(reason instanceof Error ? reason.message : "비교 실패");
    } finally { if (current === epoch.current) setBusy(false); }
  }
  function measure() {
    try {
      if (report && report.measurements.length >= 100) throw new RangeError("리포트당 측정 100개까지 저장할 수 있습니다.");
      const value = measureGeometry({ kind, points: points.slice(0, kind === "angle" ? 3 : 2), normal });
      setMeasurement(value); setError(null);
      if (report) {
        setReport({ ...report, measurements: [...report.measurements, value] });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "측정 실패"); }
  }
  function download(format: "json" | "csv" | "html") {
    if (!report) return;
    const mime = { json: "application/json", csv: "text/csv", html: "text/html" };
    const url = URL.createObjectURL(new Blob([serializeResultReport(report, format)], { type: `${mime[format]};charset=utf-8` }));
    const link = document.createElement("a"); link.href = url; link.download = `cnc-result.${format}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setLastExport(`${format.toUpperCase()} 리포트 저장`);
  }
  const pointCount = kind === "angle" ? 3 : 2;

  return <section className="result-comparison" aria-label="목표 형상·가공 결과 비교" data-testid="result-comparison">
    <header className="result-comparison__header"><div><h2>목표 / 결과 비교</h2><p>E2 · 실제 Stock checkpoint와 독립 작성 목표 비교</p></div>
      <button className="cnc-button" onClick={() => void compare()} disabled={!enabled || busy}>{busy ? "비교 중…" : "현재 Stock 비교"}</button></header>
    {!enabled && <p>공정이 완료 또는 충돌 정지된 뒤 현재 Stock을 비교할 수 있습니다.</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <div className="result-comparison__modes" role="group" aria-label="결과 비교 모드">
        {(["overlay", "split", "heatmap"] as const).map((item) => <button key={item} className="cnc-button" aria-pressed={mode === item} onClick={() => setMode(item)}>{item === "overlay" ? "Overlay" : item === "split" ? "Split" : "Heatmap"}</button>)}
      </div>
      <canvas ref={canvas} className="result-comparison__canvas" aria-label="실제 Stock와 목표 형상 비교 지도. 표면을 클릭하면 선택한 측정점에 좌표가 입력됩니다." data-testid="result-comparison-canvas"
        onClick={(event) => { const sample = canvas.current && view.current?.pick(canvas.current, event.clientX, event.clientY); if (sample) { setPicked(sample); setPoints((previous) => previous.map((point, index) => index === pickPoint ? sample.point : point)); } }} />
      <p className="result-comparison__legend" data-testid="result-legend"><span>− 과절삭 (파랑)</span><span>0 일치 (회색)</span><span>+ 미절삭 (주황)</span> 범위 ±{report.maxDeviationMm.toFixed(6)} mm · 목표 파선</p>
      {displaySummary?.reduced && <p data-testid="result-display-lod">표시 LOD: 전체 {displaySummary.totalSamples} 표본 중 실제 {displaySummary.displayedSamples} 표본만 표시·선택합니다. 생략된 셀의 국부 형상은 표시되지 않으며, 통계와 리포트는 Worker가 계산한 전체 Stock 기준입니다.</p>}
      {picked && <p role="status">셀 {picked.index}: 실제 {picked.actualMm.toFixed(6)} mm / 목표 {picked.targetMm.toFixed(6)} mm / 편차 {picked.deviationMm.toFixed(6)} mm</p>}
      <div className="result-comparison__summary"><dl><dt>실행 결과</dt><dd data-testid="result-outcome">{report.outcome === "completed" ? "완료" : "정지 (미완료 Stock)"}</dd><dt>목표</dt><dd>{report.targetId}</dd><dt>비교 셀</dt><dd>{report.comparedCells}</dd><dt>출처</dt><dd data-testid="result-provenance">{report.fixtureId} · {report.runId}</dd></dl>
        <table aria-label="결과 비교 통계"><thead><tr><th scope="col">항목</th><th scope="col">값</th></tr></thead><tbody>{resultReportRows(report).map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td data-result-key={row.key} data-canonical-value={row.value}>{row.value.toFixed(6)} {row.unit}</td></tr>)}</tbody></table></div>
      <p>평균: 밀링 셀 면적 / 선삭 layer 폭 가중치. P95: 셀별 절대 편차 최근접 순위(선삭은 내·외경 중 최대). 모든 모드가 같은 데이터·범례·통계를 사용합니다.</p>
    </>}
    <section className="result-comparison__measurement" aria-label="기하 측정 도구"><h3>기하 측정</h3>
      <p>Stock 지도를 클릭하거나 정규 좌표(mm)를 직접 입력합니다. 직경·반경은 점 A=중심, B=원주점입니다. 각도는 A–B–C의 B가 꼭짓점입니다. 깊이·벽 두께는 입력한 평행 기준면 법선 방향의 거리입니다.</p>
      <div className="result-comparison__controls"><label>측정 종류<select aria-label="측정 종류" value={kind} onChange={(event) => { setKind(event.target.value as MeasurementKind); setPickPoint(0); }}>{MEASUREMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>길이 표시<select aria-label="길이 표시 단위" value={lengthUnit} onChange={(event) => setLengthUnit(event.target.value as "mm" | "in")}><option value="mm">mm</option><option value="in">in</option></select></label>
        <label>각도 표시<select aria-label="각도 표시 단위" value={angleUnit} onChange={(event) => setAngleUnit(event.target.value as "deg" | "rad")}><option value="deg">deg</option><option value="rad">rad</option></select></label>
        <label>클릭 대상<select aria-label="측정점 선택" value={pickPoint} onChange={(event) => setPickPoint(Number(event.target.value))}>{Array.from({ length: pointCount }, (_, index) => <option key={index} value={index}>점 {String.fromCharCode(65 + index)}</option>)}</select></label></div>
      {points.slice(0, pointCount).map((point, index) => <fieldset key={index}><legend>점 {String.fromCharCode(65 + index)} (mm)</legend><div className="result-comparison__coordinates">{AXES.map((axis) => <label key={axis}>{axis[0].toUpperCase()}<input aria-label={`점 ${String.fromCharCode(65 + index)} ${axis[0].toUpperCase()} mm`} type="number" step="any" value={Number.isFinite(point[axis]) ? point[axis] : ""} onChange={(event) => { const value = event.target.valueAsNumber; setPoints((previous) => previous.map((entry, item) => item === index ? { ...entry, [axis]: value } : entry)); }} /></label>)}</div></fieldset>)}
      {(kind === "depth" || kind === "wall-thickness") && <fieldset><legend>기준면 법선 (무차원)</legend><div className="result-comparison__coordinates">{AXES.map((axis) => <label key={axis}>{axis[0].toUpperCase()}<input aria-label={`법선 ${axis[0].toUpperCase()}`} type="number" step="any" value={Number.isFinite(normal[axis]) ? normal[axis] : ""} onChange={(event) => setNormal({ ...normal, [axis]: event.target.valueAsNumber })} /></label>)}</div></fieldset>}
      <button className="cnc-button" onClick={measure}>측정 계산</button>
      {measurement && <output className="result-comparison__measurement-value" data-testid="measurement-value" data-canonical-value={measurement.canonicalValue}>{displayMeasurement(measurement, lengthUnit, angleUnit).text}</output>}
      <p>표시 단위 변경은 입력 좌표·내부 Float64 값·저장값을 변경하지 않습니다. 임의 좌표 입력 측정은 Stock 표면 정확도를 보증하지 않습니다.</p>
    </section>
    {report && <div className="result-comparison__exports" aria-label="결과 리포트 내보내기"><button className="cnc-button" onClick={() => download("json")}>JSON 저장</button><button className="cnc-button" onClick={() => download("csv")}>CSV 저장</button><button className="cnc-button" onClick={() => download("html")}>인쇄 HTML 저장</button><span role="status">{lastExport}</span></div>}
    <p className="result-comparison__notice">E2 교육용 근사 · {report ? `${report.representationResolutionMm} mm` : "현재 Stock"} 해상도 미만 형상, 버·표면 조도·열 변형은 평가하지 않습니다. 산업용 공차 검증이 아닙니다.</p>
  </section>;
}
