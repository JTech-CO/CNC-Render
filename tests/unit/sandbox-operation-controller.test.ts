import { describe, expect, test } from "vitest";

import {
  SANDBOX_FACE_MILLING_ENTITY_IDS,
  SANDBOX_OPERATION_HISTORY_LIMIT,
  SandboxOperationController,
  SandboxOperationControllerError,
  mapSandboxOperationToMillingConfiguration,
  mapSandboxOperationToRunParameters,
  parseSandboxOperationJournal,
} from "@cnc-render/web/foundation";
import {
  M8SandboxPersistenceError,
  validateSandboxOperationJournalMatch,
} from "../../app/components/m8-persistence-adapter";

const OPERATION_ID = "a3000000-0000-4000-8000-000000000001";

function ports() {
  let tick = 0;
  return {
    createUuid: () => OPERATION_ID,
    nowUtc: () => {
      const timestamp = new Date(
        Date.UTC(2026, 7, 14, 0, 0, 0) + tick * 1_000,
      ).toISOString();
      tick += 1;
      return timestamp;
    },
  };
}

function controller() {
  return new SandboxOperationController(ports());
}

describe("M10 sandbox operation controller", () => {
  test("creates a deterministic E2 face-milling operation and maps run parameters", () => {
    const sandbox = controller();
    expect(sandbox.getSnapshot()).toMatchObject({
      status: "empty",
      retainedRevisionCount: 0,
      canCommit: false,
    });

    const created = sandbox.createFaceMilling({
      stockPreset: "compact",
      cutDirection: "y",
    });
    expect(created).toMatchObject({
      status: "ready",
      revision: 1,
      committedAt: "2026-08-14T00:00:00.000Z",
      dirty: false,
      canUndo: false,
      canRedo: false,
      configuration: { stockPreset: "compact", cutDirection: "y" },
      operation: {
        id: OPERATION_ID,
        operationType: "milling",
        setupId: SANDBOX_FACE_MILLING_ENTITY_IDS.setupId,
        toolAssemblyId: SANDBOX_FACE_MILLING_ENTITY_IDS.toolAssemblyId,
        strategy: "face-zig-zag-y",
        feed: { mode: "per-minute", feedMmPerMin: 2_400 },
        spindleSpeedRpm: 6_000,
        depthOfCutMm: 4,
        widthOfCutMm: 20,
      },
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.operation)).toBe(true);
    expect(Object.isFrozen(created.operation?.feed)).toBe(true);

    const document = sandbox.getCommittedDocument();
    expect(mapSandboxOperationToMillingConfiguration(document)).toEqual({
      stockPreset: "compact",
      cutDirection: "y",
    });
    expect(mapSandboxOperationToRunParameters(document)).toMatchObject({
      fixture: "milling",
      operationId: OPERATION_ID,
      stockId: SANDBOX_FACE_MILLING_ENTITY_IDS.compactStockId,
      millingConfiguration: { stockPreset: "compact", cutDirection: "y" },
      feedMmPerMin: 2_400,
      spindleSpeedRpm: 6_000,
      depthOfCutMm: 4,
      widthOfCutMm: 20,
    });
  });

  test.each([
    [{ feedMmPerMin: Number.NaN }, "strict Operation schema"],
    [{ spindleSpeedRpm: Number.POSITIVE_INFINITY }, "strict Operation schema"],
    [{ depthOfCutMm: 3.9 }, "depthOfCutMm"],
    [{ depthOfCutMm: 5.1 }, "depthOfCutMm"],
    [{ widthOfCutMm: 20.1 }, "widthOfCutMm"],
    [{ setupId: "a3000000-0000-4000-8000-000000000099" }, "setupId"],
    [
      { toolAssemblyId: "a3000000-0000-4000-8000-000000000098" },
      "toolAssemblyId",
    ],
    [{ spindleDirection: "counterclockwise" as const }, "clockwise"],
  ])("rejects invalid finite, range, and reference edit %#", (edit, issue) => {
    const sandbox = controller();
    const before = sandbox.createFaceMilling();
    expect(() => sandbox.edit(edit)).toThrowError(
      SandboxOperationControllerError,
    );
    try {
      sandbox.edit(edit);
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxOperationControllerError);
      expect((error as SandboxOperationControllerError).code).toBe(
        "sandbox.operation.invalid",
      );
      expect(
        (error as SandboxOperationControllerError).issues.join(" "),
      ).toContain(issue);
    }
    expect(sandbox.getSnapshot()).toEqual(before);
  });

  test("commits edits, supports undo/redo, and truncates the redo branch", () => {
    const sandbox = controller();
    sandbox.createFaceMilling();
    sandbox.edit({
      name: "Compact Y finishing",
      stockPreset: "compact",
      cutDirection: "y",
      feedMmPerMin: 1_800,
    });
    expect(sandbox.getSnapshot()).toMatchObject({
      dirty: true,
      canCommit: true,
      revision: 1,
    });
    expect(() => sandbox.serializeJournal()).toThrowError(
      /Commit or discard/u,
    );

    sandbox.commit();
    sandbox.edit({ depthOfCutMm: 5 });
    const third = sandbox.commit();
    expect(third).toMatchObject({
      revision: 3,
      retainedRevisionCount: 3,
      canUndo: true,
      canRedo: false,
    });

    expect(sandbox.undo()).toMatchObject({
      revision: 2,
      canRedo: true,
      operation: { depthOfCutMm: 4 },
    });
    expect(sandbox.redo()).toMatchObject({
      revision: 3,
      operation: { depthOfCutMm: 5 },
    });
    sandbox.undo();
    sandbox.edit({ feedMmPerMin: 1_500 });
    const branch = sandbox.commit();
    expect(branch).toMatchObject({
      revision: 4,
      retainedRevisionCount: 3,
      canRedo: false,
      operation: { feed: { feedMmPerMin: 1_500 }, depthOfCutMm: 4 },
    });
  });

  test("caps committed undo history at 50 deterministic revisions", () => {
    const sandbox = controller();
    sandbox.createFaceMilling();
    for (let index = 0; index < 55; index += 1) {
      sandbox.edit({ feedMmPerMin: 1_000 + index });
      sandbox.commit();
    }

    const snapshot = sandbox.getSnapshot();
    expect(snapshot.retainedRevisionCount).toBe(
      SANDBOX_OPERATION_HISTORY_LIMIT,
    );
    expect(snapshot.revision).toBe(56);
    const journal = parseSandboxOperationJournal(sandbox.serializeJournal());
    expect(journal.revisions).toHaveLength(50);
    expect(journal.revisions[0]?.sequence).toBe(7);
    expect(journal.revisions.at(-1)?.sequence).toBe(56);
  });

  test("round-trips a strict journal with cursor and redo state", () => {
    const source = controller();
    source.createFaceMilling();
    source.edit({ stockPreset: "compact", feedMmPerMin: 1_900 });
    source.commit();
    source.edit({ cutDirection: "y", depthOfCutMm: 5 });
    source.commit();
    source.undo();

    const serialized = source.serializeJournal();
    expect(serialized).toBe(source.serializeJournal());

    const restored = controller();
    const snapshot = restored.restoreJournal(serialized);
    expect(snapshot).toMatchObject({
      revision: 2,
      canUndo: true,
      canRedo: true,
      retainedRevisionCount: 3,
      configuration: { stockPreset: "compact", cutDirection: "x" },
      operation: { feed: { feedMmPerMin: 1_900 }, depthOfCutMm: 4 },
    });
    expect(restored.serializeJournal()).toBe(serialized);
    expect(restored.redo()).toMatchObject({
      revision: 3,
      configuration: { cutDirection: "y" },
      operation: { depthOfCutMm: 5 },
    });
  });

  test("rejects unknown journal fields, versions, and changed operation identity", () => {
    const sandbox = controller();
    sandbox.createFaceMilling();
    sandbox.edit({ feedMmPerMin: 2_000 });
    sandbox.commit();
    const journal = JSON.parse(sandbox.serializeJournal());

    expect(() =>
      parseSandboxOperationJournal({ ...journal, unknown: true }),
    ).toThrowError(/journal is invalid/u);
    expect(() =>
      parseSandboxOperationJournal({ ...journal, schemaVersion: 2 }),
    ).toThrowError(/journal is invalid/u);

    journal.revisions[1].operation.id =
      "a3000000-0000-4000-8000-000000000002";
    expect(() => parseSandboxOperationJournal(journal)).toThrowError(
      /journal is invalid/u,
    );
  });

  test("validates injected UUID and UTC clock output", () => {
    expect(() =>
      new SandboxOperationController({
        createUuid: () => "not-a-uuid",
        nowUtc: () => "2026-08-14T00:00:00Z",
      }).createFaceMilling(),
    ).toThrowError(/createUuid/u);
    expect(() =>
      new SandboxOperationController({
        createUuid: () => OPERATION_ID,
        nowUtc: () => "not-a-time",
      }).createFaceMilling(),
    ).toThrowError(/nowUtc/u);
  });

  test("requires the saved operation to match the active journal revision", () => {
    const sandbox = controller();
    sandbox.createFaceMilling({ stockPreset: "compact", cutDirection: "y" });
    sandbox.edit({ name: "Compact Y face pass", feedMmPerMin: 1_800 });
    sandbox.commit();

    const document = sandbox.getCommittedDocument();
    const journal = validateSandboxOperationJournalMatch(
      document,
      sandbox.serializeJournal(),
    );
    expect(journal.revisions[journal.cursor]?.operation).toEqual(
      document.operation,
    );

    const mismatched = {
      ...document,
      operation: { ...document.operation, name: "Different operation" },
    };
    expect(() =>
      validateSandboxOperationJournalMatch(mismatched, journal),
    ).toThrowError(M8SandboxPersistenceError);
    try {
      validateSandboxOperationJournalMatch(mismatched, journal);
    } catch (error) {
      expect(error).toMatchObject({
        code: "sandbox.persistence.document-journal-mismatch",
      });
    }
    const wrongPreset = {
      ...document,
      presetId: "sandbox.unrelated",
    } as unknown as typeof document;
    expect(() =>
      validateSandboxOperationJournalMatch(wrongPreset, journal),
    ).toThrowError(M8SandboxPersistenceError);
  });

});
