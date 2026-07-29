import * as z from "zod";

const DOT_CODE_PATTERN =
  /^[a-z0-9]+(?:\.[a-z0-9]+)*(?![\s\S])/;

export const DotCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    DOT_CODE_PATTERN,
    "value must be a lowercase dot-delimited protocol code",
  );
