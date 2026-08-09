import {
  CloudPersistencePlanSchema,
  type CloudPersistencePlan,
} from "@cnc-render/contracts";

/** Cloud persistence remains disabled until a user explicitly grants content consent. */
export const CLOUD_PERSISTENCE_PLAN: CloudPersistencePlan =
  CloudPersistencePlanSchema.parse({
    schemaVersion: 1,
    enabled: false,
    reason: "user-consent-required",
    d1Binding: null,
    r2Binding: null,
    containsProjectBytes: false,
  });
