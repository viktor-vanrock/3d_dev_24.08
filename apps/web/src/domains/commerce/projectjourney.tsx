import type { ModelDetail } from "./models.ts";
import type { ProjectBuildGuide, ProjectBuildStep } from "./buildguide.ts";
import { MarkdownBody } from "./markdown.tsx";
import { apiAssetUrl } from "@shared/api";
import "./projectjourney.css";

export type ManufacturingMode = "assembly" | "fdm" | "ams" | "sla" | "cnc";

interface JourneyTemplate {
  label: string;
  title: string;
  summary: string;
  requirements: string[];
  steps: Array<{ title: string; body: string }>;
}

const JOURNEYS: Record<Exclude<ManufacturingMode, "assembly">, JourneyTemplate> = {
  fdm: {
    label: "Только печать · FDM",
    title: "От файла до готовой детали",
    summary: "Проект не требует отдельной сборки: подготовьте материал, напечатайте и проверьте результат.",
    requirements: ["1 принтер", "1 материал", "без сборки"],
    steps: [
      { title: "Подготовить", body: "Скачайте файл, проверьте габариты и выберите профиль материала." },
      { title: "Напечатать", body: "Разместите деталь на столе, запустите печать и следите за первым слоем." },
      { title: "Довести", body: "Снимите поддержки, обработайте края и проверьте посадочные размеры." },
    ],
  },
  ams: {
    label: "Многоцвет · AMS",
    title: "Соберите палитру и напечатайте",
    summary: "Цвета — часть проекта. Перед стартом сопоставьте материалы слотам AMS и проверьте продувку.",
    requirements: ["AMS", "2+ материала", "карта цветов"],
    steps: [
      { title: "Подобрать цвета", body: "Подготовьте катушки нужных цветов и проверьте совместимость материалов." },
      { title: "Назначить слоты", body: "Сопоставьте цвета модели слотам AMS и оцените объём продувки." },
      { title: "Напечатать", body: "Запустите многоцветную печать и проверьте первые смены материала." },
      { title: "Проверить", body: "Оцените чистоту переходов, поверхность и точность сборочных мест." },
    ],
  },
  sla: {
    label: "Смоляная печать · SLA",
    title: "Напечатайте, промойте и засветите",
    summary: "Для смоляной печати результат появляется после полного постпроцесса, а не в момент схода со стола.",
    requirements: ["SLA/MSLA", "смола", "мойка и засветка"],
    steps: [
      { title: "Подготовить", body: "Выберите смолу, ориентацию, полые области и расставьте поддержки." },
      { title: "Напечатать", body: "Проверьте ванну и платформу, затем запустите печать в перчатках." },
      { title: "Промыть", body: "Удалите остатки смолы, снимите поддержки и дайте детали высохнуть." },
      { title: "Засветить", body: "Проведите финальную полимеризацию и только после неё оценивайте размеры." },
    ],
  },
  cnc: {
    label: "Обработка · ЧПУ",
    title: "От заготовки до обработанной детали",
    summary: "Здесь важны не только файлы, но и заготовка, инструмент, базирование и порядок операций.",
    requirements: ["станок ЧПУ", "заготовка", "инструмент"],
    steps: [
      { title: "Подготовить заготовку", body: "Сверьте материал, припуски и способ крепления." },
      { title: "Проверить траектории", body: "Откройте управляющую программу и проверьте ноль, инструмент и безопасные высоты." },
      { title: "Обработать", body: "Выполните операции в указанном порядке и контролируйте стружку и охлаждение." },
      { title: "Финиш", body: "Снимите заусенцы, промойте деталь и проверьте критические размеры." },
    ],
  },
};

function normalizedTags(model: Pick<ModelDetail, "tags">): string[] {
  return model.tags.map((tag) => tag.toLocaleLowerCase("ru-RU"));
}

export function manufacturingModeFor(
  model: Pick<ModelDetail, "craft" | "source_format" | "tags">,
  guide: ProjectBuildGuide | null,
): ManufacturingMode {
  if (guide?.steps.length) return "assembly";
  const tags = normalizedTags(model);
  const has = (...needles: string[]) => tags.some((tag) => needles.some((needle) => tag.includes(needle)));
  if (has("sla", "msla", "resin", "смол")) return "sla";
  if (has("ams", "multicolor", "multi-color", "многоцвет")) return "ams";
  if (model.craft === "cnc" || has("чпу", "cnc") || model.source_format === "gcode") return "cnc";
  return "fdm";
}

type SupplyKind = "print" | "buy" | "tool" | "code" | "assembly" | "check";

interface SupplyItem {
  name: string;
  quantity: string | null;
  kind: SupplyKind;
}

function supplyItems(value: unknown, fallbackKind: SupplyKind): SupplyItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        const name = item.trim();
        return name ? { name, quantity: null, kind: fallbackKind } : null;
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      let name = "";
      for (const key of ["name", "title", "label"]) {
        if (typeof record[key] === "string") {
          name = record[key].trim();
          break;
        }
      }
      if (!name) return null;
      const rawKind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
      const kind: SupplyKind =
        rawKind === "print" || rawKind === "buy" || rawKind === "tool" || rawKind === "code"
          ? rawKind
          : fallbackKind;
      const quantity =
        typeof record.quantity === "string" || typeof record.quantity === "number"
          ? String(record.quantity).trim()
          : null;
      return { name, quantity: quantity || null, kind };
    })
    .filter((item): item is SupplyItem => item !== null);
}

function phaseFor(step: ProjectBuildStep): { kind: SupplyKind; label: string } {
  const title = step.title.toLocaleLowerCase("ru-RU");
  if (title.includes("печат")) return { kind: "print", label: "Печать" };
  if (title.includes("комплект") || title.includes("куп")) return { kind: "buy", label: "Комплект" };
  if (title.includes("код") || title.includes("прошив")) return { kind: "code", label: "Код" };
  if (title.includes("калибр") || title.includes("провер")) return { kind: "check", label: "Проверка" };
  return { kind: "assembly", label: "Сборка" };
}

function uniqueSupplies(items: SupplyItem[]): SupplyItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.name.toLocaleLowerCase("ru-RU")}:${item.quantity ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function StepExtras({ step }: { step: ProjectBuildStep }) {
  const parts = supplyItems(step.parts, "buy");
  const tools = supplyItems(step.tools, "tool");
  if (parts.length === 0 && tools.length === 0) return null;
  return (
    <div className="projectJourneyStepExtras">
      {parts.map((part) => (
        <span key={`part-${part.name}-${part.quantity ?? ""}`} data-kind={part.kind}>
          {part.name}
          {part.quantity ? <small>{part.quantity}</small> : null}
        </span>
      ))}
      {tools.map((tool) => (
        <span key={`tool-${tool.name}-${tool.quantity ?? ""}`} data-kind="tool">
          {tool.name}
          {tool.quantity ? <small>{tool.quantity}</small> : null}
        </span>
      ))}
    </div>
  );
}

export function ProjectJourney({ model, guide }: { model: ModelDetail; guide: ProjectBuildGuide | null }) {
  const mode = manufacturingModeFor(model, guide);
  const customSteps = mode === "assembly" ? guide?.steps ?? [] : [];
  const template = mode === "assembly" ? null : JOURNEYS[mode];
  const projectSupplies =
    customSteps.length > 0
      ? uniqueSupplies(
          customSteps.flatMap((step) => [
            ...supplyItems(step.parts, "buy"),
            ...supplyItems(step.tools, "tool"),
          ]),
        )
      : [];
  const supplyGroups = [
    {
      kind: "print" as const,
      label: "Напечатать",
      hint: "Детали из файлов проекта",
      items: projectSupplies.filter((item) => item.kind === "print"),
      photo:
        customSteps.find((step) => phaseFor(step).kind === "print" && step.photos.length > 0)?.photos[0] ??
        customSteps.find((step) => step.photos.length > 0)?.photos[0],
    },
    {
      kind: "buy" as const,
      label: "Купить",
      hint: "Готовые компоненты",
      items: projectSupplies.filter((item) => item.kind === "buy"),
      photo:
        customSteps.find(
          (step) =>
            (phaseFor(step).kind === "buy" || step.title.toLocaleLowerCase("ru-RU").includes("выбрать")) &&
            step.photos.length > 0,
        )?.photos[0] ?? customSteps.find((step) => step.photos.length > 0)?.photos[0],
    },
    {
      kind: "tool" as const,
      label: "Инструменты",
      hint: "Что понадобится на столе",
      items: projectSupplies.filter((item) => item.kind === "tool"),
      photo:
        customSteps.find(
          (step) =>
            (step.title.toLocaleLowerCase("ru-RU").includes("собрать") ||
              step.title.toLocaleLowerCase("ru-RU").includes("зрение")) &&
            step.photos.length > 0,
        )?.photos[0] ?? customSteps.find((step) => step.photos.length > 0)?.photos[0],
    },
  ].filter((group) => group.items.length > 0);

  return (
    <section className="projectJourney" aria-label="Как сделать проект">
      <header className="projectJourneyHead">
        <div>
          <span className="projectJourneyEyebrow">{mode === "assembly" ? "Сборка по шагам" : template!.label}</span>
          <h2>{mode === "assembly" ? "Соберите проект целиком" : template!.title}</h2>
          <p>
            {mode === "assembly"
              ? "Автор разложил результат на детали, инструменты и последовательность действий."
              : template!.summary}
          </p>
        </div>
        <div className="projectJourneyRequirements" aria-label="Что понадобится">
          {(mode === "assembly"
            ? [
                `${customSteps.length} ${customSteps.length === 1 ? "шаг" : "шагов"}`,
                "фото и детали",
                "контроль сборки",
              ]
            : template!.requirements
          ).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </header>

      {supplyGroups.length > 0 ? (
        <div className="projectJourneySupplyGrid" aria-label="Комплект проекта">
          {supplyGroups.map((group) => (
            <section key={group.kind} className="projectJourneySupply" data-kind={group.kind}>
              {group.photo ? (
                <div className="projectJourneySupplyMedia">
                  <img src={apiAssetUrl(group.photo.url)} alt="" loading="lazy" />
                </div>
              ) : null}
              <div className="projectJourneySupplyBody">
                <header>
                  <span>{group.label}</span>
                  <small>{group.hint}</small>
                </header>
                <ul>
                  {group.items.map((item) => (
                    <li key={`${item.name}-${item.quantity ?? ""}`}>
                      <span>{item.name}</span>
                      {item.quantity ? <strong>{item.quantity}</strong> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      ) : null}

      <ol className="projectJourneySteps" data-custom={customSteps.length > 0 || undefined}>
        {(customSteps.length > 0 ? customSteps : template!.steps).map((step, index) => {
          const custom = "id" in step;
          const phase = custom ? phaseFor(step) : null;
          return (
            <li key={custom ? step.id : step.title} className="projectJourneyStep">
              {custom && step.photos.length > 0 ? (
                <div className="projectJourneyPhotos" aria-label={`Фотографии шага «${step.title}»`}>
                  {step.photos.map((photo) => (
                    <img key={photo.id} src={apiAssetUrl(photo.url)} alt="" loading="lazy" />
                  ))}
                </div>
              ) : (
                <div className="projectJourneyStepVisual" aria-hidden="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <small>{phase?.label ?? "Шаг проекта"}</small>
                </div>
              )}
              <div className="projectJourneyStepContent">
                <div className="projectJourneyStepTop">
                  <span className="projectJourneyStepNumber">{String(index + 1).padStart(2, "0")}</span>
                  {phase ? (
                    <span className="projectJourneyPhase" data-kind={phase.kind}>
                      {phase.label}
                    </span>
                  ) : null}
                </div>
                <div className="projectJourneyStepCopy">
                  <h3>{step.title}</h3>
                  {custom && step.body ? <MarkdownBody source={step.body} /> : <p>{custom ? "Шаг без текстового описания." : step.body}</p>}
                  {custom ? <StepExtras step={step} /> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
