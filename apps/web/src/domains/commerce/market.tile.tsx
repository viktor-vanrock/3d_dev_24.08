import { useInteractionSound } from "@platform/sound";
import { modelPath, navigate, profilePath } from "../../router.ts";
import { CubeIcon, StatusPill } from "@shared/ui";
import { CraftBadge } from "./craft.tsx";
import type { MarketModel } from "./models.ts";
import { relativeDate, STATUS_META } from "./market.tsx";
import { hueFromId } from "@shared/lib";
import { apiAssetUrl } from "@shared/api";

// Плитка каталога (MF-911: вынесена из market.tsx) — переиспользуется каталогом, профилем
// автора (profile.tsx) и «Проектами» (projects/projectspage.tsx).

// hueFromId (детерминированный «оттенок» из id) вынесен в shared/lib (микроэтап 7.6) —
// им пользуется и social (плитки проектов). Реэкспорт сохраняет импорты внутри commerce.
export { hueFromId };

export function ModelTile({ model, index, mine }: { model: MarketModel; index: number; mine: boolean }) {
  const meta = STATUS_META[model.status];
  const sound = useInteractionSound();
  return (
    <div
      className="homeModelTile pressable"
      style={{ ["--i" as string]: index, ["--tile-hue" as string]: hueFromId(model.id) }}
      data-mine={(mine && model.status === "ready") || undefined}
      onPointerDown={sound.tick}
      onClick={() => navigate(modelPath(model.id))}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") navigate(modelPath(model.id));
      }}
    >
      <span className="homeModelThumb">
        <span className="homeModelGlow" aria-hidden="true" />
        <span className={`homeModelArt${model.thumb_url ? " homeModelArt--photo" : ""}`}>
          <span className="homeModelLayer homeModelLayerBack" aria-hidden="true">
            {model.thumb_url ? <img className="homeModelPhoto" src={apiAssetUrl(model.thumb_url)} alt="" /> : <CubeIcon />}
          </span>
          <span className="homeModelLayer homeModelLayerFront">
            {model.thumb_url ? <img className="homeModelPhoto" src={apiAssetUrl(model.thumb_url)} alt="" /> : <CubeIcon />}
          </span>
        </span>
        <span className="homeModelShadow" aria-hidden="true" />
        {/* Craft-бейдж в углу превью (docs/design/projects.md §2.3): компактный глиф-only,
            наложка поверх слоёного стека; скрыт на моно-ремесле (весь MVP-печать). */}
        <span className="marketTileCraft">
          <CraftBadge craft={model.craft} compact />
        </span>
      </span>
      <span className="homeModelMeta">
        <span className="homeModelName">{model.title}</span>
        <span className="marketTilePrice">{(model.price_minor ?? 0) > 0 ? formatTilePrice(model.price_minor!, model.currency ?? "RUB") : "Бесплатно"}</span>
        <span
          className="homeModelSub marketTileAuthor pressable"
          aria-label={`Автор: ${model.owner.username}`}
          title={`@${model.owner.username}`}
          onClick={(event) => {
            event.stopPropagation();
            navigate(profilePath(model.owner.username));
          }}
        >
          @{model.owner.username}
        </span>
        {meta ? (
          <span className="marketTileStatus">
            <StatusPill tone={meta.tone} pulse={meta.pulse}>
              {meta.label}
            </StatusPill>
          </span>
        ) : (
          <span className="marketTileMeta">
            <span>Голосов: {model.votes_up - model.votes_down}</span>
            <span>Загрузок: {model.downloads_count}</span>
            <span>{relativeDate(model.created_at)}</span>
          </span>
        )}
      </span>
    </div>
  );
}

function formatTilePrice(minor: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}
