import {
  CheckpointIndexSchema,
  CloudPersistencePlanSchema,
  DEFAULT_AUTOSAVE_INTERVAL_S,
  DEFAULT_CHECKPOINT_INTERVAL_S,
  DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
  PROJECT_CONTAINER_EXTENSION,
  PROJECT_CONTAINER_MEDIA_TYPE,
  ProjectContainerManifestSchema,
  StorageTelemetryEventSchema,
} from "@cnc-render/contracts";
import { describe, expect, test } from "vitest";

const HASH = "8".repeat(64);
const PROJECT_ID = "80000000-0000-4000-8000-000000000001";

function manifest() {
  return {
    schemaVersion: 1,
    engineVersion: "0.1.0",
    unitSystem: "metric",
    projectSchemaVersion: 1,
    projectSemanticHashSha256: HASH,
    authoritativeProjectSemanticHashSha256: HASH,
    entries: [
      {
        path: "project.json",
        role: "project",
        mediaType: "application/json",
        byteLength: 1_024,
        sha256: HASH,
        authoritative: true,
      },
    ],
    manifestChecksumSha256: HASH,
  };
}

function checkpointIndex() {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    engineVersion: "0.1.0",
    checkpointIntervalS: DEFAULT_CHECKPOINT_INTERVAL_S,
    checkpoints: [
      {
        schemaVersion: 1,
        id: "80000000-0000-4000-8000-000000000002",
        projectId: PROJECT_ID,
        engineVersion: "0.1.0",
        sequence: 1,
        logicalTimeS: 3,
        boundary: "interval",
        payloadPath:
          "checkpoints/80000000-0000-4000-8000-000000000002.bin",
        byteLength: 512,
        sha256: HASH,
        stateSemanticHashSha256: HASH,
        stockHashSha256: HASH,
      },
    ],
  };
}

describe("M8 project-container contract", () => {
  test("fixes the portable container identity and the 100 MiB admission limit", () => {
    expect(PROJECT_CONTAINER_EXTENSION).toBe(".cncrender");
    expect(PROJECT_CONTAINER_MEDIA_TYPE).toBe(
      "application/vnd.cnc-render.project+zip",
    );
    expect(DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES).toBe(104_857_600);
    expect(DEFAULT_AUTOSAVE_INTERVAL_S).toBe(30);
    expect(ProjectContainerManifestSchema.safeParse(manifest()).success).toBe(
      true,
    );
  });

  test("requires one authoritative project entry, sorted unique paths, and strict fields", () => {
    const missingProject = manifest();
    missingProject.entries = [];
    expect(
      ProjectContainerManifestSchema.safeParse(missingProject).success,
    ).toBe(false);

    const unsorted = manifest();
    unsorted.entries = [
      ...unsorted.entries,
      {
        path: "assets/model.glb",
        role: "machine-model",
        mediaType: "model/gltf-binary",
        byteLength: 20,
        sha256: HASH,
        authoritative: true,
      },
    ];
    expect(ProjectContainerManifestSchema.safeParse(unsorted).success).toBe(
      false,
    );

    const unknown = { ...manifest(), sourceGcode: "G0 X0" };
    expect(ProjectContainerManifestSchema.safeParse(unknown).success).toBe(
      false,
    );
  });

  test("keeps checkpoint intervals within 2 to 5 seconds or explicit boundaries", () => {
    for (const checkpointIntervalS of [2, 3, 5]) {
      const index = checkpointIndex();
      index.checkpointIntervalS = checkpointIntervalS;
      expect(CheckpointIndexSchema.safeParse(index).success).toBe(true);
    }
    for (const checkpointIntervalS of [1.999, 5.001]) {
      const index = checkpointIndex();
      index.checkpointIntervalS = checkpointIntervalS;
      expect(CheckpointIndexSchema.safeParse(index).success).toBe(false);
    }

    const regressing = checkpointIndex();
    regressing.checkpoints.push({
      ...regressing.checkpoints[0],
      id: "80000000-0000-4000-8000-000000000003",
      sequence: 1,
      logicalTimeS: 2,
      payloadPath:
        "checkpoints/80000000-0000-4000-8000-000000000003.bin",
    });
    expect(CheckpointIndexSchema.safeParse(regressing).success).toBe(false);
  });

  test("telemetry and the cloud stub cannot contain project source bytes", () => {
    const telemetry = {
      schemaVersion: 1,
      eventName: "storage.operation",
      operation: "save",
      outcome: "success",
      projectIdHashSha256: HASH,
      byteLength: 1_024,
      durationMs: 12,
      userContentConsent: false,
      containsSourceContent: false,
      diagnosticCode: null,
    };
    expect(StorageTelemetryEventSchema.safeParse(telemetry).success).toBe(true);
    expect(
      StorageTelemetryEventSchema.safeParse({
        ...telemetry,
        sourceGcode: "G21 G90",
      }).success,
    ).toBe(false);
    expect(
      StorageTelemetryEventSchema.safeParse({
        ...telemetry,
        containsSourceContent: true,
      }).success,
    ).toBe(false);

    expect(
      CloudPersistencePlanSchema.parse({
        schemaVersion: 1,
        enabled: false,
        reason: "user-consent-required",
        d1Binding: null,
        r2Binding: null,
        containsProjectBytes: false,
      }),
    ).toBeTruthy();
  });
});
