import {
  DEFAULT_CHECKPOINT_INTERVAL_S,
  DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
  ENGINE_VERSION,
  PROJECT_SCHEMA_ID,
  ProjectSchema,
  canonicalJson,
  semanticHash,
  type CheckpointIndex,
  type CoordinatorRunRequest,
  type JsonValue,
  type PersistedComponentHashes,
  type PersistedDiagnostic,
  type PersistedMeasurement,
  type PersistedStateSnapshot,
  type Project,
  type ProjectContainerManifest,
} from "@cnc-render/contracts";
import {
  CLOUD_PERSISTENCE_PLAN,
  IndexedDbGenerationMetadataPort,
  OpfsGenerationFilePort,
  ProjectPersistenceError,
  ProjectRepository,
  authoritativeProjectDocument,
  canonicalJsonBytes,
  decodeSimulationCheckpoint,
  encodeDeterministicZip,
  encodeSimulationCheckpoint,
  exportProjectContainer,
  importProjectContainer,
  projectManifestChecksum,
  sha256Hex,
  type SaveProjectGenerationInput,
} from "@cnc-render/storage";
import {
  createM7PipelineFixture,
  type CoordinatorCheckpoint,
  type M7MillingConfigurationInput,
} from "@cnc-render/simulation";

import type { M7PipelineHarness } from "./m7-pipeline-adapter";

const PROJECT_ID = "83000000-0000-4000-8000-000000000001";
const MACHINE_ID = "83000000-0000-4000-8000-000000000002";
const AXIS_ID = "83000000-0000-4000-8000-000000000003";
const SPINDLE_ID = "83000000-0000-4000-8000-000000000004";
const MATERIAL_ID = "83000000-0000-4000-8000-000000000005";
const SETUP_ID = "83000000-0000-4000-8000-000000000006";
const TOOL_ID = "83000000-0000-4000-8000-000000000007";
const STOCK_ID = "83000000-0000-4000-8000-000000000008";
const OPERATION_ID = "83000000-0000-4000-8000-000000000009";
const GCODE_RESOURCE_ID = "83000000-0000-4000-8000-00000000000a";
const MEASUREMENT_ID = "83000000-0000-4000-8000-00000000000b";
const RESTORED_TOOLPATH_ID = "83000000-0000-4000-8000-00000000000c";

export interface M8SaveReport {
  readonly projectId: string;
  readonly generationId: string;
  readonly checkpointId: string;
  readonly componentHashes: PersistedComponentHashes;
  readonly stateSemanticHashSha256: string;
  readonly stockHashSha256: string;
  readonly currentStep: number;
  readonly logicalTimeS: number;
  readonly checkpointByteLength: number;
}

export interface M8LoadReport extends M8SaveReport {
  readonly renderedOnFrame: number;
  readonly recoveryOutcomes: readonly string[];
}

export interface M8InterruptedSaveReport {
  readonly beforeGenerationId: string;
  readonly afterGenerationId: string;
  readonly recoveryOutcome: "recovered" | "quarantined";
  readonly diagnosticCode: string | null;
  readonly quarantineCount: number;
}

export interface M8MigrationReport {
  readonly migratedFromSchemaVersion: number | null;
  readonly schemaVersion: number;
  readonly originalPreserved: boolean;
  readonly originalSha256: string;
  readonly deterministicSeed: number;
}

export interface M8CorruptionReport {
  readonly diagnosticCode: string;
  readonly defaultUploadLimitBytes: number;
}

export interface M8PersistenceHarness {
  saveFixture(
    fixture?: "milling" | "turning",
    millingConfiguration?: M7MillingConfigurationInput,
  ): Promise<M8SaveReport>;
  loadPersistedProject(): Promise<M8LoadReport>;
  testInterruptedSave(): Promise<M8InterruptedSaveReport>;
  testMigrationFixture(): Promise<M8MigrationReport>;
  testCorruptionFixture(): Promise<M8CorruptionReport>;
  getCloudPlan(): typeof CLOUD_PERSISTENCE_PLAN;
}

declare global {
  interface Window {
    __CNC_RENDER_M8__?: M8PersistenceHarness;
  }
}

const encoder = new TextEncoder();

function jsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

async function representativeProject(
  fixture: "milling" | "turning",
  run: CoordinatorRunRequest,
): Promise<Project> {
  const source = run.source;
  const gcodeBytes = encoder.encode(source);
  const turning = run.process.processType === "turning";
  if ((fixture === "turning") !== turning) {
    throw new Error("Persistence fixture and process type must match.");
  }
  const stockGeometry =
    run.process.processType === "turning"
      ? {
          primitiveType: "cylinder" as const,
          diameterMm: run.process.stock.diameterMm,
          lengthMm: run.process.stock.lengthMm,
        }
      : {
          primitiveType: "box" as const,
          sizeMm: run.process.stock.sizeMm,
        };
  const stockPositionMm = run.process.stock.positionMm;
  const stockResolutionMm = run.process.stock.baseResolutionMm;
  return ProjectSchema.parse({
    $schema: PROJECT_SCHEMA_ID,
    schemaVersion: 1,
    id: PROJECT_ID,
    name: turning ? "M8 turning persistence" : "M8 milling persistence",
    createdAt: "2026-08-09T00:00:00Z",
    updatedAt: "2026-08-09T00:00:00Z",
    unitSystem: "metric",
    machineId: MACHINE_ID,
    stockId: STOCK_ID,
    operationIds: [OPERATION_ID],
    machines: [
      {
        schemaVersion: 1,
        id: MACHINE_ID,
        name: turning ? "Training lathe" : "Training VMC",
        machineType: turning ? "lathe" : "vertical-machining-center",
        kinematicRootAxisIds: [AXIS_ID],
        axes: [
          {
            schemaVersion: 1,
            id: AXIS_ID,
            name: "X",
            kind: "linear",
            parentId: null,
            directionUnit: { x: 1, y: 0, z: 0 },
            pivotMm: { xMm: 0, yMm: 0, zMm: 0 },
            minMm: -500,
            maxMm: 500,
            maxVelocityMmPerMin: 12_000,
            maxAccelerationMmPerS2: 1_200,
            homeMm: 0,
          },
        ],
        spindles: [
          {
            schemaVersion: 1,
            id: SPINDLE_ID,
            name: "Main spindle",
            maxSpindleSpeedRpm: turning ? 4_500 : 12_000,
          },
        ],
        workEnvelope: {
          minMm: { xMm: -500, yMm: -500, zMm: -500 },
          maxMm: { xMm: 500, yMm: 500, zMm: 500 },
        },
        maxFeedMmPerMin: 12_000,
        modelAssetResourceId: null,
        collisionGroups: [],
      },
    ],
    materials: [
      {
        schemaVersion: 1,
        id: MATERIAL_ID,
        name: "Aluminum 6061",
        materialGroup: "aluminum",
        densityKgPerM3: 2_700,
      },
    ],
    setups: [
      {
        schemaVersion: 1,
        id: SETUP_ID,
        name: "Training setup",
        workOffsetMm: { xMm: 0, yMm: 0, zMm: 0 },
        rotationRad: { xRad: 0, yRad: 0, zRad: 0 },
        fixtureResourceIds: [],
      },
    ],
    toolAssemblies: [
      {
        schemaVersion: 1,
        id: TOOL_ID,
        name: turning ? "Training turning insert" : "4 mm flat end mill",
        toolType: turning ? "turning-tool" : "milling-cutter",
        cutterGeometry: {
          geometryType: turning ? "turning-insert" : "flat-end-mill",
          diameterMm: turning ? 12 : 4,
          cornerRadiusMm: turning ? 0.4 : 0,
          fluteCount: turning ? 1 : 3,
          cuttingLengthMm: turning ? 12 : 12,
          overallLengthMm: turning ? 60 : 50,
        },
        holderGeometry: {
          diameterMm: turning ? 20 : 20,
          lengthMm: turning ? 80 : 35,
        },
        gaugeLengthMm: turning ? 75 : 48,
        stickoutLengthMm: turning ? 30 : 24,
        maxSpindleSpeedRpm: turning ? 4_500 : 12_000,
        wearRatio: 0,
        materialCompatibilityIds: [MATERIAL_ID],
      },
    ],
    stocks: [
      {
        schemaVersion: 1,
        id: STOCK_ID,
        name: turning ? "Training billet" : "Training block",
        geometry: stockGeometry,
        transform: {
          positionMm: stockPositionMm,
          rotationRad: { xRad: 0, yRad: 0, zRad: 0 },
        },
        materialId: MATERIAL_ID,
        representationType: turning ? "voxel" : "dexel",
        resolutionMm: stockResolutionMm,
        sourceModelResourceId: null,
      },
    ],
    operations: [
      {
        schemaVersion: 1,
        id: OPERATION_ID,
        name: turning ? "Representative turning" : "Representative milling",
        operationType: turning ? "turning" : "milling",
        setupId: SETUP_ID,
        toolAssemblyId: TOOL_ID,
        strategy: turning ? "longitudinal" : "contour",
        feed: { mode: "per-minute", feedMmPerMin: 6_000 },
        spindleSpeedRpm: turning ? 2_000 : 6_000,
        spindleDirection: "clockwise",
        depthOfCutMm: 1,
        widthOfCutMm: turning ? 1 : 2,
        targetGeometryResourceId: null,
        generatedToolpathId: null,
      },
    ],
    toolpaths: [],
    resources: [
      {
        schemaVersion: 1,
        id: GCODE_RESOURCE_ID,
        path: "programs/main.nc",
        role: "gcode-program",
        mediaType: "text/x-gcode",
        byteLength: gcodeBytes.byteLength,
        sha256: await sha256Hex(gcodeBytes),
        authoritative: true,
      },
    ],
    settings: {
      schemaVersion: 1,
      accuracyPreset: "balanced",
      displayDecimalPlaces: 3,
      deterministicSeed: 7,
    },
  });
}

function diagnosticRecords(
  codes: readonly string[],
): readonly PersistedDiagnostic[] {
  return codes.map((code) => ({
    code,
    severity: "warning",
    sourceLine: null,
    messageKey: code,
  }));
}

function measurementRecords(
  removedVolumeMm3: number,
): readonly PersistedMeasurement[] {
  return [
    {
      schemaVersion: 1,
      id: MEASUREMENT_ID,
      quantity: "volume",
      valueMm3: removedVolumeMm3,
      representationResolutionMm: 1,
    },
  ];
}

async function semantic(value: unknown): Promise<string> {
  return semanticHash(jsonValue(value));
}

async function generationInput(
  fixture: "milling" | "turning",
  checkpoint: CoordinatorCheckpoint,
  generationId: string,
  millingConfiguration: M7MillingConfigurationInput = {},
): Promise<{
  readonly input: SaveProjectGenerationInput;
  readonly checkpointId: string;
  readonly checkpointByteLength: number;
}> {
  const summary = checkpoint.summary;
  const run = createM7PipelineFixture(
    fixture,
    summary.runId,
    millingConfiguration,
  );
  const project = await representativeProject(fixture, run);
  const projectHash = await semantic(project);
  const encodedCheckpoint = await encodeSimulationCheckpoint(
    {
      schemaVersion: 1,
      engineVersion: summary.coreVersion,
      projectId: PROJECT_ID,
      projectSemanticHashSha256: projectHash,
      runId: summary.runId,
      currentStep: summary.currentStep,
      totalSteps: summary.totalSteps,
      logicalTimeS: summary.logicalTimeS,
      toolPositionMm: summary.toolPositionMm,
      stockRevision: summary.stockRevision,
      stateSemanticHashSha256: summary.stateSemanticHashSha256,
      stockHashSha256: summary.stockHashSha256,
      diagnosticCodes: summary.diagnosticCodes,
      completed: summary.completed,
      stopped: summary.stopped,
    },
    checkpoint.render,
  );
  const checkpointId = crypto.randomUUID();
  const checkpointPath = `checkpoints/${checkpointId}.bin`;
  const checkpointSha256 = await sha256Hex(encodedCheckpoint.bytes);
  const diagnostics = diagnosticRecords(summary.diagnosticCodes);
  const measurements = measurementRecords(summary.removedVolumeMm3);
  const componentHashes: PersistedComponentHashes = {
    projectSha256: projectHash,
    machineSha256: await semantic(project.machines[0]),
    toolSha256: await semantic(project.toolAssemblies[0]),
    operationSha256: await semantic(project.operations[0]),
    gcodeSha256: await sha256Hex(encoder.encode(run.source)),
    stockSha256: summary.stockHashSha256,
    diagnosticsSha256: await semantic(diagnostics),
    measurementsSha256: await semantic(measurements),
  };
  const stateSnapshot: PersistedStateSnapshot = {
    schemaVersion: 1,
    engineVersion: summary.coreVersion,
    projectId: PROJECT_ID,
    machineId: MACHINE_ID,
    toolAssemblyId: TOOL_ID,
    operationId: OPERATION_ID,
    gcodeResourcePath: "programs/main.nc",
    logicalTimeS: summary.logicalTimeS,
    stock: {
      representation:
        fixture === "turning" ? "lathe-radius-field" : "milling-dexel",
      revision: summary.stockRevision,
      stockHashSha256: summary.stockHashSha256,
      payloadPath: checkpointPath,
      payloadByteLength: encodedCheckpoint.bytes.byteLength,
      payloadSha256: checkpointSha256,
    },
    diagnostics: [...diagnostics],
    measurements: [...measurements],
    componentHashes,
    stateSemanticHashSha256: summary.stateSemanticHashSha256,
  };
  const checkpointIndex: CheckpointIndex = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    engineVersion: summary.coreVersion,
    checkpointIntervalS: DEFAULT_CHECKPOINT_INTERVAL_S,
    checkpoints: [
      {
        schemaVersion: 1,
        id: checkpointId,
        projectId: PROJECT_ID,
        engineVersion: summary.coreVersion,
        sequence: 1,
        logicalTimeS: summary.logicalTimeS,
        boundary:
          summary.completed || summary.stopped ? "terminal" : "operation",
        payloadPath: checkpointPath,
        byteLength: encodedCheckpoint.bytes.byteLength,
        sha256: checkpointSha256,
        stateSemanticHashSha256: summary.stateSemanticHashSha256,
        stockHashSha256: summary.stockHashSha256,
      },
    ],
  };
  return {
    input: {
      projectId: PROJECT_ID,
      generationId,
      engineVersion: summary.coreVersion,
      stateSnapshot,
      checkpointIndex,
      files: [
        {
          path: "project.json",
          bytes: canonicalJsonBytes(jsonValue(project)),
        },
        { path: "programs/main.nc", bytes: encoder.encode(run.source) },
        { path: checkpointPath, bytes: encodedCheckpoint.bytes },
      ],
    },
    checkpointId,
    checkpointByteLength: encodedCheckpoint.bytes.byteLength,
  };
}

function saveReport(
  input: SaveProjectGenerationInput,
  checkpointId: string,
  checkpointByteLength: number,
  currentStep: number,
): M8SaveReport {
  return {
    projectId: input.projectId,
    generationId: input.generationId,
    checkpointId,
    componentHashes: input.stateSnapshot.componentHashes,
    stateSemanticHashSha256: input.stateSnapshot.stateSemanticHashSha256,
    stockHashSha256: input.stateSnapshot.stock.stockHashSha256,
    currentStep,
    logicalTimeS: input.stateSnapshot.logicalTimeS,
    checkpointByteLength,
  };
}

function restoredCheckpoint(
  decoded: Awaited<ReturnType<typeof decodeSimulationCheckpoint>>,
  state: PersistedStateSnapshot,
): CoordinatorCheckpoint {
  const removedVolume = state.measurements.find(
    (measurement) => measurement.quantity === "volume",
  );
  return {
    summary: {
      schemaVersion: 1,
      coreVersion: decoded.header.engineVersion,
      wasm: true,
      phase: "snapshot",
      runId: decoded.header.runId,
      fixtureId: "m8-restored",
      processType:
        decoded.render.renderType === "turning-full" ? "turning" : "milling",
      toolpathId: RESTORED_TOOLPATH_ID,
      parseSemanticHashSha256: state.componentHashes.gcodeSha256,
      stateSemanticHashSha256: decoded.header.stateSemanticHashSha256,
      finalSemanticHashSha256:
        decoded.header.completed || decoded.header.stopped
          ? decoded.header.stateSemanticHashSha256
          : null,
      stockHashSha256: decoded.header.stockHashSha256,
      currentStep: decoded.header.currentStep,
      totalSteps: decoded.header.totalSteps,
      logicalTimeS: decoded.header.logicalTimeS,
      toolPositionMm: decoded.header.toolPositionMm,
      stockRevision: decoded.header.stockRevision,
      removedVolumeMm3:
        removedVolume?.quantity === "volume" ? removedVolume.valueMm3 : 0,
      diagnosticCodes: decoded.header.diagnosticCodes,
      collision: null,
      completed: decoded.header.completed,
      stopped: decoded.header.stopped,
      render: null,
      binaryLayout: [],
      binaryByteLength: decoded.header.payloadByteLength,
    },
    render: decoded.render,
  };
}

function locateBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (
    let offset = 0;
    offset <= haystack.byteLength - needle.byteLength;
    offset += 1
  ) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        continue outer;
      }
    }
    return offset;
  }
  return -1;
}

export function attachM8Persistence(
  pipeline: M7PipelineHarness,
  viewport: HTMLElement,
): { readonly harness: M8PersistenceHarness; dispose(): void } {
  const metadata = new IndexedDbGenerationMetadataPort();
  const files = new OpfsGenerationFilePort();
  const repository = new ProjectRepository(metadata, files);

  async function saveFixture(
    fixture: "milling" | "turning" = "milling",
    millingConfiguration: M7MillingConfigurationInput = {},
  ): Promise<M8SaveReport> {
    await pipeline.runPipelineFixture(fixture, {
      playbackSpeed: 100,
      executionMode: "fast-forward",
      millingConfiguration,
    });
    const checkpoint = await pipeline.capturePipelineCheckpoint();
    const generationId = crypto.randomUUID();
    const built = await generationInput(
      fixture,
      checkpoint,
      generationId,
      millingConfiguration,
    );
    await repository.save(built.input);
    viewport.dataset.persistenceState = "saved";
    viewport.dataset.persistenceGenerationId = generationId;
    viewport.dataset.persistenceStateHash =
      built.input.stateSnapshot.stateSemanticHashSha256;
    return saveReport(
      built.input,
      built.checkpointId,
      built.checkpointByteLength,
      checkpoint.summary.currentStep,
    );
  }

  async function loadPersistedProject(): Promise<M8LoadReport> {
    const recovery = await repository.recoverInterruptedSaves();
    const loaded = await repository.load(PROJECT_ID);
    if (!loaded) {
      throw new Error("No persisted M8 project is available.");
    }
    const descriptor = loaded.marker.checkpointIndex.checkpoints.at(-1);
    if (!descriptor) {
      throw new Error("Persisted project has no checkpoint descriptor.");
    }
    const checkpointBytes = loaded.files.get(descriptor.payloadPath);
    if (!checkpointBytes) {
      throw new Error("Persisted checkpoint payload is unavailable.");
    }
    const decoded = await decodeSimulationCheckpoint(checkpointBytes);
    const renderedOnFrame = await pipeline.renderPipelineCheckpoint(
      restoredCheckpoint(decoded, loaded.marker.stateSnapshot),
    );
    viewport.dataset.persistenceState = "loaded";
    viewport.dataset.persistenceGenerationId = loaded.metadata.generationId;
    viewport.dataset.persistenceStateHash =
      loaded.marker.stateSnapshot.stateSemanticHashSha256;
    return {
      projectId: loaded.marker.projectId,
      generationId: loaded.metadata.generationId,
      checkpointId: descriptor.id,
      componentHashes: loaded.marker.stateSnapshot.componentHashes,
      stateSemanticHashSha256:
        loaded.marker.stateSnapshot.stateSemanticHashSha256,
      stockHashSha256: loaded.marker.stateSnapshot.stock.stockHashSha256,
      currentStep: decoded.header.currentStep,
      logicalTimeS: decoded.header.logicalTimeS,
      checkpointByteLength: checkpointBytes.byteLength,
      renderedOnFrame,
      recoveryOutcomes: recovery.map((item) => item.outcome),
    };
  }

  const harness: M8PersistenceHarness = {
    saveFixture,
    loadPersistedProject,
    async testInterruptedSave() {
      const before = await repository.load(PROJECT_ID);
      if (!before) {
        throw new Error("Save a baseline generation before interruption testing.");
      }
      await pipeline.runPipelineFixture("turning", {
        playbackSpeed: 100,
        executionMode: "fast-forward",
      });
      const checkpoint = await pipeline.capturePipelineCheckpoint();
      const built = await generationInput(
        "turning",
        checkpoint,
        crypto.randomUUID(),
      );
      try {
        await repository.save(built.input, {
          afterFileWrite: (_path, completedFileCount) => {
            if (completedFileCount === 1) {
              throw new Error("m8.simulated-interruption");
            }
          },
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "m8.simulated-interruption") {
          throw error;
        }
      }
      const stillCurrent = await repository.load(PROJECT_ID);
      const recovery = await repository.recoverInterruptedSaves();
      const after = await repository.load(PROJECT_ID);
      const quarantined = await metadata.listQuarantinedGenerations();
      const outcome = recovery[0];
      if (!stillCurrent || !after || !outcome) {
        throw new Error("Interrupted-save recovery did not produce a result.");
      }
      return {
        beforeGenerationId: stillCurrent.metadata.generationId,
        afterGenerationId: after.metadata.generationId,
        recoveryOutcome: outcome.outcome,
        diagnosticCode: outcome.diagnosticCode,
        quarantineCount: quarantined.length,
      };
    },
    async testMigrationFixture() {
      const run = createM7PipelineFixture(
        "milling",
        "83000000-0000-4000-8000-000000000100",
      );
      const current = await representativeProject("milling", run);
      const document = structuredClone(current) as unknown as Record<
        string,
        unknown
      >;
      document.$schema = "urn:cnc-render:schema:project:0";
      document.schemaVersion = 0;
      document.resources = [];
      delete document.settings;
      const original = canonicalJsonBytes(jsonValue(document));
      const projectHash = await sha256Hex(
        canonicalJsonBytes(jsonValue(document)),
      );
      const authoritativeHash = await sha256Hex(
        canonicalJsonBytes(authoritativeProjectDocument(jsonValue(document))),
      );
      const manifestWithoutChecksum = {
        schemaVersion: 1 as const,
        engineVersion: ENGINE_VERSION,
        unitSystem: "metric" as const,
        projectSchemaVersion: 0,
        projectSemanticHashSha256: projectHash,
        authoritativeProjectSemanticHashSha256: authoritativeHash,
        entries: [
          {
            path: "project.json",
            role: "project" as const,
            mediaType: "application/json",
            byteLength: original.byteLength,
            sha256: await sha256Hex(original),
            authoritative: true,
          },
        ],
      };
      const manifest: ProjectContainerManifest = {
        ...manifestWithoutChecksum,
        manifestChecksumSha256: await projectManifestChecksum(
          manifestWithoutChecksum,
        ),
      };
      const archive = encodeDeterministicZip([
        {
          path: "manifest.json",
          bytes: canonicalJsonBytes(jsonValue(manifest)),
        },
        { path: "project.json", bytes: original },
      ]);
      const migrated = await importProjectContainer(archive);
      return {
        migratedFromSchemaVersion: migrated.migratedFromSchemaVersion,
        schemaVersion: migrated.project.schemaVersion,
        originalPreserved:
          canonicalJson(Array.from(migrated.originalProjectBytes)) ===
            canonicalJson(Array.from(original)) &&
          !new TextDecoder().decode(migrated.originalProjectBytes).includes(
            '"settings"',
          ),
        originalSha256: await sha256Hex(migrated.originalProjectBytes),
        deterministicSeed: migrated.project.settings.deterministicSeed,
      };
    },
    async testCorruptionFixture() {
      const run = createM7PipelineFixture(
        "milling",
        "83000000-0000-4000-8000-000000000101",
      );
      const withResource = await representativeProject("milling", run);
      const project = ProjectSchema.parse({ ...withResource, resources: [] });
      const archive = await exportProjectContainer({
        project,
        engineVersion: ENGINE_VERSION,
        resources: [],
      });
      const projectBytes = canonicalJsonBytes(jsonValue(project));
      const offset = locateBytes(archive, projectBytes);
      if (offset < 0) {
        throw new Error("Could not locate deterministic project payload.");
      }
      const corrupted = Uint8Array.from(archive);
      corrupted[offset] ^= 0x01;
      try {
        await importProjectContainer(corrupted);
      } catch (error) {
        if (error instanceof ProjectPersistenceError) {
          return {
            diagnosticCode: error.diagnosticCode,
            defaultUploadLimitBytes: DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
          };
        }
        throw error;
      }
      throw new Error("Corrupt project container was unexpectedly accepted.");
    },
    getCloudPlan: () => CLOUD_PERSISTENCE_PLAN,
  };

  return {
    harness,
    dispose() {
      viewport.dataset.persistenceState = "disposed";
    },
  };
}
