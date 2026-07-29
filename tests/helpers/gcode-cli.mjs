import { spawnSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturesRoot = join(repositoryRoot, "tests", "fixtures", "gcode");
const cargoRunner = join(repositoryRoot, "scripts", "run-cargo.mjs");
const cargoTargetRoot = resolve(
  repositoryRoot,
  process.env.CARGO_TARGET_DIR ?? "target",
);
const cargoProfileDirectory =
  process.env.CARGO_BUILD_TARGET === undefined
    ? join(cargoTargetRoot, "debug")
    : join(cargoTargetRoot, process.env.CARGO_BUILD_TARGET, "debug");
const gcodeCliExecutable = join(
  cargoProfileDirectory,
  `gcode-cli${process.platform === "win32" ? ".exe" : ""}`,
);

let gcodeCliBuilt = false;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixtureCandidates(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (isObject(value) && Array.isArray(value.fixtures)) {
    return value.fixtures;
  }
  return [value];
}

function isGcodeManifest(value) {
  return (
    isObject(value) &&
    value.schemaVersion === 1 &&
    typeof value.fixtureId === "string" &&
    isObject(value.input) &&
    typeof value.input.file === "string" &&
    typeof value.input.encoding === "string" &&
    isObject(value.initialState) &&
    isObject(value.expected) &&
    isObject(value.tolerance)
  );
}

function filesWithSuffix(directory, suffix) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesWithSuffix(entryPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(entryPath);
    }
  }
  return files;
}

function pathInsideFixtures(path) {
  const fromFixtures = relative(fixturesRoot, path);
  return (
    fromFixtures !== "" &&
    !fromFixtures.startsWith("..") &&
    !isAbsolute(fromFixtures)
  );
}

function ensureGcodeCli() {
  if (gcodeCliBuilt) {
    return;
  }

  const result = spawnSync(
    process.execPath,
    [
      cargoRunner,
      "build",
      "--quiet",
      "--locked",
      "-p",
      "cnc-render-gcode-core",
      "--bin",
      "gcode-cli",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
      windowsHide: true,
    },
  );

  if (result.error) {
    throw new Error(`gcode-cli could not be built: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `gcode-cli build exited with status ${result.status}.`,
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (!statSync(gcodeCliExecutable).isFile()) {
    throw new Error(
      `gcode-cli build did not create the expected executable: ${gcodeCliExecutable}`,
    );
  }

  gcodeCliBuilt = true;
}

export function loadGcodeFixtureManifests() {
  const manifests = [];
  const manifestPaths = filesWithSuffix(fixturesRoot, ".manifest.json");
  const sourcePaths = filesWithSuffix(fixturesRoot, ".nc");

  for (const manifestPath of manifestPaths) {
    let document;
    try {
      document = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Invalid JSON in G-code fixture manifest "${relative(
          fixturesRoot,
          manifestPath,
        )}": ${error.message}`,
      );
    }

    const candidates = fixtureCandidates(document);
    if (candidates.length !== 1 || !isGcodeManifest(candidates[0])) {
      throw new Error(
        `Invalid G-code fixture manifest shape in "${relative(
          fixturesRoot,
          manifestPath,
        )}".`,
      );
    }

    for (const candidate of candidates) {
      const sourcePath = resolve(dirname(manifestPath), candidate.input.file);
      if (!pathInsideFixtures(sourcePath)) {
        throw new Error(
          `G-code fixture "${candidate.fixtureId}" resolves outside tests/fixtures/gcode.`,
        );
      }
      const expectedSourcePath = manifestPath.replace(
        /\.manifest\.json$/u,
        ".nc",
      );
      if (sourcePath !== expectedSourcePath) {
        throw new Error(
          `G-code fixture "${candidate.fixtureId}" must reference its same-basename .nc source.`,
        );
      }
      if (
        candidate.input.encoding.toLowerCase().replace("-", "") !== "utf8"
      ) {
        throw new Error(
          `G-code fixture "${candidate.fixtureId}" must use UTF-8 encoding.`,
        );
      }
      if (!statSync(sourcePath).isFile()) {
        throw new Error(
          `G-code fixture "${candidate.fixtureId}" source does not exist.`,
        );
      }

      manifests.push({
        ...candidate,
        manifestPath,
        sourcePath,
        source: readFileSync(sourcePath, "utf8"),
      });
    }
  }

  const manifestPathSet = new Set(manifestPaths);
  for (const sourcePath of sourcePaths) {
    const expectedManifestPath = sourcePath.replace(
      /\.nc$/u,
      ".manifest.json",
    );
    if (!manifestPathSet.has(expectedManifestPath)) {
      throw new Error(
        `Orphan G-code source "${relative(
          fixturesRoot,
          sourcePath,
        )}" has no same-basename manifest.`,
      );
    }
  }

  if (manifests.length === 0) {
    throw new Error("No M2 G-code fixture manifests were found.");
  }

  const fixtureIds = new Set();
  for (const manifest of manifests) {
    if (fixtureIds.has(manifest.fixtureId)) {
      throw new Error(`Duplicate G-code fixtureId "${manifest.fixtureId}".`);
    }
    fixtureIds.add(manifest.fixtureId);
  }

  return manifests.sort((left, right) =>
    left.fixtureId.localeCompare(right.fixtureId, "en-US"),
  );
}

export function createGcodeParseRequest(manifest, repetitions = 1) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
    throw new RangeError("repetitions must be a positive safe integer.");
  }

  const {
    workOffsetsMm,
    toolLengthOffsetsMm,
    toolNumbers,
    toolpathId,
    operationId,
    ...initialState
  } = manifest.initialState;

  return {
    dialect: manifest.dialect,
    source: manifest.source,
    toolpathId,
    operationId,
    initialState,
    ...(workOffsetsMm === undefined ? {} : { workOffsetsMm }),
    ...(toolLengthOffsetsMm === undefined ? {} : { toolLengthOffsetsMm }),
    ...(toolNumbers === undefined ? {} : { toolNumbers }),
    repetitions,
  };
}

export function runGcodeCli(request, options = {}) {
  ensureGcodeCli();

  const result = spawnSync(gcodeCliExecutable, [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
    input: `${JSON.stringify(request)}\n`,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? 120_000,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`gcode-cli could not be launched: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `gcode-cli exited with status ${result.status}.`,
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const stdout = result.stdout.trim();
  if (stdout.length === 0) {
    throw new Error("gcode-cli returned an empty response.");
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `gcode-cli returned non-JSON output: ${error.message}\n${stdout}`,
    );
  }
}

export function parseGcodeFixture(manifest, repetitions = 1) {
  return runGcodeCli(createGcodeParseRequest(manifest, repetitions));
}

export function unwrapGcodeResult(response) {
  if (!isObject(response)) {
    throw new TypeError("gcode-cli response must be a JSON object.");
  }
  const result = isObject(response.result) ? response.result : response;
  if (
    (result.toolpath !== null && !isObject(result.toolpath)) ||
    !Array.isArray(result.diagnostics)
  ) {
    throw new TypeError(
      "gcode-cli response must contain toolpath and diagnostics.",
    );
  }
  return result;
}

export function projectToolpathForGolden(toolpath) {
  const segmentIndexById = new Map(
    toolpath.segments.map((segment, index) => [segment.id, index]),
  );
  const indicesBySourceLine = new Map();

  for (const mapping of toolpath.sourceLineMap) {
    const segmentIndex = segmentIndexById.get(mapping.segmentId);
    if (segmentIndex === undefined) {
      throw new Error(
        `Source map references unknown segment "${mapping.segmentId}".`,
      );
    }
    const indices = indicesBySourceLine.get(mapping.sourceLine) ?? [];
    indices.push(segmentIndex);
    indicesBySourceLine.set(mapping.sourceLine, indices);
  }

  return {
    segmentTypes: toolpath.segments.map((segment) => segment.segmentType),
    sourceMap: [...indicesBySourceLine.entries()]
      .sort(([left], [right]) => left - right)
      .map(([sourceLine, segmentIndices]) => ({
        sourceLine,
        segmentIndices,
      })),
  };
}
