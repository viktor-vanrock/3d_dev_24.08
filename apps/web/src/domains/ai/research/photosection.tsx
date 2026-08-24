import { useRef, useState, type DragEvent } from "react";
import "./research.css";
import { presignPrinterPhoto, printerMediaUrl, uploadPrinterPhoto } from "./api.ts";
import type { PhotoItem } from "./formstate.ts";
import { useInteractionSound } from "@platform/sound";

// Секция «Фото» (§2.4): один поток drag-drop/выбор, presigned-заливка сразу на выбор файла,
// галерея-сетка, звезда `hero` (первое загруженное — авто-hero, взаимоисключающий выбор), лимит 8,
// лайтбокс по тапу на превью. Прогресс — `.uiChecklistBarFill` поверх тайла (переиспользуем класс
// из onboarding-чеклиста по имени, не сам компонент — см. исследование примитивов MF-917).

const MAX_PHOTOS = 8;
const ACCEPTED_TYPES: Record<string, true> = { "image/jpeg": true, "image/png": true, "image/webp": true };

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 17l-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export interface PhotoSectionProps {
  slug: string;
  photos: PhotoItem[];
  heroKey: string | null;
  onPhotosChange: (update: PhotoItem[] | ((prev: PhotoItem[]) => PhotoItem[])) => void;
  onHeroChange: (update: string | null | ((prev: string | null) => string | null)) => void;
}

export function PhotoSection({ slug, photos, heroKey, onPhotosChange, onHeroChange }: PhotoSectionProps) {
  const sound = useInteractionSound();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const atLimit = photos.length >= MAX_PHOTOS;

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    for (const file of list) {
      if (!ACCEPTED_TYPES[file.type]) continue;
      const presign = await presignPrinterPhoto(slug, file.type);
      if (!presign) {
        setStorageError(true);
        continue;
      }
      const key = presign.key;
      onPhotosChange((current) => [...current, { key, status: "uploading", progress: 0.15 }]);
      const ok = await uploadPrinterPhoto(presign.uploadUrl, file);
      onPhotosChange((current) => current.map((p) => (p.key === key ? { ...p, status: ok ? "done" : "error", progress: 1 } : p)));
      if (ok) {
        onHeroChange((current) => current ?? key);
      }
    }
  }

  function removePhoto(key: string) {
    onPhotosChange(photos.filter((p) => p.key !== key));
    if (heroKey === key) {
      const next = photos.find((p) => p.key !== key && p.status === "done");
      onHeroChange(next?.key ?? null);
    }
  }

  return (
    <div className="rsPhotos">
      <div
        className="rsDropzone pressable"
        data-empty={photos.length === 0 || undefined}
        data-disabled={atLimit || undefined}
        role="button"
        tabIndex={0}
        onClick={() => !atLimit && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!atLimit && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
        }}
        onDragOver={(event: DragEvent) => {
          event.preventDefault();
          if (!atLimit) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setDragOver(false);
          if (!atLimit) void handleFiles(event.dataTransfer.files);
        }}
        data-drag={dragOver || undefined}
      >
        <span>{atLimit ? "Лимит 8 фото" : "Перетащите фото сюда или нажмите, чтобы выбрать"}</span>
        {!atLimit ? <span className="rsDropzoneHint">JPG/PNG/WebP · до 8 фото · фото с офсайта вендора — не чужие водяные знаки</span> : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {storageError ? <p className="rsPhotoStorageError">Загрузка фото временно недоступна — попробуйте позже, черновик цел.</p> : null}

      {photos.length > 0 ? (
        <div className="rsPhotoGrid">
          {photos.map((photo) => (
            <div key={photo.key} className="rsPhotoTile reveal" data-hero={photo.key === heroKey || undefined}>
              {photo.status === "done" ? (
                <img
                  src={printerMediaUrl(photo.key)}
                  alt=""
                  className="rsPhotoImg pressable"
                  onClick={() => setLightbox(photo.key)}
                />
              ) : (
                <div className="rsPhotoPlaceholder" />
              )}
              {photo.status === "uploading" ? (
                <div className="rsPhotoProgress uiChecklistBar">
                  <div className="uiChecklistBarFill" style={{ width: `${Math.round(photo.progress * 100)}%` }} />
                </div>
              ) : null}
              <button
                type="button"
                className="rsPhotoStar pressable"
                aria-label={photo.key === heroKey ? "Главное фото" : "Сделать главным фото"}
                onPointerDown={sound.tick}
                onClick={() => onHeroChange(photo.key)}
              >
                <StarIcon filled={photo.key === heroKey} />
              </button>
              <button type="button" className="rsPhotoRemove pressable" aria-label="Удалить фото" onClick={() => removePhoto(photo.key)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {lightbox ? (
        <div className="rsLightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <img src={printerMediaUrl(lightbox)} alt="" className="rsLightboxImg" />
        </div>
      ) : null}
    </div>
  );
}
