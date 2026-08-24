// Справочник ассистента печатника v1 (MF-494, docs/epics/backend.foundation.md §«Открытые
// вопросы» — статический контент в web, бекэнда не нужно). Курируемый список ссылок на
// официальные wiki/knowledge base производителей и слайсеров — без AI и свободного ввода,
// AI-версия (диагностика по фото) — MF-16, v2.
//
// Все URL проверены на 200 (curl -L) на момент добавления записи — при протухании ссылки чинить
// точечно, а не убирать раздел целиком.

export interface VendorReferenceLink {
  vendorSlug: string;
  vendorName: string;
  // Строчные подстроки для матчинга против printer.brand (case-insensitive includes).
  brandMatch: string[];
  title: string;
  url: string;
  lang: "en" | "ru";
  description: string;
  // Слайсеры, которые вендор поставляет/рекомендует — ключи в SLICER_REFERENCE_LINKS.
  recommendedSlicerSlugs: string[];
}

export interface SlicerReferenceLink {
  slicerSlug: string;
  slicerName: string;
  title: string;
  url: string;
  lang: "en" | "ru";
  description: string;
}

export const VENDOR_REFERENCE_LINKS: VendorReferenceLink[] = [
  {
    vendorSlug: "bambu-lab",
    vendorName: "Bambu Lab",
    brandMatch: ["bambu"],
    title: "Bambu Lab Wiki",
    url: "https://wiki.bambulab.com/en/home",
    lang: "en",
    description: "Официальная база знаний: калибровка, профили филамента, troubleshooting.",
    recommendedSlicerSlugs: ["bambu-studio", "orcaslicer"],
  },
  {
    vendorSlug: "prusa-research",
    vendorName: "Prusa Research",
    brandMatch: ["prusa"],
    title: "Prusa Knowledge Base",
    url: "https://help.prusa3d.com/",
    lang: "en",
    description: "Официальный support-портал Prusa: настройка, обслуживание, FAQ.",
    recommendedSlicerSlugs: ["prusaslicer", "orcaslicer"],
  },
  {
    vendorSlug: "creality",
    vendorName: "Creality",
    brandMatch: ["creality"],
    title: "Creality Wiki",
    url: "https://wiki.creality.com/en/home",
    lang: "en",
    description: "Официальная wiki: руководства, прошивки, калибровка.",
    recommendedSlicerSlugs: ["creality-print", "orcaslicer"],
  },
  {
    vendorSlug: "anycubic",
    vendorName: "Anycubic",
    brandMatch: ["anycubic"],
    title: "Anycubic — FAQ и поддержка",
    url: "https://www.anycubic.com/pages/faqs",
    lang: "en",
    description: "Официальный FAQ Anycubic по настройке и обслуживанию принтеров.",
    recommendedSlicerSlugs: ["orcaslicer", "cura"],
  },
  {
    vendorSlug: "elegoo",
    vendorName: "Elegoo",
    brandMatch: ["elegoo"],
    title: "Elegoo Wiki",
    url: "https://wiki.elegoo.com/",
    lang: "en",
    description: "Официальная wiki: руководства пользователя, прошивки, troubleshooting.",
    recommendedSlicerSlugs: ["orcaslicer", "cura"],
  },
  {
    vendorSlug: "voron-design",
    vendorName: "Voron Design",
    brandMatch: ["voron"],
    title: "Voron Documentation",
    url: "https://docs.vorondesign.com/",
    lang: "en",
    description: "Официальная документация DIY-проекта: сборка, калибровка, Klipper-конфиги.",
    recommendedSlicerSlugs: ["orcaslicer", "prusaslicer"],
  },
  {
    vendorSlug: "sovol",
    vendorName: "Sovol",
    brandMatch: ["sovol"],
    title: "Sovol — FAQ и поддержка",
    url: "https://www.sovol3d.com/pages/faq",
    lang: "en",
    description: "Официальный FAQ Sovol по настройке и частым проблемам.",
    recommendedSlicerSlugs: ["orcaslicer", "cura"],
  },
  {
    vendorSlug: "qidi-tech",
    vendorName: "Qidi Tech",
    brandMatch: ["qidi"],
    title: "Qidi Tech — поддержка",
    url: "https://qidi3d.com/pages/support",
    lang: "en",
    description: "Официальная страница поддержки: руководства и прошивки.",
    recommendedSlicerSlugs: ["orcaslicer", "cura"],
  },
  {
    vendorSlug: "ultimaker",
    vendorName: "Ultimaker",
    brandMatch: ["ultimaker", "ultimaker b.v."],
    title: "Ultimaker Support",
    url: "https://support.ultimaker.com/",
    lang: "en",
    description: "Официальная база знаний Ultimaker: обслуживание, калибровка, FAQ.",
    recommendedSlicerSlugs: ["cura"],
  },
  {
    vendorSlug: "snapmaker",
    vendorName: "Snapmaker",
    brandMatch: ["snapmaker"],
    title: "Snapmaker Wiki",
    url: "https://wiki.snapmaker.com/",
    lang: "en",
    description: "Официальная wiki: руководства по 3-в-1 платформе, прошивки, FAQ.",
    recommendedSlicerSlugs: ["cura", "orcaslicer"],
  },
  {
    vendorSlug: "flsun",
    vendorName: "FLSun",
    brandMatch: ["flsun"],
    title: "FLSun — поддержка",
    url: "https://flsun3d.com/pages/support",
    lang: "en",
    description: "Официальная страница поддержки: руководства и прошивки для дельта-принтеров.",
    recommendedSlicerSlugs: ["orcaslicer", "cura"],
  },
];

export const SLICER_REFERENCE_LINKS: SlicerReferenceLink[] = [
  {
    slicerSlug: "orcaslicer",
    slicerName: "OrcaSlicer",
    title: "OrcaSlicer Wiki",
    url: "https://github.com/SoftFever/OrcaSlicer/wiki",
    lang: "en",
    description: "Официальная документация: калибровочные тесты, профили, настройка.",
  },
  {
    slicerSlug: "prusaslicer",
    slicerName: "PrusaSlicer",
    title: "PrusaSlicer — база знаний",
    url: "https://help.prusa3d.com/prusaslicer",
    lang: "en",
    description: "Официальные статьи Prusa по настройке и использованию PrusaSlicer.",
  },
  {
    slicerSlug: "bambu-studio",
    slicerName: "Bambu Studio",
    title: "Bambu Studio — документация",
    url: "https://wiki.bambulab.com/en/software/bambu-studio",
    lang: "en",
    description: "Официальный раздел Bambu Wiki по Bambu Studio.",
  },
  {
    slicerSlug: "creality-print",
    slicerName: "Creality Print",
    title: "Creality Print — документация",
    url: "https://wiki.creality.com/en/software/creality-print",
    lang: "en",
    description: "Официальный раздел Creality Wiki по слайсеру Creality Print.",
  },
  {
    slicerSlug: "cura",
    slicerName: "Cura",
    title: "Ultimaker Cura — сайт слайсера",
    url: "https://ultimaker.com/software/ultimaker-cura/",
    lang: "en",
    description: "Официальная страница Ultimaker Cura: скачивание и обзор возможностей.",
  },
];

function slicerBySlug(slug: string): SlicerReferenceLink | null {
  return SLICER_REFERENCE_LINKS.find((slicer) => slicer.slicerSlug === slug) ?? null;
}

export function vendorReferenceLinkForBrand(brand: string): VendorReferenceLink | null {
  const normalized = brand.trim().toLowerCase();
  if (!normalized) return null;
  return VENDOR_REFERENCE_LINKS.find((vendor) => vendor.brandMatch.some((needle) => normalized.includes(needle))) ?? null;
}

export function referenceLinksForBrand(brand: string): { vendor: VendorReferenceLink | null; slicers: SlicerReferenceLink[] } {
  const vendor = vendorReferenceLinkForBrand(brand);
  if (!vendor) return { vendor: null, slicers: [] };
  const slicers = vendor.recommendedSlicerSlugs.map(slicerBySlug).filter((slicer): slicer is SlicerReferenceLink => slicer !== null);
  return { vendor, slicers };
}
