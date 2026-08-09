import type {
  PersistedComponentHashes,
  PersistedStateSnapshot,
} from "@cnc-render/contracts";
import {
  InMemoryGenerationFilePort,
  InMemoryGenerationMetadataPort,
  ProjectPersistenceError,
  ProjectRepository,
  sha256Hex,
  type SaveProjectGenerationInput,
} from "@cnc-render/storage";
import { describe, expect, test } from "vitest";

const PROJECT_ID = "81000000-0000-4000-8000-000000000001";
const MACHINE_ID = "81000000-0000-4000-8000-000000000002";
const TOOL_ID = "81000000-0000-4000-8000-000000000003";
const OPERATION_ID = "81000000-0000-4000-8000-000000000004";
const ENGINE_VERSION = "0.8.0";
const GENERATION_1 = "81000000-0000-4000-8000-000000000011";
const GENERATION_2 = "81000000-0000-4000-8000-000000000012";
const GENERATION_3 = "81000000-0000-4000-8000-000000000013";

const encoder = new TextEncoder();

async function hashLabel(label: string): Promise<string> {
  return sha256Hex(encoder.encode(label));
}

async function saveInput(
  generationId: string,
  revision: number,
): Promise<SaveProjectGenerationInput> {
  const projectBytes = encoder.encode(`{"generation":${revision}}`);
  const gcodeBytes = encoder.encode(`G21 G90\nG0 X${revision}\nM30\n`);
  const stockBytes = new Uint8Array([revision, 2, 3, 5, 8, 13]);
  const projectSha256 = await sha256Hex(projectBytes);
  const gcodeSha256 = await sha256Hex(gcodeBytes);
  const stockSha256 = await sha256Hex(stockBytes);
  const componentHashes: PersistedComponentHashes = {
    projectSha256,
    machineSha256: await hashLabel("machine"),
    toolSha256: await hashLabel("tool"),
    operationSha256: await hashLabel("operation"),
    gcodeSha256,
    stockSha256,
    diagnosticsSha256: await hashLabel("diagnostics:none"),
    measurementsSha256: await hashLabel("measurements:none"),
  };
  const stateSnapshot: PersistedStateSnapshot = {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    projectId: PROJECT_ID,
    machineId: MACHINE_ID,
    toolAssemblyId: TOOL_ID,
    operationId: OPERATION_ID,
    gcodeResourcePath: "programs/main.nc",
    logicalTimeS: revision * 3,
    stock: {
      representation: "milling-dexel",
      revision,
      stockHashSha256: stockSha256,
      payloadPath: "state/stock.bin",
      payloadByteLength: stockBytes.byteLength,
      payloadSha256: stockSha256,
    },
    diagnostics: [],
    measurements: [],
    componentHashes,
    stateSemanticHashSha256: await hashLabel(`state:${revision}`),
  };
  return {
    projectId: PROJECT_ID,
    generationId,
    engineVersion: ENGINE_VERSION,
    stateSnapshot,
    checkpointIndex: {
      schemaVersion: 1,
      projectId: PROJECT_ID,
      engineVersion: ENGINE_VERSION,
      checkpointIntervalS: 3,
      checkpoints: [],
    },
    files: [
      { path: "project.json", bytes: projectBytes },
      { path: "programs/main.nc", bytes: gcodeBytes },
      { path: "state/stock.bin", bytes: stockBytes },
    ],
  };
}

function expectDiagnostic(error: unknown, diagnosticCode: string): void {
  expect(error).toBeInstanceOf(ProjectPersistenceError);
  expect(error).toMatchObject({ diagnosticCode });
}

describe("M8 persistence atomic project repository", () => {
  test("loads identical component hashes after a repository restart", async () => {
    const metadata = new InMemoryGenerationMetadataPort();
    const files = new InMemoryGenerationFilePort();
    const firstProcess = new ProjectRepository(metadata, files);
    const input = await saveInput(GENERATION_1, 1);
    await firstProcess.save(input);

    const restartedProcess = new ProjectRepository(metadata, files);
    const loaded = await restartedProcess.load(PROJECT_ID);
    expect(loaded?.metadata.generationId).toBe(GENERATION_1);
    expect(loaded?.marker.stateSnapshot.componentHashes).toEqual(
      input.stateSnapshot.componentHashes,
    );
    expect(loaded?.marker.stateSnapshot.stateSemanticHashSha256).toBe(
      input.stateSnapshot.stateSemanticHashSha256,
    );
    expect(loaded?.files.get("state/stock.bin")).toEqual(
      input.files.find((file) => file.path === "state/stock.bin")?.bytes,
    );
  });

  test("never exposes a partial save and quarantines it during recovery", async () => {
    const metadata = new InMemoryGenerationMetadataPort();
    const files = new InMemoryGenerationFilePort();
    const repository = new ProjectRepository(metadata, files);
    await repository.save(await saveInput(GENERATION_1, 1));

    await expect(
      repository.save(await saveInput(GENERATION_2, 2), {
        afterFileWrite: (_path, completedFileCount) => {
          if (completedFileCount === 1) {
            throw new Error("simulated tab termination");
          }
        },
      }),
    ).rejects.toThrow("simulated tab termination");

    const beforeRecovery = await new ProjectRepository(metadata, files).load(
      PROJECT_ID,
    );
    expect(beforeRecovery?.metadata.generationId).toBe(GENERATION_1);
    const recovery = await repository.recoverInterruptedSaves();
    expect(recovery).toEqual([
      {
        projectId: PROJECT_ID,
        generationId: GENERATION_2,
        outcome: "quarantined",
        diagnosticCode: "storage.recovery.marker-missing",
      },
    ]);
    expect(await metadata.listStagingGenerations()).toHaveLength(0);
    expect(await metadata.listQuarantinedGenerations()).toMatchObject([
      {
        generationId: GENERATION_2,
        diagnosticCode: "storage.recovery.marker-missing",
      },
    ]);
    expect((await repository.load(PROJECT_ID))?.metadata.generationId).toBe(
      GENERATION_1,
    );
  });

  test("promotes a complete staged generation after interruption before commit", async () => {
    const metadata = new InMemoryGenerationMetadataPort();
    const files = new InMemoryGenerationFilePort();
    const repository = new ProjectRepository(metadata, files);
    await repository.save(await saveInput(GENERATION_1, 1));
    const third = await saveInput(GENERATION_3, 3);

    await expect(
      repository.save(third, {
        beforeMetadataCommit: () => {
          throw new Error("simulated crash after OPFS commit marker");
        },
      }),
    ).rejects.toThrow("simulated crash after OPFS commit marker");
    expect((await repository.load(PROJECT_ID))?.metadata.generationId).toBe(
      GENERATION_1,
    );

    expect(await repository.recoverInterruptedSaves()).toEqual([
      {
        projectId: PROJECT_ID,
        generationId: GENERATION_3,
        outcome: "recovered",
        diagnosticCode: null,
      },
    ]);
    const recovered = await new ProjectRepository(metadata, files).load(
      PROJECT_ID,
    );
    expect(recovered?.metadata.generationId).toBe(GENERATION_3);
    expect(recovered?.marker.stateSnapshot.componentHashes).toEqual(
      third.stateSnapshot.componentHashes,
    );
  });

  test("refuses to reuse a committed immutable generation ID", async () => {
    const metadata = new InMemoryGenerationMetadataPort();
    const files = new InMemoryGenerationFilePort();
    const repository = new ProjectRepository(metadata, files);
    const input = await saveInput(GENERATION_1, 1);
    await repository.save(input);
    await expect(repository.save(input)).rejects.toSatisfy((error: unknown) => {
      expectDiagnostic(error, "storage.save.generation-not-immutable");
      return true;
    });
  });
});
