const [commandName, firstMilestone, ...detailParts] = process.argv.slice(2);

if (
  !commandName ||
  !/^M(?:[1-9]|1[0-3])$/u.test(firstMilestone ?? "")
) {
  console.error(
    "Usage: node scripts/report-phase-gate.mjs <command> <M1..M13> [detail]",
  );
  process.exitCode = 1;
} else {
  const detail =
    detailParts.length > 0 ? ` (${detailParts.join(" ")})` : "";
  console.log(
    `[phase-gate] ${commandName}: M0 비적용 / 첫 적용 milestone: ${firstMilestone}${detail}`,
  );
}
