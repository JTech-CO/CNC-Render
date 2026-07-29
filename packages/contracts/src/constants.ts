export const SCHEMA_VERSION = 1 as const;
export const WORKER_PROTOCOL_VERSION = 1 as const;

export const PROJECT_SCHEMA_ID =
  "urn:cnc-render:schema:project:1" as const;
export const WORKER_SCHEMA_ID =
  "urn:cnc-render:schema:worker-protocol:1" as const;

export const PROJECT_EXTENSION = ".cncrender" as const;
export const PROJECT_MEDIA_TYPE =
  "application/vnd.cnc-render.project+zip" as const;
export const PROJECT_ROOT_DOCUMENT = "project.json" as const;
