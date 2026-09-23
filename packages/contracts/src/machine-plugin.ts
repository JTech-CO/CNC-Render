import * as z from "zod";

import { MachineDefinitionSchema } from "./domain";
import {
  DirectionUnitSchema,
  FiniteNumberSchema,
  TransformSchema,
  UuidSchema,
  Vec3MmSchema,
} from "./primitives";

export const FiveAxisModeSchema = z.enum(["3plus2", "simultaneous-5axis"]);

/** Data-only description; not executable code or proof of solver support. */
export const MachinePluginSchema = z.strictObject({
  contractVersion: z.literal(1),
  pluginId: z.string().min(1).max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*(?![\s\S])/),
  pluginVersion: z.string().regex(/^\d+\.\d+\.\d+(?![\s\S])/).max(32),
  architecture: z.enum(["table-table", "head-table", "head-head"]),
  machine: MachineDefinitionSchema,
  capabilities: z.strictObject({
    modes: z.array(FiveAxisModeSchema).min(1).max(2),
    tcp: z.enum(["unsupported", "supported"]),
  }),
  // Chains run from the machine base to the attachment. Empty means fixed base.
  toolChainAxisIds: z.array(UuidSchema).max(5),
  workpieceChainAxisIds: z.array(UuidSchema).max(5),
  toolMount: z.strictObject({
    positionMm: Vec3MmSchema,
    toolAxisUnit: DirectionUnitSchema,
  }),
  workpieceMount: TransformSchema,
}).superRefine((plugin, context) => {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });
  const { machine } = plugin;
  if (!["vertical-machining-center", "horizontal-machining-center"].includes(machine.machineType)) {
    issue(["machine", "machineType"], "five-axis milling requires a machining center");
  }
  if (machine.axes.length !== 5 || machine.axes.filter((axis) => axis.kind === "rotary").length !== 2) {
    issue(["machine", "axes"], "plugin requires exactly three linear and two rotary axes");
  }
  if (new Set(plugin.capabilities.modes).size !== plugin.capabilities.modes.length) {
    issue(["capabilities", "modes"], "modes must be unique");
  }
  const axes = new Map(machine.axes.map((axis) => [axis.id, axis]));
  const used = new Set<string>();
  for (const field of ["toolChainAxisIds", "workpieceChainAxisIds"] as const) {
    let parentId: string | null = null;
    plugin[field].forEach((id, index) => {
      const axis = axes.get(id);
      if (!axis || axis.parentId !== parentId || used.has(id)) {
        issue([field, index], "chains must be disjoint, known, root-to-leaf parent sequences");
      }
      used.add(id);
      parentId = id;
    });
  }
  if (machine.axes.some((axis) => !used.has(axis.id))) {
    issue(["machine", "axes"], "every machine axis must belong to exactly one attachment chain");
  }
  const headRotaries = plugin.toolChainAxisIds.filter((id) => axes.get(id)?.kind === "rotary").length;
  const expectedHeadRotaries = { "table-table": 0, "head-table": 1, "head-head": 2 }[plugin.architecture];
  if (headRotaries !== expectedHeadRotaries) {
    issue(["architecture"], "architecture must match rotary ownership of tool and workpiece chains");
  }
});

export type MachinePlugin = z.infer<typeof MachinePluginSchema>;
export type FiveAxisMode = z.infer<typeof FiveAxisModeSchema>;

/** Workpiece coordinates; tool-axis roll is intentionally not part of the task. */
export const FiveAxisTargetSchema = z.strictObject({
  tcpPositionMm: Vec3MmSchema,
  toolAxisUnit: DirectionUnitSchema,
});
export type FiveAxisTarget = z.infer<typeof FiveAxisTargetSchema>;
export type MachinePluginState = z.infer<ReturnType<typeof createMachinePluginStateSchema>>;

export const SolutionWeightsSchema = z.strictObject({
  axisTravel: z.number().int().min(0).max(1000),
  limitPenalty: z.number().int().min(0).max(1000),
  singularityRisk: z.number().int().min(0).max(1000),
}).refine((w) => w.axisTravel + w.limitPenalty + w.singularityRisk > 0, "at least one weight must be positive");
export type SolutionWeights = z.infer<typeof SolutionWeightsSchema>;

export const MachineAxisPositionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ axisId: UuidSchema, kind: z.literal("linear"), positionMm: FiniteNumberSchema }),
  z.strictObject({ axisId: UuidSchema, kind: z.literal("rotary"), positionRad: FiniteNumberSchema }),
]);

/** Captures a validated copy so later caller mutation cannot change validation. */
export function createMachinePluginStateSchema(definition: unknown) {
  const plugin = MachinePluginSchema.parse(definition);
  const axes = new Map(plugin.machine.axes.map((axis) => [axis.id, axis]));
  return z.strictObject({
    contractVersion: z.literal(1),
    pluginId: z.literal(plugin.pluginId),
    pluginVersion: z.literal(plugin.pluginVersion),
    machineId: z.literal(plugin.machine.id),
    mode: FiveAxisModeSchema,
    tcpEnabled: z.boolean(),
    positions: z.array(MachineAxisPositionSchema).length(5),
  }).superRefine((state, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    if (!plugin.capabilities.modes.includes(state.mode)) {
      issue(["mode"], "mode is not supported by the plugin");
    }
    if (state.tcpEnabled && plugin.capabilities.tcp !== "supported") {
      issue(["tcpEnabled"], "TCP is not supported by the plugin");
    }
    const seen = new Set<string>();
    state.positions.forEach((position, index) => {
      const axis = axes.get(position.axisId);
      if (!axis || seen.has(position.axisId) || axis.kind !== position.kind) {
        issue(["positions", index], "axis must be known, unique and use the correct unit");
      } else {
        const outside = axis.kind === "linear" && position.kind === "linear"
          ? position.positionMm < axis.minMm || position.positionMm > axis.maxMm
          : axis.kind === "rotary" && position.kind === "rotary"
            ? position.positionRad < axis.minRad || position.positionRad > axis.maxRad
            : true;
        if (outside) issue(["positions", index], "axis position exceeds inclusive travel limits");
      }
      seen.add(position.axisId);
    });
  });
}
