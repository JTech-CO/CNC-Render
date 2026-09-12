import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { benchmarkProjects, BENCHMARK_QUALITIES } from "./benchmark-contract.mjs";
import { runtimeFingerprint } from "./runtime-fingerprint.mjs";
import { validateReferenceEvidence } from "./check-reference-evidence.mjs";

const benchmark = JSON.parse(readFileSync("artifacts/benchmark-reference-final.json", "utf8"));
const sanitize = (sample) => ({
  processes: [{ privateBytes: sample.processes.reduce((sum, process) => sum + process.privateBytes, 0) }],
  gpuReportedBytes: sample.gpuReportedBytes,
  ...(sample.attributedBytes === undefined ? {} : { attributedBytes: sample.attributedBytes, privateDeltaBytes: sample.privateDeltaBytes, gpuDeltaBytes: sample.gpuDeltaBytes }),
});
const memory = benchmarkProjects("reference").flatMap((project) => BENCHMARK_QUALITIES.map((quality) => {
  const report = JSON.parse(readFileSync(`artifacts/app-memory-${project.name}-${quality}.json`, "utf8"));
  return { ...report, project: project.name,
    coldBlankBrowserSamples: report.coldBlankBrowserSamples.map(sanitize),
    emptyGpuInitializedBrowserSamples: report.emptyGpuInitializedBrowserSamples.map(sanitize),
    samples: report.samples.map(sanitize),
  };
}));
const identity = runtimeFingerprint();
const evidence = { schemaVersion: 1, collectedAtUtc: new Date().toISOString(),
  scope: "User-approved reference PC; measured unchanged runtime inputs, not a browser-wide or industrial certification",
  runtimeFingerprint: identity, benchmark, memory };
validateReferenceEvidence(evidence, identity);
const envelope = { schemaVersion: 1, encoding: "gzip-base64", runtimeFingerprint: identity,
  description: "Run node scripts/check-reference-evidence.mjs to validate and expand the sanitized report into artifacts/approved-host-reference-evidence.json",
  payload: gzipSync(JSON.stringify(evidence), { level: 9 }).toString("base64") };
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/reference-evidence-envelope.json", JSON.stringify(envelope, null, 2) + "\n");
console.info(`[reference-evidence] ${memory.length} memory cases, ${benchmark.executions.length} hardware cases; source ${identity.sha256}`);
