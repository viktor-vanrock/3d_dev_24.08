import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type { BedSize, Placement, PlacementStatus } from "./bedlayout.ts";

/*
  Полноэкранная рабочая сцена слайсера (MF-1094).

  В отличие от первого прототипа она не выдаёт footprint-box за деталь: конкретный artifact
  code-first проекта грузится напрямую из pinned release, обычная модель — из preview_url.
  Заглушка остаётся только на время загрузки/при ошибке и визуально отличается от геометрии.

  Supports здесь — честный ПРЕДВАРИТЕЛЬНЫЙ просмотр опорных зон по footprint. Финальные
  toolpaths/поддержки обязан вернуть Orca worker; UI прямо называет этот слой
  «предварительным» и не использует его как доказательство печатаемости.
*/

const MM_TO_SCENE = 0.01;
const COLOR_MODEL = 0xd9ded9;
const COLOR_SELECTED = 0xffbb45;
const COLOR_INVALID = 0xff6b65;
const COLOR_PLACEHOLDER = 0x7fd9d0;

function toScene(mm: number): number {
  return mm * MM_TO_SCENE;
}

export interface PlateAssetSource {
  modelId: string;
  url: string;
  format: "stl" | "gltf";
  dimensionsMm?: { width: number; depth: number; height: number } | null;
}

export interface PlateSceneCallbacks {
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, xMm: number, yMm: number) => void;
  onMoveEnd?: () => void;
  onAssetMeasured?: (modelId: string, size: { width: number; depth: number; height: number }) => void;
  onAssetState?: (modelId: string, state: "loading" | "ready" | "failed") => void;
}

export interface PlateSceneHandle {
  resize: () => void;
  dispose: () => void;
  resetView: () => void;
  setView: (view: "perspective" | "top" | "front") => void;
  setBed: (bed: BedSize) => void;
  setSupportsVisible: (visible: boolean) => void;
  syncAssets: (sources: PlateAssetSource[]) => void;
  syncPlacements: (placements: Placement[], statuses: Map<string, PlacementStatus>, selectedId: string | null) => void;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
}

function cloneRenderable(root: THREE.Group): THREE.Group {
  const clone = root.clone(true);
  clone.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => material.clone());
    else if (mesh.material) mesh.material = mesh.material.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return clone;
}

function tintRenderable(root: THREE.Object3D, color: number): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.color) standard.color.setHex(color);
      standard.roughness = 0.56;
      standard.metalness = 0.04;
    }
  });
}

export function createPlateScene(
  canvas: HTMLCanvasElement,
  initialBed: BedSize,
  callbacks: PlateSceneCallbacks = {},
): PlateSceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 760 ? 1.4 : 1.85));
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xdde5dc, 0.055);
  const camera = new THREE.PerspectiveCamera(34, (canvas.clientWidth || 1) / (canvas.clientHeight || 1), 0.01, 100);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.72;

  scene.add(new THREE.HemisphereLight(0xf7fff8, 0x506055, 1.35));
  const key = new THREE.DirectionalLight(0xfff2d8, 3.2);
  key.position.set(-4, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 20;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8bffd8, 1.6);
  rim.position.set(4, 3, -4);
  scene.add(rim);

  let bed = initialBed;
  const bedGroup = new THREE.Group();
  scene.add(bedGroup);

  function buildBed(): void {
    for (const child of [...bedGroup.children]) {
      bedGroup.remove(child);
      disposeObject(child);
    }
    const width = toScene(bed.width);
    const depth = toScene(bed.depth);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(width, toScene(5), depth),
      new THREE.MeshPhysicalMaterial({
        color: 0x313934,
        roughness: 0.48,
        metalness: 0.3,
        clearcoat: 0.2,
        clearcoatRoughness: 0.62,
      }),
    );
    plate.position.y = -toScene(2.5);
    plate.receiveShadow = true;
    bedGroup.add(plate);

    const grid = new THREE.GridHelper(Math.max(width, depth), Math.max(10, Math.round(Math.max(bed.width, bed.depth) / 20)), 0x9bb1a3, 0x59675f);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.44;
    grid.position.y = toScene(0.25);
    bedGroup.add(grid);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, toScene(5.2), depth)),
      new THREE.LineBasicMaterial({ color: 0x9bd6b7, transparent: true, opacity: 0.75 }),
    );
    edge.position.y = -toScene(2.5);
    bedGroup.add(edge);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(width, depth) * 1.25, 72),
      new THREE.ShadowMaterial({ color: 0x26322c, opacity: 0.22 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -toScene(8);
    floor.receiveShadow = true;
    bedGroup.add(floor);
  }
  buildBed();

  let theta = -0.62;
  let phi = 0.88;
  let radius = Math.max(toScene(bed.width), toScene(bed.depth)) * 1.18 + 1.1;
  let targetTheta = theta;
  let targetPhi = phi;
  let targetRadius = radius;

  function updateCamera(): void {
    const sinPhi = Math.sin(phi);
    camera.position.set(radius * sinPhi * Math.sin(theta), radius * Math.cos(phi), radius * sinPhi * Math.cos(theta));
    camera.lookAt(0, toScene(12), 0);
  }
  updateCamera();

  const prototypes = new Map<string, THREE.Group>();
  const sourceKeys = new Map<string, string>();
  const loading = new Set<string>();
  const instances = new Map<string, THREE.Group>();
  const supports = new Map<string, THREE.Group>();
  let lastPlacements: Placement[] = [];
  let lastStatuses = new Map<string, PlacementStatus>();
  let lastSelectedId: string | null = null;
  let supportsVisible = true;

  function placeholderFor(placement: Placement): THREE.Group {
    const root = new THREE.Group();
    const width = Math.max(toScene(placement.footprint.width), 0.18);
    const depth = Math.max(toScene(placement.footprint.depth), 0.18);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, toScene(8), depth),
      new THREE.MeshStandardMaterial({
        color: COLOR_PLACEHOLDER,
        transparent: true,
        opacity: 0.58,
        roughness: 0.64,
      }),
    );
    mesh.position.y = toScene(4);
    root.add(mesh);
    return root;
  }

  function makeSupports(placement: Placement): THREE.Group {
    const root = new THREE.Group();
    root.name = "preliminary-supports";
    const material = new THREE.MeshStandardMaterial({
      color: 0x56dfaf,
      transparent: true,
      opacity: 0.38,
      roughness: 0.74,
      metalness: 0.03,
    });
    const positions: Array<[number, number]> = [
      [-0.26, -0.18],
      [0.22, -0.1],
      [-0.08, 0.23],
    ];
    const height = toScene(8);
    const radiusMm = Math.max(1.6, Math.min(3.2, Math.min(placement.footprint.width, placement.footprint.depth) * 0.08));
    for (const [xFactor, zFactor] of positions) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(toScene(radiusMm), toScene(radiusMm * 1.45), height, 8), material.clone());
      pillar.position.set(toScene(placement.footprint.width * xFactor), height / 2, toScene(placement.footprint.depth * zFactor));
      root.add(pillar);
    }
    root.visible = supportsVisible;
    return root;
  }

  function materialColor(status: PlacementStatus | undefined, selected: boolean): number {
    if (status && (status.collides || status.outOfBounds)) return COLOR_INVALID;
    if (selected) return COLOR_SELECTED;
    return COLOR_MODEL;
  }

  function rebuildInstances(): void {
    const seen = new Set<string>();
    for (const placement of lastPlacements) {
      seen.add(placement.id);
      let root = instances.get(placement.id);
      const hasPrototype = prototypes.has(placement.modelId);
      const isPlaceholder = root?.userData.placeholder === true;
      if (!root || (hasPrototype && isPlaceholder)) {
        if (root) {
          scene.remove(root);
          disposeObject(root);
        }
        root = hasPrototype ? cloneRenderable(prototypes.get(placement.modelId)!) : placeholderFor(placement);
        root.userData.placementId = placement.id;
        root.userData.placeholder = !hasPrototype;
        root.traverse((object) => {
          object.userData.placementId = placement.id;
        });
        scene.add(root);
        instances.set(placement.id, root);
      }
      root.position.set(toScene(placement.x), 0, toScene(placement.y));
      root.rotation.y = -(placement.rotationDeg * Math.PI) / 180;
      tintRenderable(root, materialColor(lastStatuses.get(placement.id), placement.id === lastSelectedId));

      let support = supports.get(placement.id);
      if (!support) {
        support = makeSupports(placement);
        support.userData.placementId = placement.id;
        scene.add(support);
        supports.set(placement.id, support);
      }
      support.position.copy(root.position);
      support.rotation.y = root.rotation.y;
      support.visible = supportsVisible;
    }
    for (const [id, root] of [...instances]) {
      if (seen.has(id)) continue;
      scene.remove(root);
      disposeObject(root);
      instances.delete(id);
    }
    for (const [id, root] of [...supports]) {
      if (seen.has(id)) continue;
      scene.remove(root);
      disposeObject(root);
      supports.delete(id);
    }
  }

  function prepareLoadedRoot(raw: THREE.Group, source: PlateAssetSource): { root: THREE.Group; sizeMm: { width: number; depth: number; height: number } } {
    const wrapper = new THREE.Group();
    wrapper.add(raw);
    if (source.format === "stl") raw.rotation.x = -Math.PI / 2;
    raw.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(wrapper);
    let size = box.getSize(new THREE.Vector3());
    const requested = source.dimensionsMm;
    if (source.format === "gltf" && requested && size.x > 0 && size.y > 0 && size.z > 0) {
      const scale = Math.min(
        requested.width / size.x,
        requested.height / size.y,
        requested.depth / size.z,
      );
      raw.scale.multiplyScalar(scale);
      raw.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(wrapper);
      size = box.getSize(new THREE.Vector3());
    }
    if (!Number.isFinite(size.x + size.y + size.z) || Math.max(size.x, size.y, size.z) <= 0) {
      throw new Error("plate asset has invalid bounds");
    }
    const center = box.getCenter(new THREE.Vector3());
    raw.position.x -= center.x;
    raw.position.z -= center.z;
    raw.position.y -= box.min.y;
    wrapper.scale.setScalar(MM_TO_SCENE);
    tintRenderable(wrapper, COLOR_MODEL);
    return {
      root: wrapper,
      sizeMm: { width: size.x, depth: size.z, height: size.y },
    };
  }

  function loadAsset(source: PlateAssetSource): void {
    const sourceKey = `${source.format}:${source.url}`;
    if (sourceKeys.get(source.modelId) === sourceKey || loading.has(source.modelId)) return;
    sourceKeys.set(source.modelId, sourceKey);
    loading.add(source.modelId);
    callbacks.onAssetState?.(source.modelId, "loading");

    const success = (raw: THREE.Group) => {
      if (!loading.has(source.modelId)) {
        disposeObject(raw);
        return;
      }
      try {
        const prepared = prepareLoadedRoot(raw, source);
        const previous = prototypes.get(source.modelId);
        if (previous) disposeObject(previous);
        prototypes.set(source.modelId, prepared.root);
        callbacks.onAssetMeasured?.(source.modelId, prepared.sizeMm);
        callbacks.onAssetState?.(source.modelId, "ready");
        rebuildInstances();
      } catch {
        disposeObject(raw);
        callbacks.onAssetState?.(source.modelId, "failed");
      } finally {
        loading.delete(source.modelId);
      }
    };
    const failure = () => {
      loading.delete(source.modelId);
      callbacks.onAssetState?.(source.modelId, "failed");
    };

    if (source.format === "stl") {
      new STLLoader().load(
        source.url,
        (geometry) => {
          geometry.computeVertexNormals();
          const raw = new THREE.Group();
          raw.add(new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: COLOR_MODEL, roughness: 0.56, flatShading: true }),
          ));
          success(raw);
        },
        undefined,
        failure,
      );
      return;
    }
    new GLTFLoader().load(source.url, (gltf) => success(gltf.scene), undefined, failure);
  }

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let draggingId: string | null = null;
  let orbiting = false;
  let lastX = 0;
  let lastY = 0;

  function ndcFromEvent(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function placementIdFor(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (typeof current.userData.placementId === "string") return current.userData.placementId;
      current = current.parent;
    }
    return null;
  }

  function groundPoint(event: PointerEvent): { xMm: number; yMm: number } | null {
    ndcFromEvent(event);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
    return { xMm: hit.x / MM_TO_SCENE, yMm: hit.z / MM_TO_SCENE };
  }

  function onPointerDown(event: PointerEvent): void {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture может быть недоступен в синтетическом/старом браузере.
    }
    ndcFromEvent(event);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects([...instances.values()], true)[0];
    const placementId = hit ? placementIdFor(hit.object) : null;
    if (placementId) {
      draggingId = placementId;
      callbacks.onSelect?.(placementId);
      return;
    }
    orbiting = true;
    lastX = event.clientX;
    lastY = event.clientY;
    callbacks.onSelect?.(null);
  }

  function onPointerMove(event: PointerEvent): void {
    if (draggingId) {
      const point = groundPoint(event);
      if (point) callbacks.onMove?.(draggingId, point.xMm, point.yMm);
      return;
    }
    if (!orbiting) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    targetTheta -= dx * 0.007;
    targetPhi = THREE.MathUtils.clamp(targetPhi - dy * 0.007, 0.18, Math.PI - 0.32);
  }

  function onPointerUp(event: PointerEvent): void {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // см. onPointerDown
    }
    if (draggingId) callbacks.onMoveEnd?.();
    draggingId = null;
    orbiting = false;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const min = Math.max(toScene(bed.width), toScene(bed.depth)) * 0.48;
    const max = Math.max(toScene(bed.width), toScene(bed.depth)) * 3.2;
    targetRadius = THREE.MathUtils.clamp(targetRadius + event.deltaY * 0.0017 * targetRadius, min, max);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  let raf = 0;
  let disposed = false;
  function frame(): void {
    if (disposed) return;
    theta += (targetTheta - theta) * 0.12;
    phi += (targetPhi - phi) * 0.12;
    radius += (targetRadius - radius) * 0.1;
    updateCamera();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  frame();

  function setView(view: "perspective" | "top" | "front"): void {
    if (view === "top") {
      targetTheta = 0;
      targetPhi = 0.02;
    } else if (view === "front") {
      targetTheta = 0;
      targetPhi = Math.PI / 2;
    } else {
      targetTheta = -0.62;
      targetPhi = 0.88;
    }
  }

  return {
    resize() {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    resetView() {
      setView("perspective");
      targetRadius = Math.max(toScene(bed.width), toScene(bed.depth)) * 1.18 + 1.1;
    },
    setView,
    setBed(next: BedSize) {
      bed = next;
      buildBed();
      targetRadius = Math.max(toScene(bed.width), toScene(bed.depth)) * 1.18 + 1.1;
    },
    setSupportsVisible(visible: boolean) {
      supportsVisible = visible;
      for (const support of supports.values()) support.visible = visible;
    },
    syncAssets(sources: PlateAssetSource[]) {
      for (const source of sources) loadAsset(source);
    },
    syncPlacements(placements: Placement[], statuses: Map<string, PlacementStatus>, selectedId: string | null) {
      lastPlacements = placements;
      lastStatuses = statuses;
      lastSelectedId = selectedId;
      rebuildInstances();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      for (const root of instances.values()) disposeObject(root);
      for (const root of supports.values()) disposeObject(root);
      for (const root of prototypes.values()) disposeObject(root);
      instances.clear();
      supports.clear();
      prototypes.clear();
      for (const child of [...bedGroup.children]) disposeObject(child);
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
