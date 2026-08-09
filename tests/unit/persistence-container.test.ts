import {
  PROJECT_CONTAINER_MEDIA_TYPE,
  ProjectSchema,
  canonicalJson,
  type JsonValue,
  type Project,
  type ProjectContainerManifest,
} from "@cnc-render/contracts";
import {
  ProjectPersistenceError,
  authoritativeProjectDocument,
  canonicalJsonBytes,
  encodeDeterministicZip,
  exportProjectContainer,
  importProjectContainer,
  projectManifestChecksum,
  sha256Hex,
  type ProjectContainerResource,
} from "@cnc-render/storage";
import { describe, expect, test } from "vitest";

import validProjectFixture from "../fixtures/m1/valid-project.json";

const ENGINE_VERSION = "0.8.0";

function cloneFixture(): Record<string, unknown> {
  return structuredClone(validProjectFixture) as Record<string, unknown>;
}

async function currentProject(): Promise<{
  readonly project: Project;
  readonly resource: ProjectContainerResource;
}> {
  const bytes = new TextEncoder().encode("G21 G90\nG0 X0 Y0 Z5\nM30\n");
  const projectDocument = cloneFixture();
  const resources = projectDocument.resources as Array<Record<string, unknown>>;
  resources[0].byteLength = bytes.byteLength;
  resources[0].sha256 = await sha256Hex(bytes);
  const project = ProjectSchema.parse(projectDocument);
  return {
    project,
    resource: {
      path: project.resources[0].path,
      role: project.resources[0].role,
      mediaType: project.resources[0].mediaType,
      authoritative: project.resources[0].authoritative,
      bytes,
    },
  };
}

function expectDiagnostic(error: unknown, diagnosticCode: string): void {
  expect(error).toBeInstanceOf(ProjectPersistenceError);
  expect(error).toMatchObject({ diagnosticCode });
}

async function previousSchemaArchive(): Promise<{
  readonly archive: Uint8Array;
  readonly originalProjectBytes: Uint8Array;
}> {
  const document = cloneFixture();
  document.$schema = "urn:cnc-render:schema:project:0";
  document.schemaVersion = 0;
  document.resources = [];
  delete document.settings;
  const jsonDocument = document as JsonValue;
  const originalProjectBytes = canonicalJsonBytes(jsonDocument);
  const projectHash = await sha256Hex(canonicalJsonBytes(jsonDocument));
  const authoritativeHash = await sha256Hex(
    canonicalJsonBytes(authoritativeProjectDocument(jsonDocument)),
  );
  const withoutChecksum = {
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
        byteLength: originalProjectBytes.byteLength,
        sha256: await sha256Hex(originalProjectBytes),
        authoritative: true,
      },
    ],
  };
  const manifest: ProjectContainerManifest = {
    ...withoutChecksum,
    manifestChecksumSha256: await projectManifestChecksum(withoutChecksum),
  };
  return {
    archive: encodeDeterministicZip([
      {
        path: "manifest.json",
        bytes: canonicalJsonBytes(manifest as JsonValue),
      },
      { path: "project.json", bytes: originalProjectBytes },
    ]),
    originalProjectBytes,
  };
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
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

describe("M8 persistence project container", () => {
  test("exports deterministic ZIP bytes and imports the same semantic project", async () => {
    const { project, resource } = await currentProject();
    const input = {
      project,
      engineVersion: ENGINE_VERSION,
      resources: [resource],
    };
    const first = await exportProjectContainer(input);
    const second = await exportProjectContainer(input);
    expect(second).toEqual(first);

    const imported = await importProjectContainer(first, {
      fileName: "training.cncrender",
      mediaType: PROJECT_CONTAINER_MEDIA_TYPE,
    });
    expect(imported.project).toEqual(project);
    expect(imported.migratedFromSchemaVersion).toBeNull();
    expect(imported.resources.get(resource.path)).toEqual(resource.bytes);
    expect(imported.manifest.schemaVersion).toBe(1);
    expect(imported.manifest.engineVersion).toBe(ENGINE_VERSION);
    expect(imported.manifest.unitSystem).toBe("metric");
    expect(imported.manifest.manifestChecksumSha256).toHaveLength(64);
    expect(new TextDecoder().decode(imported.originalProjectBytes)).toBe(
      canonicalJson(project as JsonValue),
    );
  });

  test("rejects mismatched project resources and file identity", async () => {
    const { project, resource } = await currentProject();
    await expect(
      exportProjectContainer({
        project,
        engineVersion: ENGINE_VERSION,
        resources: [{ ...resource, bytes: new Uint8Array([1, 2, 3]) }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDiagnostic(error, "storage.export.resource-descriptor-mismatch");
      return true;
    });

    const archive = await exportProjectContainer({
      project,
      engineVersion: ENGINE_VERSION,
      resources: [resource],
    });
    await expect(
      importProjectContainer(archive, { fileName: "training.zip" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDiagnostic(error, "storage.import.extension-invalid");
      return true;
    });
    await expect(
      importProjectContainer(archive, { mediaType: "application/zip" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDiagnostic(error, "storage.import.media-type-invalid");
      return true;
    });
  });

  test("migrates a v0 fixture without changing its original bytes", async () => {
    const { archive, originalProjectBytes } = await previousSchemaArchive();
    const imported = await importProjectContainer(archive);

    expect(imported.migratedFromSchemaVersion).toBe(0);
    expect(imported.project.schemaVersion).toBe(1);
    expect(imported.project.settings).toEqual({
      schemaVersion: 1,
      accuracyPreset: "balanced",
      displayDecimalPlaces: 3,
      deterministicSeed: 0,
    });
    expect(imported.originalProjectBytes).toEqual(originalProjectBytes);
    expect(new TextDecoder().decode(originalProjectBytes)).not.toContain(
      '"settings"',
    );
  });

  test("reports upload, CRC, and manifest-checksum corruption deterministically", async () => {
    const { project, resource } = await currentProject();
    const archive = await exportProjectContainer({
      project,
      engineVersion: ENGINE_VERSION,
      resources: [resource],
    });

    await expect(
      importProjectContainer(archive, {
        uploadLimitBytes: archive.byteLength - 1,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDiagnostic(error, "storage.import.upload-limit");
      return true;
    });

    const corrupted = Uint8Array.from(archive);
    const projectBytes = canonicalJsonBytes(project as JsonValue);
    const projectOffset = indexOfBytes(corrupted, projectBytes);
    expect(projectOffset).toBeGreaterThanOrEqual(0);
    corrupted[projectOffset] ^= 0x01;
    await expect(importProjectContainer(corrupted)).rejects.toSatisfy(
      (error: unknown) => {
        expectDiagnostic(error, "storage.import.crc-mismatch");
        return true;
      },
    );

    const previous = await previousSchemaArchive();
    const imported = await importProjectContainer(previous.archive);
    const invalidManifest = {
      ...imported.manifest,
      manifestChecksumSha256: "0".repeat(64),
    };
    const invalidChecksumArchive = encodeDeterministicZip([
      {
        path: "manifest.json",
        bytes: canonicalJsonBytes(invalidManifest as JsonValue),
      },
      {
        path: "project.json",
        bytes: previous.originalProjectBytes,
      },
    ]);
    await expect(importProjectContainer(invalidChecksumArchive)).rejects.toSatisfy(
      (error: unknown) => {
        expectDiagnostic(error, "storage.import.manifest-checksum-mismatch");
        return true;
      },
    );
  });
});
