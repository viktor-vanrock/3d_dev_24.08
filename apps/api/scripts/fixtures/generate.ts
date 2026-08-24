// Генератор фикстур для dev-сида (MF-535, эпик MF-532 «dev-среда на VDS»).
//
// Делает два набора детерминированных бинарников, которые СИДом раскладываются в dev-бакет
// и подхватываются текущим models assets boundary (apps/api/src/modules/models/infrastructure/assets.ts):
//   • 6 GLB-примитивов (role='preview', model/gltf-binary) — рендерятся three.js-вьюером
//     на /project и в hero-карусели (приёмка эпика, п.6);
//   • 6 WebP-миниатюр (role='thumbnail', image/webp) — карточки каталога без «пустых»
//     (требование Design, «Итоги совета» п.6); каждому примитиву — свой цвет.
//
// Синтетика — базис приёмки среды (слой 1 сида). НЕ художественный ассет: цель — валидная
// геометрия/картинка, которую браузер реально отрисует, а не заглушка в БД.
//
// Запуск (перегенерация фикстур): pnpm --filter @portal/api exec tsx scripts/fixtures/generate.ts
// Результат коммитится в репо (scripts/fixtures/*.glb|*.webp) — сид читает готовые файлы,
// на проде/стенде ничего не генерируется.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// ── Геометрия: треугольный «суп» (плоские нормали) → индексированный GLB ──────────────
type Vec3 = [number, number, number];
type Tri = [Vec3, Vec3, Vec3];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function faceNormal(t: Tri): Vec3 {
  return normalize(cross(sub(t[1], t[0]), sub(t[2], t[0])));
}

function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Tri[] {
  return [
    [a, b, c],
    [a, c, d],
  ];
}

function cube(s = 0.5): Tri[] {
  const v0: Vec3 = [-s, -s, -s];
  const v1: Vec3 = [s, -s, -s];
  const v2: Vec3 = [s, s, -s];
  const v3: Vec3 = [-s, s, -s];
  const v4: Vec3 = [-s, -s, s];
  const v5: Vec3 = [s, -s, s];
  const v6: Vec3 = [s, s, s];
  const v7: Vec3 = [-s, s, s];
  return [
    ...quad(v4, v5, v6, v7), // +z
    ...quad(v1, v0, v3, v2), // -z
    ...quad(v0, v4, v7, v3), // -x
    ...quad(v5, v1, v2, v6), // +x
    ...quad(v3, v7, v6, v2), // +y
    ...quad(v0, v1, v5, v4), // -y
  ];
}

function pyramid(s = 0.5, h = 0.9): Tri[] {
  const b0: Vec3 = [-s, 0, -s];
  const b1: Vec3 = [s, 0, -s];
  const b2: Vec3 = [s, 0, s];
  const b3: Vec3 = [-s, 0, s];
  const apex: Vec3 = [0, h, 0];
  return [
    [b0, b1, apex],
    [b1, b2, apex],
    [b2, b3, apex],
    [b3, b0, apex],
    ...quad(b0, b3, b2, b1), // база
  ];
}

function cylinder(r = 0.5, h = 1, seg = 32): Tri[] {
  const top = h / 2;
  const bot = -h / 2;
  const tris: Tri[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const b = ((i + 1) / seg) * Math.PI * 2;
    const ax = Math.cos(a) * r;
    const az = Math.sin(a) * r;
    const bx = Math.cos(b) * r;
    const bz = Math.sin(b) * r;
    tris.push(...quad([ax, bot, az], [bx, bot, bz], [bx, top, bz], [ax, top, az]));
    tris.push([
      [0, top, 0],
      [ax, top, az],
      [bx, top, bz],
    ]);
    tris.push([
      [0, bot, 0],
      [bx, bot, bz],
      [ax, bot, az],
    ]);
  }
  return tris;
}

function cone(r = 0.5, h = 1, seg = 32): Tri[] {
  const bot = -h / 2;
  const apex: Vec3 = [0, h / 2, 0];
  const tris: Tri[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const b = ((i + 1) / seg) * Math.PI * 2;
    const ax = Math.cos(a) * r;
    const az = Math.sin(a) * r;
    const bx = Math.cos(b) * r;
    const bz = Math.sin(b) * r;
    tris.push([[ax, bot, az], [bx, bot, bz], apex]);
    tris.push([
      [0, bot, 0],
      [bx, bot, bz],
      [ax, bot, az],
    ]);
  }
  return tris;
}

function sphere(r = 0.55, lat = 24, lon = 32): Tri[] {
  const grid: Vec3[][] = [];
  for (let i = 0; i <= lat; i++) {
    const theta = (i / lat) * Math.PI;
    const row: Vec3[] = [];
    for (let j = 0; j <= lon; j++) {
      const phi = (j / lon) * Math.PI * 2;
      row.push([r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi)]);
    }
    grid.push(row);
  }
  const tris: Tri[] = [];
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      tris.push(...quad(grid[i]![j]!, grid[i]![j + 1]!, grid[i + 1]![j + 1]!, grid[i + 1]![j]!));
    }
  }
  return tris;
}

function torus(R = 0.4, r = 0.18, seg = 32, sides = 20): Tri[] {
  const grid: Vec3[][] = [];
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2;
    const row: Vec3[] = [];
    for (let j = 0; j <= sides; j++) {
      const v = (j / sides) * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = r * Math.sin(v);
      const z = (R + r * Math.cos(v)) * Math.sin(u);
      row.push([x, y, z]);
    }
    grid.push(row);
  }
  const tris: Tri[] = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < sides; j++) {
      tris.push(...quad(grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!));
    }
  }
  return tris;
}

// ── Упаковка GLB (glTF 2.0 binary) ───────────────────────────────────────────────────
function pad4(n: number): number {
  return (4 - (n % 4)) % 4;
}

function buildGlb(tris: Tri[], color: [number, number, number]): Buffer {
  const vertCount = tris.length * 3;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint16Array(vertCount);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let v = 0;
  tris.forEach((t, ti) => {
    const n = faceNormal(t);
    for (const p of t) {
      positions[v * 3] = p[0];
      positions[v * 3 + 1] = p[1];
      positions[v * 3 + 2] = p[2];
      normals[v * 3] = n[0];
      normals[v * 3 + 1] = n[1];
      normals[v * 3 + 2] = n[2];
      for (let k = 0; k < 3; k++) {
        const val = p[k]!;
        if (val < min[k]!) min[k] = val;
        if (val > max[k]!) max[k] = val;
      }
      v++;
    }
    indices[ti * 3] = ti * 3;
    indices[ti * 3 + 1] = ti * 3 + 1;
    indices[ti * 3 + 2] = ti * 3 + 2;
  });

  const idxBytes = indices.byteLength;
  const idxPad = pad4(idxBytes);
  const posOffset = idxBytes + idxPad;
  const posBytes = positions.byteLength;
  const normOffset = posOffset + posBytes;
  const normBytes = normals.byteLength;
  const binLength = normOffset + normBytes;

  const bin = Buffer.alloc(binLength);
  Buffer.from(indices.buffer, indices.byteOffset, idxBytes).copy(bin, 0);
  Buffer.from(positions.buffer, positions.byteOffset, posBytes).copy(bin, posOffset);
  Buffer.from(normals.buffer, normals.byteOffset, normBytes).copy(bin, normOffset);

  const gltf = {
    asset: { version: "2.0", generator: "portal seed-dev fixtures (MF-535)" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [color[0], color[1], color[2], 1],
          metallicFactor: 0.05,
          roughnessFactor: 0.65,
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5123, count: vertCount, type: "SCALAR" },
      { bufferView: 1, componentType: 5126, count: vertCount, type: "VEC3", min, max },
      { bufferView: 2, componentType: 5126, count: vertCount, type: "VEC3" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxBytes, target: 34963 },
      { buffer: 0, byteOffset: posOffset, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: normOffset, byteLength: normBytes, target: 34962 },
    ],
    buffers: [{ byteLength: binLength }],
  };

  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = pad4(json.length);
  if (jsonPad) json = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]); // паддинг JSON — пробелы

  const totalLength = 12 + 8 + json.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHeader, json, binHeader, bin]);
}

// ── WebP (VP8L lossless, сплошной цвет) ──────────────────────────────────────────────
// Минимальный корректный VP8L: изображение — один цвет, каждый пиксель кодируется
// «простым» (1-символьным) префикс-кодом на канал → 0 бит на пиксель, декодер восстанавливает
// W×H пикселей одного ARGB. Формат/битовый порядок — спека WebP Lossless (LSB-first).
class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private nbits = 0;
  put(value: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.cur |= ((value >> i) & 1) << this.nbits;
      this.nbits++;
      if (this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }
  finish(): Buffer {
    if (this.nbits > 0) {
      this.bytes.push(this.cur);
      this.cur = 0;
      this.nbits = 0;
    }
    return Buffer.from(this.bytes);
  }
}

function solidWebp(width: number, height: number, r: number, g: number, b: number): Buffer {
  const bw = new BitWriter();
  bw.put(width - 1, 14);
  bw.put(height - 1, 14);
  bw.put(0, 1); // alpha_is_used = 0 (A=255)
  bw.put(0, 3); // version = 0
  bw.put(0, 1); // transforms: стоп
  bw.put(0, 1); // color cache: нет
  bw.put(0, 1); // meta huffman: нет (одна группа)

  // simple prefix code с одним символом → чтение символа не двигает битридер.
  const simple8 = (symbol: number) => {
    bw.put(1, 1); // simple_code
    bw.put(0, 1); // num_symbols - 1 = 0
    bw.put(1, 1); // first_symbol_len_code = 1 → 8-битный символ
    bw.put(symbol, 8);
  };
  simple8(g); // GREEN (+length/cache alphabet), символ < 256 ⇒ литерал
  simple8(r); // RED
  simple8(b); // BLUE
  simple8(255); // ALPHA
  // DIST — код обязателен, но не используется (нет back-reference'ов); 1 символ, 1-битная форма
  bw.put(1, 1);
  bw.put(0, 1);
  bw.put(0, 1);
  bw.put(0, 1);

  let vp8l = Buffer.concat([Buffer.from([0x2f]), bw.finish()]);
  const chunkSize = vp8l.length;
  if (chunkSize % 2 === 1) vp8l = Buffer.concat([vp8l, Buffer.from([0x00])]); // RIFF padding

  const head = Buffer.alloc(20);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(4 + 8 + vp8l.length, 4); // 'WEBP' + ('VP8L'+size) + data
  head.write("WEBP", 8, "ascii");
  head.write("VP8L", 12, "ascii");
  head.writeUInt32LE(chunkSize, 16);
  return Buffer.concat([head, vp8l]);
}

// ── Набор из 6 примитивов + цветов ───────────────────────────────────────────────────
export interface Fixture {
  slug: string;
  tris: Tri[];
  color: [number, number, number]; // linear 0..1 для GLB baseColor
  thumb: [number, number, number]; // 0..255 sRGB для webp
}

export const FIXTURES: Fixture[] = [
  { slug: "cube", tris: cube(), color: [0.85, 0.33, 0.29], thumb: [201, 92, 78] },
  { slug: "pyramid", tris: pyramid(), color: [0.9, 0.68, 0.22], thumb: [214, 165, 74] },
  { slug: "cylinder", tris: cylinder(), color: [0.32, 0.6, 0.86], thumb: [92, 148, 201] },
  { slug: "cone", tris: cone(), color: [0.36, 0.72, 0.5], thumb: [98, 174, 129] },
  { slug: "sphere", tris: sphere(0.55, 16, 24), color: [0.62, 0.4, 0.78], thumb: [156, 110, 190] },
  { slug: "torus", tris: torus(0.4, 0.18, 28, 16), color: [0.9, 0.5, 0.62], thumb: [214, 128, 152] },
];

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of FIXTURES) {
    const glb = buildGlb(f.tris, f.color);
    const webp = solidWebp(256, 256, f.thumb[0], f.thumb[1], f.thumb[2]);
    const glbPath = join(OUT_DIR, `${f.slug}.glb`);
    const webpPath = join(OUT_DIR, `${f.slug}.webp`);
    writeFileSync(glbPath, glb);
    writeFileSync(webpPath, webp);
    const gSum = createHash("sha256").update(glb).digest("hex").slice(0, 12);
    const wSum = createHash("sha256").update(webp).digest("hex").slice(0, 12);
    console.log(`${f.slug.padEnd(9)} glb ${String(glb.length).padStart(6)}B (${gSum})  webp ${String(webp.length).padStart(5)}B (${wSum})`);
  }
  console.log(`\n${FIXTURES.length} примитивов записано в ${OUT_DIR}`);
}

// Запуск как скрипт (не при импорте из сида).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
