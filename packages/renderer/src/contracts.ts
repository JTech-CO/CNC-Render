/**
 * Renderer-owned contracts. The simulation remains the authority for machine
 * state; these values only describe how immutable snapshots are presented.
 */

export const RENDERER_PACKAGE_NAME = "@cnc-render/renderer" as const;

export type RendererPackageName = typeof RENDERER_PACKAGE_NAME;

export const RENDER_SCENE_UNITS = {
  length: "millimetre",
  unitsPerMillimetre: 1,
} as const;

export const SCENE_PRESENTATION = {
  viewportBackground: "#e9edf1",
  stockSurface: "#fdfdfb",
  stockEdge: "#4d5966",
} as const;

export type RendererMode = "webgpu" | "webgl2";
export type RendererPreference = "auto" | RendererMode;

export interface RendererCapabilityProbe {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly crossOriginIsolated: boolean;
  readonly maxTextureDimension2d: number | null;
}

export interface RendererLimit {
  readonly id:
    | "surface-resolution"
    | "toolpath-segments"
    | "material-update"
    | "antialiasing";
  readonly label: string;
  readonly value: string;
}

export interface RendererBackendSelection {
  readonly mode: RendererMode | null;
  readonly requested: RendererPreference;
  readonly reason:
    | "webgpu-available"
    | "webgpu-forced"
    | "webgl2-fallback"
    | "webgl2-forced"
    | "no-supported-backend";
  readonly limits: readonly RendererLimit[];
}

export const RENDERER_LIMITS: Readonly<
  Record<RendererMode, readonly RendererLimit[]>
> = {
  webgpu: [
    {
      id: "surface-resolution",
      label: "표면 프리뷰",
      value: "최대 2048 × 2048 texel",
    },
    {
      id: "toolpath-segments",
      label: "공구 경로",
      value: "최대 1,000,000 segments",
    },
    {
      id: "material-update",
      label: "소재 갱신",
      value: "GPU compute 준비",
    },
    {
      id: "antialiasing",
      label: "안티앨리어싱",
      value: "4× MSAA",
    },
  ],
  webgl2: [
    {
      id: "surface-resolution",
      label: "표면 프리뷰",
      value: "최대 1024 × 1024 texel",
    },
    {
      id: "toolpath-segments",
      label: "공구 경로",
      value: "최대 250,000 segments",
    },
    {
      id: "material-update",
      label: "소재 갱신",
      value: "CPU/WASM 메시 프리뷰",
    },
    {
      id: "antialiasing",
      label: "안티앨리어싱",
      value: "최대 4× MSAA",
    },
  ],
} as const;

export type SceneLayerId =
  | "machine"
  | "stock"
  | "cutter"
  | "holder"
  | "fixture"
  | "toolpath";

export interface SceneLayerDefinition {
  readonly id: SceneLayerId;
  readonly label: string;
  readonly collisionGroupId: string;
  readonly collisionMask: number;
  readonly defaultVisible: boolean;
  readonly selectable: boolean;
}

export const SCENE_LAYERS: readonly SceneLayerDefinition[] = [
  {
    id: "machine",
    label: "기계",
    collisionGroupId: "machine-static",
    collisionMask: 1,
    defaultVisible: true,
    selectable: true,
  },
  {
    id: "stock",
    label: "소재",
    collisionGroupId: "stock",
    collisionMask: 2,
    defaultVisible: true,
    selectable: true,
  },
  {
    id: "cutter",
    label: "절삭 공구",
    collisionGroupId: "cutter",
    collisionMask: 4,
    defaultVisible: true,
    selectable: true,
  },
  {
    id: "holder",
    label: "공구 홀더",
    collisionGroupId: "holder",
    collisionMask: 8,
    defaultVisible: true,
    selectable: true,
  },
  {
    id: "fixture",
    label: "고정구",
    collisionGroupId: "fixture",
    collisionMask: 16,
    defaultVisible: true,
    selectable: true,
  },
  {
    id: "toolpath",
    label: "공구 경로",
    collisionGroupId: "toolpath-guide",
    collisionMask: 32,
    defaultVisible: true,
    selectable: false,
  },
] as const;

export type CameraPresetId =
  | "front"
  | "top"
  | "right"
  | "isometric";

export type Vector3Tuple = readonly [number, number, number];

export interface CameraPreset {
  readonly id: CameraPresetId;
  readonly label: string;
  /** CNC domain coordinates in millimetres: X, Y, Z-up. */
  readonly positionMm: Vector3Tuple;
  readonly targetMm: Vector3Tuple;
  readonly up: Vector3Tuple;
}

export const CAMERA_PRESETS: Readonly<Record<CameraPresetId, CameraPreset>> = {
  front: {
    id: "front",
    label: "정면",
    positionMm: [0, -1_450, 260],
    targetMm: [0, 0, 180],
    up: [0, 0, 1],
  },
  top: {
    id: "top",
    label: "평면",
    positionMm: [0, 0, 1_650],
    targetMm: [0, 0, 80],
    up: [0, 1, 0],
  },
  right: {
    id: "right",
    label: "우측",
    positionMm: [1_450, 0, 260],
    targetMm: [0, 0, 180],
    up: [0, 0, 1],
  },
  isometric: {
    id: "isometric",
    label: "등각",
    positionMm: [1_050, -1_100, 820],
    targetMm: [0, 0, 160],
    up: [0, 0, 1],
  },
} as const;

export interface RendererResourceSnapshot {
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
}

export interface RendererTelemetry {
  readonly framesRendered: number;
  readonly lastFrameMs: number;
  readonly averageFrameMs: number;
  readonly resources: RendererResourceSnapshot;
}
