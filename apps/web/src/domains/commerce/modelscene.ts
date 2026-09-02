import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { prefersReducedMotionNow } from "@platform/theme";

/*
  3D-вьюер модели (MF-463, docs/design/marketplace.full.md §12): та же ручная
  drag-орбита, что и в mascot3d.ts (без OrbitControls), + wheel/pinch-зум +
  сброс-тween. Загружает GLB по preview_url (GLTFLoader, превью-пайплайн —
  отдельная Python-задача параллельной стадии).

  `format="stl"` (GAP-STL, docs/design/generation.md §6.1): ветка генерации `openscad`
  отдаёт STL-артефакт напрямую (apps/giga/src/giga/branches/openscad.py), без отдельного
  GLB-превью — читаем геометрию STLLoader'ом и заворачиваем в Mesh с матовым материалом
  (albedo ~rgb(200,200,200), docs/design/model-preview.md «Матовый нейтральный материал»),
  дальше та же орбита/fit, что у GLTF-группы.
*/

const DEFAULT_THETA = -0.5;
const DEFAULT_PHI = 1.15;
const MIN_PHI = 0.35;
const MAX_PHI = Math.PI - 0.35;
const MIN_RADIUS_SCALE = 0.55;
const MAX_RADIUS_SCALE = 2.8;
const IDLE_SPIN_SPEED = 0.12;

// Мобильный профиль (MF-433): стартуем с более скромным DPR-потолком, чем десктоп — телефон
// класса 2 ГБ VRAM платит за каждый закрашенный пиксель дороже, а орбитальный просмотр не
// требует ретина-чёткости. Дальше — самодельный аналог drei `<PerformanceMonitor/>` (в проекте
// нет react-three-fiber, сцена — ручной three.js, см. шапку файла): считаем среднее время кадра
// скользящим окном и, если оно устойчиво хуже ~33fps, ступенчато понижаем DPR вплоть до пола —
// не даём кадру рухнуть в свап/троттлинг на слабом GPU вместо плавной деградации чёткости.
const MOBILE_INITIAL_DPR_CAP = 1.5;
const DESKTOP_INITIAL_DPR_CAP = 2;
const MIN_ADAPTIVE_DPR = 0.75;
const ADAPTIVE_DPR_STEP = 0.8;
const PERF_SAMPLE_FRAMES = 45;
const PERF_LOW_FPS_FRAME_MS = 1000 / 33;
const MAX_DPR_DOWNGRADES = 3;
import { API_URL } from "@shared/api";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shouldSendModelCredentials(url: string, webOrigin: string, apiUrl = API_URL): boolean {
  try {
    const targetOrigin = new URL(url, webOrigin).origin;
    const apiOrigin = apiUrl ? new URL(apiUrl, webOrigin).origin : webOrigin;
    return targetOrigin === webOrigin || targetOrigin === apiOrigin;
  } catch {
    return false;
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const m = material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.normalMap?.dispose();
      m.roughnessMap?.dispose();
      m.metalnessMap?.dispose();
      material.dispose();
    }
  });
}

// Некоторые экспортёры нейросеточных мешей (включая текущий TRELLIS→trimesh)
// выпускают валидный GLB с POSITION/UV, но без NORMAL. MeshStandardMaterial такой
// файл парсит без ошибки, однако результат может оказаться полностью тёмным либо
// исчезнуть из-за одностороннего материала. Нормализуем только недостающие данные,
// не перетирая авторские нормали обычных каталоговых GLB.
export function prepareLoadedModel(root: THREE.Object3D): number {
  let triangleCount = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position || position.count < 3) return;
    for (let index = 0; index < position.array.length; index += 1) {
      if (!Number.isFinite(position.array[index])) {
        throw new Error("modelscene: non-finite vertex position");
      }
    }

    const repairedNormals = !geometry.getAttribute("normal");
    if (repairedNormals) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.frustumCulled = false;

    if (repairedNormals) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      }
    }

    triangleCount += Math.floor(
      (geometry.index?.count ?? position.count) / 3,
    );
  });
  if (triangleCount === 0) throw new Error("modelscene: no renderable triangles");
  root.updateMatrixWorld(true);
  return triangleCount;
}

export interface ModelSceneHandle {
  reset: () => void;
  resize: () => void;
  dispose: () => void;
}

export function createModelScene(
  canvas: HTMLCanvasElement,
  url: string,
  callbacks: { onLoaded?: () => void; onError?: () => void } = {},
  format: "gltf" | "stl" | "obj" = "gltf",
  mobileProfile = false,
): ModelSceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const initialDprCap = mobileProfile ? MOBILE_INITIAL_DPR_CAP : DESKTOP_INITIAL_DPR_CAP;
  let currentDpr = Math.min(window.devicePixelRatio, initialDprCap);
  renderer.setPixelRatio(currentDpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, (canvas.clientWidth || 1) / (canvas.clientHeight || 1), 0.01, 100);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;

  const key = new THREE.DirectionalLight("#fff2dd", 1.6);
  key.position.set(2.4, 3.6, 3);
  scene.add(key);
  scene.add(new THREE.AmbientLight("#ffffff", 0.45));

  let defaultRadius = 3.2;
  let theta = DEFAULT_THETA;
  let phi = DEFAULT_PHI;
  let radius = defaultRadius;
  let targetTheta = theta;
  let targetPhi = phi;
  let targetRadius = radius;

  function updateCamera() {
    const sinPhi = Math.sin(phi);
    camera.position.set(radius * sinPhi * Math.sin(theta), radius * Math.cos(phi), radius * sinPhi * Math.cos(theta));
    camera.lookAt(0, 0, 0);
  }
  updateCamera();

  let group: THREE.Group | null = null;
  let disposed = false;
  let errorReported = false;

  function reportError(): void {
    if (disposed || errorReported) return;
    errorReported = true;
    callbacks.onError?.();
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    reportError();
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  // Битый/пустой меш (0 треугольников, NaN-координаты) не бросает исключение сам по себе —
  // Box3 на пустом объекте даёт Infinity/NaN-границы, и без явной проверки сцена тихо
  // отрендерит невидимую точку вместо честного "не удалось загрузить" (MF-847). Бросаем
  // здесь, чтобы вызывающий loader.load-колбэк ниже перевёл это в тот же onError-путь,
  // что сетевая/парсинг-ошибка.
  function fitAndAdd(root: THREE.Group): THREE.Group {
    prepareLoadedModel(root);
    const box = new THREE.Box3().setFromObject(root, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDim) || maxDim <= 0) throw new Error("modelscene: degenerate geometry bounds");

    // Центрируем в исходной системе координат, а масштаб применяем уже к внешнему pivot.
    // Если записать `root.position = -center`, а затем уменьшить только сам root, его position
    // не масштабируется собственным scale: STL с координатами далеко от нуля уезжает за камеру,
    // хотя loader и сообщает об успешной загрузке. Pivot сохраняет и GLTF-трансформы, и
    // гарантирует, что геометрический центр после нормализации останется в (0, 0, 0).
    root.position.sub(center);
    const fittedRoot = new THREE.Group();
    fittedRoot.add(root);
    fittedRoot.scale.setScalar(1.6 / maxDim);
    scene.add(fittedRoot);
    defaultRadius = 3.2;
    radius = targetRadius = defaultRadius;
    updateCamera();
    return fittedRoot;
  }

  // Фолбэк-рендер на неоткрываемый/битый файл (MF-847): и сетевая/парсинг-ошибка (loader
  // вызывает свой onError, три.js это делает сам для malformed ZIP/glTF), и исключение из
  // нашего собственного кода сборки сцены (fitAndAdd на вырожденной геометрии, см. выше) —
  // оба пути сводятся к одному callbacks.onError?.(), не давая необработанному throw
  // всплыть из loader.load колбэка и уронить страницу.
  function handleLoaded(build: () => void): void {
    if (disposed) return;
    try {
      build();
      callbacks.onLoaded?.();
    } catch {
      reportError();
    }
  }
  function handleLoadError(): void {
    reportError();
  }

  // API-прокси стриминга (MF-470) живёт на api.3mf.tech — другой origin, чем веб (3mf.tech).
  // GLTFLoader/FileLoader по умолчанию шлёт fetch с credentials: 'same-origin', сессионная
  // cookie не долетит без явного withCredentials — тогда стрим ответит 401 вместо GLB/STL.
  // Но внешний open-source asset (GitHub/jsDelivr) обязан грузиться БЕЗ credentials:
  // CORS `Access-Control-Allow-Origin: *` несовместим с credentialed-request. Различаем
  // origin портала/API и сторонний CDN, а не включаем cookie глобально для любого URL.
  const withCredentials = shouldSendModelCredentials(url, window.location.origin);

  if (format === "stl") {
    const loader = new STLLoader();
    loader.setWithCredentials(withCredentials);
    loader.load(
      url,
      (geometry) =>
        handleLoaded(() => {
          // Флэт-шейдинг — STL печатной детали читается гранями, не сглаженной поверхностью.
          const material = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.55, metalness: 0.05, flatShading: true });
          const mesh = new THREE.Mesh(geometry, material);
          const loadedGroup = new THREE.Group();
          loadedGroup.add(mesh);
          group = fitAndAdd(loadedGroup);
        }),
      undefined,
      handleLoadError,
    );
  } else if (format === "obj") {
    const loader = new OBJLoader();
    loader.setWithCredentials(withCredentials);
    loader.load(
      url,
      (object) =>
        handleLoaded(() => {
          group = fitAndAdd(object);
        }),
      undefined,
      handleLoadError,
    );
  } else {
    const loader = new GLTFLoader();
    loader.setWithCredentials(withCredentials);
    loader.load(
      url,
      (gltf) =>
        handleLoaded(() => {
          group = fitAndAdd(gltf.scene);
        }),
      undefined,
      handleLoadError,
    );
  }

  let dragging = false;
  let hasDragged = false;
  let lastX = 0;
  let lastY = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartRadius = radius;

  const reduceMotion = prefersReducedMotionNow();

  function onPointerDown(event: PointerEvent) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // синтетическое событие/старый браузер — drag работает в границах канваса
    }
    if (pointers.size === 1) {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    } else if (pointers.size === 2) {
      dragging = false;
      const pts = [...pointers.values()];
      pinchStartDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      pinchStartRadius = targetRadius;
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (pinchStartDist > 0) {
        targetRadius = clamp(
          pinchStartRadius * (pinchStartDist / dist),
          defaultRadius * MIN_RADIUS_SCALE,
          defaultRadius * MAX_RADIUS_SCALE,
        );
      }
      return;
    }
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) hasDragged = true;
    targetTheta -= dx * 0.008;
    targetPhi = clamp(targetPhi - dy * 0.008, MIN_PHI, MAX_PHI);
  }

  function endPointer(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      dragging = false;
      return;
    }
    const remaining = [...pointers.values()][0]!;
    dragging = true;
    lastX = remaining.x;
    lastY = remaining.y;
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    targetRadius = clamp(
      targetRadius + event.deltaY * 0.0025 * defaultRadius,
      defaultRadius * MIN_RADIUS_SCALE,
      defaultRadius * MAX_RADIUS_SCALE,
    );
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  let raf = 0;
  const clock = new THREE.Clock();
  let perfSampleCount = 0;
  let perfSampleTotalMs = 0;
  let dprDowngrades = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!dragging && pointers.size === 0 && !hasDragged && !reduceMotion) {
      targetTheta += dt * IDLE_SPIN_SPEED;
    }
    theta += (targetTheta - theta) * 0.15;
    phi += (targetPhi - phi) * 0.15;
    radius += (targetRadius - radius) * 0.15;
    updateCamera();
    renderer.render(scene, camera);

    if (dprDowngrades < MAX_DPR_DOWNGRADES) {
      perfSampleTotalMs += dt * 1000;
      perfSampleCount += 1;
      if (perfSampleCount >= PERF_SAMPLE_FRAMES) {
        const avgFrameMs = perfSampleTotalMs / perfSampleCount;
        perfSampleCount = 0;
        perfSampleTotalMs = 0;
        if (avgFrameMs > PERF_LOW_FPS_FRAME_MS && currentDpr > MIN_ADAPTIVE_DPR) {
          currentDpr = Math.max(MIN_ADAPTIVE_DPR, currentDpr * ADAPTIVE_DPR_STEP);
          renderer.setPixelRatio(currentDpr);
          dprDowngrades += 1;
        }
      }
    }

    raf = requestAnimationFrame(frame);
  }
  frame();

  return {
    reset() {
      hasDragged = false;
      targetTheta = DEFAULT_THETA;
      targetPhi = DEFAULT_PHI;
      targetRadius = defaultRadius;
    },
    resize() {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
      canvas.removeEventListener("wheel", onWheel);
      if (group) disposeObject(group);
      renderer.dispose();
    },
  };
}
