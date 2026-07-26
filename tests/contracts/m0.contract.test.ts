import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  name: string;
  version: string;
  private: boolean;
  type: string;
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TokenDocument {
  policy: {
    colorScheme: string;
    lightOnly: boolean;
    allowSystemTheme: boolean;
  };
  tokens: {
    color: Record<string, { $value: string }>;
  };
}

interface DependencyCruiserConfiguration {
  forbidden: Array<{
    name: string;
    severity: string;
  }>;
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

async function readJson<T>(relativePath: string): Promise<T> {
  const contents = await readFile(resolve(repositoryRoot, relativePath), "utf8");
  return JSON.parse(contents) as T;
}

describe("M0 repository contract", () => {
  it("pins the workspace identity, toolchain, scripts, and dependencies", async () => {
    const manifest = await readJson<PackageManifest>("package.json");
    const workspace = await readFile(
      resolve(repositoryRoot, "pnpm-workspace.yaml"),
      "utf8",
    );

    expect(manifest).toMatchObject({
      name: "cnc-render",
      version: "0.0.0",
      private: true,
      type: "module",
      packageManager: "pnpm@11.5.3",
      engines: {
        node: "24.18.0",
        pnpm: "11.5.3",
      },
    });
    expect(workspace).toMatch(/^\s*-\s+"apps\/\*"\s*$/mu);
    expect(workspace).toMatch(/^\s*-\s+"packages\/\*"\s*$/mu);

    const standardScripts = [
      "lint",
      "typecheck",
      "test:unit",
      "test:contracts",
      "test:parity",
      "test:e2e",
      "test:visual",
      "test:a11y",
      "cargo:check",
      "cargo:test",
      "generate:contracts",
      "build",
      "bench",
      "check:bundle",
      "check:forbidden-ui",
      "verify",
    ];

    expect(manifest.scripts).toBeDefined();
    for (const scriptName of standardScripts) {
      expect(manifest.scripts).toHaveProperty(scriptName);
    }

    expect(manifest.scripts).toMatchObject({
      dev: "vinext dev",
      build: "vinext build",
      start: "vinext start",
      "cargo:check":
        "node scripts/run-cargo.mjs check --workspace --all-targets --locked",
      "cargo:test": "node scripts/run-cargo.mjs test --workspace --locked",
      "generate:contracts": "node scripts/generate-contract-artifacts.mjs",
      verify:
        "pnpm lint && pnpm typecheck && pnpm cargo:check && pnpm test:unit && pnpm test:contracts && pnpm test:parity && pnpm check:forbidden-ui && pnpm build",
    });
    expect(manifest.scripts?.lint).toContain(
      "depcruise --config dependency-cruiser.config.cjs",
    );
    expect(manifest.scripts?.lint).toContain("pnpm check:doc-terms");
    expect(manifest.scripts?.lint).toContain("pnpm check:toolchain");

    expect(manifest.dependencies).toMatchObject({
      "@cnc-render/web": "workspace:*",
      next: "16.2.6",
      react: "19.2.6",
      "react-dom": "19.2.6",
    });
    expect(manifest.devDependencies).toMatchObject({
      "@cloudflare/vite-plugin": "1.37.1",
      "dependency-cruiser": "18.1.0",
      vinext: "0.0.50",
      vite: "8.0.13",
      vitest: "4.1.10",
      wrangler: "4.92.0",
    });

    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    expect(dependencies).not.toHaveProperty("drizzle-orm");
    expect(dependencies).not.toHaveProperty("drizzle-kit");
    expect(dependencies).not.toHaveProperty("react-loading-skeleton");
    expect(dependencies).not.toHaveProperty("tailwindcss");
    expect(dependencies).not.toHaveProperty("@tailwindcss/postcss");
    expect(existsSync(resolve(repositoryRoot, "package-lock.json"))).toBe(false);
  });

  it("keeps every workspace package private and ESM-only", async () => {
    const packages = [
      ["apps/web/package.json", "@cnc-render/web"],
      ["packages/contracts/package.json", "@cnc-render/contracts"],
      ["packages/ui/package.json", "@cnc-render/ui"],
      ["packages/simulation/package.json", "@cnc-render/simulation"],
      ["packages/renderer/package.json", "@cnc-render/renderer"],
      ["packages/storage/package.json", "@cnc-render/storage"],
    ] as const;

    for (const [manifestPath, expectedName] of packages) {
      const manifest = await readJson<PackageManifest>(manifestPath);
      expect(manifest).toMatchObject({
        name: expectedName,
        private: true,
        type: "module",
      });
    }
  });

  it("enforces the required package dependency boundaries", () => {
    const configuration = require(
      resolve(repositoryRoot, "dependency-cruiser.config.cjs"),
    ) as DependencyCruiserConfiguration;
    const requiredRules = [
      "no-circular",
      "no-contracts-to-implementations",
      "no-core-to-ui",
      "no-ui-to-core",
      "no-simulation-to-adapters",
      "no-renderer-to-storage",
      "no-storage-to-renderer",
      "no-package-to-application",
      "no-foundation-to-site-adapter",
    ];

    expect(configuration.forbidden.map((rule) => rule.name)).toEqual(
      expect.arrayContaining(requiredRules),
    );
    expect(configuration.forbidden).toEqual(
      expect.arrayContaining(
        requiredRules.map((name) =>
          expect.objectContaining({ name, severity: "error" }),
        ),
      ),
    );
  });

  it("keeps the canonical document and design-token decisions aligned", async () => {
    const [tokens, projectFormat, terminology, technical, design] =
      await Promise.all([
        readJson<TokenDocument>("design/tokens/cnc-render.tokens.json"),
        readFile(
          resolve(
            repositoryRoot,
            "docs/architecture-decisions/0002-project-container-format.md",
          ),
          "utf8",
        ),
        readFile(resolve(repositoryRoot, "docs/terminology.md"), "utf8"),
        readFile(resolve(repositoryRoot, "docs/technical-whitepaper.md"), "utf8"),
        readFile(resolve(repositoryRoot, "docs/design-whitepaper.md"), "utf8"),
      ]);

    expect(tokens.policy).toMatchObject({
      colorScheme: "light",
      lightOnly: true,
      allowSystemTheme: false,
    });
    expect(tokens.tokens.color["app-bg"]?.$value).toBe("#f4f6f8");

    expect(projectFormat).toContain(".cncrender");
    expect(projectFormat).toContain(
      "application/vnd.cnc-render.project+zip",
    );
    expect(projectFormat).toContain("urn:cnc-render:schema:project:1");
    expect(terminology).toContain("라이트모드 전용");
    expect(terminology).toContain(".cncrender");

    for (const canonicalWhitepaper of [technical, design]) {
      expect(canonicalWhitepaper).not.toMatch(/\bCNCverse\b/iu);
      expect(canonicalWhitepaper).not.toMatch(/\.cncverse\b/iu);
      expect(canonicalWhitepaper).not.toMatch(/\bdark\s+mode\b/iu);
      expect(canonicalWhitepaper).not.toMatch(/다크\s*모드/u);
    }
  });

  it("runs the canonical terminology checker as an executable contract", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/check-doc-terms.mjs")],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        windowsHide: true,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("[doc-terms]");
  });
});
