"use client";

import { lazy, Suspense } from "react";

const MachineWorkspace = lazy(async () => {
  const loadedWorkspace = await import("./machine-workspace");
  return { default: loadedWorkspace.MachineWorkspace };
});

export function MachineWorkspaceLoader() {
  return (
    <Suspense
      fallback={
        <div className="workspace-loading" role="status">
          3D 작업실을 준비하고 있습니다.
        </div>
      }
    >
      <MachineWorkspace />
    </Suspense>
  );
}
