import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { hueFromId } from "@shared/lib";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { listFeaturedModels, type MarketModel } from "@domains/commerce";
import { apiAssetUrl } from "@shared/api";
import { modelPath, navigate } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { usePrefersReducedMotion } from "@platform/theme";
import { Button } from "@shared/ui";
import "./hero.css";

// Hero-карусель рекомендованных проектов (MF-512, docs/design/projects.page.md §2). Наполнение —
// кураторский featured из БД (GET /models?featured=1, до 5). 0 featured → секция не рендерится
// вообще (§2.4) — честный паттерн «структура включается от данных», не пустая заглушка.

const AUTOPLAY_MS = 7000;

export function HeroCarousel() {
  const [slides, setSlides] = useState<MarketModel[] | null | "error">(null);

  useEffect(() => {
    let cancelled = false;
    void listFeaturedModels().then((result) => {
      if (cancelled) return;
      setSlides(result === null ? "error" : result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (slides === null) return <div className="heroCarousel heroCarouselSkeleton" aria-hidden="true" />;
  // Ошибка кураторской ленты — тихо прячем hero (§2.5): каталог ниже остаётся доступен.
  if (slides === "error" || slides.length === 0) return null;
  return <HeroCarouselView slides={slides} />;
}

// Порог сдвига (px), после которого отпускание свайпа листает слайд, а не пружинит назад.
const SWIPE_THRESHOLD = 60;

// Порог движения (px), после которого палец считается «тащит», а не тапает. setPointerCapture
// захватывается ЛЕНИВО — только когда сдвиг перевалил за порог (см. handlePointerMove), а не
// сразу на pointerdown: захват на каждом касании уводил click ЛЮБОГО потомка (.heroSlideHit,
// .heroCarouselDot) на .heroCarousel (тот без onClick) — тап переставал открывать проект, а тап
// по точке открывал текущий слайд вместо переключения (MF-606, живой QA на dev.3mf.tech). Простой
// тап без реального сдвига захват не трогает — click доходит до настоящей цели естественно.
//
// ВАЖНО (второй раунд QA, баг уже утёк на прод v26.2.160): setPointerCapture НЕ ретаргетит
// нативный click, который браузер синтезирует после touchend по ИСХОДНОЙ точке касания — это
// отдельный механизм (эвристика тач-скролла/тапа браузера, обычно ~10px), независимый от pointer
// capture. Из-за этого частичный свайп 9–~17px (наш JS уже корректно считает «драг», не открывает
// слайд из React) всё равно триггерил браузерный click по .heroSlideHit → случайную навигацию.
// Фикс — event.preventDefault() в handlePointerMove, как только жест признан драгом: это гасит
// весь последующий синтез compat-мышиных событий (включая click) для ЭТОГО касания на уровне
// браузера, а не полагается на ретаргетинг через capture.
const TAP_MOVE_THRESHOLD = 8;

function HeroCarouselView({ slides }: { slides: MarketModel[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const sound = useInteractionSound();
  const single = slides.length === 1;

  // Ручной свайп (motion.md §6): палец двигает слайд 1:1, чем дальше — тем сильнее
  // сопротивление (rubber-band, «тач должен чувствовать предел»); отпустил до порога —
  // пружина назад, после порога — листает (новый слайд въезжает кросс-фейдом сам, по key).
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; pointerId: number } | null>(null);
  const trackWidthRef = useRef(1);
  const justSwipedRef = useRef(false);
  // Зеркало dragging в ref — pointerup может прийти в той же синхронной пачке событий, что
  // решающий move (быстрый флик), до того, как React перерендерит компонент с новым dragging из
  // замыкания; ref всегда актуален независимо от тайминга ре-рендера (тот же приём и обоснование,
  // что navswipe.ts/pulltorefresh.ts, MF-758).
  const draggingRef = useRef(false);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStartRef.current = { x: event.clientX, pointerId: event.pointerId };
    trackWidthRef.current = event.currentTarget.getBoundingClientRect().width || 1;
    setPaused(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const raw = event.clientX - start.x;
    if (!draggingRef.current) {
      if (Math.abs(raw) < TAP_MOVE_THRESHOLD) return;
      draggingRef.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    // Гасит нативный touch→click компенсирующий синтез браузера для всего жеста (см. комментарий
    // у TAP_MOVE_THRESHOLD выше) — без этого частичный свайп всё равно открывал текущий слайд.
    event.preventDefault();
    const limit = trackWidthRef.current * 0.9;
    // Классическая rubber-band-формула: чем больше |raw|, тем меньше приращение движения.
    const resisted = raw / (1 + Math.abs(raw) / limit);
    setDragX(resisted);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const raw = event.clientX - start.x;
    const wasDragging = draggingRef.current;
    dragStartRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    setDragX(0);
    setPaused(false);
    // Не тащили — это тап: захват pointer'а не включался (см. handlePointerMove), поэтому
    // click дойдёт до настоящей цели (кнопка слайда/точка) сам, естественным путём браузера.
    if (!wasDragging) return;
    if (single) return;
    if (raw <= -SWIPE_THRESHOLD) {
      justSwipedRef.current = true;
      sound.tick();
      setActive((current) => (current + 1) % slides.length);
    } else if (raw >= SWIPE_THRESHOLD) {
      justSwipedRef.current = true;
      sound.tick();
      setActive((current) => (current - 1 + slides.length) % slides.length);
    }
    if (justSwipedRef.current) {
      setTimeout(() => {
        justSwipedRef.current = false;
      }, 300);
    }
  }

  // Автолист на скрытой вкладке — на паузе (visibilitychange), не «проматываем» вслепую (§2.3).
  useEffect(() => {
    if (single) return;
    const onVisibility = () => setPaused(document.visibilityState === "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [single]);

  // Триггер появления — setTimeout, не rAF (грабля motion.md: rAF на фоновой вкладке
  // застревает opacity:0).
  useEffect(() => {
    if (single || paused || reducedMotion) return;
    const timer = setTimeout(() => setActive((current) => (current + 1) % slides.length), AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [active, paused, reducedMotion, single, slides.length]);

  const activeModel = slides[active]!;

  function openSlide(model: MarketModel) {
    if (justSwipedRef.current) return;
    navigate(modelPath(model.id));
  }

  return (
    <div
      className="heroCarousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Рекомендованные проекты"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (single) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setActive((current) => (current + 1) % slides.length);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setActive((current) => (current - 1 + slides.length) % slides.length);
        }
      }}
    >
      <HeroSlide
        key={activeModel.id}
        model={activeModel}
        dragX={dragging ? dragX : 0}
        onOpen={() => openSlide(activeModel)}
      />

      <span className="srOnly" aria-live="polite">
        {activeModel.title}
      </span>

      {!single ? (
        <div className="heroCarouselDots" role="tablist" aria-label="Слайды">
          {slides.map((model, index) => (
            <Button
              variant="ghost"
              icon={null}
              key={model.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={`Слайд ${index + 1}: ${model.title}`}
              className="heroCarouselDot pressable"
              data-active={index === active || undefined}
              onClick={() => {
                sound.tick();
                setActive(index);
              }}
            >
              <span aria-hidden="true" />
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HeroSlide({
  model,
  dragX,
  onOpen,
}: {
  model: MarketModel;
  dragX: number;
  onOpen: () => void;
}) {
  return (
    <div
      className="heroSlide"
      data-dragging={dragX !== 0 || undefined}
      style={dragX !== 0 ? { transform: `translateX(${dragX}px)` } : undefined}
      role="group"
      aria-roledescription="slide"
    >
      <Button variant="ghost" icon={null} className="heroSlideHit" onClick={onOpen} aria-label={`Открыть проект: ${model.title}`}>
        <span className="heroSlidePreview" aria-hidden="true">
          {model.thumb_url ? (
            <img className="heroSlideImg" src={apiAssetUrl(model.thumb_url)} alt="" />
          ) : (
            <span className="heroSlidePlaceholder" style={{ ["--tile-hue" as string]: hueFromId(model.id) }}>
              <span className="heroSlidePlaceholderGlow" />
              <span className="heroSlidePlaceholderArt">
                <CubeIcon />
              </span>
            </span>
          )}
        </span>
        <span className="heroSlideVeil" aria-hidden="true" />
        <span className="heroSlideOverlay">
          <span className="heroSlideTitle">{model.title}</span>
          <span className="heroSlideAuthor">by ⦿ @{model.owner.username}</span>
        </span>
        <span className="heroSlideCta">Открыть проект →</span>
      </Button>
    </div>
  );
}

// Тот же branded-placeholder, что карточка каталога (ModelTile, market.tsx) — свечение по хэшу
// id + слоистый глиф, только в масштабе hero 16:9 (docs/design/projects.page.md §14.3 п.4).
function CubeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
