import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { PLASTICS, saveSnapshots, type AvatarConfig, type AvatarFacing, type AvatarSnapshots } from "./avatar.tsx";
import { HEADER_MASCOT_REST_POINTER, headerMascotRotationForPointer } from "./headermascotpose.ts";
// shared→platform: mascot3d.ts (shared/avatar) зовёт prefersReducedMotionNow. Развязка
// (опустить в shared как параметр, либо принять анимационный флаг снаружи) ОТЛОЖЕНА —
// см. MIGRATION.md, тот же прецедент, что vote.tsx (микроэтап 7.6). До неё — явное легатное исключение.
// eslint-disable-next-line boundaries/element-types -- отложенное shared→platform ребро, см. выше
import { prefersReducedMotionNow } from "@platform/theme";

/*
  3D-маскот (MF-446 v5): простой округлый силуэт между Reddit Snoo и Among Us.
  Ноги убраны по решению оператора 2026-07-19: персонаж — цельный мягкий «боб»
  с настраиваемым туловищем и парящими руками. Детали остаются крупными,
  архетипичными и читаются в портрете 36px.

  Рендер-качество: RoomEnvironment (PMREM) для бликов пластика, мягкие тени
  (PCFSoft) на невидимом «полу» (ShadowMaterial), ACES-тонмаппинг.
  Текстуры: слои печати (bump-полосы) · глянец · матовый · шершавый (шум) ·
  мрамор · карбон. Поверх зафиксированного тела навешиваются наряды/шапки/
  предметы — их набор растёт, не трогая форму.

  Живая сцена только в редакторе; капсула/меню — PNG-снапшоты.
*/

function plasticHex(config: AvatarConfig): string {
  return PLASTICS.find((p) => p.id === config.color)?.hex ?? "#34d399";
}

// --- процедурные текстуры пластика ---
function stripeBump(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 64, 512);
  ctx.fillStyle = "#9c9c9c";
  for (let y = 0; y < 512; y += 7) ctx.fillRect(0, y, 64, 2.6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 2);
  return texture;
}

function noiseBump(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(128, 128);
  let seed = 42;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = 108 + (seed % 60);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function carbonBump(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#a0a0a0";
  ctx.lineWidth = 5;
  for (let i = -128; i < 256; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i + 128, 0); ctx.lineTo(i, 128); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function marbleMap(base: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    let x = (i * 47) % 256, y = 0;
    ctx.moveTo(x, y);
    while (y < 256) {
      x += ((i * 31 + y * 13) % 41) - 20;
      y += 18 + ((i * 17 + y) % 13);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function plasticMaterial(config: AvatarConfig): THREE.MeshPhysicalMaterial {
  const color = plasticHex(config);
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.72,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.55,
  });
  switch (config.texture) {
    case "layers":
      material.bumpMap = stripeBump();
      material.bumpScale = 0.8;
      material.roughness = 0.5;
      break;
    case "gloss":
      material.roughness = 0.08;
      material.clearcoat = 1;
      material.clearcoatRoughness = 0.05;
      break;
    case "matte":
      material.roughness = 0.9;
      material.clearcoat = 0;
      break;
    case "rough":
      material.bumpMap = noiseBump();
      material.bumpScale = 0.6;
      material.roughness = 0.85;
      material.clearcoat = 0;
      break;
    case "carbon":
      material.bumpMap = carbonBump();
      material.bumpScale = 0.45;
      material.roughness = 0.55;
      material.color.multiplyScalar(0.85);
      break;
    case "marble":
      material.map = marbleMap(color);
      material.roughness = 0.25;
      material.clearcoat = 0.7;
      break;
  }
  return material;
}

const DARK = new THREE.MeshStandardMaterial({ color: "#141a17", roughness: 0.5 });
const STEEL = new THREE.MeshStandardMaterial({ color: "#c8ced0", roughness: 0.35, metalness: 0.8 });
const GOLD = new THREE.MeshStandardMaterial({ color: "#e8b54a", roughness: 0.3, metalness: 0.7 });
const WOOD = new THREE.MeshStandardMaterial({ color: "#9a7a52", roughness: 0.7 });
const CORAL = new THREE.MeshStandardMaterial({ color: "#e8836f", roughness: 0.4 });

// --- тело-«боб»: гладкий цельный профиль от основания торса до макушки.
// Ног и выемки нет: узнаваемость строится на мягком силуэте и крупных деталях.
const BEAN_PROFILE = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0.001, 0.3, 0),
    new THREE.Vector3(0.56, 0.31, 0),
    new THREE.Vector3(0.67, 0.55, 0),
    new THREE.Vector3(0.69, 0.95, 0),
    new THREE.Vector3(0.65, 1.4, 0),
    new THREE.Vector3(0.5, 1.76, 0),
    new THREE.Vector3(0.001, 1.95, 0),
  ],
  false,
  "catmullrom",
  0.5,
);

function beanGeometry(scale = 1, yFromAbs = 0, yToAbs = 2): THREE.LatheGeometry {
  const points = BEAN_PROFILE.getPoints(48)
    .filter((p) => p.y >= yFromAbs - 0.001 && p.y <= yToAbs + 0.001)
    .map((p) => new THREE.Vector2(p.x * scale, p.y));
  return new THREE.LatheGeometry(points, 64);
}

// радиус боба на высоте y (для посадки лица/шапок на поверхность)
function beanRadiusAt(y: number): number {
  const points = BEAN_PROFILE.getPoints(96);
  let best = points[0]!;
  for (const p of points) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
  return best.x;
}

// позы: парящие руки-ШАРИКИ (только позиция — шарику не нужен наклон) + наклон корпуса
interface Pose {
  bodyTilt: number;
  armL: { x: number; y: number; z: number };
  armR: { x: number; y: number; z: number };
}

const POSES_3D: Record<string, Pose> = {
  stand: { bodyTilt: 0, armL: { x: -0.82, y: 0.8, z: 0.05 }, armR: { x: 0.82, y: 0.8, z: 0.05 } },
  wave: { bodyTilt: -0.05, armL: { x: -0.82, y: 0.8, z: 0.05 }, armR: { x: 0.95, y: 1.65, z: 0.15 } },
  cheer: { bodyTilt: 0, armL: { x: -0.88, y: 1.6, z: 0.1 }, armR: { x: 0.88, y: 1.6, z: 0.1 } },
  think: { bodyTilt: 0.06, armL: { x: -0.82, y: 0.75, z: 0.05 }, armR: { x: 0.5, y: 1.2, z: 0.62 } },
  present: { bodyTilt: -0.04, armL: { x: -0.9, y: 0.95, z: 0.15 }, armR: { x: 0.95, y: 1.05, z: 0.3 } },
  idea: { bodyTilt: 0.04, armL: { x: -0.72, y: 0.7, z: 0.12 }, armR: { x: 0.62, y: 1.52, z: 0.3 } },
};

export function buildMascot(config: AvatarConfig): THREE.Group {
  const group = new THREE.Group();
  const plastic = plasticMaterial(config);
  const pose = POSES_3D[config.pose] ?? POSES_3D.stand!;

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = group): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // корпус (наклоняемый узел: боб + лицо + шапка + наряд)
  const body = new THREE.Group();
  body.rotation.z = pose.bodyTilt;
  group.add(body);

  // --- БОБ (зафиксированная форма): корпус от основания торса до макушки ---
  add(beanGeometry(), plastic, 0, 0, 0, body);

  // Парящие руки: отдельный крупный слой, без тонких «приклеенных» суставов.
  for (const side of ["armL", "armR"] as const) {
    const p = pose[side];
    const sx = side === "armL" ? -1 : 1;
    if (config.arms === "robot") {
      const forearm = add(new THREE.CapsuleGeometry(0.12, 0.28, 8, 18), STEEL, p.x, p.y, p.z);
      forearm.rotation.z = sx * -0.3;
      add(new THREE.SphereGeometry(0.16, 24, 18), DARK, p.x + sx * 0.05, p.y + 0.2, p.z + 0.02);
    } else {
      const armMaterial =
        config.arms === "gloves"
          ? DARK
          : config.arms === "sleeves"
            ? new THREE.MeshStandardMaterial({ color: "#536b7b", roughness: 0.94 })
            : plastic;
      const arm = add(new THREE.SphereGeometry(config.arms === "gloves" ? 0.22 : 0.19, 28, 22), armMaterial, p.x, p.y, p.z);
      arm.scale.y = config.arms === "sleeves" ? 1.45 : 1.16;
    }
  }

  // --- лицо (на поверхности боба) ---
  const eyeY = 1.32;
  const eyeSpread = 0.29;
  const faceItem = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, extraZ = 0) => {
    const r = beanRadiusAt(y) + 0.01 + extraZ;
    const mesh = add(geometry, material, x, y, Math.sqrt(Math.max(r * r - x * x, 0.01)), body);
    mesh.castShadow = false; // лицо не отбрасывает тени на тело (полосы от глаз)
    return mesh;
  };

  if (config.eyes === "dots" || config.eyes === "wink") {
    faceItem(new THREE.SphereGeometry(0.1, 20, 16), DARK, -eyeSpread, eyeY).scale.z = 0.4;
    if (config.eyes === "dots") {
      faceItem(new THREE.SphereGeometry(0.1, 20, 16), DARK, eyeSpread, eyeY).scale.z = 0.4;
    } else {
      faceItem(new THREE.TorusGeometry(0.1, 0.026, 10, 20, Math.PI), DARK, eyeSpread, eyeY - 0.03);
    }
  }
  if (config.eyes === "happy") {
    for (const sx of [-eyeSpread, eyeSpread]) {
      faceItem(new THREE.TorusGeometry(0.1, 0.026, 10, 20, Math.PI), DARK, sx, eyeY - 0.03);
    }
  }
  if (config.eyes === "visor") {
    const visor = add(new THREE.SphereGeometry(0.52, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), DARK, 0, eyeY + 0.1, 0.22, body);
    visor.rotation.x = Math.PI / 2 - 0.25;
    visor.scale.set(1, 0.75, 0.9);
    visor.castShadow = false;
  }
  if (config.eyes === "sleepy") {
    for (const sx of [-eyeSpread, eyeSpread]) {
      const eye = faceItem(new THREE.TorusGeometry(0.1, 0.025, 10, 20, Math.PI), DARK, sx, eyeY + 0.02);
      eye.rotation.z = Math.PI;
    }
  }
  if (config.eyes === "stars") {
    for (const sx of [-eyeSpread, eyeSpread]) {
      const eye = faceItem(new THREE.OctahedronGeometry(0.115, 0), GOLD, sx, eyeY);
      eye.scale.set(1, 1.22, 0.35);
      eye.rotation.z = Math.PI / 4;
    }
  }
  // улыбка
  if (config.eyes !== "visor") {
    const smile = faceItem(new THREE.TorusGeometry(0.14, 0.028, 10, 22, Math.PI), DARK, 0, 1.05);
    smile.rotation.z = Math.PI;
  }

  // --- борода: отдельный крупный слой на нижней части лица ---
  if (config.beard === "stubble") {
    for (const [x, y] of [[-0.2, 1.02], [0, 0.98], [0.2, 1.02], [-0.1, 0.9], [0.1, 0.9]] as const) {
      const dot = faceItem(new THREE.SphereGeometry(0.025, 10, 8), DARK, x, y, 0.025);
      dot.scale.z = 0.35;
    }
  }
  if (config.beard === "moustache") {
    for (const sx of [-1, 1]) {
      const moustache = faceItem(new THREE.CapsuleGeometry(0.045, 0.18, 6, 12), DARK, sx * 0.105, 1.08, 0.035);
      moustache.rotation.z = sx * 0.92;
      moustache.scale.z = 0.45;
    }
  }
  if (config.beard === "full" || config.beard === "braid") {
    const beard = faceItem(new THREE.SphereGeometry(0.36, 28, 18), DARK, 0, 0.96, 0.035);
    beard.scale.set(1, 0.74, 0.3);
    if (config.beard === "braid") {
      const braid = faceItem(new THREE.CapsuleGeometry(0.075, 0.32, 8, 16), DARK, 0, 0.65, 0.02);
      braid.scale.z = 0.55;
      add(new THREE.SphereGeometry(0.095, 16, 12), GOLD, 0, 0.47, beanRadiusAt(0.47) + 0.03, body);
    }
  }

  // --- шапки (верхушка боба ~1.95) ---
  if (config.hat === "helmet") {
    const glass = new THREE.MeshPhysicalMaterial({
      color: "#bfe3ff", transparent: true, opacity: 0.16, roughness: 0.04, clearcoat: 1, side: THREE.DoubleSide,
    });
    const dome = add(new THREE.SphereGeometry(0.95, 40, 28), glass, 0, 1.45, 0, body);
    dome.castShadow = false;
  }
  if (config.hat === "cap") {
    const dome = add(new THREE.SphereGeometry(0.62, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), DARK, 0, 1.62, 0, body);
    dome.scale.set(1.12, 0.78, 1.12);
    const brim = add(new THREE.CylinderGeometry(0.52, 0.55, 0.06, 32, 1, false, -Math.PI / 2, Math.PI), DARK, 0, 1.66, 0.28, body);
    brim.rotation.x = -0.1;
    brim.scale.z = 1.25;
  }
  if (config.hat === "crown") {
    add(new THREE.CylinderGeometry(0.42, 0.48, 0.26, 32), GOLD, 0, 1.98, 0, body);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      add(new THREE.ConeGeometry(0.1, 0.26, 12), GOLD, Math.sin(angle) * 0.4, 2.2, Math.cos(angle) * 0.4, body);
    }
  }
  if (config.hat === "cat") {
    for (const sx of [-0.38, 0.38]) {
      const ear = add(new THREE.ConeGeometry(0.2, 0.42, 24), plastic, sx, 1.95, 0, body);
      ear.rotation.z = sx > 0 ? -0.35 : 0.35;
      const inner = add(new THREE.ConeGeometry(0.11, 0.24, 20), CORAL, sx * 1.02, 1.93, 0.06, body);
      inner.rotation.z = ear.rotation.z;
    }
  }
  if (config.hat === "fox") {
    const fox = new THREE.MeshStandardMaterial({ color: "#e88a45", roughness: 0.86 });
    for (const sx of [-0.4, 0.4]) {
      const ear = add(new THREE.ConeGeometry(0.22, 0.48, 24), fox, sx, 1.98, 0, body);
      ear.rotation.z = sx > 0 ? -0.3 : 0.3;
      const inner = add(new THREE.ConeGeometry(0.1, 0.25, 18), DARK, sx * 1.02, 1.98, 0.08, body);
      inner.rotation.z = ear.rotation.z;
    }
  }
  if (config.hat === "beanie") {
    const knit = new THREE.MeshStandardMaterial({ color: "#515dad", roughness: 0.96 });
    const cap = add(new THREE.SphereGeometry(0.62, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), knit, 0, 1.72, 0, body);
    cap.scale.set(1.1, 0.72, 1.1);
    add(new THREE.TorusGeometry(0.58, 0.09, 12, 32), knit, 0, 1.75, 0, body).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.13, 20, 14), knit, 0, 2.17, 0, body);
  }

  // --- наряды: «оболочка» нижней части боба (чуть шире тела) ---
  if (config.outfit === "sweater") {
    const knit = new THREE.MeshStandardMaterial({ color: "#4a5568", roughness: 0.95 });
    add(beanGeometry(1.07, 0.3, 0.98), knit, 0, -0.005, 0, body);
  }
  if (config.outfit === "overall") {
    const denim = new THREE.MeshStandardMaterial({ color: "#4a6f8a", roughness: 0.85 });
    add(beanGeometry(1.06, 0.3, 0.92), denim, 0, -0.005, 0, body);
    // нагрудник-кармашек спереди (плоский, слегка утоплен по кривизне тела)
    const pocket = add(new RoundedBoxGeometry(0.34, 0.22, 0.06, 3, 0.05), new THREE.MeshStandardMaterial({ color: "#3d5c72", roughness: 0.85 }), 0, 0.74, beanRadiusAt(0.74) - 0.01, body);
    pocket.rotation.x = 0.18;
    pocket.castShadow = false;
  }
  if (config.outfit === "apron") {
    const cloth = new THREE.MeshStandardMaterial({ color: "#b08050", roughness: 0.9 });
    add(beanGeometry(1.055, 0.3, 0.88), cloth, 0, -0.005, 0, body);
    const apronPocket = add(new RoundedBoxGeometry(0.32, 0.2, 0.06, 3, 0.05), new THREE.MeshStandardMaterial({ color: "#96693d", roughness: 0.9 }), 0, 0.48, beanRadiusAt(0.48) - 0.01, body);
    apronPocket.rotation.x = 0.15;
    apronPocket.castShadow = false;
  }
  if (config.outfit === "labcoat") {
    const coat = new THREE.MeshStandardMaterial({ color: "#eef4f3", roughness: 0.94 });
    add(beanGeometry(1.065, 0.3, 1.04), coat, 0, -0.005, 0, body);
    const seam = add(new RoundedBoxGeometry(0.055, 0.58, 0.035, 2, 0.02), STEEL, 0, 0.69, beanRadiusAt(0.69) + 0.005, body);
    seam.castShadow = false;
    for (const y of [0.55, 0.72, 0.89]) {
      const button = add(new THREE.SphereGeometry(0.026, 12, 8), DARK, 0.07, y, beanRadiusAt(y) + 0.035, body);
      button.castShadow = false;
    }
  }
  if (config.outfit === "techvest") {
    const vest = new THREE.MeshStandardMaterial({ color: "#263b37", roughness: 0.88 });
    add(beanGeometry(1.07, 0.3, 0.98), vest, 0, -0.005, 0, body);
    const panel = add(new RoundedBoxGeometry(0.4, 0.26, 0.055, 3, 0.05), new THREE.MeshStandardMaterial({ color: "#6beac7", roughness: 0.72 }), 0, 0.72, beanRadiusAt(0.72), body);
    panel.rotation.x = 0.16;
    panel.castShadow = false;
  }

  // --- за спиной ---
  if (config.back === "spool") {
    const spool = new THREE.Group();
    for (const sz of [-0.15, 0.15]) {
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 32), DARK);
      flange.rotation.x = Math.PI / 2;
      flange.position.z = sz;
      flange.castShadow = true;
      spool.add(flange);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.28, 32), plastic);
    core.rotation.x = Math.PI / 2;
    core.castShadow = true;
    spool.add(core);
    spool.position.set(0, 0.85, -0.78);
    body.add(spool);
  }
  if (config.back === "jetpack") {
    for (const sx of [-0.22, 0.22]) {
      add(new THREE.CapsuleGeometry(0.16, 0.44, 8, 20), STEEL, sx, 0.85, -0.72, body);
      add(new THREE.ConeGeometry(0.09, 0.2, 14), new THREE.MeshBasicMaterial({ color: "#f2a93b" }), sx, 0.5, -0.72, body).rotation.x = Math.PI;
    }
  }

  // --- в руке: предмет у ПРАВОЙ парящей руки, следует за позой ---
  const anchor = pose.armR;
  const toolAt = (tool: THREE.Group) => {
    tool.position.set(anchor.x + 0.14, anchor.y + 0.08, anchor.z + 0.2);
    tool.rotation.z = -0.3;
    tool.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    group.add(tool);
  };
  if (config.accessory === "spatula") {
    const tool = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 12), WOOD);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.02, 24), STEEL);
    blade.position.y = 0.3;
    blade.scale.z = 0.35;
    blade.rotation.x = Math.PI / 2;
    tool.add(handle, blade);
    toolAt(tool);
  }
  if (config.accessory === "wrench") {
    const tool = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.38, 6, 12), STEEL);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.045, 10, 20, Math.PI * 1.5), STEEL);
    ring.position.y = 0.28;
    ring.rotation.z = Math.PI * 0.75;
    tool.add(shaft, ring);
    toolAt(tool);
  }
  if (config.accessory === "heart") {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.14);
    shape.bezierCurveTo(-0.26, 0.07, -0.12, 0.25, 0, 0.1);
    shape.bezierCurveTo(0.12, 0.25, 0.26, 0.07, 0, -0.14);
    const heart = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 4 }),
      CORAL,
    );
    const tool = new THREE.Group();
    tool.add(heart);
    toolAt(tool);
  }
  if (config.accessory === "caliper") {
    const tool = new THREE.Group();
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.52, 0.035, 2, 0.018), STEEL);
    rail.position.y = 0.08;
    const jawTop = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.045, 0.04, 2, 0.014), STEEL);
    jawTop.position.set(0.08, 0.31, 0);
    const jawBottom = jawTop.clone();
    jawBottom.position.set(-0.08, -0.15, 0);
    const slider = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.13, 0.055, 2, 0.025), DARK);
    slider.position.y = 0.08;
    tool.add(rail, jawTop, jawBottom, slider);
    toolAt(tool);
  }
  if (config.accessory === "solder") {
    const tool = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 6, 12), new THREE.MeshStandardMaterial({ color: "#515dad", roughness: 0.72 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.28, 12), STEEL);
    tip.position.y = 0.31;
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 20, Math.PI), DARK);
    cord.position.y = -0.22;
    cord.rotation.z = Math.PI / 2;
    tool.add(handle, tip, cord);
    toolAt(tool);
  }

  return group;
}

// Знак подобран эмпирически под камеру на +Z: отрицательный поворот по Y
// разворачивает лицо (нормаль +Z) в сторону экрана-влево (-X).
const FACING_Y: Record<AvatarFacing, number> = { front: 0, left: -0.62, right: 0.62 };

// --- общая постановка сцены: env-свет, ключ с мягкой тенью, пол-ловец тени ---
function setupStage(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight("#fff2dd", 2.4);
  key.position.set(2.6, 4.2, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 3;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 8;
  for (const side of ["left", "right", "bottom", "top"] as const) {
    // компактная теневая камера — резкость мягкой тени
    (key.shadow.camera as unknown as Record<string, number>)[side] = side === "left" || side === "bottom" ? -1 : 1;
  }
  scene.add(key);

  const rim = new THREE.DirectionalLight("#34d399", 1.1);
  rim.position.set(-3, 2.5, -4);
  scene.add(rim);

  // Пол-ловец тени: персонаж без ног визуально опирается нижней частью боба.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 32),
    new THREE.ShadowMaterial({ opacity: 0.28 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.29;
  ground.receiveShadow = true;
  scene.add(ground);
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.3, 5.2);
  camera.lookAt(0, 1.08, 0);
  return camera;
}

// Снапшоты рендерятся без круглой CSS-обрезки вокруг (капсула/меню показывают
// «только персонажа», без кольца/фона) — значит кадр должен сам с запасом
// вмещать тень и парящие руки по бокам, шире, чем в живом редакторе.
function makeSnapshotCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  camera.position.set(0, 1.28, 6.1);
  camera.lookAt(0, 1.08, 0);
  return camera;
}

interface SceneHandle {
  setConfig: (config: AvatarConfig) => void;
  dispose: () => void;
}

export type HeaderMascotReaction = "idle" | "engaged" | "notice" | "typing";

export interface HeaderMascotSceneHandle extends SceneHandle {
  setPointer: (x: number, y: number) => void;
  setReaction: (reaction: HeaderMascotReaction) => void;
  setVisible: (visible: boolean) => void;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const m = material as THREE.MeshPhysicalMaterial;
      m.map?.dispose();
      m.bumpMap?.dispose();
      material.dispose();
    }
  });
}

// Живая сцена редактора: drag-вращение + idle-покачивание.
export function createMascotScene(canvas: HTMLCanvasElement, initial: AvatarConfig): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const scene = new THREE.Scene();
  const camera = makeCamera();
  setupStage(renderer, scene);

  const resize = new ResizeObserver(() => {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(canvas);

  let mascot = buildMascot(initial);
  scene.add(mascot);

  let targetY = 0;
  let dragging = false;
  let lastX = 0;
  let raf = 0;
  const clock = new THREE.Clock();

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // синтетическое событие/старый браузер — drag работает в границах канваса
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    targetY += (event.clientX - lastX) * 0.012;
    lastX = event.clientX;
  });
  const stop = () => { dragging = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  const reduceMotion = prefersReducedMotionNow();

  function frame() {
    const t = clock.getElapsedTime();
    const idle = reduceMotion || dragging ? 0 : Math.sin(t * 0.8) * 0.12;
    mascot.rotation.y += (targetY + idle - mascot.rotation.y) * 0.12;
    if (!reduceMotion) mascot.position.y = Math.sin(t * 1.6) * 0.03;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  frame();

  return {
    setConfig(next) {
      scene.remove(mascot);
      disposeGroup(mascot);
      mascot = buildMascot(next);
      mascot.rotation.y = targetY;
      scene.add(mascot);
    },
    dispose() {
      cancelAnimationFrame(raf);
      resize.disconnect();
      disposeGroup(mascot);
      renderer.dispose();
    },
  };
}

// Единственная постоянная 3D-сцена вне конструктора: компактный персонаж в правой
// капсуле. Здесь намеренно нет PMREM, теней и постоянного 60fps-цикла. Кадры
// рисуются только пока маскот догоняет курсор/реакцию, затем GPU засыпает.
export function createHeaderMascotScene(
  canvas: HTMLCanvasElement,
  initial: AvatarConfig,
  onContextLost?: () => void,
): HeaderMascotSceneHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    premultipliedAlpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setSize(Math.max(canvas.clientWidth, 64), Math.max(canvas.clientHeight, 64), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#fff5e7", "#b8d8c7", 2.2));
  const key = new THREE.DirectionalLight("#fff1dc", 2.8);
  key.position.set(2.5, 3.8, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#60e5bd", 1.5);
  rim.position.set(-3, 2, -2);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 20);
  camera.position.set(0, 1.25, 6);
  camera.lookAt(0, 0.95, 0);

  let mascot = buildMascot(initial);
  mascot.scale.setScalar(1.08);
  scene.add(mascot);

  // Клавиатура появляется только во время ввода в глобальный поиск. Это отдельный
  // лёгкий примитив, поэтому персонажу не приходится пересобирать весь набор одежды.
  const keyboard = new THREE.Group();
  const keyboardMaterial = new THREE.MeshStandardMaterial({ color: "#24272b", roughness: 0.62, metalness: 0.08 });
  const keyboardBase = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.48), keyboardMaterial);
  keyboard.add(keyboardBase);
  const keyMaterial = new THREE.MeshStandardMaterial({ color: "#d9f8ef", roughness: 0.7 });
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const keycap = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.045, 0.13), keyMaterial);
      keycap.position.set(-0.42 + column * 0.17, 0.08, -0.1 + row * 0.18);
      keyboard.add(keycap);
    }
  }
  keyboard.position.set(-0.08, 0.36, 0.9);
  keyboard.rotation.x = -0.48;
  keyboard.scale.setScalar(0.001);
  keyboard.visible = false;
  scene.add(keyboard);

  // Базовая поза шапки: персонаж находится справа и смотрит внутрь композиции,
  // влево-вниз. LiveHeaderMascot добавляет к этой точке небольшую реакцию на курсор.
  let pointerX: number = HEADER_MASCOT_REST_POINTER.x;
  let pointerY: number = HEADER_MASCOT_REST_POINTER.y;
  let reaction: HeaderMascotReaction = "idle";
  let reactionStarted = 0;
  let visible = true;
  let disposed = false;
  let raf = 0;
  let lastFrame = 0;

  const applyPointerPoseImmediately = () => {
    const target = headerMascotRotationForPointer(pointerX, pointerY);
    mascot.rotation.x = target.x;
    mascot.rotation.y = target.y;
  };

  const draw = (now = performance.now()) => {
    if (disposed || !visible) {
      raf = 0;
      return;
    }
    // 30fps достаточно для маленького персонажа и заметно дешевле постоянного chrome.
    if (now - lastFrame < 30) {
      raf = requestAnimationFrame(draw);
      return;
    }
    lastFrame = now;
    const target = headerMascotRotationForPointer(pointerX, pointerY);
    mascot.rotation.y += (target.y - mascot.rotation.y) * 0.18;
    mascot.rotation.x += (target.x - mascot.rotation.x) * 0.16;

    const elapsed = Math.max(0, now - reactionStarted);
    let targetZ = 0;
    let targetScale = 1.08;
    let keyboardScale = 0.001;
    if (reaction === "engaged") {
      targetZ = Math.sin(Math.min(elapsed / 360, 1) * Math.PI) * -0.1;
      targetScale = 1.12;
    } else if (reaction === "notice" && elapsed < 700) {
      targetZ = Math.sin(elapsed / 70) * 0.11 * (1 - elapsed / 700);
      targetScale = 1.08 + Math.sin(elapsed / 90) * 0.035;
    } else if (reaction === "typing") {
      targetZ = Math.sin(elapsed / 110) * 0.025;
      targetScale = 1.1;
      keyboardScale = 1;
    }
    mascot.rotation.z += (targetZ - mascot.rotation.z) * 0.22;
    const currentScale = mascot.scale.x + (targetScale - mascot.scale.x) * 0.2;
    mascot.scale.setScalar(currentScale);
    keyboard.visible = keyboardScale > 0.01 || keyboard.scale.x > 0.02;
    const currentKeyboardScale = keyboard.scale.x + (keyboardScale - keyboard.scale.x) * 0.24;
    keyboard.scale.setScalar(Math.max(0.001, currentKeyboardScale));
    keyboard.position.y = 0.36 + (reaction === "typing" ? Math.sin(elapsed / 85) * 0.015 : 0);
    renderer.render(scene, camera);

    const moving =
      Math.abs(mascot.rotation.y - target.y) > 0.003 ||
      Math.abs(mascot.rotation.x - target.x) > 0.003 ||
      Math.abs(mascot.rotation.z - targetZ) > 0.003 ||
      Math.abs(mascot.scale.x - targetScale) > 0.003 ||
      Math.abs(keyboard.scale.x - keyboardScale) > 0.01 ||
      (reaction === "notice" && elapsed < 760) ||
      (reaction === "engaged" && elapsed < 420) ||
      reaction === "typing";
    raf = moving ? requestAnimationFrame(draw) : 0;
  };
  const invalidate = () => {
    if (!disposed && visible && !raf) raf = requestAnimationFrame(draw);
  };

  const resize = new ResizeObserver(() => {
    const width = Math.max(canvas.clientWidth, 64);
    const height = Math.max(canvas.clientHeight, 64);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  });
  resize.observe(canvas);

  const contextLost = (event: Event) => {
    event.preventDefault();
    visible = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  // Первый WebGL-кадр уже совпадает с базовым взглядом fallback-снимка.
  // Раньше модель успевала один кадр смотреть прямо, а затем «дёргалась»
  // влево-вниз при первом requestAnimationFrame после каждого route-remount.
  applyPointerPoseImmediately();
  renderer.render(scene, camera);

  return {
    setConfig(next) {
      scene.remove(mascot);
      disposeGroup(mascot);
      mascot = buildMascot(next);
      mascot.scale.setScalar(1.08);
      scene.add(mascot);
      applyPointerPoseImmediately();
      invalidate();
    },
    setPointer(x, y) {
      pointerX = THREE.MathUtils.clamp(x, -1, 1);
      pointerY = THREE.MathUtils.clamp(y, -1, 1);
      invalidate();
    },
    setReaction(next) {
      reaction = next;
      reactionStarted = performance.now();
      invalidate();
    },
    setVisible(next) {
      visible = next;
      if (visible) invalidate();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      resize.disconnect();
      canvas.removeEventListener("webglcontextlost", contextLost);
      disposeGroup(mascot);
      disposeGroup(keyboard);
      renderer.dispose();
    },
  };
}

// Снапшоты для капсулы/меню: офскрин-рендер трёх ракурсов (ключ — в avatar.tsx).
export function renderMascotSnapshots(config: AvatarConfig, size = 160): AvatarSnapshots {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);

  const scene = new THREE.Scene();
  const camera = makeSnapshotCamera();
  setupStage(renderer, scene);

  const mascot = buildMascot(config);
  scene.add(mascot);

  // Build into a mutable intermediate object; AvatarSnapshotsDto fields are readonly in generated schema.
  const shots: Record<AvatarFacing, string> = {} as Record<AvatarFacing, string>;
  for (const facing of ["left", "right", "front"] as const) {
    mascot.rotation.y = FACING_Y[facing];
    renderer.render(scene, camera);
    shots[facing] = canvas.toDataURL("image/png");
  }

  disposeGroup(mascot);
  renderer.dispose();
  saveSnapshots(shots as AvatarSnapshots);
  return shots as AvatarSnapshots;
}

// STL-экспорт «напечатай персонажа» (R&D, MF-1021): технический экспорт
// геометрии текущего конфига, печатопригодность (манифолдность/поддержки) — вне скоупа.
export function exportMascotSTL(config: AvatarConfig, binary = true): Blob {
  const mascot = buildMascot(config);
  const exporter = new STLExporter();
  const result = exporter.parse(mascot, { binary });
  disposeGroup(mascot);
  return new Blob([result], { type: binary ? "application/sla" : "text/plain" });
}

// Дев-хелпер: скачивает STL текущей фигурки в браузере (консоль/дев-кнопка).
export function downloadMascotSTL(config: AvatarConfig, filename = "mascot.stl"): void {
  const blob = exportMascotSTL(config);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
