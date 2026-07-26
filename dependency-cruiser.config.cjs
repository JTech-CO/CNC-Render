const packageTarget = (name) =>
  `^(?:packages/${name}(?:/|$)|(?:node_modules/)?@cnc-render/${name}(?:/|$))`;

const coreSource = "^packages/(?:simulation|renderer|storage)(?:/|$)";
const coreTarget =
  "^(?:packages/(?:simulation|renderer|storage)(?:/|$)|(?:node_modules/)?@cnc-render/(?:simulation|renderer|storage)(?:/|$))";
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
        path: "^packages/(?:ui|simulation|renderer|storage)(?:/|$)",
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
