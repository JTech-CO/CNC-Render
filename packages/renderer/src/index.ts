export {
  CAMERA_PRESETS,
  RENDERER_LIMITS,
  RENDERER_PACKAGE_NAME,
  RENDER_SCENE_UNITS,
  SCENE_LAYERS,
  SCENE_PRESENTATION,
} from "./contracts";
export type {
  CameraPreset,
  CameraPresetId,
  RendererBackendSelection,
  RendererCapabilityProbe,
  RendererLimit,
  RendererMode,
  RendererPackageName,
  RendererPreference,
  RendererResourceSnapshot,
  RendererTelemetry,
  SceneLayerDefinition,
  SceneLayerId,
  Vector3Tuple,
} from "./contracts";
export {
  detectBrowserRendererCapabilities,
  selectRendererBackend,
} from "./capabilities";
export {
  domainBoundsToSceneBounds,
  domainMmToScene,
} from "./coordinate-space";
export {
  maximumProjectedBoundsDelta,
  projectAxisAlignedBounds,
} from "./projection";
export type {
  AxisAlignedBounds,
  ProjectedBounds,
} from "./projection";
export { resourceDelta, resourcesAreStable } from "./resource-stability";
export {
  PartialStockSurface,
  StockSurfaceInputError,
} from "./stock-surface";
export type {
  StockSurfaceBufferDiagnostics,
  StockSurfaceDescriptor,
  StockSurfacePatch,
  StockSurfacePointMm,
} from "./stock-surface";
