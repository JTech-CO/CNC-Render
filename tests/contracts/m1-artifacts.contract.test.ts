import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_ID,
  WORKER_SCHEMA_ID,
  parseProject,
  projectJsonSchema,
  semanticHash,
  workerJsonSchema,
  type JsonValue,
} from "@cnc-render/contracts";

const repositoryRoot = new URL("../../", import.meta.url);
const writeArtifacts = process.env.CNC_RENDER_WRITE_CONTRACT_ARTIFACTS === "1";

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function stableArtifact(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function artifactUrl(relativePath: string): URL {
  return new URL(relativePath, repositoryRoot);
}

function writeOrCompare(relativePath: string, contents: string): void {
  const url = artifactUrl(relativePath);
  if (writeArtifacts) {
    mkdirSync(new URL(".", url), { recursive: true });
    writeFileSync(url, contents, "utf8");
    return;
  }

  expect(
    existsSync(url),
    `missing ${relativePath}; run pnpm generate:contracts`,
  ).toBe(true);
  expect(readFileSync(url, "utf8")).toBe(contents);
}

describe("schema M1 generated contract artifacts", () => {
  it("keeps Project and Worker JSON Schema byte-stable", () => {
    const projectSchema = projectJsonSchema();
    const workerSchema = workerJsonSchema();

    expect(projectSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(projectSchema.$id).toBe(PROJECT_SCHEMA_ID);
    expect(workerSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(workerSchema.$id).toBe(WORKER_SCHEMA_ID);

    writeOrCompare(
      "packages/contracts/schemas/project.schema.json",
      stableArtifact(projectSchema),
    );
    writeOrCompare(
      "packages/contracts/schemas/worker.schema.json",
      stableArtifact(workerSchema),
    );
  });

  it("keeps the shared semantic SHA-256 fixture byte-stable", async () => {
    const project = parseProject(
      JSON.parse(
        readFileSync(
          artifactUrl("tests/fixtures/m1/valid-project.json"),
          "utf8",
        ),
      ),
    );
    const digest = await semanticHash(project as JsonValue);
    writeOrCompare(
      "tests/fixtures/m1/valid-project.sha256",
      `${digest}\n`,
    );
  });
});
