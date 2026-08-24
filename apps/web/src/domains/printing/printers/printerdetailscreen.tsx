import { useEffect, useState, type ReactNode } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): printing→access useGuestLogin, развязка отложена до pages/DI. См. MIGRATION.md.
import { useGuestLogin } from "@domains/access";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): printing→commerce ContextFeedbackDoor (дверь обратной связи), развязка отложена до pages/DI. См. MIGRATION.md.
import { ContextFeedbackDoor } from "@domains/commerce";
import { useOverlay } from "@platform/overlay";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing→ai listPrinters/PrinterRecord/TOOLHEAD_KIND_OPTIONS/FieldDef (каталог принтеров читает исследовательскую базу), развязка отложена до pages/DI. См. MIGRATION.md.
import { listPrinters, type PrinterRecord, TOOLHEAD_KIND_OPTIONS, type FieldDef } from "@domains/ai";
import { navigate, parkAddPath, printerCommunityFirmwarePath, printerDiyPath, printersPath, threadPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, ActionCard, AgentBadge, Button, EmptyState, FlagshipBadge, Heading, StatusPill } from "@shared/ui";
import { useCompareSet } from "./comparestate.ts";
import { PRINTER_COMMUNITY_PREVIEWS } from "./communitypreview.ts";
import { printerCardViewSource, trackPrinterEvent } from "./events.ts";
import { isStalePrice } from "./facets.ts";
import { pilotInfoFor, type PilotInfo } from "../park/firmwarepilot.ts";
import { referenceLinksForBrand } from "./referencelinks.ts";
import { STATUS_LABEL, STATUS_TONE, SUPPORT_LEVEL_LABEL, SUPPORT_LEVEL_LEVEL, SUPPORT_LEVEL_TONE, supportPresentationFor } from "./labels.ts";
import "./printers.css";

const PRINTED_PROJECT_PREVIEW = ["Кронштейн для камеры", "Органайзер для стола", "Корпус электроники", "Тестовый куб 20 мм"] as const;

interface DetailSection {
  key: string;
  label: string;
  fields?: FieldDef[];
  kind?: "toolhead_extras" | "materials_supported" | "unique_features";
}

// Порядок §4.3 — 1:1 с текстом спеки, не с research/schema.ts SPEC_SECTIONS (там другой порядок
// под форму ресёрчера): build_volume → hotend → bed → speed → multimaterial → toolhead_extras →
// connectivity → materials_supported → dimensions_mm → price → unique_features.
const DETAIL_SECTIONS: DetailSection[] = [
  {
    key: "build_volume",
    label: "Объём печати",
    fields: [
      { key: "x", label: "X, мм", type: "number" },
      { key: "y", label: "Y, мм", type: "number" },
      { key: "z", label: "Z, мм", type: "number" },
      { key: "shape", label: "Форма стола", type: "select" },
      { key: "diameter", label: "Диаметр (круглый/дельта), мм", type: "number" },
    ],
  },
  {
    key: "hotend",
    label: "Хотэнд",
    fields: [
      { key: "max_temp_c", label: "Макс. температура, °C", type: "number" },
      { key: "max_flow_mm3s", label: "Макс. поток, мм³/с", type: "number" },
      { key: "nozzle_default_mm", label: "Сопло по умолчанию, мм", type: "number" },
      { key: "nozzle_swappable", label: "Сопло сменное", type: "boolean" },
      { key: "material", label: "Материал", type: "text" },
      { key: "hardened", label: "Закалённый", type: "boolean" },
    ],
  },
  {
    key: "bed",
    label: "Стол",
    fields: [
      { key: "max_temp_c", label: "Макс. температура стола, °C", type: "number" },
      { key: "surface", label: "Покрытие", type: "text" },
      { key: "auto_leveling", label: "Автовыравнивание", type: "text" },
    ],
  },
  {
    key: "speed",
    label: "Скорость",
    fields: [
      { key: "max_speed_mms", label: "Макс. скорость, мм/с", type: "number" },
      { key: "max_accel_mms2", label: "Макс. ускорение, мм/с²", type: "number" },
      { key: "input_shaping", label: "Input shaping", type: "boolean" },
    ],
  },
  {
    key: "multimaterial",
    label: "AMS / мультиматериал",
    fields: [
      { key: "supported", label: "Поддерживается", type: "boolean" },
      { key: "system_name", label: "Название системы", type: "text" },
      { key: "max_colors", label: "Макс. цветов", type: "number" },
      { key: "unique_notes", label: "Чем уникальна", type: "text" },
    ],
  },
  { key: "toolhead_extras", label: "Уникальные головы (лазер/ЧПУ)", kind: "toolhead_extras" },
  {
    key: "connectivity",
    label: "Связь",
    fields: [
      { key: "wifi", label: "Wi-Fi", type: "boolean" },
      { key: "ethernet", label: "Ethernet", type: "boolean" },
      { key: "usb", label: "USB", type: "boolean" },
      { key: "camera", label: "Камера", type: "boolean" },
      { key: "firmware", label: "Прошивка", type: "text" },
      { key: "moonraker", label: "Moonraker API", type: "boolean" },
      { key: "lan_mode", label: "Работает без облака вендора", type: "boolean" },
    ],
  },
  { key: "materials_supported", label: "Поддерживаемые материалы", kind: "materials_supported" },
  {
    key: "dimensions_mm",
    label: "Габариты",
    fields: [
      { key: "w", label: "Ширина, мм", type: "number" },
      { key: "d", label: "Глубина, мм", type: "number" },
      { key: "h", label: "Высота, мм", type: "number" },
      { key: "weight_kg", label: "Вес, кг", type: "number" },
    ],
  },
  {
    key: "price",
    label: "Цена",
    fields: [
      { key: "msrp_usd", label: "Рекомендованная, USD", type: "number" },
      { key: "ru_rub", label: "Типичная цена РУ-рынка, ₽", type: "number" },
      { key: "ru_updated_at", label: "Цена РУ обновлена", type: "text" },
    ],
  },
  { key: "unique_features", label: "Уникальные особенности", kind: "unique_features" },
];

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function formatFieldValue(field: FieldDef, value: unknown): string {
  if (field.type === "boolean") return value ? "Да" : "Нет";
  if (field.key === "shape") return value === "round" ? "Круглый" : value === "rect" ? "Прямоугольный" : String(value);
  if (field.type === "number" && typeof value === "number") return value.toLocaleString("ru-RU");
  return String(value);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function sourceIndexFor(printer: PrinterRecord, path: string): number | null {
  const entry = printer.field_sources[path];
  if (!entry?.source_url) return null;
  const idx = printer.sources.indexOf(entry.source_url);
  return idx >= 0 ? idx + 1 : null;
}

function gapsForSection(printer: PrinterRecord, sectionKey: string): string[] {
  return printer._meta.gaps.filter((g) => g === sectionKey || g.startsWith(`${sectionKey}.`));
}

export function PrinterDetailScreen({
  user,
  section,
  onSectionChange,
  slug,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (s: Section) => void;
  slug: string;
}) {
  const [printers, setPrinters] = useState<PrinterRecord[] | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const [notifying, setNotifying] = useState(false);
  const sound = useInteractionSound();
  const overlay = useOverlay();
  const compare = useCompareSet();
  const promptGuestLogin = useGuestLogin();
  const isResearcher = user?.role === "researcher";

  useEffect(() => {
    let cancelled = false;
    void listPrinters().then((data) => {
      if (!cancelled) setPrinters(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setHeroIndex(0);
  }, [slug]);

  const printer = printers?.find((p) => p.slug === slug) ?? null;

  useEffect(() => {
    if (!printer) return;
    trackPrinterEvent("printer_card_view", {
      printer_id: printer.id,
      slug: printer.slug,
      source: printerCardViewSource(),
    });
  }, [printer]);

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} />
      </div>
      <main className="homeContent">
        {printers === null ? (
          <div className="prnDetail" aria-hidden="true">
            <div className="prnSkeletonPhoto" style={{ borderRadius: 24 }} />
          </div>
        ) : !printer ? (
          <div className="prnNotFound">
            <EmptyState icon={<NotFoundIcon />} title="Такого принтера у нас пока нет" sub="Возможно, ссылка устарела — поищите в каталоге." />
            <Button variant="secondary" onClick={() => navigate(printersPath())}>
              К каталогу
            </Button>
          </div>
        ) : (
          <PrinterDetailBody
            printer={printer}
            heroIndex={heroIndex}
            setHeroIndex={setHeroIndex}
            isResearcher={isResearcher}
            compareSelected={compare.has(printer.id)}
            onToggleCompare={() => compare.toggle(printer.id)}
            notifying={notifying}
            onNotify={() => {
              if (!user) {
                promptGuestLogin();
                return;
              }
              setNotifying(true);
              sound.success();
              overlay.toast({ severity: "info", title: "Готово", message: "Сообщим, как только появится в продаже." });
            }}
            onClaim={() => {
              if (!user) {
                promptGuestLogin();
                return;
              }
              trackPrinterEvent("printer_card_click_through", { printer_id: printer.id, target: "my_printers" });
              navigate(parkAddPath({ brand: printer.brand, model: printer.model, machineId: printer.id, returnTo: window.location.pathname + window.location.search, source: "catalog" }));
            }}
            onRequestFirmwareAccess={async () => {
              if (!user) {
                promptGuestLogin();
                return;
              }
              const confirmed = await overlay.confirm({
                title: "Запросить доступ к прошивке",
                message: `Прошивка для «${printer.brand} ${printer.model}» приватна и меняет системное ПО принтера — устанавливается только по вашему явному запросу. Продолжить?`,
                confirmLabel: "Запросить доступ",
                cancelLabel: "Отмена",
                destructive: true,
              });
              if (!confirmed) return;
              // Публичного API заявок ещё нет (MF-888, in_review) — заявка фиксируется честно как
              // ручная обработка оператором, не мгновенная автоматика (park/leveltiles.tsx §5, 1:1).
              overlay.toast({ severity: "success", title: "Заявка принята", message: "Мы свяжемся с вами, когда прошивка для этой модели будет готова" });
            }}
          />
        )}
      </main>
    </div>
  );
}

function PrinterDetailBody({
  printer,
  heroIndex,
  setHeroIndex,
  isResearcher,
  compareSelected,
  onToggleCompare,
  notifying,
  onNotify,
  onClaim,
  onRequestFirmwareAccess,
}: {
  printer: PrinterRecord;
  heroIndex: number;
  setHeroIndex: (i: number) => void;
  isResearcher: boolean;
  compareSelected: boolean;
  onToggleCompare: () => void;
  notifying: boolean;
  onNotify: () => void;
  onClaim: () => void;
  onRequestFirmwareAccess: () => void;
}) {
  const sound = useInteractionSound();
  const announced = printer.status === "announced";
  const gallery = [printer.media.hero, ...(printer.media.gallery ?? [])].filter((v): v is string => !!v);
  const heroSrc = gallery[heroIndex] ?? gallery[0] ?? null;
  const todayMs = Date.now();
  const pilot = pilotInfoFor(printer.pilot_status, `${printer.brand} ${printer.model}`);

  return (
    <div className="prnDetail">
      <div className="prnGallery">
        <div className="prnHeroPhoto">
          {heroSrc ? (
            <img key={heroSrc} className="prnHeroPhotoImg" src={heroSrc} alt={`${printer.brand} ${printer.model}`} />
          ) : (
            <div className="prnHeroPlaceholder">
              <PlaceholderIcon />
              <span className="prnTilePlaceholderBrand">{printer.brand}</span>
            </div>
          )}
          <button
            type="button"
            className="prnHeroCompare pressable"
            aria-label={`${compareSelected ? "Убрать" : "Добавить"} ${printer.brand} ${printer.model} ${compareSelected ? "из сравнения" : "к сравнению"}`}
            aria-pressed={compareSelected}
            title={compareSelected ? "Убрать из сравнения" : "Добавить к сравнению"}
            onClick={() => {
              sound.toggle();
              onToggleCompare();
            }}
          >
            <CompareIcon selected={compareSelected} />
          </button>
        </div>
        {gallery.length > 1 ? (
          <div className="prnThumbRow">
            {gallery.map((src, index) => (
              <button key={src + index} type="button" className="prnThumb pressable" data-active={index === heroIndex} onClick={() => setHeroIndex(index)}>
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="prnDetailHead">
        <Heading size="md">
          {printer.brand} {printer.model}
        </Heading>
        <div className="prnDetailBadges">
          <StatusPill tone={STATUS_TONE[printer.status as keyof typeof STATUS_LABEL]} level={printer.status === "shipping" ? 2 : undefined}>
            {STATUS_LABEL[printer.status as keyof typeof STATUS_LABEL]}
          </StatusPill>
          {printer._meta.verified === false ? <StatusPill tone="warn">уточняется</StatusPill> : null}
          <SupportLevelBadge printer={printer} />
        </div>
        <CatalogPilotRow info={pilot} />

        <div className="prnDetailActions">
          {!announced ? (
            <button type="button" className="prnDetailActionLink pressable" onClick={onClaim}>
              Это мой принтер
            </button>
          ) : null}
          {isResearcher ? (
            <button type="button" className="prnResearcherLink pressable" onClick={() => navigate(`/research/${encodeURIComponent(printer.slug)}`)}>
              Дозаполнить карточку →
            </button>
          ) : null}
        </div>

        {announced ? (
          <div className="prnAnnouncedCta">
            <Button variant="primary" disabled={notifying} onPointerDown={sound.confirm} onClick={onNotify}>
              {notifying ? "Вы подписаны" : "Уведомить о выходе"}
            </Button>
          </div>
        ) : (
          <SupportLevelActions printer={printer} onClaim={onClaim} onRequestFirmwareAccess={onRequestFirmwareAccess} />
        )}
      </div>

      {DETAIL_SECTIONS.map((section) => (
        <SpecSection key={section.key} section={section} printer={printer} isResearcher={isResearcher} todayMs={todayMs} />
      ))}

      {printer.sources.length > 0 ? (
        <div className="prnSources">
          <div className="prnSourcesAttribution">
            {printer._meta.filled_by ? <AgentBadge>{printer._meta.filled_by}</AgentBadge> : null}
            <span>обновлено {new Date(printer._meta.updated_at).toLocaleDateString("ru-RU")}</span>
            {printer._meta.verified === false ? <StatusPill tone="warn">уточняется</StatusPill> : null}
          </div>
          <div>Источники</div>
          {printer.sources.map((url, index) => (
            <div key={url} className="prnSourceRow">
              <span>[{index + 1}]</span>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {domainOf(url)} ↗
              </a>
            </div>
          ))}
        </div>
      ) : null}

      <PrinterReferenceLinks printer={printer} />
      <PrinterCommunityTail printer={printer} />
      <section className="prnFeedbackBanner" aria-label="Сообщить о проблеме с карточкой">
        <div>
          <strong>Нашли ошибку?</strong>
          <span>Помогите улучшить карточку принтера.</span>
        </div>
        <ContextFeedbackDoor
          preset="problem"
          className="prnFeedbackDoor"
          context={{
            title: `${printer.brand} ${printer.model}`,
            category: "printer",
            ref: { type: "printer", id: printer.slug, title: `${printer.brand} ${printer.model}` },
          }}
        />
      </section>
    </div>
  );
}

function CatalogPilotRow({ info }: { info: PilotInfo }) {
  const [open, setOpen] = useState(false);
  if (!info.visible) return null;

  return (
    <div className="prnPilotWidget">
      <button
        type="button"
        className="prnPilotRow pressable"
        aria-expanded={open}
        aria-controls="printer-pilot-hint"
        aria-label={info.ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="prnPilotSpark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M13 2 5 14h6l-1 8 9-13h-7l1-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span aria-hidden="true">
          <StatusPill tone={info.tone}>{info.label}</StatusPill>
        </span>
      </button>
      {info.secondLine ? <p className="prnPilotHint" aria-hidden="true">{info.secondLine}</p> : null}
      {open ? <p id="printer-pilot-hint" className="prnPilotHint reveal">{info.hint}</p> : null}
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17 17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Справочник ассистента печатника v1 (MF-494) — статический курируемый список ссылок на
// официальные wiki/knowledge base производителя и совместимых слайсеров, без AI и без свободного
// ввода (AI-диагностика по фото — MF-16, v2). Данные — referencelinks.ts, матчинг по printer.brand.
function PrinterReferenceLinks({ printer }: { printer: PrinterRecord }) {
  const { vendor, slicers } = referenceLinksForBrand(printer.brand);
  if (!vendor) return null;

  return (
    <section className="prnCommunity" aria-labelledby="printer-reference-title">
      <h2 className="prnSectionTitle" id="printer-reference-title">Справочник</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <ActionCard
          key={vendor.url}
          variant="secondary"
          title={vendor.title}
          sub={vendor.description}
          icon={<ExternalIcon />}
          href={vendor.url}
          external
        />
        {slicers.map((slicer) => (
          <ActionCard
            key={slicer.url}
            variant="secondary"
            title={slicer.title}
            sub={slicer.description}
            icon={<ExternalIcon />}
            href={slicer.url}
            external
          />
        ))}
      </div>
    </section>
  );
}

function PrinterCommunityTail({ printer }: { printer: PrinterRecord }) {
  // Публичный API привязки сообщества и проектов к модели ещё не входит в контракт карточки.
  // До его появления показываем компактный preview-фолбэк той же формы, чтобы хвост не исчезал.
  return (
    <>
      <section className="prnCommunity" aria-labelledby="printer-community-title">
        <h2 className="prnSectionTitle" id="printer-community-title">Обсуждение</h2>
        <div className="prnCommunityPosts">
          {PRINTER_COMMUNITY_PREVIEWS.map((post) => (
            <button type="button" className="prnCommunityPost pressable" key={post.id} onClick={() => navigate(threadPath(post.id))}>
              <span>{post.title}</span>
              <span className="prnCommunityMeta">{post.author} · {post.age}</span>
            </button>
          ))}
        </div>
        <button type="button" className="prnDetailActionLink pressable" onClick={() => {
          trackPrinterEvent("printer_card_click_through", { printer_id: printer.id, target: "community" });
          navigate(`/community/printer-${encodeURIComponent(printer.slug)}`);
        }}>
          Открыть сообщество →
        </button>
      </section>
      <section className="prnCommunity" aria-labelledby="printer-projects-title">
        <h2 className="prnSectionTitle" id="printer-projects-title">Что на нём печатают</h2>
        <div className="prnPrintedModels">
          {PRINTED_PROJECT_PREVIEW.map((model) => <span className="prnModelChip" key={model}>{model}</span>)}
        </div>
        <button type="button" className="prnDetailActionLink pressable" onClick={() => {
          trackPrinterEvent("printer_card_click_through", { printer_id: printer.id, target: "project" });
          navigate(`/project?printer=${encodeURIComponent(printer.slug)}`);
        }}>
          Смотреть все проекты →
        </button>
      </section>
    </>
  );
}

// Бейдж support_level (docs/design/printer.face.md §1) — единственный словарь тонов для
// list/managed/custom, каталог не изобретает второй. `custom` c firmware_ready=false падает на
// обычный StatusPill dim «Custom: скоро» (§1.2 модификатор «не готово»), не рисует FlagshipBadge.
function SupportLevelBadge({ printer }: { printer: PrinterRecord }) {
  const level = supportPresentationFor(printer.support_level, printer.firmware_ready);
  if (level === "unknown") return <StatusPill tone="dim">Поддержка уточняется</StatusPill>;
  if (level === "custom-soon") return <StatusPill tone="dim">Custom: скоро</StatusPill>;
  if (level === "custom") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <FlagshipBadge>{SUPPORT_LEVEL_LABEL.custom}</FlagshipBadge>
        {!printer.firmware_public ? <span className="uiActionCardSub">доступ по запросу</span> : null}
      </span>
    );
  }
  return (
    <StatusPill tone={SUPPORT_LEVEL_TONE[level]} level={SUPPORT_LEVEL_LEVEL[level]}>
      {SUPPORT_LEVEL_LABEL[level]}
    </StatusPill>
  );
}

// Действия по уровню поддержки (docs/epics/printer.support.md §235-237, MF-892): на поддержанном
// (managed/custom) — «Управлять»/«Поставить прошивку»; на неподдержанном (list) — два выхода
// «Сделать самому»/«Прошивки сообщества» (printer.wizard.md §5, роуты уже заведены в MF-903).
function SupportLevelActions({
  printer,
  onClaim,
  onRequestFirmwareAccess,
}: {
  printer: PrinterRecord;
  onClaim: () => void;
  onRequestFirmwareAccess: () => void;
}) {
  const level = supportPresentationFor(printer.support_level, printer.firmware_ready);

  if (level === "managed") {
    const isLanOnly = printer.connector_type === "moonraker" || printer.connector_type === "prusa-link" || printer.connector_type === "octoprint";
    return (
      <div className="prnAnnouncedCta">
        <p className="prnManagedConnection">{isLanOnly ? "Локально, в вашей сети" : "Режим подключения уточняется"}</p>
        <Button variant="primary" onClick={onClaim}>
          Добавить в парк
        </Button>
      </div>
    );
  }

  if (level === "custom") {
    return (
      <div className="prnAnnouncedCta">
        <Button variant="primary" onClick={onRequestFirmwareAccess}>
          Поставить прошивку
        </Button>
      </div>
    );
  }

  return (
    <div className="prnSupportExits">
      <ActionCard
        className="prnSupportExitCard"
        title="Сделать самому"
        sub="Публичный API портала — напишите свою интеграцию поверх Moonraker"
        icon={<ChevronIcon />}
        onClick={() => navigate(printerDiyPath(printer.slug))}
      />
      <ActionCard
        className="prnSupportExitCard"
        title="Прошивки сообщества"
        sub="Адаптации других пользователей на GitVerse"
        icon={<ChevronIcon />}
        onClick={() => navigate(printerCommunityFirmwarePath(printer.slug))}
      />
    </div>
  );
}

function SpecSection({
  section,
  printer,
  isResearcher,
  todayMs,
}: {
  section: DetailSection;
  printer: PrinterRecord;
  isResearcher: boolean;
  todayMs: number;
}) {
  const gaps = gapsForSection(printer, section.key);

  if (section.kind === "toolhead_extras") {
    const items = printer.toolhead_extras;
    if (items.length === 0 && gaps.length === 0) return null;
    return (
      <SectionShell label={section.label} sectionKey={section.key} isResearcher={isResearcher} gapNote={items.length === 0 ? "не заполнено" : null}>
        {items.map((item, index) => (
          <div key={index} className="prnSpecRow">
            <span className="prnSpecLabel">{TOOLHEAD_KIND_OPTIONS.find((o) => o.value === item.kind)?.label ?? item.kind}</span>
            <span>{item.spec}</span>
          </div>
        ))}
      </SectionShell>
    );
  }

  if (section.kind === "materials_supported") {
    const values = printer.materials_supported;
    if (values.length === 0 && gaps.length === 0) return null;
    return (
      <SectionShell label={section.label} sectionKey={section.key} isResearcher={isResearcher} gapNote={values.length === 0 ? "не заполнено" : null}>
        {values.length > 0 ? <div className="prnSpecRow">{values.join(", ")}</div> : null}
      </SectionShell>
    );
  }

  if (section.kind === "unique_features") {
    const values = printer.unique_features;
    if (values.length === 0 && gaps.length === 0) return null;
    return (
      <SectionShell label={section.label} sectionKey={section.key} isResearcher={isResearcher} gapNote={values.length === 0 ? "не заполнено" : null}>
        {values.map((v) => (
          <div key={v} className="prnSpecRow">
            {v}
          </div>
        ))}
      </SectionShell>
    );
  }

  const fields = section.fields ?? [];
  const sectionData = get(printer, section.key);
  const filled = fields.filter((f) => isFilled(get(sectionData, f.key)));
  const unfilled = fields.filter((f) => !isFilled(get(sectionData, f.key)));
  if (filled.length === 0 && gaps.length === 0) return null;

  return (
    <SectionShell
      label={section.label}
      sectionKey={section.key}
      isResearcher={isResearcher}
      gapNote={unfilled.length > 0 ? unfilled.map((f) => f.label).join(", ") : null}
    >
      {filled.map((field) => {
        const path = `${section.key}.${field.key}`;
        const value = get(sectionData, field.key);
        const footnote = sourceIndexFor(printer, path);
        const stale = section.key === "price" && field.key === "ru_rub" && isStalePrice(printer, todayMs);
        return (
          <div key={field.key} className="prnSpecRow">
            <span className="prnSpecLabel">{field.label}</span>
            <span>
              {formatFieldValue(field, value)}
              {stale && sectionData && typeof sectionData === "object" && (sectionData as Record<string, unknown>).ru_updated_at ? (
                <span className="prnSpecFootnote"> · {new Date((sectionData as Record<string, unknown>).ru_updated_at as string).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</span>
              ) : null}
              {footnote ? <sup className="prnSpecFootnote">[{footnote}]</sup> : null}
            </span>
          </div>
        );
      })}
    </SectionShell>
  );
}

function SectionShell({
  label,
  sectionKey,
  isResearcher,
  gapNote,
  children,
}: {
  label: string;
  sectionKey: string;
  isResearcher: boolean;
  gapNote: string | null;
  children: ReactNode;
}) {
  return (
    <div className="prnSection">
      <div className="prnSectionTitle">{label}</div>
      {children}
      {gapNote ? (
        <div className="prnSectionGap">
          <span>Не заполнено: {gapNote}</span>
          {isResearcher ? (
            <button type="button" className="prnSectionGapResearch" onClick={() => navigate(`/research?facet=${encodeURIComponent(sectionKey)}`)}>
              Дозаполнить →
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlaceholderIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-5A1.5 1.5 0 0 1 4.5 10h15A1.5 1.5 0 0 1 21 11.5v5a1.5 1.5 0 0 1-1.5 1.5H18M6 18v3h12v-3M6 18h12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CompareIcon({ selected }: { selected: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {selected ? <path d="m7 12 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function NotFoundIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="m20 20-4-4M8.5 8.5l5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
