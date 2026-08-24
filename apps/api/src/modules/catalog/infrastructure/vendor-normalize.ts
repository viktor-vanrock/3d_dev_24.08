// Вендор → канонический (slug, name). Извлечено из scripts/import-machines-bootstrap.ts
// (MF-405) при добавлении entity resolution пайплайна (MF-406, декомпозиция MF-648) — оба
// потребителя (bootstrap-импорт и blocking-шаг resolve/) должны схлопывать одного вендора в
// один vendors-ряд одинаково, дублировать таблицу алиасов было бы гарантированным дрейфом.
//
import { createHash } from "node:crypto";

// Известные варианты написания одного вендора у разных источников (слайсеры, вендор-сайты) →
// канонический (slug, name). Ключи — точное написание, которое встретилось у источника
// (регистрозависимо); неизвестные варианты падают в slugify-фолбэк ниже, который в норме даёт
// тот же slug за счёт lower-case (пример: "SOVOL" от Shopify-адаптера не входит в ключи, но
// slugify("SOVOL") === "sovol" === алиас "Sovol"/"Sovol 3D").
const VENDOR_ALIASES: Record<string, { slug: string; name: string }> = {
  BBL: { slug: "bambu-lab", name: "Bambu Lab" },
  Prusa: { slug: "prusa-research", name: "Prusa Research" },
  Prusa3D: { slug: "prusa-research", name: "Prusa Research" },
  PrusaResearch: { slug: "prusa-research", name: "Prusa Research" },
  Creality: { slug: "creality", name: "Creality" },
  Creality3D: { slug: "creality", name: "Creality" },
  Elegoo: { slug: "elegoo", name: "Elegoo" },
  ELEGOO: { slug: "elegoo", name: "Elegoo" },
  Voron: { slug: "voron-design", name: "Voron Design" },
  VoronDesign: { slug: "voron-design", name: "Voron Design" },
  FlyingBear: { slug: "flyingbear", name: "FlyingBear" },
  "Flying Bear": { slug: "flyingbear", name: "FlyingBear" },
  Sovol: { slug: "sovol", name: "Sovol" },
  "Sovol 3D": { slug: "sovol", name: "Sovol" },
  Flsun: { slug: "flsun", name: "FLSun" },
  FLSun: { slug: "flsun", name: "FLSun" },
  BIQU: { slug: "biqu", name: "BIQU" },
  Biqu: { slug: "biqu", name: "BIQU" },
  Ratrig: { slug: "ratrig", name: "RatRig" },
  RatRig: { slug: "ratrig", name: "RatRig" },
  Ultimaker: { slug: "ultimaker", name: "Ultimaker" },
  UltiMaker: { slug: "ultimaker", name: "Ultimaker" },
  "Ultimaker B.V.": { slug: "ultimaker", name: "Ultimaker" },
  Folgertech: { slug: "folger-tech", name: "Folger Tech" },
  "Folger Tech": { slug: "folger-tech", name: "Folger Tech" },
  Qidi: { slug: "qidi-tech", name: "Qidi Tech" },
  QIDITechnology: { slug: "qidi-tech", name: "Qidi Tech" },
  "Velleman N.V.": { slug: "velleman", name: "Velleman" },
  WEEDO: { slug: "weedo", name: "Weedo" },
  "Zav Co., Ltd.": { slug: "zav", name: "Zav" },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveVendorName(raw: string): { slug: string; name: string } {
  const alias = VENDOR_ALIASES[raw];
  if (alias) return alias;
  const slug = slugify(raw);
  if (slug) return { slug, name: raw };
  // Пустой slug (raw без единого латинского символа/цифры, напр. чистая кириллица без алиаса) —
  // не бросаем строку без slug (unique constraint у vendors.slug), детерминированный фолбэк по
  // содержимому raw, тот же паттерн, что был в bootstrap-скрипте.
  return { slug: `vendor-${createHash("sha1").update(raw).digest("hex").slice(0, 8)}`, name: raw };
}
