function bytes(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid memory byte count");
  return value;
}

export function memoryComponents(sample) {
  if (!Array.isArray(sample?.processes) || sample.processes.length === 0) throw new Error("Missing process memory samples");
  const privateBytes = sample.processes.reduce((sum, process) => bytes(sum + bytes(process.privateBytes)), 0);
  return { privateBytes, gpuBytes: bytes(sample.gpuReportedBytes) };
}

export function emptyBrowserBaseline(samples) {
  if (samples.length < 3) throw new Error("At least three empty-browser samples required");
  const components = samples.map(memoryComponents);
  // Use the lowest observed fixed cost; never inflate the baseline to pass a gate.
  return { privateBytes: Math.min(...components.map((value) => value.privateBytes)), gpuBytes: Math.min(...components.map((value) => value.gpuBytes)) };
}

export function attributedMemory(sample, baseline) {
  const current = memoryComponents(sample);
  const privateDeltaBytes = Math.max(0, current.privateBytes - bytes(baseline.privateBytes));
  const gpuDeltaBytes = Math.max(0, current.gpuBytes - bytes(baseline.gpuBytes));
  return { privateDeltaBytes, gpuDeltaBytes, attributedBytes: bytes(privateDeltaBytes + gpuDeltaBytes) };
}
