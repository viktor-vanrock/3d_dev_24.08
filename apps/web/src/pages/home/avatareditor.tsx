import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { components } from "../../api/generated/openapi";
import { apiFetch } from "@shared/api";
import type { SessionUser } from "@domains/access";
import { navigate, profilePath } from "../../router.ts";
import { HomeHeader, type Section } from "@platform/nav";
import {
  ACCESSORIES,
  ARMS,
  AvatarBubble,
  BEARDS,
  EYES,
  HATS,
  OUTFITS,
  PLASTICS,
  POSES,
  TEXTURES,
  type AvatarConfig,
  type AvatarSnapshots,
  useAvatar,
} from "@shared/avatar";

type MascotModule = typeof import("@shared/avatar/mascot3d.ts");
type LayerKey = "hat" | "eyes" | "beard" | "outfit" | "arms" | "accessory" | "pose" | "color" | "texture";

// Локальный тип для state — Partial чтобы поддерживать pose/texture которых нет в DTO
type WardrobeLayers = Partial<Record<LayerKey, readonly string[]>>;

function previewConfig(config: AvatarConfig, key: LayerKey, value: string): AvatarConfig {
  return { ...config, [key]: value };
}

type CatalogOption = { id: string; label: string; hex?: string };

interface EditorGroup {
  key: LayerKey;
  label: string;
  shortLabel: string;
  description: string;
  options: readonly CatalogOption[];
}

const GROUPS: readonly EditorGroup[] = [
  { key: "hat", label: "Шляпки и ушки", shortLabel: "Голова", description: "Головные уборы, ушки и сезонные детали.", options: HATS },
  { key: "eyes", label: "Выражение лица", shortLabel: "Лицо", description: "Настроение считывается даже в маленьком портрете.", options: EYES },
  { key: "beard", label: "Борода и усы", shortLabel: "Борода", description: "От лёгкой щетины до бороды мейкера.", options: BEARDS },
  { key: "outfit", label: "Туловище", shortLabel: "Одежда", description: "Рабочая одежда и одежда по статусу.", options: OUTFITS },
  { key: "arms", label: "Руки", shortLabel: "Руки", description: "Форма и материал парящих рук.", options: ARMS },
  { key: "accessory", label: "Предмет в руках", shortLabel: "Предмет", description: "Инструмент или вещь, которая рассказывает о вас.", options: ACCESSORIES },
  { key: "pose", label: "Поза", shortLabel: "Поза", description: "Поза меняет жесты и характер персонажа.", options: POSES },
  { key: "color", label: "Цвет пластика", shortLabel: "Цвет", description: "Базовый цвет вашего напечатанного персонажа.", options: PLASTICS },
  { key: "texture", label: "Текстура", shortLabel: "Материал", description: "Матовый пластик, слои печати и специальные материалы.", options: TEXTURES },
] as const;

const OPTION_META: Record<string, { badge: string; detail: string; entitlement?: "achievement" }> = {
  "outfit:apron": { badge: "Ачивка", detail: "Первый Make", entitlement: "achievement" },
  "hat:beanie": { badge: "Сезон", detail: "Лето 2026" },
  "hat:crown": { badge: "Статус", detail: "Ведущий автор" },
  "arms:robot": { badge: "Редкое", detail: "Инженерный набор" },
};

export function AvatarEditorPage({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const [avatar, saveAvatar] = useAvatar(user.id);
  const [draft, setDraft] = useState<AvatarConfig>(avatar);
  const deferredDraft = useDeferredValue(draft);
  const [activeKey, setActiveKey] = useState<LayerKey>("hat");
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "fallback">("loading");
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unlocks, setUnlocks] = useState<WardrobeLayers | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{ setConfig: (config: AvatarConfig) => void; dispose: () => void } | null>(null);
  const moduleRef = useRef<MascotModule | null>(null);
  const activeGroup = useMemo(() => GROUPS.find((group) => group.key === activeKey) ?? GROUPS[0]!, [activeKey]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("portal:avatar-editor", { detail: { open: true } }));
    let cancelled = false;
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const loadScene = () => {
      // three.js code-splitting: динамический import мимо index.ts намеренно (см. shared/avatar/index.ts).
      // eslint-disable-next-line boundaries/entry-point
      void import("@shared/avatar/mascot3d.ts")
        .then((module) => {
          if (cancelled || !canvasRef.current) return;
          moduleRef.current = module;
          sceneRef.current = module.createMascotScene(canvasRef.current, draft);
          setSceneState("ready");
        })
        .catch(() => !cancelled && setSceneState("fallback"));
    };
    const idleId = idleWindow.requestIdleCallback?.(loadScene, { timeout: 450 });
    const timer = idleId === undefined ? window.setTimeout(loadScene, 40) : null;
    return () => {
      cancelled = true;
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timer !== null) window.clearTimeout(timer);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      window.dispatchEvent(new CustomEvent("portal:avatar-editor", { detail: { open: false } }));
    };
    // First paint deliberately uses the lightweight SVG portrait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    setApplying(true);
    const frame = requestAnimationFrame(() => {
      sceneRef.current?.setConfig(deferredDraft);
      setApplying(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [deferredDraft]);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/me/wardrobe/unlocks`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: components["schemas"]["WardrobeUnlocksResponseDto"] | null) => {
        if (!cancelled) setUnlocks(data?.layers ?? {});
      })
      .catch(() => {
        if (!cancelled) setUnlocks({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const leave = () => navigate(profilePath(user.username), "back");

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    let snapshots: AvatarSnapshots | null = null;
    try {
      snapshots = moduleRef.current?.renderMascotSnapshots(draft, 360) ?? null;
    } catch {
      // Config remains useful when WebGL or snapshot rendering is unavailable.
    }
    const ok = await saveAvatar(draft, snapshots);
    setSaving(false);
    if (ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      return;
    }
    setSaveError("Образ сохранён на устройстве, но портреты пока не синхронизированы.");
  }

  return (
    <main className="avatarStudioPage">
      <HomeHeader
        user={user}
        printers={[]}
        section={section}
        onSectionChange={onSectionChange}
        onBack={leave}
        backLabel="К профилю"
        mode="back"
      />

      <div className="avatarStudioShell">
        <section className="avatarStudioPreview" aria-label="Предпросмотр персонажа">
          <div className="avatarStudioIntro">
            <span className="uiEyebrow">Мастерская персонажа</span>
            <h1>Соберите себя</h1>
            <p>Простой силуэт, ваши детали. Персонаж станет вашим лицом в ленте, проектах и комментариях.</p>
          </div>

          <div className="avatarStudioStage" data-state={sceneState}>
            <div className="avatarStudioGlow" aria-hidden="true" />
            <div className="avatarStudioFallback" aria-hidden={sceneState === "ready"}>
              <AvatarBubble config={draft} snapshots={null} size={360} facing="front" />
            </div>
            <canvas
              ref={canvasRef}
              className="avatarStudioCanvas"
              width={900}
              height={900}
              aria-label="Интерактивный 3D-персонаж"
              data-engine={sceneState === "ready" ? "three.js" : undefined}
            />
            {sceneState === "loading" ? <span className="avatarStudioLoad">Подготавливаем 3D-примерку…</span> : null}
            {sceneState === "fallback" ? <span className="avatarStudioLoad">Показываем лёгкий 2D-режим</span> : null}
            {applying ? <span className="avatarStudioApplying">Примеряем</span> : null}
            <span className="avatarStudioRotateHint">Потяните, чтобы рассмотреть</span>
          </div>

          <div className="avatarStudioLook">
            <span>{PLASTICS.find((item) => item.id === draft.color)?.label}</span>
            <span>·</span>
            <span>{OUTFITS.find((item) => item.id === draft.outfit)?.label}</span>
            <span>·</span>
            <span>{POSES.find((item) => item.id === draft.pose)?.label}</span>
          </div>
        </section>

        <section className="avatarStudioEditor" aria-label="Каталог настройки персонажа">
          <header className="avatarStudioEditorHead">
            <div>
              <span className="uiEyebrow">Ваш стиль</span>
              <h2>{activeGroup.label}</h2>
            </div>
            <div className="avatarStudioActions">
              <button type="button" className="avatarStudioGhost pressable" onClick={() => setDraft(avatar)}>
                Сбросить
              </button>
              <button type="button" className="avatarStudioSave pressable" disabled={saving} onClick={handleSave}>
                {saving ? "Фотографируем…" : saved ? "Сохранено ✓" : "Сохранить образ"}
              </button>
            </div>
          </header>

          <nav className="avatarStudioTabs" aria-label="Категории персонажа">
            {GROUPS.map((group) => (
              <button
                key={group.key}
                type="button"
                className="avatarStudioTab pressable"
                aria-selected={activeKey === group.key}
                onClick={() => setActiveKey(group.key)}
              >
                {group.shortLabel}
              </button>
            ))}
          </nav>

          <div className="avatarStudioCatalogHead">
            <p>{activeGroup.description}</p>
            <span>{activeGroup.options.length} вариантов</span>
          </div>

          <div className="avatarStudioGrid" role="listbox" aria-label={activeGroup.label}>
            {activeGroup.options.map((option) => {
              const key = `${activeGroup.key}:${option.id}`;
              const meta = OPTION_META[key];
              const achievementLocked =
                meta?.entitlement === "achievement" &&
                (unlocks === null || !unlocks[activeGroup.key]?.includes(option.id));
              const selected = draft[activeGroup.key] === option.id;
              const config = previewConfig(draft, activeGroup.key, option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className="avatarStudioTile pressable"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={achievementLocked || undefined}
                  disabled={achievementLocked}
                  data-selected={selected || undefined}
                  data-locked={achievementLocked || undefined}
                  onClick={() => {
                    setSaved(false);
                    setDraft((current) => previewConfig(current, activeGroup.key, option.id));
                  }}
                >
                  <span className="avatarStudioTilePreview" style={option.hex ? { "--item-color": option.hex } as CSSProperties : undefined}>
                    <AvatarBubble config={config} snapshots={null} size={112} facing="front" />
                  </span>
                  <span className="avatarStudioTileCopy">
                    <strong>{option.label}</strong>
                    {meta ? <small>{meta.detail}</small> : <small>Доступно</small>}
                  </span>
                  {meta ? <span className="avatarStudioBadge">{achievementLocked ? "Закрыто" : meta.badge}</span> : null}
                  {selected ? <span className="avatarStudioSelected" aria-hidden="true">✓</span> : null}
                </button>
              );
            })}
          </div>

          {saveError ? <div className="avatarStudioError" role="status">{saveError}</div> : null}
          <div className="avatarStudioMobileSave">
            <button type="button" className="avatarStudioSave pressable" disabled={saving} onClick={handleSave}>
              {saving ? "Фотографируем…" : saved ? "Сохранено ✓" : "Сохранить образ"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
