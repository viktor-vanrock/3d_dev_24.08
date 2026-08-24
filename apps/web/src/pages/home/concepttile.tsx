import { useEffect, useRef, useState, type CSSProperties } from "react";
import { apiAssetUrl } from "@domains/ai";
import type { FlowConcept } from "./conceptflow.ts";
import {
  displayConceptDescription,
  type PromptConceptMotif,
} from "./promptconcepts.ts";

const MOTIF_HUE: Record<PromptConceptMotif, number> = {
  figure: 164,
  articulated: 195,
  functional: 38,
  decor: 326,
};

function formatRemaining(seconds: number | null): string {
  if (seconds === null) return "—:—";
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function ConceptTile({
  concept,
  index,
  onSelect,
  onVisibilityChange,
}: {
  concept: FlowConcept;
  index: number;
  onSelect: (concept: FlowConcept) => void;
  onVisibilityChange: (
    conceptId: string,
    visible: boolean,
    position?: { left: number; top: number },
  ) => void;
}) {
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const tileRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const loaded = concept.previewUrl !== null && loadedPreviewUrl === concept.previewUrl;
  useEffect(() => {
    const image = imageRef.current;
    if (concept.previewUrl && image?.complete && image.naturalWidth > 0) {
      setLoadedPreviewUrl(concept.previewUrl);
    }
  }, [concept.previewUrl]);
  useEffect(() => {
    if (concept.state !== "queued") return;
    const tile = tileRef.current;
    if (!tile) return;
    if (typeof IntersectionObserver === "undefined") {
      onVisibilityChange(concept.id, true);
      return () => onVisibilityChange(concept.id, false);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.15,
        );
        const visibleEntry = entries.find(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.15,
        );
        onVisibilityChange(
          concept.id,
          visible,
          visibleEntry
            ? {
                left: visibleEntry.boundingClientRect.left,
                top: visibleEntry.boundingClientRect.top,
              }
            : undefined,
        );
      },
      { threshold: [0, 0.15] },
    );
    observer.observe(tile);
    return () => {
      observer.disconnect();
      onVisibilityChange(concept.id, false);
    };
  }, [concept.id, concept.state, onVisibilityChange]);

  const style = {
    ["--concept-hue" as string]: MOTIF_HUE[concept.motif],
    // Лента бесконечная: глобальный index сделал бы задержку появления всё длиннее.
    // Шесть позиций повторяют короткую хореографию каждого нового батча слева направо.
    ["--i" as string]: index % 6,
  } as CSSProperties;
  const active3d =
    concept.trellisStatus === "starting" ||
    concept.trellisStatus === "queued" ||
    concept.trellisStatus === "running";
  useEffect(() => {
    if (!active3d || concept.trellisEtaSeconds === null || concept.trellisEstimateAt === null) return;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active3d, concept.trellisEstimateAt, concept.trellisEtaSeconds]);
  const remaining =
    concept.trellisEtaSeconds === null || concept.trellisEstimateAt === null
      ? null
      : concept.trellisEtaSeconds -
        Math.max(0, Math.floor((clock - concept.trellisEstimateAt) / 1_000));

  if (concept.state !== "ready" || !concept.previewUrl) {
    const generating = concept.state === "generating";
    const queued = concept.state === "queued";
    return (
      <div
        ref={(node) => {
          tileRef.current = node;
        }}
        className={`homeConceptTile homeConceptTile--skeleton${queued ? " homeConceptTile--queued" : ""}${generating ? " homeConceptTile--generating" : ""}${concept.arrival === "prompt" ? " homeConceptTile--prompt-enter" : ""}${concept.state === "failed" ? " homeConceptTile--failed" : ""}`}
        style={style}
        aria-hidden="true"
      >
        <span className="homeConceptVisual">
          {queued ? (
            <span className="homeConceptQueueCue">
              <span className="homeConceptQueueDots">
                <i />
                <i />
                <i />
              </span>
              В очереди
            </span>
          ) : generating ? (
            <span className="homeConceptGenerationCue">
              <i />
              Создаём изображение
            </span>
          ) : null}
        </span>
        <span className="homeConceptMeta">
          <strong>{concept.label}</strong>
          <span className="homeConceptDescription">{displayConceptDescription(concept.prompt)}</span>
        </span>
      </div>
    );
  }

  return (
    <button
      ref={(node) => {
        tileRef.current = node;
      }}
      type="button"
      className={`homeConceptTile homeConceptTile--ready pressable${concept.arrival === "image" ? " homeConceptTile--image-enter" : ""}`}
      style={style}
      aria-label={`Создать 3D: ${concept.label}`}
      aria-busy={active3d || undefined}
      onClick={() => onSelect(concept)}
    >
      <span className="homeConceptVisual" data-loaded={loaded || undefined}>
        <img
          ref={imageRef}
          src={apiAssetUrl(concept.previewUrl)}
          alt=""
          data-loaded={loaded || undefined}
          onLoad={() => setLoadedPreviewUrl(concept.previewUrl)}
        />
        {active3d ? (
          <span
            className="homeConceptTrellisProgress"
            role="progressbar"
            aria-label={`До конца генерации ${formatRemaining(remaining)}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={concept.trellisProgress === null ? undefined : Math.round(concept.trellisProgress)}
          >
            <span className="homeConceptTrellisActivity" aria-hidden="true" />
            <time
              className="homeConceptTrellisEta"
              dateTime={remaining === null ? undefined : `PT${Math.max(0, Math.round(remaining))}S`}
            >
              {formatRemaining(remaining)}
            </time>
            <span className="homeConceptTrellisTrack">
              <i style={{ width: `${Math.max(8, concept.trellisProgress ?? 12)}%` }} />
            </span>
          </span>
        ) : null}
      </span>
      <span className="homeConceptMeta">
        <strong>{concept.label}</strong>
        <span className="homeConceptDescription">{displayConceptDescription(concept.prompt)}</span>
      </span>
    </button>
  );
}
