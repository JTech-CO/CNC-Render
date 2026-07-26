import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitestCli = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const contractTest = fileURLToPath(
  new URL("../tests/contracts/m1-artifacts.contract.test.ts", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    vitestCli,
    "run",
    "--config",
    "vitest.contracts.config.ts",
    contractTest,
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env,
      CNC_RENDER_WRITE_CONTRACT_ARTIFACTS: "1",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[contract-artifacts] ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
