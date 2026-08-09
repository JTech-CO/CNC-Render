export const WORKSPACE_COMMAND_EVENT = "cnc-render:workspace-command";
export const WORKSPACE_STATUS_EVENT = "cnc-render:workspace-status";

export type WorkspaceCommand =
  | { readonly type: "play-toggle" }
  | { readonly type: "stop" }
  | { readonly type: "save" };

export interface WorkspaceStatus {
  readonly state:
    | "loading"
    | "idle"
    | "starting"
    | "running"
    | "paused"
    | "completed"
    | "stopped"
    | "cancelled"
    | "error";
  readonly fixture: "milling" | "turning" | "collision-stop" | null;
  readonly saved?: boolean;
}

export function dispatchWorkspaceCommand(command: WorkspaceCommand): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceCommand>(WORKSPACE_COMMAND_EVENT, {
      detail: command,
    }),
  );
}
