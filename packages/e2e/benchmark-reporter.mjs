import { cpus, platform, release, totalmem } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { benchmarkProjects, compareBenchmarkMatrix, evaluatePerformance, functionalSamplePassed } from "../../scripts/benchmark-contract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export default class BenchmarkReporter {
  rows = [];
  onTestEnd(test, result) {
    const attachment = result.attachments.find((item) => item.name === "reference-benchmark");
    const sample = attachment?.body ? JSON.parse(attachment.body.toString("utf8")) : null;
    this.rows.push({
      project: test.parent.project().name,
      fixture: test.title,
      status: result.status,
      sample,
      performance: sample ? evaluatePerformance(sample) : null,
      failure: result.status === "passed" ? null : "execution-or-functional-gate-failed",
    });
  }
  onEnd(result) {
    const matrix = process.env.CNC_RENDER_BENCH_MATRIX ?? "software";
    const projects = benchmarkProjects(matrix);
    const parity = compareBenchmarkMatrix(this.rows, projects);
    const output = process.env.CNC_RENDER_BENCH_REPORT;
    if (!output) throw new Error("CNC_RENDER_BENCH_REPORT is required.");
    let artifact = null;
    try { artifact = JSON.parse(readFileSync(resolve(root, "dist/pages/release.json"), "utf8")); } catch { /* Build failure is reported, never passed. */ }
    const report = {
      reportVersion: 1,
      capturedAtUtc: new Date().toISOString(),
      scope: "local-pages-reference-candidate",
      matrix,
      gateStatus: result.status === "passed" && parity.every((item) => item.status === "pass") ? "pass" : "fail",
      functionalStatus: parity.every((item) => item.status === "pass") && this.rows.every((row) =>
        functionalSamplePassed(row.sample, projects.find((project) => project.name === row.project)?.backend)) ? "pass" : "fail",
      releaseStatus: "incomplete",
      artifact,
      host: { os: platform(), osRelease: release(), cpu: cpus()[0]?.model ?? "unknown", logicalCpus: cpus().length, physicalMemoryBytes: totalmem(), node: process.version },
      policy: { mediumTargetFps: 60, highMinimumFps: 30, coldShellMaximumMs: 5000, defaultMemoryMaximumBytes: 600_000_000, precisionMemoryRecommendedBytes: 1_500_000_000 },
      browserLimitations: [
        { browser: "firefox", status: "not-run", reason: "No Firefox evidence in this Chromium/channel matrix; no support certification." },
        { browser: "safari", status: "not-run", reason: "Actual Safari on macOS required; Playwright WebKit is not Safari certification." },
      ],
      parity,
      executions: this.rows,
    };
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.info(`[benchmark] ${output}: gates=${report.gateStatus}, functional=${report.functionalStatus}, release=incomplete`);
    if (report.gateStatus !== "pass" || report.functionalStatus !== "pass") return { status: "failed" };
  }
}
