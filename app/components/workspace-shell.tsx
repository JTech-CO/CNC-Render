"use client";

import { Button, Dialog } from "@cnc-render/ui";
import { useEffect, useState } from "react";
import { MachineWorkspaceLoader } from "./machine-workspace-loader";
import {
  WORKSPACE_STATUS_EVENT,
  dispatchWorkspaceCommand,
  type WorkspaceStatus,
} from "./workspace-events";

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 6h22v20H5z" />
      <path d="M10 11h12v10H10zM16 11v10" />
      <path d="M2 10h3M27 10h3M2 22h3M27 22h3" />
    </svg>
  );
}

function playLabel(state: WorkspaceStatus["state"]): string {
  if (state === "running" || state === "starting") {
    return "일시정지";
  }
  if (state === "paused") {
    return "계속";
  }
  return "실행";
}

function statusLabel(state: WorkspaceStatus["state"]): string {
  switch (state) {
    case "loading":
      return "준비 중";
    case "starting":
    case "running":
      return "실행 중";
    case "paused":
      return "일시정지";
    case "completed":
      return "완료";
    case "stopped":
      return "충돌 정지";
    case "cancelled":
      return "취소됨";
    case "error":
      return "오류";
    case "idle":
      return "준비";
  }
}

interface WorkspaceControlsProps {
  readonly onHelp: () => void;
}

function WorkspaceControls({ onHelp }: WorkspaceControlsProps) {
  const [runState, setRunState] =
    useState<WorkspaceStatus["state"]>("loading");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const updateStatus = (event: Event) => {
      const status = (event as CustomEvent<WorkspaceStatus>).detail;
      setRunState(status.state);
      if (status.saved) {
        setSaved(true);
      }
    };

    window.addEventListener(WORKSPACE_STATUS_EVENT, updateStatus);
    return () =>
      window.removeEventListener(WORKSPACE_STATUS_EVENT, updateStatus);
  }, []);

  return (
    <>
      <nav className="project-breadcrumb" aria-label="현재 프로젝트">
        <span>Projects</span>
        <span aria-hidden="true">/</span>
        <strong>VMC setup study</strong>
        <span className="saved-state">
          {saved ? "로컬 저장됨" : "로컬 Fixture"}
        </span>
      </nav>

      <div className="command-actions" aria-label="시뮬레이션 명령">
        <span className="run-state" data-state={runState}>
          {statusLabel(runState)}
        </span>
        <Button
          disabled={runState === "loading" || runState === "error"}
          onClick={() => dispatchWorkspaceCommand({ type: "play-toggle" })}
          variant="primary"
        >
          {playLabel(runState)}
        </Button>
        <Button onClick={() => dispatchWorkspaceCommand({ type: "stop" })}>
          정지
        </Button>
        <Button onClick={() => dispatchWorkspaceCommand({ type: "save" })}>
          저장
        </Button>
        <span className="milestone-label">M9 · WORKSPACE &amp; A11Y</span>
        <Button data-testid="open-help" onClick={onHelp}>
          도움말
        </Button>
      </div>
    </>
  );
}

export function WorkspaceShell() {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <main className="application-shell">
      <header className="command-bar">
        <a className="product-brand" href="./" aria-label="CNC Render 작업실">
          <span className="product-mark">
            <BrandMark />
          </span>
          <span className="product-name">
            <strong>CNC Render</strong>
            <small>Learning simulator</small>
          </span>
        </a>

        <WorkspaceControls onHelp={() => setHelpOpen(true)} />
      </header>

      <MachineWorkspaceLoader />

      <Dialog
        data-testid="help-dialog"
        onDismiss={() => setHelpOpen(false)}
        open={helpOpen}
        title="CNC Render 도움말"
      >
        <section className="help-section">
          <h3>작업 영역</h3>
          <p>
            장면은 3D 설정, 코드는 현재 G-code, 학습은 다음 단계 안내,
            결과는 실행 요약을 표시합니다. 고급 편집기는 M11에서 제공됩니다.
          </p>
        </section>
        <section className="help-section">
          <h3>실행과 절삭</h3>
          <p>
            상단 실행 버튼으로 Worker/WASM 파이프라인을 시작합니다. 일시정지와
            계속, 정지를 사용할 수 있고 재생 중 공구 위치와 소재 형상이
            직접 갱신됩니다.
          </p>
        </section>
        <section className="help-section">
          <h3>3D 키보드</h3>
          <dl className="help-shortcuts">
            <div>
              <dt><kbd>F</kbd></dt>
              <dd>전체 장면 맞춤</dd>
            </div>
            <div>
              <dt><kbd>0</kbd>–<kbd>3</kbd></dt>
              <dd>등각·정면·상단·우측 시점</dd>
            </div>
            <div>
              <dt><kbd>Esc</kbd></dt>
              <dd>선택 해제 또는 도움말 닫기</dd>
            </div>
          </dl>
        </section>
        <aside className="education-disclaimer">
          <strong>교육용 근사 시뮬레이션 · 정확도 E2</strong>
          <p>
            산업용 검증 도구나 실제 장비 제어 결과와 동일하지 않습니다.
          </p>
        </aside>
      </Dialog>
    </main>
  );
}
