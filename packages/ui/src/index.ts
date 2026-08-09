export {
  Button,
  DataTable,
  Dialog,
  ParameterRow,
  Tabs,
  UnitInput,
  type ButtonProps,
  type DataTableColumn,
  type DataTableProps,
  type DialogProps,
  type ParameterRowProps,
  type TabItem,
  type TabsProps,
  type UnitInputProps,
} from "./primitives";
export { designTokens, type DesignTokenName } from "./generated/tokens";

/** Stable marker for the domain-neutral presentation boundary. */
export const UI_PACKAGE_NAME = "@cnc-render/ui" as const;

export type UiPackageName = typeof UI_PACKAGE_NAME;
