import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeFingerprint } from "./runtime-fingerprint.mjs";
import { benchmarkProjects, BENCHMARK_QUALITIES, compareBenchmarkMatrix, evaluatePerformance, functionalSamplePassed } from "./benchmark-contract.mjs";
import { attributedMemory, emptyBrowserBaseline } from "./memory-contract.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Reference evidence: ${message}`);
}

export function validateMemoryEvidence(reports) {
  const projects = benchmarkProjects("reference");
  requireCondition(Array.isArray(reports) && reports.length === 8, "eight memory cases required");
  for (const project of projects) for (const quality of BENCHMARK_QUALITIES) {
    const matches = reports.filter((report) => report.project === project.name && report.qualityPreset === quality);
    requireCondition(matches.length === 1, "missing/duplicate memory case");
    const report = matches[0];
    requireCondition(report.reportVersion === 3 && report.freshBrowserPerCase === true && report.backend === project.backend && report.status === "pass", "invalid memory provenance/status");
    requireCondition(Array.isArray(report.baselineResources) && report.baselineResources.length === 0, "application resources in baseline");
    requireCondition(Number.isFinite(report.durationMs) && report.durationMs >= 60_000 && report.samples.length >= 10 && report.repetitions > 0, "incomplete memory sampling");
    const baseline = emptyBrowserBaseline(report.emptyGpuInitializedBrowserSamples);
    requireCondition(baseline.privateBytes === report.baseline.privateBytes && baseline.gpuBytes === report.baseline.gpuBytes, "baseline mismatch");
    const peak = Math.max(...report.samples.map((sample) => {
      const value = attributedMemory(sample, baseline);
      requireCondition(value.attributedBytes === sample.attributedBytes, "memory arithmetic mismatch");
      return value.attributedBytes;
    }));
    const limit = quality === "balanced" ? 600_000_000 : 1_500_000_000;
    requireCondition(report.limitBytes === limit && report.observedPeakBytes === peak && peak <= limit, "memory budget exceeded");
  }
}

export function validateReferenceEvidence(evidence, currentFingerprint) {
  requireCondition(evidence.schemaVersion === 1, "unsupported schema");
  requireCondition(JSON.stringify(evidence.runtimeFingerprint) === JSON.stringify(currentFingerprint), "runtime changed; remeasure on the approved reference host");
  const report = evidence.benchmark;
  requireCondition(report.matrix === "reference" && report.gateStatus === "pass" && report.functionalStatus === "pass" && report.performanceStatus === "pass", "benchmark failed");
  const projects = benchmarkProjects("reference");
  requireCondition(compareBenchmarkMatrix(report.executions, projects, BENCHMARK_QUALITIES).every((row) => row.status === "pass"), "benchmark parity mismatch");
  for (const row of report.executions) {
    const sample = row.sample;
    requireCondition(row.status === "passed" && sample?.gpuClass === "hardware-candidate" && functionalSamplePassed(sample, projects.find((project) => project.name === row.project)?.backend), "invalid hardware case");
    const performance = evaluatePerformance(sample);
    requireCondition(performance.mediumFps !== "fail" && performance.highPreset !== "fail" && performance.coldShell === "pass", "hardware performance budget exceeded");
    requireCondition(sample.maximumMainHandlerMs < 50 && sample.maximumLongTasksPerRun <= 1 && sample.reactCommitDelta === 0, "main-thread budget exceeded");
  }
  validateMemoryEvidence(evidence.memory);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envelope = JSON.parse(readFileSync(resolve("docs/verification/m12-reference-evidence.json"), "utf8"));
  requireCondition(envelope.schemaVersion === 1 && envelope.encoding === "gzip-base64", "unsupported evidence envelope");
  const evidence = JSON.parse(gunzipSync(Buffer.from(envelope.payload, "base64"), { maxOutputLength: 2_000_000 }).toString("utf8"));
  validateReferenceEvidence(evidence, runtimeFingerprint());
  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/approved-host-reference-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  console.info("[reference-evidence] approved-host hardware/parity/memory budgets and runtime fingerprint verified");
}
