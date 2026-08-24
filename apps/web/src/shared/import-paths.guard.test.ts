import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard-тесты путей импортов (микроэтап 7.7). Ловят класс багов, который tsc
// пропускает и который всплывал только на полном vitest после переносов доменов:
//   1) относительные и side-effect импорты, указывающие на несуществующий файл
//      (напр. CSS "../market/x.css", свёрнутый переносом в barrel, или ../ не на
//       той глубине после git mv в domains/*);
//   2) строковые пути в readFileSync/source()/new URL внутри тестов, указывающие
//      на старое расположение перенесённого файла (guard-тесты структуры).
// tsc не проверяет ни .css-импорты, ни строковые аргументы readFileSync — поэтому
// эти инварианты держим отдельным быстрым тестом (секунды вместо полного прогона).

const SRC = resolve(process.cwd(), "src");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

// Сам guard-файл исключаем: в нём живут иллюстративные строки-примеры для регэкспов,
// которые иначе матчились бы собственными же проверками.
const SELF = resolve(__dirname, "import-paths.guard.test.ts");
const allFiles = walk(SRC).filter((f) => f !== SELF);

// Резолвит относительный спецификатор в существующий файл. Спецификаторы в проекте
// пишутся с явным расширением (.ts/.tsx/.css/.svg/...), но подстрахуемся авто-
// расширениями и index-файлами на случай будущих без-расширенных импортов.
function relativeSpecifierResolves(fromFile: string, spec: string): boolean {
  const base = resolve(dirname(fromFile), spec);
  if (existsSync(base) && statSync(base).isFile()) return true;
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".css", ".json"]) {
    if (existsSync(base + ext)) return true;
  }
  for (const idx of ["index.ts", "index.tsx"]) {
    if (existsSync(join(base, idx))) return true;
  }
  return false;
}

describe("guard: относительные и side-effect импорты указывают на существующие файлы (7.7)", () => {
  it("каждый относительный `from \"./…\"` / `\"../…\"` разрешается в файл на диске", () => {
    const broken: string[] = [];
    // from "..."; — и import-, и export-реэкспорты
    const fromRe = /(?:^|\n)\s*(?:import|export)[^"'\n]*?from\s+["'](\.[^"']+)["']/g;
    for (const file of allFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(fromRe)) {
        const spec = m[1];
        if (!spec) continue;
        if (!relativeSpecifierResolves(file, spec)) {
          broken.push(`${file.replace(SRC, "src")} → ${spec}`);
        }
      }
    }
    expect(broken, `битые относительные импорты (файл → спецификатор):\n${broken.join("\n")}`).toEqual([]);
  });

  it("каждый относительный side-effect импорт `import \"./…\";` разрешается (ловит свёрнутый в barrel CSS)", () => {
    const broken: string[] = [];
    // import "..."; без слова from — side-effect (обычно .css)
    const sideRe = /(?:^|\n)\s*import\s+["'](\.[^"']+)["']\s*;/g;
    for (const file of allFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(sideRe)) {
        const spec = m[1];
        if (!spec) continue;
        if (!relativeSpecifierResolves(file, spec)) {
          broken.push(`${file.replace(SRC, "src")} → ${spec}`);
        }
      }
    }
    expect(broken, `битые side-effect импорты (файл → спецификатор):\n${broken.join("\n")}`).toEqual([]);
  });

  it("нет side-effect импорта голого barrel `import \"@domains/*|@shared/*|@platform/*\";` (barrel-CSS-баг Этапа 6)", () => {
    // import "@domains/commerce"; резолвится (в barrel), поэтому проверка-существования его НЕ
    // ловит — но семантически это почти всегда ошибка: CSS-импорт "../market/x.css", который
    // regex переноса свернул в алиас. Barrel/index не должен импортироваться ради side-effect
    // (у него нет CSS-побочек) — только именованно (`import { X } from …`).
    const suspicious: string[] = [];
    const barrelSideRe = /(?:^|\n)\s*import\s+["'](@(?:domains|shared|platform)\/[^"']+)["']\s*;/g;
    for (const file of allFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(barrelSideRe)) {
        const spec = m[1];
        if (!spec) continue;
        // допускаем явный .css/.svg/... по алиасу — это осознанный ассет, не barrel
        if (!/\.[a-z]+$/.test(spec)) suspicious.push(`${file.replace(SRC, "src")} → ${spec}`);
      }
    }
    expect(suspicious, `side-effect импорт barrel (вероятно свёрнутый CSS):\n${suspicious.join("\n")}`).toEqual([]);
  });
});

describe("guard: строковые пути в readFileSync/source()/new URL существуют (7.7)", () => {
  it("хардкод-пути вида \"src/…\" в readFileSync/resolve указывают на существующий файл", () => {
    const broken: string[] = [];
    // строковые литералы, начинающиеся на src/ (аргумент resolve(process.cwd(), "src/…"))
    const srcLiteralRe = /["'`](src\/[^"'`]+\.[a-z]+)["'`]/g;
    for (const file of allFiles) {
      const text = readFileSync(file, "utf8");
      // проверяем только файлы, реально читающие с диска (иначе "src/…" может быть строкой в ассерте)
      if (!/readFileSync|readdirSync|existsSync/.test(text)) continue;
      for (const m of text.matchAll(srcLiteralRe)) {
        const rel = m[1];
        if (!rel) continue;
        if (!existsSync(resolve(process.cwd(), rel))) {
          broken.push(`${file.replace(SRC, "src")} → ${rel}`);
        }
      }
    }
    expect(broken, `битые readFileSync-пути (файл → путь):\n${broken.join("\n")}`).toEqual([]);
  });

  it("пути в source()/new URL(\"../…\", import.meta.url) внутри guard-тестов существуют", () => {
    const broken: string[] = [];
    // source("../rel/file.ext") и new URL("../rel", import.meta.url) — резолвим от файла теста
    const urlRe = /(?:source|new URL)\(\s*["'`](\.[^"'`]+\.[a-z]+)["'`]/g;
    for (const file of allFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(urlRe)) {
        const spec = m[1];
        if (!spec) continue;
        if (!relativeSpecifierResolves(file, spec)) {
          broken.push(`${file.replace(SRC, "src")} → ${spec}`);
        }
      }
    }
    expect(broken, `битые source()/new URL пути (файл → путь):\n${broken.join("\n")}`).toEqual([]);
  });
});
