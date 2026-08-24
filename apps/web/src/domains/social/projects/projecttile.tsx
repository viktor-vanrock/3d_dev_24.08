import { useInteractionSound } from "@platform/sound";
import { modelPath, navigate } from "../../../router.ts";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import type { MarketModel } from "@domains/commerce";
import { relativeDate, hueFromId } from "@shared/lib";
import { apiAssetUrl } from "@shared/api";
import { ProgressiveImage } from "@shared/ui";
import { projectSummary } from "./projecttile.utils.ts";

const FORMAT_LABELS: Record<string, string> = {
  "3mf": "3MF",
  stl: "STL",
  obj: "OBJ",
  step: "STEP",
  dxf: "DXF",
  svg: "SVG",
  gcode: "G-code",
  gerber: "Gerber",
  zip: "Архив",
};

const CRAFT_LABELS: Record<string, string> = {
  "3d_printing": "3D-печать",
  cnc: "ЧПУ",
  laser: "Лазер",
  electronics: "Электроника",
  software: "Код",
  woodworking: "Дерево",
  metalworking: "Металл",
};

export function ProjectTile({ model, index, mine }: { model: MarketModel; index: number; mine: boolean }) {
  const sound = useInteractionSound();
  const openProject = () => navigate(modelPath(model.id));
  const price =
    (model.price_minor ?? 0) > 0
      ? new Intl.NumberFormat("ru-RU", {
          style: "currency",
          currency: model.currency ?? "RUB",
          maximumFractionDigits: 0,
        }).format((model.price_minor ?? 0) / 100)
      : "Открытый проект";
  const tags = model.tags.slice(0, 3);

  return (
    <article
      className="projectTile pressable"
      style={{ ["--i" as string]: index, ["--project-hue" as string]: hueFromId(model.id) }}
      data-mine={mine || undefined}
      role="link"
      tabIndex={0}
      onPointerDown={sound.tick}
      onClick={openProject}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProject();
        }
      }}
    >
      <div className="projectTileCover">
        <ProgressiveImage
          className="projectTileMedia"
          src={model.thumb_url ? apiAssetUrl(model.thumb_url) : null}
          alt={`Превью проекта «${model.title}»`}
          fallback={<ProjectCoverFallback />}
        />
        <div className="projectTileCoverShade" aria-hidden="true" />
        <div className="projectTileCoverBadges">
          <span>{CRAFT_LABELS[model.craft] ?? "Проект"}</span>
          <span>{FORMAT_LABELS[model.source_format] ?? model.source_format.toUpperCase()}</span>
        </div>
        {mine ? <span className="projectTileMine">Ваш проект</span> : null}
      </div>

      <div className="projectTileBody">
        <div className="projectTileByline">
          <span className="projectTileAuthor">@{model.owner.username}</span>
          <span aria-hidden="true">·</span>
          <span>{relativeDate(model.created_at)}</span>
        </div>

        <h2>{model.title}</h2>
        <p className="projectTileSummary">{projectSummary(model.description)}</p>

        {tags.length > 0 ? (
          <ul className="projectTileTags" aria-label="Теги проекта">
            {tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        ) : null}

        <div className="projectTileFooter">
          <span className="projectTilePrice">{price}</span>
          <span className="projectTileStats" aria-label={`Рейтинг ${model.votes_up - model.votes_down}, загрузок ${model.downloads_count}`}>
            <span>
              <ArrowUpIcon /> {model.votes_up - model.votes_down}
            </span>
            <span>
              <DownloadIcon /> {model.downloads_count}
            </span>
          </span>
          <span className="projectTileOpen" aria-hidden="true">
            Открыть <ArrowRightIcon />
          </span>
        </div>
      </div>
    </article>
  );
}

function ProjectCoverFallback() {
  return (
    <div className="projectTileFallback" aria-label="Превью проекта готовится">
      <span className="projectTileFallbackPrint">
        <CubeIcon />
      </span>
      <span className="projectTileFallbackPart">
        <NutIcon />
      </span>
      <span className="projectTileFallbackGuide">
        <GuideIcon />
      </span>
      <span className="projectTileFallbackLine projectTileFallbackLine--one" />
      <span className="projectTileFallbackLine projectTileFallbackLine--two" />
      <span className="projectTileFallbackLabel">превью готовится</span>
    </div>
  );
}

function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function NutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7.1 5.6 4.9-2.8 4.9 2.8 2.8 4.9v3l-2.8 4.9-4.9 2.8-4.9-2.8-2.8-4.9v-3l2.8-4.9Z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GuideIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 4.5h9.5L19 8v11.5H6v-15Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15 4.5V8h4M9 12h7M9 15.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.5 7.5 3.5-3.5 3.5 3.5M8 4v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v7m0 0 3-3m-3 3-3-3M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
