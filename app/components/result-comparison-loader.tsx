"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";
import type { ResultComparisonInput } from "../../packages/simulation/src/result-comparison";
import type { M11ResultBridge } from "./m11-result-bridge";

const Panel = lazy(async () => {
  const loaded = await import("./result-comparison-panel");
  return { default: loaded.ResultComparisonPanel };
});

export function ResultComparisonLoader({ bridge, enabled, capture }: {
  readonly bridge: M11ResultBridge;
  readonly enabled: boolean;
  readonly capture: () => Promise<ResultComparisonInput>;
}) {
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
  return <>
    {snapshot.requiresRerun ? <p role="status">불러온 Stock은 현재 Worker 실행 세션과 다릅니다. 재실행 후 결과를 비교하세요.</p> : null}
    <Suspense fallback={<p role="status">측정·결과 비교 도구를 불러오고 있습니다.</p>}>
      <Panel key={snapshot.runId} enabled={enabled && !snapshot.requiresRerun} capture={capture} />
    </Suspense>
  </>;
}
