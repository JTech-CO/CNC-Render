import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const ENTRY_SOURCE = "virtual:vinext-app-browser-entry";
const WORKSPACE_SHELL_SOURCE = "app/components/workspace-shell.tsx";
const MACHINE_WORKSPACE_SOURCE = "app/components/machine-workspace.tsx";
const GCODE_LAB_SOURCE = "app/components/gcode-lab-panel.tsx";
const LAZY_SENTINELS = [
  "MonacoEnvironment",
  "cnc-render-gcode-analysis",
  "gcode.analysis.request",
];

function requireEntry(manifest, key) {
  const entry = manifest[key];
  if (!entry) {
    throw new Error(`[ui-bundle] Missing Vite manifest entry ${key}.`);
  }
  return entry;
}

function staticClosure(manifest, roots) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visited.has(key)) {
      continue;
    }
    visited.add(key);
    const entry = manifest[key];
    if (!entry) {
      continue;
    }
    for (const imported of entry.imports ?? []) {
      pending.push(imported);
    }
  }
  return visited;
}

async function entryText(distClient, manifest, keys) {
  const chunks = [];
  for (const key of keys) {
    const file = manifest[key]?.file;
    if (typeof file === "string" && extname(file) === ".js") {
      chunks.push(await readFile(resolve(distClient, file), "utf8"));
    }
  }
  return chunks.join("\n");
}

export async function checkGcodeLabLazyBoundary(distClient) {
  const manifestPath = resolve(distClient, ".vite/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry = requireEntry(manifest, ENTRY_SOURCE);
  const workspaceShell = requireEntry(manifest, WORKSPACE_SHELL_SOURCE);
  const machineWorkspace = requireEntry(manifest, MACHINE_WORKSPACE_SOURCE);
  const gcodeLab = requireEntry(manifest, GCODE_LAB_SOURCE);

  if (!entry.isEntry || !workspaceShell.isDynamicEntry) {
    throw new Error("[ui-bundle] Initial application entries are malformed.");
  }
  if (
    !machineWorkspace.dynamicImports?.includes(GCODE_LAB_SOURCE) ||
    !gcodeLab.isDynamicEntry
  ) {
    throw new Error(
      "[ui-bundle] G-code Lab must remain a dynamic import of MachineWorkspace.",
    );
  }

  const initialKeys = staticClosure(manifest, [
    ENTRY_SOURCE,
    WORKSPACE_SHELL_SOURCE,
    MACHINE_WORKSPACE_SOURCE,
  ]);
  if (initialKeys.has(GCODE_LAB_SOURCE)) {
    throw new Error(
      "[ui-bundle] G-code Lab entered the initial static dependency graph.",
    );
  }
  const initialText = await entryText(distClient, manifest, initialKeys);
  const leaked = LAZY_SENTINELS.filter((sentinel) =>
    initialText.includes(sentinel),
  );
  if (leaked.length > 0) {
    throw new Error(
      `[ui-bundle] Monaco/G-code analysis leaked into initial chunks: ${leaked.join(", ")}.`,
    );
  }

  const labKeys = staticClosure(manifest, [GCODE_LAB_SOURCE]);
  const labText = await entryText(distClient, manifest, labKeys);
  const missing = LAZY_SENTINELS.filter(
    (sentinel) => !labText.includes(sentinel),
  );
  if (missing.length > 0) {
    throw new Error(
      `[ui-bundle] G-code Lab lazy chunk is missing: ${missing.join(", ")}.`,
    );
  }

  console.log(
    `[ui-bundle] G-code Lab lazy boundary verified across ${initialKeys.size} initial and ${labKeys.size} lazy manifest entries.`,
  );
}
