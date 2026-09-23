import type { MachinePlugin } from "@cnc-render/contracts";

const uuid = (index: number) => `13000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** Contract fixtures only: these do not claim FK/IK or cutting certification. */
export function machinePluginFixture(architecture: MachinePlugin["architecture"]): MachinePlugin {
  const headCount = { "table-table": 0, "head-table": 1, "head-head": 2 }[architecture];
  const toolChain = [1, 2, 3, ...[4, 5].slice(0, headCount)];
  const tableChain = [4, 5].slice(headCount);
  const axes: MachinePlugin["machine"]["axes"] = [1, 2, 3, 4, 5].map((index) => {
    const chain = toolChain.includes(index) ? toolChain : tableChain;
    const offset = chain.indexOf(index);
    const common = {
      schemaVersion: 1 as const, id: uuid(index), name: ["X", "Y", "Z", "A", "C"][index - 1],
      parentId: offset === 0 ? null : uuid(chain[offset - 1]),
      directionUnit: { x: index === 1 || index === 4 ? 1 : 0, y: index === 2 ? 1 : 0, z: index === 3 || index === 5 ? 1 : 0 },
      pivotMm: { xMm: 0, yMm: 0, zMm: index === 4 ? 100 : 0 },
    };
    return index <= 3
      ? { ...common, kind: "linear" as const, minMm: -500, maxMm: 500, homeMm: 0, maxVelocityMmPerMin: 6000, maxAccelerationMmPerS2: 1000 }
      : { ...common, kind: "rotary" as const, minRad: -Math.PI, maxRad: Math.PI, homeRad: 0, maxVelocityRadPerS: 1, maxAccelerationRadPerS2: 2 };
  });
  return {
    contractVersion: 1, pluginId: `educational.${architecture}`, pluginVersion: "1.0.0", architecture,
    machine: {
      schemaVersion: 1, id: uuid(10), name: `Contract ${architecture}`, machineType: "vertical-machining-center",
      axes, kinematicRootAxisIds: axes.filter((axis) => axis.parentId === null).map((axis) => axis.id),
      spindles: [{ schemaVersion: 1, id: uuid(11), name: "Spindle", maxSpindleSpeedRpm: 12000 }],
      workEnvelope: { minMm: { xMm: -500, yMm: -500, zMm: -500 }, maxMm: { xMm: 500, yMm: 500, zMm: 500 } },
      maxFeedMmPerMin: 6000, modelAssetResourceId: null, collisionGroups: [],
    },
    capabilities: { modes: ["3plus2", "simultaneous-5axis"], tcp: "supported" },
    toolChainAxisIds: toolChain.map(uuid), workpieceChainAxisIds: tableChain.map(uuid),
    toolMount: { positionMm: { xMm: 0, yMm: 0, zMm: -120 }, toolAxisUnit: { x: 0, y: 0, z: 1 } },
    workpieceMount: { positionMm: { xMm: 0, yMm: 0, zMm: 100 }, rotationRad: { xRad: 0, yRad: 0, zRad: 0 } },
  };
}

export function machineStateFixture(plugin: MachinePlugin) {
  return {
    contractVersion: 1 as const, pluginId: plugin.pluginId, pluginVersion: plugin.pluginVersion,
    machineId: plugin.machine.id, mode: "3plus2" as const, tcpEnabled: true,
    positions: plugin.machine.axes.map((axis) => axis.kind === "linear"
      ? { axisId: axis.id, kind: "linear" as const, positionMm: axis.homeMm }
      : { axisId: axis.id, kind: "rotary" as const, positionRad: axis.homeRad }),
  };
}
