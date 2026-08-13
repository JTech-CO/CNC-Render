import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import {
  SCENE_LAYERS,
  SCENE_PRESENTATION,
  type SceneLayerId,
} from "./contracts";
import { domainMmToScene } from "./coordinate-space";
import {
  PartialRotationalStockSurface,
  type RotationalStockSurfaceDescriptor,
  type RotationalStockSurfaceDiagnostics,
  type RotationalStockSurfacePatch,
} from "./rotational-stock-surface";
import {
  PartialStockSurface,
  type StockSurfaceBufferDiagnostics,
  type StockSurfaceDescriptor,
  type StockSurfacePatch,
} from "./stock-surface";

const MILLING_TOOL_TIP_HOME_MM = 340;

const MACHINE_COLOR = 0xaeb8c3;
const MACHINE_DARK_COLOR = 0x55616f;
const TABLE_COLOR = 0x667482;
const FIXTURE_COLOR = 0x4f6276;
const HOLDER_COLOR = 0x3f4b57;
const CUTTER_COLOR = 0xa36a2c;
const TOOLPATH_COLOR = 0x2859c5;
const SELECTION_COLOR = 0xc26420;
const COLLISION_MARKER_COLOR = 0xb42318;
export const DEFAULT_VIEWPORT_BACKGROUND =
  SCENE_PRESENTATION.viewportBackground;

export type MachinePresentationMode = "milling" | "turning";

export interface MachineScene {
  readonly scene: Scene;
  readonly contentRoot: Group;
  readonly layerGroups: ReadonlyMap<SceneLayerId, Group>;
  readonly selectableObjects: Object3D[];
  readonly fitBounds: Box3;
  readonly presentationMode: MachinePresentationMode;
  select(object: Object3D | null): SceneLayerId | null;
  setPresentationMode(mode: MachinePresentationMode): void;
  setMillingToolpath(
    pointsMm: readonly (readonly [number, number, number])[],
  ): void;
  configureStockSurface(
    descriptor: StockSurfaceDescriptor,
  ): StockSurfaceBufferDiagnostics;
  applyStockSurfacePatches(
    patches: readonly StockSurfacePatch[],
  ): StockSurfaceBufferDiagnostics;
  configureRotationalStockSurface(
    descriptor: RotationalStockSurfaceDescriptor,
  ): RotationalStockSurfaceDiagnostics;
  applyRotationalStockSurfacePatches(
    patches: readonly RotationalStockSurfacePatch[],
  ): RotationalStockSurfaceDiagnostics;
  getRotationalStockSurfaceDiagnostics(): RotationalStockSurfaceDiagnostics | null;
  getStockSurfaceDiagnostics(): StockSurfaceBufferDiagnostics | null;
  finishStockSurfaceUpload(): void;
  setToolPositionMm(
    positionMm: readonly [number, number, number],
  ): void;
  setCollisionMarker(
    positionMm: readonly [number, number, number] | null,
  ): void;
  dispose(): void;
}

function positionFromDomain(
  object: Object3D,
  positionMm: readonly [number, number, number],
): void {
  const [x, y, z] = domainMmToScene(positionMm);
  object.position.set(x, y, z);
}

function tagObject(
  object: Object3D,
  layerId: SceneLayerId,
  selectable: boolean,
): void {
  const definition = SCENE_LAYERS.find((layer) => layer.id === layerId);

  if (!definition) {
    throw new Error(`Unknown scene layer: ${layerId}`);
  }

  object.userData.sceneLayerId = layerId;
  object.userData.collisionGroupId = definition.collisionGroupId;
  object.userData.collisionMask = definition.collisionMask;
  object.userData.selectable = selectable;
}

function box(
  layer: Group,
  layerId: SceneLayerId,
  sizeMm: readonly [number, number, number],
  positionMm: readonly [number, number, number],
  material: MeshStandardMaterial,
  selectable = true,
): Mesh {
  const [widthX, depthY, heightZ] = sizeMm;
  const geometry = new BoxGeometry(widthX, heightZ, depthY);
  const mesh = new Mesh(geometry, material);
  positionFromDomain(mesh, positionMm);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  tagObject(mesh, layerId, selectable);
  layer.add(mesh);
  return mesh;
}

function cylinder(
  layer: Group,
  layerId: SceneLayerId,
  radiusTopMm: number,
  radiusBottomMm: number,
  heightMm: number,
  positionMm: readonly [number, number, number],
  material: MeshStandardMaterial,
  selectable = true,
): Mesh {
  const geometry = new CylinderGeometry(
    radiusTopMm,
    radiusBottomMm,
    heightMm,
    32,
  );
  const mesh = new Mesh(geometry, material);
  positionFromDomain(mesh, positionMm);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  tagObject(mesh, layerId, selectable);
  layer.add(mesh);
  return mesh;
}

function addStockOutline(stock: Mesh): void {
  const outline = new LineSegments(
    new EdgesGeometry(stock.geometry),
    new LineBasicMaterial({
      color: SCENE_PRESENTATION.stockEdge,
      transparent: true,
      opacity: 0.78,
    }),
  );
  outline.name = "education-stock-outline";
  outline.renderOrder = 5;
  tagObject(outline, "stock", false);
  stock.add(outline);
}

function makeLayerGroups(): Map<SceneLayerId, Group> {
  return new Map(
    SCENE_LAYERS.map((definition) => {
      const group = new Group();
      group.name = `scene-layer:${definition.id}`;
      group.visible = definition.defaultVisible;
      tagObject(group, definition.id, false);
      return [definition.id, group] as const;
    }),
  );
}

function makePresentationGroup(
  parent: Group,
  mode: MachinePresentationMode,
  layerId: SceneLayerId,
  visible: boolean,
): Group {
  const group = new Group();
  group.name = `presentation:${mode}:${layerId}`;
  group.visible = visible;
  tagObject(group, layerId, false);
  parent.add(group);
  return group;
}

function addTurningFixture(
  layer: Group,
  selectableObjects: Object3D[],
  material: MeshStandardMaterial,
): void {
  const chuck = cylinder(
    layer,
    "fixture",
    58,
    58,
    36,
    [0, 0, 222],
    material,
  );
  const jaws = [
    box(layer, "fixture", [18, 34, 18], [34, 0, 245], material),
    box(layer, "fixture", [18, 34, 18], [-34, 0, 245], material),
    box(layer, "fixture", [34, 18, 18], [0, 34, 245], material),
    box(layer, "fixture", [34, 18, 18], [0, -34, 245], material),
  ];
  selectableObjects.push(chuck, ...jaws);
}

function addTurningToolAssembly(
  holderLayer: Group,
  cutterLayer: Group,
  selectableObjects: Object3D[],
  holderMaterial: MeshStandardMaterial,
  cutterMaterial: MeshStandardMaterial,
): void {
  const holder = box(
    holderLayer,
    "holder",
    [76, 34, 26],
    [46, 0, 0],
    holderMaterial,
  );
  const insert = box(
    cutterLayer,
    "cutter",
    [16, 14, 10],
    [8, 0, 0],
    cutterMaterial,
  );
  selectableObjects.push(holder, insert);
}

function addTurningToolpath(layer: Group): void {
  const pointsMm: readonly [number, number, number][] = [
    [45, 0, 370],
    [45, 0, 350],
    [38, 0, 350],
    [38, 0, 250],
    [45, 0, 250],
    [45, 0, 350],
    [36, 0, 350],
    [36, 0, 250],
    [45, 0, 250],
    [45, 0, 350],
    [34, 0, 350],
    [34, 0, 250],
    [45, 0, 250],
    [45, 0, 350],
    [32, 0, 350],
    [32, 0, 250],
    [45, 0, 250],
    [45, 0, 370],
  ];
  const points = pointsMm.map((point) => {
    const [x, y, z] = domainMmToScene(point);
    return new Vector3(x, y, z);
  });
  const line = new Line(
    new BufferGeometry().setFromPoints(points),
    new LineBasicMaterial({
      color: TOOLPATH_COLOR,
      transparent: true,
      opacity: 0.9,
    }),
  );
  line.name = "turning-toolpath";
  tagObject(line, "toolpath", false);
  layer.add(line);
}
function addMachine(
  layer: Group,
  selectableObjects: Object3D[],
  materials: {
    machine: MeshStandardMaterial;
    machineDark: MeshStandardMaterial;
    table: MeshStandardMaterial;
  },
): void {
  const base = box(
    layer,
    "machine",
    [1_120, 760, 90],
    [0, 0, 45],
    materials.machineDark,
  );
  const leftColumn = box(
    layer,
    "machine",
    [150, 620, 1_050],
    [-480, 80, 570],
    materials.machine,
  );
  const rightColumn = box(
    layer,
    "machine",
    [150, 620, 1_050],
    [480, 80, 570],
    materials.machine,
  );
  const bridge = box(
    layer,
    "machine",
    [1_110, 360, 170],
    [0, 155, 1_080],
    materials.machine,
  );
  const table = box(
    layer,
    "machine",
    [760, 520, 70],
    [0, -20, 135],
    materials.table,
  );
  const saddle = box(
    layer,
    "machine",
    [880, 610, 64],
    [0, 10, 88],
    materials.machineDark,
  );

  selectableObjects.push(base, leftColumn, rightColumn, bridge, table, saddle);

  for (const x of [-260, -130, 0, 130, 260]) {
    const slot = box(
      layer,
      "machine",
      [18, 500, 5],
      [x, -20, 173],
      materials.machineDark,
      false,
    );
    slot.castShadow = false;
  }
}

function addFixture(
  layer: Group,
  selectableObjects: Object3D[],
  material: MeshStandardMaterial,
): void {
  const base = box(
    layer,
    "fixture",
    [490, 330, 36],
    [0, 0, 190],
    material,
  );
  const fixedJaw = box(
    layer,
    "fixture",
    [490, 48, 92],
    [0, 122, 236],
    material,
  );
  const movingJaw = box(
    layer,
    "fixture",
    [490, 48, 92],
    [0, -122, 236],
    material,
  );
  selectableObjects.push(base, fixedJaw, movingJaw);
}

function addStock(
  layer: Group,
  selectableObjects: Object3D[],
  material: MeshStandardMaterial,
): Mesh {
  const stock = box(
    layer,
    "stock",
    [360, 200, 88],
    [0, 0, 298],
    material,
  );
  stock.name = "education-stock";
  addStockOutline(stock);
  selectableObjects.push(stock);
  return stock;
}

function addToolAssembly(
  holderLayer: Group,
  cutterLayer: Group,
  selectableObjects: Object3D[],
  holderMaterial: MeshStandardMaterial,
  cutterMaterial: MeshStandardMaterial,
): void {
  const head = box(
    holderLayer,
    "holder",
    [270, 260, 220],
    [0, 75, 835],
    holderMaterial,
  );
  const spindle = cylinder(
    holderLayer,
    "holder",
    68,
    68,
    220,
    [0, 0, 670],
    holderMaterial,
  );
  const taper = cylinder(
    holderLayer,
    "holder",
    42,
    66,
    100,
    [0, 0, 510],
    holderMaterial,
  );
  const cutter = cylinder(
    cutterLayer,
    "cutter",
    10,
    10,
    120,
    [0, 0, 400],
    cutterMaterial,
  );
  selectableObjects.push(head, spindle, taper, cutter);
}

function addToolpath(layer: Group): Line {
  const pathPointsMm: readonly [number, number, number][] = [
    [-145, -70, 370],
    [-145, -70, 338],
    [145, -70, 338],
    [145, 0, 338],
    [-145, 0, 338],
    [-145, 70, 338],
    [145, 70, 338],
    [145, 70, 370],
  ];
  const points = pathPointsMm.map((point) => {
    const [x, y, z] = domainMmToScene(point);
    return new Vector3(x, y, z);
  });
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new LineBasicMaterial({
    color: TOOLPATH_COLOR,
    transparent: true,
    opacity: 0.9,
  });
  const line = new Line(geometry, material);
  line.name = "education-toolpath";
  tagObject(line, "toolpath", false);
  layer.add(line);
  return line;
}

function disposeObjectResources(root: Object3D): void {
  root.traverse((object) => {
    const objectWithResources = object as Object3D & {
      geometry?: BufferGeometry;
      material?: MeshStandardMaterial | LineBasicMaterial | Array<
        MeshStandardMaterial | LineBasicMaterial
      >;
    };
    objectWithResources.geometry?.dispose();

    if (Array.isArray(objectWithResources.material)) {
      objectWithResources.material.forEach((material) => material.dispose());
    } else {
      objectWithResources.material?.dispose();
    }
  });
}

export function createMachineScene(): MachineScene {
  const scene = new Scene();
  scene.background = new Color(DEFAULT_VIEWPORT_BACKGROUND);
  const contentRoot = new Group();
  contentRoot.name = "cnc-render-machine-scene";
  scene.add(contentRoot);

  const layerGroups = makeLayerGroups();
  for (const group of layerGroups.values()) {
    contentRoot.add(group);
  }

  const materials = {
    machine: new MeshStandardMaterial({
      color: MACHINE_COLOR,
      metalness: 0.12,
      roughness: 0.68,
    }),
    machineDark: new MeshStandardMaterial({
      color: MACHINE_DARK_COLOR,
      metalness: 0.24,
      roughness: 0.58,
    }),
    table: new MeshStandardMaterial({
      color: TABLE_COLOR,
      metalness: 0.36,
      roughness: 0.5,
    }),
    stock: new MeshStandardMaterial({
      color: SCENE_PRESENTATION.stockSurface,
      metalness: 0.06,
      roughness: 0.7,
    }),
    fixture: new MeshStandardMaterial({
      color: FIXTURE_COLOR,
      metalness: 0.32,
      roughness: 0.48,
    }),
    holder: new MeshStandardMaterial({
      color: HOLDER_COLOR,
      metalness: 0.52,
      roughness: 0.36,
    }),
    cutter: new MeshStandardMaterial({
      color: CUTTER_COLOR,
      metalness: 0.65,
      roughness: 0.3,
    }),
  };
  const selectableObjects: Object3D[] = [];

  addMachine(layerGroups.get("machine")!, selectableObjects, materials);
  const stockLayer = layerGroups.get("stock")!;
  const millingFixtureGroup = makePresentationGroup(
    layerGroups.get("fixture")!,
    "milling",
    "fixture",
    true,
  );
  const turningFixtureGroup = makePresentationGroup(
    layerGroups.get("fixture")!,
    "turning",
    "fixture",
    false,
  );
  const millingStockGroup = makePresentationGroup(
    stockLayer,
    "milling",
    "stock",
    true,
  );
  const turningStockGroup = makePresentationGroup(
    stockLayer,
    "turning",
    "stock",
    false,
  );
  const millingHolderGroup = makePresentationGroup(
    layerGroups.get("holder")!,
    "milling",
    "holder",
    true,
  );
  const turningHolderGroup = makePresentationGroup(
    layerGroups.get("holder")!,
    "turning",
    "holder",
    false,
  );
  const millingCutterGroup = makePresentationGroup(
    layerGroups.get("cutter")!,
    "milling",
    "cutter",
    true,
  );
  const turningCutterGroup = makePresentationGroup(
    layerGroups.get("cutter")!,
    "turning",
    "cutter",
    false,
  );
  const millingToolpathGroup = makePresentationGroup(
    layerGroups.get("toolpath")!,
    "milling",
    "toolpath",
    true,
  );
  const turningToolpathGroup = makePresentationGroup(
    layerGroups.get("toolpath")!,
    "turning",
    "toolpath",
    false,
  );

  addFixture(millingFixtureGroup, selectableObjects, materials.fixture);
  addTurningFixture(turningFixtureGroup, selectableObjects, materials.fixture);
  const educationStock = addStock(
    millingStockGroup,
    selectableObjects,
    materials.stock,
  );
  let partialStockSurface: PartialStockSurface | null = null;
  let rotationalStockSurface: PartialRotationalStockSurface | null = null;
  addToolAssembly(
    millingHolderGroup,
    millingCutterGroup,
    selectableObjects,
    materials.holder,
    materials.cutter,
  );
  addTurningToolAssembly(
    turningHolderGroup,
    turningCutterGroup,
    selectableObjects,
    materials.holder,
    materials.cutter,
  );
  const millingToolpath = addToolpath(millingToolpathGroup);
  addTurningToolpath(turningToolpathGroup);

  const floor = new Mesh(
    new PlaneGeometry(2_100, 1_650),
    new MeshStandardMaterial({
      color: 0xdfe5eb,
      metalness: 0,
      roughness: 1,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3;
  floor.receiveShadow = true;
  tagObject(floor, "machine", false);
  layerGroups.get("machine")!.add(floor);

  const grid = new GridHelper(2_000, 20, 0xaab4bf, 0xcbd2da);
  grid.position.y = 0;
  tagObject(grid, "machine", false);
  layerGroups.get("machine")!.add(grid);

  const ambient = new AmbientLight(0xffffff, 1.65);
  const keyLight = new DirectionalLight(0xffffff, 2.9);
  keyLight.position.set(-850, 1_500, 700);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1_024, 1_024);
  keyLight.shadow.camera.near = 10;
  keyLight.shadow.camera.far = 4_000;
  const fillLight = new DirectionalLight(0xdce8f4, 1.25);
  fillLight.position.set(900, 800, -650);
  scene.add(ambient, keyLight, fillLight);

  const selectionMaterial = new LineBasicMaterial({
    color: SELECTION_COLOR,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const selectionGeometry = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  const selectionBox = new LineSegments(selectionGeometry, selectionMaterial);
  selectionBox.name = "semantic-selection-outline";
  selectionBox.visible = false;
  selectionBox.renderOrder = 20;
  scene.add(selectionBox);

  const collisionMarker = new Mesh(
    new SphereGeometry(12, 16, 12),
    new MeshStandardMaterial({
      color: COLLISION_MARKER_COLOR,
      metalness: 0,
      roughness: 0.55,
    }),
  );
  collisionMarker.name = "collision-location-marker";
  collisionMarker.visible = false;
  collisionMarker.renderOrder = 24;
  tagObject(collisionMarker, "fixture", false);
  scene.add(collisionMarker);

  let presentationMode: MachinePresentationMode = "milling";
  const presentationGroups = {
    milling: [
      millingFixtureGroup,
      millingStockGroup,
      millingHolderGroup,
      millingCutterGroup,
      millingToolpathGroup,
    ],
    turning: [
      turningFixtureGroup,
      turningStockGroup,
      turningHolderGroup,
      turningCutterGroup,
      turningToolpathGroup,
    ],
  } as const;
  const applyPresentationMode = (mode: MachinePresentationMode): void => {
    presentationMode = mode;
    for (const candidate of ["milling", "turning"] as const) {
      for (const group of presentationGroups[candidate]) {
        group.visible = candidate === mode;
      }
    }
    selectionBox.visible = false;
  };
  applyPresentationMode("milling");

  const fitBounds = new Box3().setFromObject(contentRoot);

  return {
    scene,
    contentRoot,
    layerGroups,
    selectableObjects,
    fitBounds,
    get presentationMode() {
      return presentationMode;
    },
    select(object) {
      if (!object) {
        selectionBox.visible = false;
        return null;
      }

      const bounds = new Box3().setFromObject(object);
      if (bounds.isEmpty()) {
        selectionBox.visible = false;
        return null;
      }

      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      selectionBox.position.copy(center);
      selectionBox.scale.set(size.x + 10, size.y + 10, size.z + 10);
      selectionBox.visible = true;
      const layerId = object.userData.sceneLayerId;
      return typeof layerId === "string" ? (layerId as SceneLayerId) : null;
    },
    setPresentationMode(mode) {
      applyPresentationMode(mode);
    },
    setMillingToolpath(pointsMm) {
      if (
        pointsMm.length < 2 ||
        pointsMm.some((point) => point.some((value) => !Number.isFinite(value)))
      ) {
        throw new RangeError(
          "Milling toolpath requires at least two finite millimetre points.",
        );
      }
      const points = pointsMm.map((point) => {
        const [x, y, z] = domainMmToScene(point);
        return new Vector3(x, y, z);
      });
      const previousGeometry = millingToolpath.geometry;
      millingToolpath.geometry = new BufferGeometry().setFromPoints(points);
      previousGeometry.dispose();
    },
    configureStockSurface(descriptor) {
      applyPresentationMode("milling");
      if (partialStockSurface) {
        partialStockSurface.mesh.visible = false;
        stockLayer.remove(partialStockSurface.mesh);
        partialStockSurface.dispose();
      }
      if (rotationalStockSurface) {
        stockLayer.remove(rotationalStockSurface.mesh);
        rotationalStockSurface.dispose();
        rotationalStockSurface = null;
      }
      educationStock.visible = false;
      partialStockSurface = new PartialStockSurface(
        descriptor,
        materials.stock,
      );
      tagObject(partialStockSurface.mesh, "stock", true);
      stockLayer.add(partialStockSurface.mesh);
      selectableObjects.push(partialStockSurface.mesh);
      return partialStockSurface.getDiagnostics();
    },
    applyStockSurfacePatches(patches) {
      if (!partialStockSurface) {
        throw new Error(
          "Configure the Stock surface before applying partial patches.",
        );
      }
      return partialStockSurface.applyPatches(patches);
    },
    configureRotationalStockSurface(descriptor) {
      applyPresentationMode("turning");
      if (partialStockSurface) {
        stockLayer.remove(partialStockSurface.mesh);
        partialStockSurface.dispose();
        partialStockSurface = null;
      }
      if (rotationalStockSurface) {
        stockLayer.remove(rotationalStockSurface.mesh);
        rotationalStockSurface.dispose();
      }
      educationStock.visible = false;
      rotationalStockSurface = new PartialRotationalStockSurface(
        descriptor,
        materials.stock,
      );
      tagObject(rotationalStockSurface.mesh, "stock", true);
      stockLayer.add(rotationalStockSurface.mesh);
      selectableObjects.push(rotationalStockSurface.mesh);
      return rotationalStockSurface.getDiagnostics();
    },
    applyRotationalStockSurfacePatches(patches) {
      if (!rotationalStockSurface) {
        throw new Error(
          "Configure the rotational Stock surface before applying profile patches.",
        );
      }
      return rotationalStockSurface.applyPatches(patches);
    },
    getRotationalStockSurfaceDiagnostics() {
      return rotationalStockSurface?.getDiagnostics() ?? null;
    },
    getStockSurfaceDiagnostics() {
      return partialStockSurface?.getDiagnostics() ?? null;
    },
    finishStockSurfaceUpload() {
      if (stockLayer.visible && partialStockSurface?.mesh.visible) {
        partialStockSurface.finishUpload();
      }
      if (stockLayer.visible && rotationalStockSurface?.mesh.visible) {
        rotationalStockSurface.finishUpload();
      }
    },
    setToolPositionMm(positionMm) {
      if (presentationMode === "turning") {
        const turningPositionMm: readonly [number, number, number] = [
          positionMm[0] / 2,
          positionMm[1],
          positionMm[2],
        ];
        positionFromDomain(layerGroups.get("holder")!, turningPositionMm);
        positionFromDomain(layerGroups.get("cutter")!, turningPositionMm);
        return;
      }
      const millingTranslationMm: readonly [number, number, number] = [
        positionMm[0],
        positionMm[1],
        positionMm[2] - MILLING_TOOL_TIP_HOME_MM,
      ];
      positionFromDomain(layerGroups.get("holder")!, millingTranslationMm);
      positionFromDomain(layerGroups.get("cutter")!, millingTranslationMm);
    },
    setCollisionMarker(positionMm) {
      if (positionMm === null) {
        collisionMarker.visible = false;
        return;
      }
      positionFromDomain(collisionMarker, positionMm);
      collisionMarker.visible = true;
    },
    dispose() {
      disposeObjectResources(scene);
      scene.clear();
    },
  };
}
