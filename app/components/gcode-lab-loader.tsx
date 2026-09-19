"use client";

import { lazy, Suspense } from "react";
import type { GcodeLabPanelProps } from "./gcode-lab-panel";

export type { GcodeLabPanelProps, GcodeLabRuntimeDiagnostic, GcodeLabExecutionState } from "./gcode-lab-panel";

const GcodeLabPanel = lazy(async () => {
  const loaded = await import("./gcode-lab-panel");
  return { default: loaded.GcodeLabPanel };
});

export function GcodeLabLoader(props: GcodeLabPanelProps) {
  return (
    <Suspense
      fallback={
        <div className="gcode-lab-loading" role="status">
          G-code 편집기와 분석 Worker를 불러오고 있습니다.
        </div>
      }
    >
      <GcodeLabPanel {...props} />
    </Suspense>
  );
}
