// Рендерит PWA-иконки из public/icons/source.svg (монограмма-куб, токены theme/tokens.css:
// #0a1512 фон / #34d399 mint-акцент). Перегенерировать при смене брендинга: `pnpm --filter
// @portal/web run icons:generate`. sharp — devDependency, в проде не используется.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(here, "..", "public", "icons");
const svgPath = path.join(here, "icon-source.svg");

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  // Maskable — тот же арт (фон на всю площадь, знак уже в safe zone 80%), но отдельные
  // файлы + отдельная запись manifest с purpose:"maskable" (спецификация не разрешает
  // одному файлу отвечать за два purpose одновременно).
  { file: "icon-maskable-192.png", size: 192 },
  { file: "icon-maskable-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "favicon-32.png", size: 32 },
  { file: "favicon-16.png", size: 16 },
];

const svg = await readFile(svgPath);

for (const { file, size } of targets) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(path.join(iconsDir, file), png);
  console.warn(`wrote ${file} (${size}x${size})`);
}
