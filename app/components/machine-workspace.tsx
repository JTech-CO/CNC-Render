"use client";

import {
  CAMERA_PRESETS,
  SCENE_LAYERS,
  type CameraPresetId,
  type RendererPreference,
  type RendererTelemetry,
  type SceneLayerId,
} from "@cnc-render/renderer";
import type {
  WorkcellRenderer,
  WorkcellRendererDiagnostics,
  WorkcellRendererStatus,
} from "@cnc-render/renderer/workcell";
import { useEffect, useRef } from "react";

interface CncRenderM3Harness {
  getDiagnostics(): WorkcellRendererDiagnostics;
  getReactCommitCount(): number;
  setView(view: CameraPresetId): void;
  fit(): void;
  focusLayer(layerId: SceneLayerId): void;
  orbit(azimuthDegrees: number, polarDegrees: number): void;
  pan(horizontalMm: number, verticalMm: number): void;
  zoom(factor: number): void;
  setLayerVisibility(layerId: SceneLayerId, visible: boolean): void;
}

declare global {
  interface Window {
    __CNC_RENDER_M3__?: CncRenderM3Harness;
  }
}

function requestedRendererPreference(): RendererPreference {
  const requested = new URLSearchParams(window.location.search).get("renderer");
  return requested === "webgpu" || requested === "webgl2"
    ? requested
    : "auto";
}

function formattedMetric(value: number, fractionDigits = 1): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : "—";
}

function viewLabel(view: WorkcellRendererStatus["cameraView"]): string {
  return view === "custom" ? "사용자 시점" : CAMERA_PRESETS[view].label;
}

function workspaceIcon(kind: "scene" | "code" | "learn" | "report") {
  const paths = {
    scene: (
      <>
        <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </>
    ),
    code: (
      <>
        <path d="m8 6-5 6 5 6M16 6l5 6-5 6M14 3l-4 18" />
      </>
    ),
    learn: (
      <>
        <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23.5z" />
        <path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5a3.5 3.5 0 0 1 3.5 3.5z" />
      </>
    ),
    report: (
      <>
        <path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}

export function MachineWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorkcellRenderer | null>(null);
  const commitCountRef = useRef(0);
  const modeBadgeRef = useRef<HTMLSpanElement>(null);
  const backendDetailRef = useRef<HTMLParagraphElement>(null);
  const cameraReadoutRef = useRef<HTMLSpanElement>(null);
  const selectionReadoutRef = useRef<HTMLSpanElement>(null);
  const frameReadoutRef = useRef<HTMLSpanElement>(null);
  const frameCountRef = useRef<HTMLSpanElement>(null);
  const resourceReadoutRef = useRef<HTMLParagraphElement>(null);
  const limitsRef = useRef<HTMLUListElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    commitCountRef.current += 1;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) {
      return;
    }

    let resizeTimer: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;

    const updateStatus = (status: WorkcellRendererStatus) => {
      const mode = status.backend.mode;
      const modeLabel =
        mode === "webgpu"
          ? "WebGPU"
          : mode === "webgl2"
            ? "WebGL 2"
            : "사용 불가";

      viewport.dataset.rendererMode = mode ?? "unavailable";
      viewport.dataset.cameraView = status.cameraView;
      viewport.dataset.selectedLayer = status.selectedLayer ?? "none";

      if (modeBadgeRef.current) {
        modeBadgeRef.current.textContent = modeLabel;
        modeBadgeRef.current.dataset.mode = mode ?? "unavailable";
      }
      if (cameraReadoutRef.current) {
        cameraReadoutRef.current.textContent = viewLabel(status.cameraView);
      }
      if (selectionReadoutRef.current) {
        const selected = SCENE_LAYERS.find(
          (layer) => layer.id === status.selectedLayer,
        );
        selectionReadoutRef.current.textContent =
          selected?.label ?? "선택 없음";
      }
      if (backendDetailRef.current) {
        backendDetailRef.current.textContent =
          status.runtimeWarning ??
          (mode === "webgpu"
            ? "GPU 렌더 경로 · 4× MSAA · compute 준비"
            : mode === "webgl2"
              ? "안전 폴백 · CPU/WASM 메시 프리뷰"
              : "WebGPU 또는 WebGL 2가 필요합니다.");
      }
      if (limitsRef.current) {
        const items = status.backend.limits.map((limit) => {
          const item = document.createElement("li");
          const label = document.createElement("span");
          const value = document.createElement("strong");
          label.textContent = limit.label;
          value.textContent = limit.value;
          item.append(label, value);
          return item;
        });
        limitsRef.current.replaceChildren(...items);
      }
    };

    const updateTelemetry = (telemetry: RendererTelemetry) => {
      viewport.dataset.renderFrames = String(telemetry.framesRendered);
      viewport.dataset.reactCommits = String(commitCountRef.current);

      if (frameReadoutRef.current) {
        frameReadoutRef.current.textContent = `${formattedMetric(
          telemetry.averageFrameMs,
        )} ms`;
      }
      if (frameCountRef.current) {
        frameCountRef.current.textContent =
          `${telemetry.framesRendered.toLocaleString("en-US")} frames`;
      }
      if (resourceReadoutRef.current) {
        const { geometries, textures, programs } = telemetry.resources;
        resourceReadoutRef.current.textContent =
          `${geometries} geometry · ${textures} texture · ${programs} program`;
      }
    };

    void import("@cnc-render/renderer/workcell")
      .then(({ WorkcellRenderer: RuntimeWorkcellRenderer }) => {
        if (disposed) {
          return null;
        }

        const renderer = new RuntimeWorkcellRenderer({
          canvas,
          preference: requestedRendererPreference(),
          onStatus: updateStatus,
          onTelemetry: updateTelemetry,
        });
        rendererRef.current = renderer;

        const resize = () => {
          const bounds = viewport.getBoundingClientRect();
          renderer.resize(bounds.width, bounds.height);
        };
        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer !== null) {
            window.clearTimeout(resizeTimer);
          }
          resizeTimer = window.setTimeout(resize, 80);
        });
        resizeObserver.observe(viewport);

        return renderer.initialize().then((status) => ({
          renderer,
          resize,
          status,
        }));
      })
      .then((result) => {
        if (disposed || !result) {
          return;
        }
        const { renderer, resize, status } = result;
        updateStatus(status);
        resize();
        viewport.dataset.ready = "true";
        window.__CNC_RENDER_M3__ = {
          getDiagnostics: () => renderer.getDiagnostics(),
          getReactCommitCount: () => commitCountRef.current,
          setView: (view) => renderer.setCameraPreset(view),
          fit: () => renderer.fit(),
          focusLayer: (layerId) => renderer.focusLayer(layerId),
          orbit: (azimuthDegrees, polarDegrees) =>
            renderer.orbitByDegrees(azimuthDegrees, polarDegrees),
          pan: (horizontalMm, verticalMm) =>
            renderer.panByMm(horizontalMm, verticalMm),
          zoom: (factor) => renderer.zoomBy(factor),
          setLayerVisibility: (layerId, visible) =>
            renderer.setLayerVisibility(layerId, visible),
        };
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        viewport.dataset.ready = "error";
        if (errorRef.current) {
          errorRef.current.hidden = false;
          errorRef.current.textContent =
            error instanceof Error
              ? error.message
              : "3D 렌더러를 시작하지 못했습니다.";
        }
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      rendererRef.current?.dispose();
      rendererRef.current = null;
      delete window.__CNC_RENDER_M3__;
    };
  }, []);

  const setView = (view: CameraPresetId) => {
    rendererRef.current?.setCameraPreset(view);
  };

  return (
    <div className="workspace-grid">
      <nav className="activity-rail" aria-label="작업 영역">
        <button className="activity-button is-active" type="button">
          {workspaceIcon("scene")}
          <span>장면</span>
        </button>
        <button className="activity-button" type="button">
          {workspaceIcon("code")}
          <span>코드</span>
        </button>
        <button className="activity-button" type="button">
          {workspaceIcon("learn")}
          <span>학습</span>
        </button>
        <button className="activity-button" type="button">
          {workspaceIcon("report")}
          <span>결과</span>
        </button>
      </nav>

      <aside className="scene-panel" aria-labelledby="scene-heading">
        <div className="panel-heading">
          <div>
            <p>SCENE GRAPH</p>
            <h2 id="scene-heading">VMC 교육 Fixture</h2>
          </div>
          <span className="panel-count">6 layers</span>
        </div>

        <div className="scene-tree" role="tree" aria-label="렌더 장면 레이어">
          <div
            className="tree-root"
            role="treeitem"
            aria-expanded="true"
            aria-selected="false"
          >
            <span className="tree-disclosure" aria-hidden="true">
              ▾
            </span>
            <span className="tree-root-mark" aria-hidden="true" />
            <strong>VMC-3X-EDU</strong>
          </div>
          <div className="tree-children" role="group">
            {SCENE_LAYERS.map((layer) => (
              <label
                className="layer-row"
                data-layer-id={layer.id}
                key={layer.id}
              >
                <input
                  type="checkbox"
                  defaultChecked={layer.defaultVisible}
                  onChange={(event) =>
                    rendererRef.current?.setLayerVisibility(
                      layer.id,
                      event.currentTarget.checked,
                    )
                  }
                />
                <span
                  className={`layer-swatch layer-swatch-${layer.id}`}
                  aria-hidden="true"
                />
                <span className="layer-copy">
                  <strong>{layer.label}</strong>
                  <small>{layer.collisionGroupId}</small>
                </span>
                <code>{layer.collisionMask}</code>
              </label>
            ))}
          </div>
        </div>

        <div className="scene-panel-note">
          <span>좌표계</span>
          <strong>G54 · X/Y/Z · mm</strong>
          <p>렌더 경계는 1 scene unit = 1 mm를 사용합니다.</p>
        </div>
      </aside>

      <section className="viewport-shell" aria-labelledby="viewport-heading">
        <header className="viewport-toolbar">
          <div className="viewport-title">
            <span className="status-dot" aria-hidden="true" />
            <div>
              <p>3D WORKSPACE</p>
              <h1 id="viewport-heading">Machine setup</h1>
            </div>
          </div>
          <div className="view-actions" aria-label="카메라 시점">
            {(["front", "top", "right", "isometric"] as const).map(
              (view) => (
                <button
                  data-view={view}
                  key={view}
                  onClick={() => setView(view)}
                  type="button"
                >
                  {CAMERA_PRESETS[view].label}
                </button>
              ),
            )}
            <button
              className="fit-button"
              data-view="fit"
              onClick={() => rendererRef.current?.fit()}
              type="button"
            >
              맞춤 <kbd>F</kbd>
            </button>
          </div>
        </header>

        <div
          className="viewport-stage"
          data-camera-view="isometric"
          data-react-commits="0"
          data-ready="false"
          data-render-frames="0"
          data-renderer-mode="detecting"
          data-testid="machine-viewport"
          ref={viewportRef}
        >
          <canvas
            aria-label="CNC 수직형 머시닝 센터 3D 장면. 우클릭 드래그로 회전, 중클릭 드래그로 이동, 휠로 확대하며 F 키로 장면을 맞춥니다."
            data-testid="machine-canvas"
            ref={canvasRef}
            tabIndex={0}
          />
          <div className="viewport-axis" aria-hidden="true">
            <span className="axis-z">Z</span>
            <span className="axis-x">X</span>
            <span className="axis-y">Y</span>
          </div>
          <div className="viewport-mode" aria-live="polite">
            <span ref={modeBadgeRef}>감지 중</span>
            <p ref={backendDetailRef}>렌더링 기능을 확인하고 있습니다.</p>
          </div>
          <div className="viewport-error" hidden ref={errorRef} role="alert" />
          <div className="viewport-help" aria-label="3D 조작 도움말">
            <span>우클릭 Orbit</span>
            <span>중클릭 Pan</span>
            <span>휠 Zoom</span>
            <span>
              <kbd>Esc</kbd> 선택 해제
            </span>
          </div>
        </div>

        <footer className="viewport-status" aria-label="렌더 상태">
          <span>
            시점 <strong ref={cameraReadoutRef}>등각</strong>
          </span>
          <span>
            선택 <strong ref={selectionReadoutRef}>선택 없음</strong>
          </span>
          <span>
            평균 프레임 <strong ref={frameReadoutRef}>— ms</strong>
          </span>
          <span ref={frameCountRef}>0 frames</span>
        </footer>
      </section>

      <aside className="inspector-panel" aria-labelledby="inspector-heading">
        <div className="panel-heading inspector-heading">
          <div>
            <p>INSPECTOR</p>
            <h2 id="inspector-heading">렌더 진단</h2>
          </div>
          <span className="accuracy-badge">E2</span>
        </div>

        <section className="inspector-section" aria-labelledby="backend-heading">
          <div className="section-label">
            <h3 id="backend-heading">Backend limits</h3>
            <span>자동 감지</span>
          </div>
          <ul className="limit-list" ref={limitsRef}>
            <li>
              <span>상태</span>
              <strong>확인 중</strong>
            </li>
          </ul>
        </section>

        <section className="inspector-section" aria-labelledby="camera-heading">
          <div className="section-label">
            <h3 id="camera-heading">Camera</h3>
            <span>Perspective 38°</span>
          </div>
          <dl className="metric-grid">
            <div>
              <dt>Focus range</dt>
              <dd>180–5,000 mm</dd>
            </div>
            <div>
              <dt>Near / Far</dt>
              <dd>1 / 10,000 mm</dd>
            </div>
          </dl>
          <button
            className="secondary-control"
            onClick={() => rendererRef.current?.focusLayer("stock")}
            type="button"
          >
            소재 범위에 포커스
          </button>
        </section>

        <section
          className="inspector-section"
          aria-labelledby="resource-heading"
        >
          <div className="section-label">
            <h3 id="resource-heading">Resource telemetry</h3>
            <span>on demand</span>
          </div>
          <p className="resource-line" ref={resourceReadoutRef}>
            0 geometry · 0 texture · 0 program
          </p>
          <p className="inspector-explanation">
            프레임은 카메라·크기·레이어가 바뀔 때만 예약되며 React commit과
            분리됩니다.
          </p>
        </section>

        <aside className="education-disclaimer">
          <strong>교육용 시각 Fixture · 정확도 E2</strong>
          <p>
            현재 장면은 렌더러·카메라 계약 검증용입니다. 산업용 충돌 검증이나
            실제 장비 제어 결과가 아닙니다.
          </p>
        </aside>
      </aside>

      <section className="bottom-dock" aria-labelledby="dock-heading">
        <header className="dock-tabs">
          <h2 id="dock-heading">Program preview</h2>
          <div role="tablist" aria-label="하단 패널">
            <button aria-selected="true" role="tab" type="button">
              G-code
            </button>
            <button aria-selected="false" role="tab" type="button">
              Diagnostics <span>0</span>
            </button>
          </div>
        </header>
        <div className="program-preview">
          <ol aria-label="교육용 G-code 미리보기">
            <li>
              <code>G21 G17 G90</code>
              <span>mm · XY plane · absolute</span>
            </li>
            <li>
              <code>G54 G0 X-145 Y-70 Z370</code>
              <span>fixture start</span>
            </li>
            <li className="is-current">
              <code>G1 Z338 F420</code>
              <span>preview segment</span>
            </li>
            <li>
              <code>G1 X145</code>
              <span>toolpath guide</span>
            </li>
          </ol>
          <div className="dock-summary">
            <span>Fixture</span>
            <strong>M3-machine-scene</strong>
            <span>Execution</span>
            <strong>정적 렌더 검증</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
