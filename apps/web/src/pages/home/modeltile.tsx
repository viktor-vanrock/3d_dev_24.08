import { useState } from "react";
import type { MarketModel } from "@domains/commerce";
import { apiAssetUrl } from "@shared/api";
import { modelPath, navigate } from "../../router.ts";
import { useInteractionSound } from "@platform/sound";

// Плитка модели каталога (docs/design/model-preview.md § «Псевдо-3D превью») — общий
// рендер для галереи популярного (home.tsx), модуля совместимости и ленты автора
// (Фаза 3, MF-438): один и тот же слоёный стек (нейтральный product-shot → фото/глиф → тень), реальные
// данные MF-11 вместо мока. Вынесено сюда, чтобы три модуля дома не копипастили разметку.

// Стабильный «оттенок» тайла по id модели — заменяет ручной hue мока: детерминирован
// (одна модель = один цвет между рендерами), не требует поля на сервере.
function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function CubeGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 0v18M4 7l8 4 8-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Главная — витрина, а не реестр незавершённых импортов. Ready-запись без
// thumbnail выглядит как пустая страница с кубом-заглушкой; строка без файлов
// вообще не подтверждает существование печатаемого результата. Такие записи
// остаются доступны владельцу и в профильных разделах, но в магическую ленту
// попадают только проекты с реальной моделью и готовым product-shot.
export function isShowcaseModel(model: MarketModel): boolean {
  return Boolean(model.thumb_url) && model.project_summary.file_count > 0;
}

export function ModelTileButton({
  model,
  index = 0,
  onOpen,
  hideBrokenPreview = false,
}: {
  model: MarketModel;
  index?: number;
  onOpen?: (model: MarketModel, index: number) => void;
  hideBrokenPreview?: boolean;
}) {
  const sound = useInteractionSound();
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  if (hideBrokenPreview && (!isShowcaseModel(model) || thumbnailFailed)) return null;

  return (
    <button
      type="button"
      className="homeModelTile pressable"
      style={{ ["--i" as string]: index % 6 }}
      onPointerDown={sound.tick}
      onClick={() => {
        onOpen?.(model, index);
        navigate(modelPath(model.id));
      }}
    >
      <span className="homeModelThumb" style={{ ["--tile-hue" as string]: hueFromId(model.id) }}>
        {model.thumb_url ? (
          <span className="homeModelArt homeModelArt--photo">
            <img
              className="homeModelPhoto"
              src={apiAssetUrl(model.thumb_url)}
              alt=""
              loading="lazy"
              onError={() => {
                if (hideBrokenPreview) setThumbnailFailed(true);
              }}
            />
          </span>
        ) : (
          <span className="homeModelArt">
            <span className="homeModelLayer homeModelLayerBack" aria-hidden="true">
              <CubeGlyph />
            </span>
            <span className="homeModelLayer homeModelLayerFront">
              <CubeGlyph />
            </span>
          </span>
        )}
        <span className="homeModelShadow" aria-hidden="true" />
      </span>
      <span className="homeModelMeta">
        <span className="homeModelName">{model.title}</span>
        <span className="homeModelSub">
          @{model.owner.username} · ♥ {model.votes_up}
        </span>
      </span>
    </button>
  );
}

export function ModelTileGrid({
  models,
  onOpen,
}: {
  models: MarketModel[];
  onOpen?: (model: MarketModel, index: number) => void;
}) {
  return (
    <div className="homeGallery">
      {models.map((model, index) => (
        <ModelTileButton key={model.id} model={model} index={index} onOpen={onOpen} />
      ))}
    </div>
  );
}
