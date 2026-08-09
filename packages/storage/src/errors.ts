export type PersistenceStage =
  | "checkpoint"
  | "export"
  | "import"
  | "load"
  | "migration"
  | "recovery"
  | "save";

export class ProjectPersistenceError extends Error {
  readonly diagnosticCode: string;
  readonly stage: PersistenceStage;
  readonly recoverable: boolean;

  constructor(
    diagnosticCode: string,
    stage: PersistenceStage,
    message: string,
    options: { readonly cause?: unknown; readonly recoverable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProjectPersistenceError";
    this.diagnosticCode = diagnosticCode;
    this.stage = stage;
    this.recoverable = options.recoverable ?? false;
  }
}

export function persistenceFailure(
  diagnosticCode: string,
  stage: PersistenceStage,
  message: string,
  options?: { readonly cause?: unknown; readonly recoverable?: boolean },
): ProjectPersistenceError {
  return new ProjectPersistenceError(diagnosticCode, stage, message, options);
}
