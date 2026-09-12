"use client";

import type { GcodeAnalysisDiagnostic, GcodeAnalysisResult } from "@cnc-render/contracts";
import { GcodeAnalysisClient } from "@cnc-render/simulation";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./gcode-lab.css";

export interface GcodeLabRuntimeDiagnostic {
  readonly id: string;
  readonly code: string;
  readonly origin: "axis-limit" | "collision" | "machining-warning";
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly sourceLine: number | null;
  readonly objectId: string | null;
  readonly positionMm: { readonly xMm: number; readonly yMm: number; readonly zMm: number } | null;
}
export interface GcodeLabPanelProps {
  readonly source: string;
  readonly currentSourceLine?: number | null;
  readonly breakpoints?: readonly number[];
  readonly executionStatus?: string;
  readonly runtimeDiagnostics?: readonly GcodeLabRuntimeDiagnostic[];
  readonly selectedDiagnosticId?: string | null;
  readonly onSourceChange?: (source: string) => void;
  readonly onSelectDiagnostic?: (id: string | null) => void;
  readonly onFocusDiagnostic?: (id: string) => void;
  readonly subscribeExecution?: (listener: (state: GcodeLabExecutionState) => void) => () => void;
  readonly onRun?: (source: string) => Promise<void> | void;
  readonly onStep?: (source: string) => Promise<void> | void;
  readonly onPause?: () => Promise<void> | void;
  readonly onStop?: () => Promise<void> | void;
  readonly onToggleBreakpoint?: (line: number) => void;
  readonly onResetSource?: () => string;
}
export interface GcodeLabExecutionState {
  readonly source?: string | null;
  readonly currentSourceLine: number | null;
  readonly executionStatus: string;
  readonly runtimeDiagnostics: readonly GcodeLabRuntimeDiagnostic[];
}
type EditorLoadState = "loading" | "ready" | "failed";
type GcodeLabAnalysis = Pick<GcodeAnalysisResult, "schemaVersion" | "coreVersion" | "wasm" | "phase" | "dialect" | "accepted" | "sourceHashSha256" | "diagnostics" | "toolpathId">;
interface DisplayDiagnostic {
  readonly id: string;
  readonly code: string;
  readonly origin: "parser" | GcodeLabRuntimeDiagnostic["origin"];
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly range: GcodeAnalysisDiagnostic["range"] | null;
  readonly supportLevel: string | null;
  readonly spatial: boolean;
  readonly objectId: string | null;
  readonly help: string;
}
interface GcodeLabHarnessState {
  readonly editorLoadState: EditorLoadState;
  readonly workerMode: "dedicated";
  readonly selectedDiagnosticId: string | null;
  readonly analysis: GcodeLabAnalysis | null;
  readonly source: string;
  readonly currentSourceLine: number | null;
  readonly breakpoints: readonly number[];
}
interface GcodeLabHarness { getState(): GcodeLabHarnessState }
declare global { interface Window { __CNC_RENDER_M11__?: GcodeLabHarness } }
function installHarness(harness: GcodeLabHarness): () => void {
  window.__CNC_RENDER_M11__ = harness;
  return () => { delete window.__CNC_RENDER_M11__; };
}

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker(_moduleId: string, _label: string): Worker };
};
monacoGlobal.MonacoEnvironment ??= { getWorker: () => new EditorWorker() };
const EMPTY_DIAGNOSTICS: readonly GcodeLabRuntimeDiagnostic[] = [];
const EMPTY_BREAKPOINTS: readonly number[] = [];
const DIAGNOSTICS_PER_PAGE = 50;

function parserHelp(diagnostic: GcodeAnalysisDiagnostic): string {
  if (diagnostic.code.includes("cutter_comp")) return "G41/G42 공구 반경 보정은 인식하지만 common-v1에서 실행하지 않습니다. CAM에서 공구 중심 경로를 계산한 G0/G1/G2/G3 프로그램으로 내보내세요. 보정을 단순 삭제하면 형상이 달라질 수 있으므로 자동 대체하지 않습니다.";
  if (diagnostic.supportLevel !== "supported") return "이 코드는 common-v1 실행 지원 범위 밖입니다. 컨트롤러의 명령 의미를 확인하고 지원되는 명시적 이동 명령으로 프로그램을 다시 작성하세요. 동일한 동작을 보장할 수 없어 자동 대체하지 않습니다.";
  if (diagnostic.code.includes("feed")) return "절삭 이동 전에 양수 이송 F 값을 지정하고 G20/G21 단위와 이동 모드를 확인하세요.";
  if (diagnostic.code.includes("arc")) return "원호 끝점, I/J/K 중심 오프셋 또는 R 반지름과 G17/G18/G19 평면을 확인하세요. 시작·끝 반지름이 일치해야 합니다.";
  return "표시된 원본 줄과 파서 메시지를 확인하세요. 구문·모달 상태·수치 입력을 수정하면 150 ms 뒤 Rust/WASM 파서가 다시 분석합니다.";
}
function runtimeHelp(origin: GcodeLabRuntimeDiagnostic["origin"]): string {
  if (origin === "axis-limit") return "축 이동 한계를 초과했습니다. 원본 줄의 목표 좌표, 단위와 절대/증분 모드를 확인하고 작업영역 안으로 수정하세요.";
  if (origin === "collision") return "런타임 충돌 위치입니다. 공구·홀더·고정구 간섭과 안전 높이를 확인한 뒤 경로를 수정하세요. 중지된 실행은 수정 후 새로 시작해야 합니다.";
  return "재료 제거 엔진이 보고한 가공 경고입니다. 빠른 이동 중 소재 진입, 절입 깊이와 공구 설정을 확인하세요. E2 근사 결과이며 산업용 검증이 아닙니다.";
}
function makeDiagnostics(analysis: GcodeLabAnalysis | null, runtime: readonly GcodeLabRuntimeDiagnostic[]): DisplayDiagnostic[] {
  return [
    ...(analysis?.diagnostics ?? []).map((d) => ({ id: d.id, code: d.code, origin: d.origin, severity: d.severity, message: d.message, range: d.range, supportLevel: d.supportLevel, spatial: false, objectId: null, help: parserHelp(d) })),
    ...runtime.map((d) => ({ id: d.id, code: d.code, origin: d.origin, severity: d.severity, message: d.message, range: d.sourceLine === null ? null : { start: { line: d.sourceLine, column: 1 }, end: { line: d.sourceLine, column: 2 } }, supportLevel: null, spatial: d.positionMm !== null && d.objectId !== null, objectId: d.objectId, help: runtimeHelp(d.origin) })),
  ];
}

export function GcodeLabPanel(props: GcodeLabPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; }, [props]);
  const diagnosticsRef = useRef<readonly DisplayDiagnostic[]>([]);
  const sourceRef = useRef(props.source);
  const [lastRunSource, setLastRunSource] = useState(props.source);
  const harnessRef = useRef<GcodeLabHarnessState>({ editorLoadState: "loading", workerMode: "dedicated", selectedDiagnosticId: null, analysis: null, source: props.source, currentSourceLine: null, breakpoints: [] });
  const [analysis, setAnalysis] = useState<GcodeLabAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState(props.source);
  const [cursorLine, setCursorLine] = useState(1);
  const [diagnosticPage, setDiagnosticPage] = useState(0);
  const [execution, setExecution] = useState<GcodeLabExecutionState | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const executionRef = useRef<GcodeLabExecutionState | null>(null);
  useEffect(() => { executionRef.current = execution; }, [execution]);
  const status = execution?.executionStatus ?? props.executionStatus ?? "idle";
  const executionMatchesSource = execution?.source !== undefined ? execution.source === draftSource : draftSource === lastRunSource;
  const currentSourceLine = executionMatchesSource ? execution?.currentSourceLine ?? props.currentSourceLine ?? null : null;
  const running = status === "running" || status === "starting" || status === "initializing" || status === "loading";
  const locked = running || status === "paused" || actionPending;
  const breakpoints = props.breakpoints ?? EMPTY_BREAKPOINTS;
  const runtime = executionMatchesSource ? execution?.runtimeDiagnostics ?? props.runtimeDiagnostics ?? EMPTY_DIAGNOSTICS : EMPTY_DIAGNOSTICS;
  const diagnostics = useMemo(() => makeDiagnostics(analysis, runtime), [analysis, runtime]);
  useEffect(() => { diagnosticsRef.current = diagnostics; }, [diagnostics]);
  const effectiveSelectedId = props.selectedDiagnosticId === undefined ? selectedId : props.selectedDiagnosticId;
  const selected = diagnostics.find(({ id }) => id === effectiveSelectedId);
  const selectedIndex = diagnostics.findIndex(({ id }) => id === effectiveSelectedId);
  const pageCount = Math.max(1, Math.ceil(diagnostics.length / DIAGNOSTICS_PER_PAGE));
  const visiblePage = selectedIndex >= 0 ? Math.floor(selectedIndex / DIAGNOSTICS_PER_PAGE) : Math.min(diagnosticPage, pageCount - 1);
  const pageDiagnostics = diagnostics.slice(visiblePage * DIAGNOSTICS_PER_PAGE, (visiblePage + 1) * DIAGNOSTICS_PER_PAGE);
  const canExecute = analysis?.accepted === true && !running && !actionPending && errorMessage === null;

  const revealDiagnostic = useCallback((diagnostic: DisplayDiagnostic, focus: boolean) => {
    setSelectedId(diagnostic.id);
    harnessRef.current = { ...harnessRef.current, selectedDiagnosticId: diagnostic.id };
    if (hostRef.current) {
      hostRef.current.dataset.focusedLine = diagnostic.range ? String(diagnostic.range.start.line) : "";
      hostRef.current.dataset.selectedDiagnosticId = diagnostic.id;
    }
    if (diagnostic.range) {
      const { start, end } = diagnostic.range;
      editorRef.current?.setSelection(new monaco.Range(start.line, start.column, end.line, end.column));
      editorRef.current?.revealLineInCenter(start.line);
      if (focus) editorRef.current?.focus();
    }
  }, []);
  const selectDiagnostic = useCallback((diagnostic: DisplayDiagnostic) => {
    revealDiagnostic(diagnostic, true);
    propsRef.current.onSelectDiagnostic?.(diagnostic.id);
  }, [revealDiagnostic]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!monaco.languages.getLanguages().some(({ id }) => id === "cnc-gcode")) {
      monaco.languages.register({ id: "cnc-gcode" });
      monaco.languages.setMonarchTokensProvider("cnc-gcode", { ignoreCase: true, tokenizer: { root: [[/[;].*$/u, "comment"], [/\([^)]*\)/u, "comment"], [/[GMTFSXYZABCIJKPQRH][-+]?\d+(?:\.\d+)?/u, "keyword"], [/N\d+/u, "number"]] } });
    }
    monaco.editor.defineTheme("cnc-render-light", { base: "vs", inherit: true, rules: [{ token: "keyword", foreground: "174EA6", fontStyle: "bold" }, { token: "comment", foreground: "5F6B7A" }], colors: { "editor.background": "#F7F9FB", "editor.foreground": "#17202A", "editorLineNumber.foreground": "#657386", "editorLineNumber.activeForeground": "#17202A", "editorError.foreground": "#B42318" } });
    const model = monaco.editor.createModel(sourceRef.current, "cnc-gcode", monaco.Uri.parse("inmemory://cnc-render/active-program.nc"));
    const editor = monaco.editor.create(host, { model, theme: "cnc-render-light", automaticLayout: true, fontFamily: "var(--font-family-mono)", fontSize: 13, glyphMargin: true, lineDecorationsWidth: 24, lineNumbersMinChars: 2, minimap: { enabled: false }, overviewRulerLanes: 1, renderLineHighlight: "all", scrollBeyondLastLine: false, smoothScrolling: false, wordWrap: "off", ariaLabel: "G-code 편집기" });
    editorRef.current = editor;
    decorationsRef.current = editor.createDecorationsCollection();
    const client = new GcodeAnalysisClient();
    let disposed = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const analyze = async (requestedRevision: number, source: string) => {
      try {
        if (!source.trim()) throw new Error("G-code 프로그램을 입력하세요.");
        const result = await client.analyze({ schemaVersion: 1, dialect: "common-v1", source });
        if (disposed || revision !== requestedRevision) return;
        // Full source maps belong to the analysis/runtime boundary, not React state.
        const summary: GcodeLabAnalysis = { schemaVersion: result.schemaVersion, coreVersion: result.coreVersion, wasm: result.wasm, phase: result.phase, dialect: result.dialect, accepted: result.accepted, sourceHashSha256: result.sourceHashSha256, diagnostics: result.diagnostics, toolpathId: result.toolpathId };
        harnessRef.current = { ...harnessRef.current, editorLoadState: "ready", analysis: summary };
        host.dataset.analysisState = "ready";
        setAnalysis(summary);
      } catch (error: unknown) {
        if (disposed || revision !== requestedRevision) return;
        harnessRef.current = { ...harnessRef.current, editorLoadState: "failed", analysis: null };
        host.dataset.analysisState = "failed";
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    };
    const schedule = (delay: number) => {
      revision += 1;
      const requestedRevision = revision;
      const source = model.getValue();
      sourceRef.current = source;
      setDraftSource(source); setAnalysis(null); setErrorMessage(null); setSelectedId(null);
      monaco.editor.setModelMarkers(model, "cnc-render-gcode-analysis", []);
      harnessRef.current = { ...harnessRef.current, editorLoadState: "loading", analysis: null, source, selectedDiagnosticId: null };
      host.dataset.analysisState = "loading"; host.dataset.selectedDiagnosticId = ""; host.dataset.focusedLine = "";
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void analyze(requestedRevision, source), delay);
    };
    const content = model.onDidChangeContent(() => {
      schedule(150);
      propsRef.current.onSourceChange?.(model.getValue());
      propsRef.current.onSelectDiagnostic?.(null);
    });
    const pointer = editor.onMouseDown((event) => {
      const line = event.target.position?.lineNumber;
      if (!line) return;
      if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) { propsRef.current.onToggleBreakpoint?.(line); return; }
      const diagnostic = diagnosticsRef.current.find((candidate) => candidate.range?.start.line === line);
      if (diagnostic) selectDiagnostic(diagnostic);
    });
    const cursor = editor.onDidChangeCursorPosition(({ position }) => setCursorLine(position.lineNumber));
    editor.addAction({ id: "cnc-render.toggle-breakpoint", label: "중단점 전환", keybindings: [monaco.KeyCode.F9], run: () => { const line = editor.getPosition()?.lineNumber; if (line) propsRef.current.onToggleBreakpoint?.(line); } });
    editor.addAction({ id: "cnc-render.step-source-line", label: "원본 줄 단위 실행", keybindings: [monaco.KeyCode.F10], run: () => {
      if (harnessRef.current.analysis?.accepted && !["running", "starting", "initializing", "loading"].includes(executionRef.current?.executionStatus ?? propsRef.current.executionStatus ?? "idle")) {
        const source = model.getValue();
        setLastRunSource(source);
        setExecutionError(null);
        setActionPending(true);
        void Promise.resolve().then(() => propsRef.current.onStep?.(source)).catch((error: unknown) => setExecutionError(error instanceof Error ? error.message : String(error))).finally(() => setActionPending(false));
      }
    } });
    const removeHarness = installHarness({ getState: () => ({ ...harnessRef.current }) });
    void analyze(0, sourceRef.current);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      content.dispose(); pointer.dispose(); cursor.dispose();
      decorationsRef.current?.clear(); decorationsRef.current = null;
      monaco.editor.setModelMarkers(model, "cnc-render-gcode-analysis", []);
      client.dispose(); editor.dispose(); model.dispose(); editorRef.current = null;
      removeHarness();
    };
  }, [selectDiagnostic]);

  const subscribeExecution = props.subscribeExecution;
  useEffect(() => subscribeExecution?.(setExecution), [subscribeExecution]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== props.source) editor.setValue(props.source);
  }, [props.source]);
  useEffect(() => { editorRef.current?.updateOptions({ readOnly: locked }); }, [locked]);
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const visibleDiagnostics = diagnosticsRef.current;
    monaco.editor.setModelMarkers(model, "cnc-render-gcode-analysis", visibleDiagnostics.flatMap((d) => d.range ? [{ severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: d.message, code: d.code, source: d.origin + " · Rust/WASM", startLineNumber: d.range.start.line, startColumn: d.range.start.column, endLineNumber: d.range.end.line, endColumn: d.range.end.column }] : []));
    const decorations: monaco.editor.IModelDeltaDecoration[] = visibleDiagnostics.flatMap((d) => d.range ? [{ range: new monaco.Range(d.range.start.line, d.range.start.column, d.range.end.line, d.range.end.column), options: { className: "gcode-diagnostic-range", glyphMarginClassName: "gcode-error-glyph", glyphMarginHoverMessage: { value: (d.severity === "error" ? "오류" : "경고") + " · " + d.code }, hoverMessage: { value: d.message }, isWholeLine: d.origin !== "parser", linesDecorationsClassName: "gcode-error-line-label" } }] : []);
    for (const line of breakpoints) {
      if (line > 0 && line <= model.getLineCount()) decorations.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, glyphMarginClassName: "gcode-breakpoint-glyph", glyphMarginHoverMessage: { value: "◆ 중단점 · " + line + "행 (실행 전 정지)" }, linesDecorationsClassName: "gcode-breakpoint-line-label" } });
    }
    const line = currentSourceLine;
    if (line !== null && line > 0 && line <= model.getLineCount()) {
      decorations.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "gcode-current-range", glyphMarginClassName: "gcode-current-glyph", glyphMarginHoverMessage: { value: "▶ 현재 실행 줄 · " + line + "행" }, linesDecorationsClassName: "gcode-current-line-label" } });
      editorRef.current?.revealLineInCenterIfOutsideViewport(line);
    }
    decorationsRef.current?.set(decorations);
    harnessRef.current = { ...harnessRef.current, currentSourceLine: line, breakpoints: [...breakpoints] };
  }, [analysis, runtime, breakpoints, currentSourceLine]);
  useEffect(() => {
    const diagnostic = diagnosticsRef.current.find(({ id }) => id === props.selectedDiagnosticId);
    if (diagnostic) revealDiagnostic(diagnostic, false);
    else if (props.selectedDiagnosticId === null) {
      harnessRef.current = { ...harnessRef.current, selectedDiagnosticId: null };
      if (hostRef.current) { hostRef.current.dataset.selectedDiagnosticId = ""; hostRef.current.dataset.focusedLine = ""; }
    }
  }, [props.selectedDiagnosticId, revealDiagnostic, runtime]);

  const run = (step: boolean) => {
    if (!canExecute) return;
    const source = sourceRef.current;
    setLastRunSource(source);
    setExecutionError(null);
    setActionPending(true);
    void Promise.resolve().then(() => step ? props.onStep?.(source) : props.onRun?.(source)).catch((error: unknown) => setExecutionError(error instanceof Error ? error.message : String(error))).finally(() => setActionPending(false));
  };
  const control = (callback: (() => Promise<void> | void) | undefined) => {
    if (!callback || actionPending) return;
    setExecutionError(null); setActionPending(true);
    void Promise.resolve().then(callback).catch((error: unknown) => setExecutionError(error instanceof Error ? error.message : String(error))).finally(() => setActionPending(false));
  };
  return (
    <section className="gcode-lab" data-testid="gcode-lab">
      <div className="gcode-lab-intro"><p className="context-kicker">G-CODE LAB · RUST/WASM</p><h3>실행 프로그램 편집</h3><p>common-v1 · 편집 후 150 ms 재분석 · 실행 중에는 코드 편집이 잠깁니다.</p></div>
      <div className="gcode-lab-controls" aria-label="G-code 실행 제어">
        <button type="button" data-testid="gcode-run" disabled={!canExecute || !props.onRun} onClick={() => run(false)}>{status === "paused" ? "계속 실행" : "코드 실행"}</button>
        <button type="button" data-testid="gcode-step" disabled={!canExecute || !props.onStep} onClick={() => run(true)}>줄 단위 실행 (F10)</button>
        <button type="button" disabled={!running || actionPending || !props.onPause} onClick={() => control(props.onPause)}>일시정지</button>
        <button type="button" disabled={!locked || actionPending || !props.onStop} onClick={() => control(props.onStop)}>정지</button>
        <button type="button" data-testid="gcode-toggle-breakpoint" disabled={!props.onToggleBreakpoint} onClick={() => props.onToggleBreakpoint?.(cursorLine)}>중단점 전환 (F9)</button>
        {props.onResetSource ? <button type="button" disabled={locked} onClick={() => { const source = props.onResetSource?.(); if (source !== undefined) editorRef.current?.setValue(source); }}>대표 프로그램 복원</button> : null}
      </div>
      <div className="gcode-line-legend" aria-label="코드 줄 표시 범례"><span>▶ 현재 줄 {currentSourceLine ?? "—"}</span><span>! 오류 / 경고</span><span>◆ 중단점 {breakpoints.length ? breakpoints.join(", ") : "없음"}</span></div>
      <div className="gcode-editor" data-analysis-state="loading" data-focused-line="" data-selected-diagnostic-id="" data-testid="gcode-editor" ref={hostRef} />
      <div className="gcode-diagnostics" aria-live="polite">
        <div className="gcode-diagnostics-heading"><strong>진단</strong><span>{analysis ? diagnostics.length + "건 · " + (analysis.accepted ? "분석 통과" : "실행 불가") : errorMessage ? "분석 실패" : "분석 중"}</span></div>
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        {executionError ? <p role="alert">{executionError}</p> : null}
        <ul aria-label="G-code 진단 목록">{pageDiagnostics.map((d) => (
          <li aria-current={effectiveSelectedId === d.id ? "true" : undefined} data-diagnostic-id={d.id} data-testid="gcode-diagnostic-item" key={d.id}>
            <button type="button" aria-pressed={effectiveSelectedId === d.id} onClick={() => selectDiagnostic(d)}><span className="gcode-diagnostic-icon" aria-hidden="true">!</span><span><strong>{d.severity === "error" ? "오류" : "경고"} · {d.range ? d.range.start.line + "행" : "원본 줄 없음"}</strong><code>{d.code}</code><span>{d.origin}</span>{d.supportLevel ? <><span>{d.supportLevel}</span><span>자동 대체 불가</span></> : null}</span></button>
          </li>
        ))}</ul>
        {pageCount > 1 ? <nav className="gcode-diagnostic-pages" aria-label="진단 페이지">
          <button type="button" disabled={visiblePage === 0} onClick={() => { setSelectedId(null); props.onSelectDiagnostic?.(null); setDiagnosticPage(visiblePage - 1); }}>이전 진단</button>
          <span>{visiblePage + 1} / {pageCount} 페이지 · 페이지당 최대 {DIAGNOSTICS_PER_PAGE}건</span>
          <button type="button" disabled={visiblePage + 1 >= pageCount} onClick={() => { setSelectedId(null); props.onSelectDiagnostic?.(null); setDiagnosticPage(visiblePage + 1); }}>다음 진단</button>
        </nav> : null}
        {selected ? <section className="gcode-diagnostic-help" aria-label="선택 진단 도움말" data-testid="gcode-diagnostic-help"><strong>{selected.code}</strong><p>{selected.message}</p><p>{selected.help}</p>{selected.objectId ? <p>대상 객체: {selected.objectId}</p> : null}<button type="button" data-testid="gcode-focus-diagnostic" disabled={!selected.spatial || !props.onFocusDiagnostic} onClick={() => props.onFocusDiagnostic?.(selected.id)}>{selected.spatial ? "3D 위치로 이동" : "3D 위치 없음"}</button></section> : null}
      </div>
      <p className="context-note">E2 교육용 근사 · 산업용 검증 도구가 아닙니다. 파서 오류에 임의의 3D 좌표를 부여하지 않으며 실제 런타임 위치만 연결합니다.</p>
    </section>
  );
}
