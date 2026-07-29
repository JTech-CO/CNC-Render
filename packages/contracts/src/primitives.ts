import * as z from "zod";

import { SCHEMA_VERSION } from "./constants";

const RFC_9562_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_RFC_3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z(?![\s\S])/;
const NORMALIZED_MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?![\s\S])/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isUtcRfc3339(value: string): boolean {
  const match = UTC_RFC_3339_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function isNotNegativeZero(value: number): boolean {
  return !Object.is(value, -0);
}

export const SchemaVersionSchema = z.literal(SCHEMA_VERSION);
export const UuidSchema = z
  .string()
  .length(36)
  .regex(RFC_9562_UUID_PATTERN, "value must be an RFC 9562 UUID");
export const UtcDateTimeSchema = z
  .string()
  .regex(UTC_RFC_3339_PATTERN, "timestamp must be UTC RFC 3339")
  .refine(isUtcRfc3339, "timestamp must be a real UTC calendar instant");
export const FiniteNumberSchema = z
  .number()
  .refine(isNotNegativeZero, "number must not be negative zero");
export const PositiveNumberSchema = z.number().positive();
export const NonNegativeNumberSchema = z
  .number()
  .nonnegative()
  .refine(isNotNegativeZero, "number must not be negative zero");
export const SafeSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .refine(isNotNegativeZero, "sequence must not be negative zero");

export const Vec3MmSchema = z.strictObject({
  xMm: FiniteNumberSchema,
  yMm: FiniteNumberSchema,
  zMm: FiniteNumberSchema,
});

export const DirectionUnitSchema = z
  .strictObject({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    z: FiniteNumberSchema,
  })
  .superRefine((direction, context) => {
    const magnitude = Math.hypot(direction.x, direction.y, direction.z);
    if (Math.abs(magnitude - 1) > 1e-9) {
      context.addIssue({
        code: "custom",
        message: "axis direction must be a normalized unit vector",
      });
    }
  });

export const RotationRadSchema = z.strictObject({
  xRad: FiniteNumberSchema,
  yRad: FiniteNumberSchema,
  zRad: FiniteNumberSchema,
});

export const TransformSchema = z.strictObject({
  positionMm: Vec3MmSchema,
  rotationRad: RotationRadSchema,
});

export const ResourceRoleSchema = z.enum([
  "gcode-program",
  "machine-model",
  "stock-model",
  "target-model",
  "toolpath",
  "checkpoint",
  "preview",
  "report",
]);

export const ResourceDescriptorSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: UuidSchema,
    path: z.string().min(1).max(512),
    role: ResourceRoleSchema,
    mediaType: z
      .string()
      .regex(
        NORMALIZED_MIME_TYPE_PATTERN,
        "mediaType must be a normalized MIME type",
      ),
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
    authoritative: z.boolean(),
  })
  .superRefine((resource, context) => {
    if (!isSafeResourcePath(resource.path)) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: "resource path must be a safe normalized relative path",
      });
    }
    if (
      ["checkpoint", "preview", "report"].includes(resource.role) &&
      resource.authoritative
    ) {
      context.addIssue({
        code: "custom",
        path: ["authoritative"],
        message:
          "derived checkpoint, preview, and report resources are not authoritative",
      });
    }
  });

export type Vec3Mm = z.infer<typeof Vec3MmSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type ResourceDescriptor = z.infer<typeof ResourceDescriptorSchema>;

export function isSafeResourcePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}
