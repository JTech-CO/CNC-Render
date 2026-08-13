const packageTarget = (name) =>
  `^(?:packages/${name}(?:/|$)|(?:node_modules/)?@cnc-render/${name}(?:/|$))`;

const implementationPackageNames =
  "ui|lesson-engine|simulation|renderer|storage";
const implementationPackages = `(?:${implementationPackageNames})`;
const corePackageNames = "lesson-engine|simulation|renderer|storage";
const coreSource = `^packages/(?:${corePackageNames})(?:/|$)`;
const coreTarget =
  `^(?:packages/(?:${corePackageNames})(?:/|$)|(?:node_modules/)?@cnc-render/(?:${corePackageNames})(?:/|$))`;
const adapterTarget =
  "^(?:packages/(?:renderer|storage)(?:/|$)|(?:node_modules/)?@cnc-render/(?:renderer|storage)(?:/|$))";

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Package and application dependencies must remain acyclic.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-contracts-to-implementations",
      severity: "error",
      comment:
        "Domain and transport contracts are the lowest TypeScript layer and cannot import product implementations.",
      from: {
        path: "^packages/contracts(?:/|$)",
      },
      to: {
        path: `^(?:packages/${implementationPackages}(?:/|$)|apps/web(?:/|$)|app(?:/|$)|(?:node_modules/)?@cnc-render/${implementationPackages}(?:/|$))`,
      },
    },
    {
      name: "no-core-to-ui",
      severity: "error",
      comment:
        "Core packages expose contracts to adapters; they never import presentation code.",
      from: {
        path: coreSource,
      },
      to: {
        path: packageTarget("ui"),
      },
    },
    {
      name: "no-ui-to-core",
      severity: "error",
      comment:
        "The shared UI package contains domain-neutral primitives and cannot depend on an engine or adapter.",
      from: {
        path: "^packages/ui(?:/|$)",
      },
      to: {
        path: coreTarget,
      },
    },
    {
      name: "no-simulation-to-adapters",
      severity: "error",
      comment:
        "Simulation is renderer- and storage-agnostic; composition belongs in the web foundation.",
      from: {
        path: "^packages/simulation(?:/|$)",
      },
      to: {
        path: adapterTarget,
      },
    },
    {
      name: "no-lesson-engine-to-runtime",
      severity: "error",
      comment:
        "Lesson validation and authored rules stay deterministic and cannot reach UI, simulation, renderer, or storage implementations.",
      from: {
        path: "^packages/lesson-engine(?:/|$)",
      },
      to: {
        path: "^(?:packages/(?:ui|simulation|renderer|storage)(?:/|$)|(?:node_modules/)?@cnc-render/(?:ui|simulation|renderer|storage)(?:/|$))",
      },
    },
    {
      name: "no-renderer-to-storage",
      severity: "error",
      comment:
        "Rendering cannot reach persistence directly; the web foundation coordinates both adapters.",
      from: {
        path: "^packages/renderer(?:/|$)",
      },
      to: {
        path: packageTarget("storage"),
      },
    },
    {
      name: "no-storage-to-renderer",
      severity: "error",
      comment:
        "Persistence cannot reach rendering directly; the web foundation coordinates both adapters.",
      from: {
        path: "^packages/storage(?:/|$)",
      },
      to: {
        path: packageTarget("renderer"),
      },
    },
    {
      name: "no-package-to-application",
      severity: "error",
      comment:
        "Reusable packages cannot import either the web foundation or the site adapter.",
      from: {
        path: `^packages/(?:contracts|${implementationPackageNames})(?:/|$)`,
      },
      to: {
        path: "^(?:apps/web|app)(?:/|$)",
      },
    },
    {
      name: "no-foundation-to-site-adapter",
      severity: "error",
      comment:
        "The root site adapter may consume the web foundation, but the foundation cannot import the site adapter.",
      from: {
        path: "^apps/web(?:/|$)",
      },
      to: {
        path: "^app(?:/|$)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "default"],
    },
  },
};
