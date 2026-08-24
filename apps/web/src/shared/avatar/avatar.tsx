import { useCallback, useEffect, useSyncExternalStore } from "react";

/*
  Персонаж-аватар «мейкер-маскот» (эпик MF-446): идея персонального маскота
  и редактора — от Reddit Snoo, простой читаемый силуэт — от Among Us.
  Версия v5: большая мягкая голова, цельный округлый торс без ног и парящие
  руки. Детали крупные и должны считываться в портрете 36px.

  SVG — лёгкий портрет/фолбэк: проп `facing` ('front'|'left'|'right')
  поворачивает персонажа в 3/4 (лицо/аксессуары съезжают к краю, дальняя
  рука прячется).
  Контекст задаёт поворот: на главной в капсуле смотрит влево (в сторону
  контента), в меню — вправо (на своё имя), в редакторе — анфас.

  Слои: цвет · текстура · поза · туловище · шляпка/ушки · выражение ·
  борода · руки · предмет · деталь за спиной. Фона в конфиге нет.

  Источник правды — GET/PATCH /me/avatar; localStorage остаётся account-scoped
  быстрым кэшем и офлайн-фолбэком. Каталог использует SVG-превью, одна живая
  three.js-сцена загружается только на отдельной странице мастерской.
*/

import type { components } from "src/api/generated/openapi";
import { apiFetch, API_URL } from "@shared/api";

export type AvatarConfig = components["schemas"]["AvatarConfigDto"];

export type AvatarFacing = "front" | "left" | "right";

export const PLASTICS = [
  { id: "mint", label: "Мята", hex: "#34d399" },
  { id: "coral", label: "Коралл", hex: "#e8836f" },
  { id: "amber", label: "Янтарь", hex: "#f2c063" },
  { id: "sky", label: "Небо", hex: "#7cc4e8" },
  { id: "lilac", label: "Сирень", hex: "#b79ce8" },
  { id: "royal", label: "Королевский", hex: "#515dad" },
  { id: "aqua", label: "Аквамарин", hex: "#6beac7" },
  { id: "graphite", label: "Графит", hex: "#555e5b" },
  { id: "snow", label: "Белый", hex: "#e9ece9" },
] as const;

export const TEXTURES = [
  { id: "layers", label: "Слои печати" },
  { id: "gloss", label: "Глянец" },
  { id: "matte", label: "Матовый" },
  { id: "rough", label: "Шершавый" },
  { id: "marble", label: "Мрамор" },
  { id: "carbon", label: "Карбон" },
] as const;

export const POSES = [
  { id: "stand", label: "Спокойно" },
  { id: "wave", label: "Привет" },
  { id: "cheer", label: "Победа" },
  { id: "think", label: "Думает" },
  { id: "present", label: "Показывает" },
  { id: "idea", label: "Есть идея" },
] as const;

export const OUTFITS = [
  { id: "none", label: "Без одежды" },
  { id: "sweater", label: "Худи" },
  { id: "overall", label: "Комбинезон" },
  { id: "apron", label: "Фартук" },
  { id: "labcoat", label: "Лаборатория" },
  { id: "techvest", label: "Тех-жилет" },
] as const;

export const HATS = [
  { id: "none", label: "Без головного убора" },
  { id: "helmet", label: "Космошлем" },
  { id: "cap", label: "Кепка" },
  { id: "crown", label: "Корона" },
  { id: "cat", label: "Кошачьи ушки" },
  { id: "fox", label: "Лисьи ушки" },
  { id: "beanie", label: "Шапка мейкера" },
] as const;

export const EYES = [
  { id: "dots", label: "Любопытный" },
  { id: "happy", label: "Радостный" },
  { id: "wink", label: "Подмигивает" },
  { id: "visor", label: "Визор" },
  { id: "sleepy", label: "Спокойный" },
  { id: "stars", label: "В восторге" },
] as const;

export const BEARDS = [
  { id: "none", label: "Без бороды" },
  { id: "stubble", label: "Щетина" },
  { id: "moustache", label: "Усы" },
  { id: "full", label: "Борода" },
  { id: "braid", label: "Коса мейкера" },
] as const;

export const ARMS = [
  { id: "plain", label: "Обычные" },
  { id: "gloves", label: "Перчатки" },
  { id: "sleeves", label: "Рукава" },
  { id: "robot", label: "Робо-руки" },
] as const;

export const ACCESSORIES = [
  { id: "none", label: "Нет" },
  { id: "spatula", label: "Шпатель" },
  { id: "wrench", label: "Ключ" },
  { id: "heart", label: "Сердечко" },
  { id: "caliper", label: "Штангенциркуль" },
  { id: "solder", label: "Паяльник" },
] as const;

export const BACKS = [
  { id: "none", label: "Нет" },
  { id: "spool", label: "Катушка" },
  { id: "jetpack", label: "Джетпак" },
] as const;

export const DEFAULT_AVATAR: AvatarConfig = {
  color: "mint",
  texture: "layers",
  pose: "stand",
  outfit: "none",
  hat: "none",
  eyes: "dots",
  beard: "none",
  arms: "plain",
  accessory: "none",
  back: "none",
};

const STORAGE_KEY = "portal.avatar";

// Случайная генерация для новых юзеров (MF-449, открытый вопрос эпика — решено):
// полный рандом по ВСЕМ слоям, вкл. "нет"-варианты нарядов/шапок/т.п. — как Snoo на
// Reddit получает случайный костюм при регистрации, а не единый дефолт-голыш.
function pickRandom<T extends readonly { id: string }[]>(list: T): T[number]["id"] {
  return list[Math.floor(Math.random() * list.length)]!.id;
}

export function randomAvatarConfig(): AvatarConfig {
  return {
    color: pickRandom(PLASTICS),
    texture: pickRandom(TEXTURES),
    pose: pickRandom(POSES),
    outfit: pickRandom(OUTFITS),
    hat: pickRandom(HATS),
    eyes: pickRandom(EYES),
    beard: pickRandom(BEARDS),
    arms: pickRandom(ARMS),
    accessory: pickRandom(ACCESSORIES),
    back: pickRandom(BACKS),
  };
}

function loadLocalAvatar(): AvatarConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return { ...DEFAULT_AVATAR, ...(JSON.parse(raw) as Partial<AvatarConfig>) };
  } catch {
    return null;
  }
}

function persistLocalAvatar(config: AvatarConfig): void {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(config));
  } catch {
    // приватный режим/квота — конфиг остаётся только в памяти на эту сессию
  }
}

// --- PNG-снапшоты 3D-фигурки (пишет mascot3d.renderMascotSnapshots при сохранении;
// читают капсула/меню). Живут здесь, чтобы чтение НЕ тянуло three.js в основной чанк.
const SNAPSHOT_KEY = "portal.avatar.snapshots";

export type AvatarSnapshots = components["schemas"]["AvatarSnapshotsDto"];

function scopedKey(key: string): string {
  return storeAccountId ? `${key}.${storeAccountId}` : key;
}

export function loadSnapshots(): AvatarSnapshots | null {
  try {
    const raw = localStorage.getItem(scopedKey(SNAPSHOT_KEY));
    return raw ? (JSON.parse(raw) as AvatarSnapshots) : null;
  } catch {
    return null;
  }
}

export function saveSnapshots(snapshots: AvatarSnapshots): void {
  storeSnapshots = snapshots;
  try {
    localStorage.setItem(scopedKey(SNAPSHOT_KEY), JSON.stringify(snapshots));
  } catch {
    // Снапшоты — кэш. Каноническая копия после PATCH живёт на сервере.
  }
  listeners.forEach((listener) => listener());
}

// Мини-стор модульного уровня (не React Context — двум независимым потребителям,
// капсуле шапки и модалке профиля MF-15, нужен ОДИН общий конфиг и ОДИН сетевой
// запрос на монтирование, а не гонка из двух независимых useState). Сохранение из
// любого потребителя (редактор открыт из капсулы ИЛИ из профиля) мгновенно видно
// в обоих — проверка переиспользуемости снапшот-подхода, которую требует MF-449.
let storeAccountId: string | null = null;
let storeConfig: AvatarConfig = loadLocalAvatar() ?? DEFAULT_AVATAR;
let storeSnapshots: AvatarSnapshots | null = loadSnapshots();
const listeners = new Set<() => void>();
const fetchedAccounts = new Set<string>();

function activateAccount(accountId: string): void {
  if (storeAccountId === accountId) return;
  storeAccountId = accountId;
  try {
    const scopedConfig = localStorage.getItem(scopedKey(STORAGE_KEY));
    const legacyConfig = localStorage.getItem(STORAGE_KEY);
    storeConfig = scopedConfig
      ? { ...DEFAULT_AVATAR, ...(JSON.parse(scopedConfig) as Partial<AvatarConfig>) }
      : legacyConfig
        ? { ...DEFAULT_AVATAR, ...(JSON.parse(legacyConfig) as Partial<AvatarConfig>) }
        : deterministicAvatarConfig(accountId);
  } catch {
    storeConfig = deterministicAvatarConfig(accountId);
  }
  storeSnapshots = loadSnapshots();
}

function setStoreConfig(next: AvatarConfig): void {
  storeConfig = next;
  persistLocalAvatar(next);
  listeners.forEach((listener) => listener());
}

function ensureRemoteFetched(accountId: string): void {
  if (fetchedAccounts.has(accountId)) return;
  fetchedAccounts.add(accountId);
  apiFetch(`/me/avatar`, { credentials: "include" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { config?: Partial<AvatarConfig>; snapshots?: AvatarSnapshots | null } | null) => {
      if (storeAccountId !== accountId) return;
      if (data?.config) {
        setStoreConfig({ ...DEFAULT_AVATAR, ...data.config });
        if (data.snapshots) saveSnapshots(resolveSnapshots(data.snapshots));
        return;
      }
      // Эндпоинт ещё не задеплоен (TODO: Back, контракт зафиксирован в MF-449) или
      // сессия гостя — если и локального конфига нет, это первый визит: рандомим
      // персонажа вместо единого дефолт-голыша, а не молчим до появления бэкенда.
      if (!loadLocalAvatar()) setStoreConfig(randomAvatarConfig());
    })
    .catch(() => {
      if (!loadLocalAvatar()) setStoreConfig(randomAvatarConfig());
    });
}

export type SaveAvatar = (next: AvatarConfig, snapshots?: AvatarSnapshots | null) => Promise<boolean>;

export function useAvatar(accountId = "current"): [AvatarConfig, SaveAvatar, AvatarSnapshots | null] {
  activateAccount(accountId);
  const config = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => storeConfig,
  );
  const snapshots = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => storeSnapshots,
  );

  useEffect(() => {
    ensureRemoteFetched(accountId);
  }, [accountId]);

  const save = useCallback(async (next: AvatarConfig, nextSnapshots?: AvatarSnapshots | null) => {
    setStoreConfig(next);
    if (nextSnapshots) saveSnapshots(nextSnapshots);
    try {
      const response = await apiFetch(`/me/avatar`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next, snapshots: nextSnapshots ?? undefined }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { config?: Partial<AvatarConfig>; snapshots?: AvatarSnapshots | null };
      if (storeAccountId !== accountId) return true;
      if (data.config) setStoreConfig({ ...DEFAULT_AVATAR, ...data.config });
      if (data.snapshots) saveSnapshots(resolveSnapshots(data.snapshots));
      return true;
    } catch {
      // Локальная копия остаётся рабочей, но редактор честно сообщает, что синхронизация
      // не завершилась: пользователь может повторить сохранение после восстановления сети.
      return false;
    }
  }, [accountId]);

  return [config, save, snapshots];
}

function resolveSnapshots(snapshots: AvatarSnapshots): AvatarSnapshots {
  return {
    front: resolveSnapshotUrl(snapshots.front),
    left: resolveSnapshotUrl(snapshots.left),
    right: resolveSnapshotUrl(snapshots.right),
  };
}

function resolveSnapshotUrl(value: string | null): string | null {
  if (!value || value.startsWith("data:") || /^https?:\/\//i.test(value)) return value;
  return `${API_URL.replace(/\/$/, "")}${value.startsWith("/") ? "" : "/"}${value}`;
}

// Legacy-пользователь без сохранённого конфига всё равно получает узнаваемого
// персонажа, а не фото или первую букву. FNV-1a даёт стабильный набор по id/нику.
export function deterministicAvatarConfig(seed: string): AvatarConfig {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const next = (length: number) => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return Math.abs(hash >>> 0) % length;
  };
  return {
    color: PLASTICS[next(PLASTICS.length)]!.id,
    texture: TEXTURES[next(TEXTURES.length)]!.id,
    pose: POSES[next(POSES.length)]!.id,
    outfit: OUTFITS[next(OUTFITS.length)]!.id,
    hat: HATS[next(HATS.length)]!.id,
    eyes: EYES[next(EYES.length)]!.id,
    beard: BEARDS[next(BEARDS.length)]!.id,
    arms: ARMS[next(ARMS.length)]!.id,
    accessory: ACCESSORIES[next(ACCESSORIES.length)]!.id,
    back: BACKS[next(BACKS.length)]!.id,
  };
}

function hexOf<T extends readonly { id: string; hex?: string }[]>(list: T, id: string, fallback: string): string {
  return list.find((item) => item.id === id)?.hex ?? fallback;
}

export function MakerAvatar({
  config,
  size = 40,
  facing = "front",
  label,
}: {
  config: AvatarConfig;
  size?: number;
  facing?: AvatarFacing;
  label?: string;
}) {
  const plastic = hexOf(PLASTICS, config.color, "#34d399");
  const dark = "#0b1512";
  // Псевдо-3D: сдвиг «лица» к краю головы. Рисуем ЛЕВЫЙ поворот, правый — зеркалим.
  const side = facing !== "front";
  const dx = side ? -7 : 0;
  const mirror = facing === "right";
  const armFill = config.arms === "gloves" ? "#202826" : config.arms === "robot" ? "#b8c2c2" : config.arms === "sleeves" ? "#536b7b" : plastic;
  const armPose =
    config.pose === "wave"
      ? { leftY: 60, rightY: 32 }
      : config.pose === "cheer"
        ? { leftY: 31, rightY: 31 }
        : config.pose === "think" || config.pose === "idea"
          ? { leftY: 60, rightY: 42 }
          : config.pose === "present"
            ? { leftY: 54, rightY: 50 }
            : { leftY: 60, rightY: 60 };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "block" }}
    >
      <g transform={mirror ? "scale(-1,1) translate(-96,0)" : undefined}>
        {/* --- за спиной (рисуется первым, торчит со «спины» = справа при взгляде влево) --- */}
        {config.back === "spool" ? (
          <g transform={side ? "translate(8,0)" : "translate(14,0)"}>
            <circle cx="58" cy="66" r="10" fill="#3b3f3d" />
            <circle cx="58" cy="66" r="6.5" fill={plastic} />
            <circle cx="58" cy="66" r="2.2" fill="#3b3f3d" />
            {/* нить филамента образует самостоятельную декоративную дугу */}
            <path d="M58 56C66 42 58 26 49.5 16" stroke={plastic} strokeWidth="1.6" fill="none" strokeDasharray="3 2.5" opacity="0.8" />
          </g>
        ) : null}
        {config.back === "jetpack" ? (
          <g transform={side ? "translate(6,0)" : "translate(13,0)"}>
            <rect x="52" y="56" width="12" height="18" rx="5" fill="#4a5250" />
            <rect x="54.5" y="74" width="7" height="4" rx="2" fill="#3b3f3d" />
            <path d="M56 79c1 3 3 3 4 0" stroke="#f2a93b" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </g>
        ) : null}

        {/* --- цельное туловище без ног --- */}
        <rect x={31 + dx * 0.4} y="54" width="34" height="34" rx="17" fill={plastic} />

        {/* Парящие руки: форма и материал — самостоятельный слой. */}
        {!side || !mirror ? (
          <rect x={22 + dx * 0.8} y={armPose.leftY} width={config.arms === "robot" ? 8 : 9} height="18" rx={config.arms === "robot" ? 3 : 4.5} fill={armFill} />
        ) : null}
        {!side ? <rect x="65" y={armPose.rightY} width={config.arms === "robot" ? 8 : 9} height="18" rx={config.arms === "robot" ? 3 : 4.5} fill={armFill} /> : null}
        {config.arms === "robot" ? (
          <>
            <circle cx={26 + dx * 0.8} cy={armPose.leftY + 2} r="3" fill="#202826" />
            {!side ? <circle cx="69" cy={armPose.rightY + 2} r="3" fill="#202826" /> : null}
          </>
        ) : null}

        {/* --- наряды --- */}
        {config.outfit === "sweater" ? (
          <g>
            <rect x={33 + dx * 0.4} y="62" width="30" height="16" rx="8" fill="#4a5568" />
            <path d={`M${37 + dx * 0.4} 66h22`} stroke="#e9ece9" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
          </g>
        ) : null}
        {config.outfit === "overall" ? (
          <g>
            <rect x={35 + dx * 0.4} y="66" width="26" height="17" rx="6" fill="#4a6f8a" />
            <path d={`M${39 + dx * 0.4} 66v-5M${57 + dx * 0.4} 66v-5`} stroke="#4a6f8a" strokeWidth="3.4" strokeLinecap="round" />
            <rect x={43 + dx * 0.4} y="70" width="10" height="7" rx="2" fill="#3d5c72" />
          </g>
        ) : null}
        {config.outfit === "apron" ? (
          <g>
            <path d={`M${36 + dx * 0.4} 62h24l2 21h-28l2-21Z`} fill="#b08050" />
            <rect x={42 + dx * 0.4} y="70" width="12" height="8" rx="2" fill="#96693d" />
          </g>
        ) : null}
        {config.outfit === "labcoat" ? (
          <g>
            <path d={`M${34 + dx * 0.4} 56h28v29H34z`} fill="#eef4f3" opacity="0.96" />
            <path d={`M${48 + dx * 0.4} 57v28`} stroke="#9ba7a4" strokeWidth="1.2" />
            <circle cx={52 + dx * 0.4} cy="67" r="1.2" fill={dark} />
            <circle cx={52 + dx * 0.4} cy="74" r="1.2" fill={dark} />
          </g>
        ) : null}
        {config.outfit === "techvest" ? (
          <g>
            <rect x={33 + dx * 0.4} y="58" width="30" height="26" rx="12" fill="#263b37" />
            <rect x={40 + dx * 0.4} y="65" width="16" height="10" rx="3" fill="#6beac7" opacity="0.88" />
          </g>
        ) : null}

        {/* --- большая мягкая голова --- */}
        <rect x="21" y="18" width="54" height="48" rx="23" fill={plastic} />

        {/* текстуры пластика (на голове; слои — и на теле) */}
        {config.texture === "layers" ? (
          <>
            <path d="M24 30h48M23 39h50M24 48h48M27 57h42" stroke={dark} strokeOpacity="0.14" strokeWidth="1.6" />
            <path d={`M${36 + dx * 0.4} 70h24M${36 + dx * 0.4} 76h24`} stroke={dark} strokeOpacity="0.14" strokeWidth="1.5" />
          </>
        ) : null}
        {config.texture === "gloss" ? (
          <path d="M30 30c4-4 12-5 16-3-6 5-10 11-11 17-4-3-8-9-5-14Z" fill="#ffffff" opacity="0.28" />
        ) : null}
        {config.texture === "marble" ? (
          <path
            d="M28 32c6 3 10-2 16 1s9-2 14 1M27 46c7 2 12-3 19 0s10-2 16 1M30 57c5 2 9-1 14 1"
            stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.6" fill="none" strokeLinecap="round"
          />
        ) : null}
        {config.texture === "carbon" ? (
          <path
            d="M28 28l14 14M38 26l18 18M48 26l20 20M58 26l12 12M26 38l12 12M26 48l10 10"
            stroke={dark} strokeOpacity="0.16" strokeWidth="2.4"
          />
        ) : null}

        {/* --- лицо (сдвигается к краю при повороте; глаза чуть сжимаются) --- */}
        <g transform={`translate(${dx},0)`}>
          {config.eyes === "dots" ? (
            <>
              <ellipse cx="38" cy="42" rx={side ? 2.9 : 3.6} ry="3.6" fill={dark} />
              <ellipse cx="58" cy="42" rx={side ? 2.9 : 3.6} ry="3.6" fill={dark} />
              <path d="M42 52c2.5 2.4 9.5 2.4 12 0" stroke={dark} strokeWidth="2.4" strokeLinecap="round" fill="none" />
            </>
          ) : null}
          {config.eyes === "happy" ? (
            <>
              <path d="M34 43c1.5-4 6.5-4 8 0M54 43c1.5-4 6.5-4 8 0" stroke={dark} strokeWidth="2.6" strokeLinecap="round" fill="none" />
              <path d="M41 52c3 3 11 3 14 0" stroke={dark} strokeWidth="2.4" strokeLinecap="round" fill="none" />
            </>
          ) : null}
          {config.eyes === "wink" ? (
            <>
              <ellipse cx="38" cy="42" rx={side ? 2.9 : 3.6} ry="3.6" fill={dark} />
              <path d="M54 42c1.5-3 6.5-3 8 0" stroke={dark} strokeWidth="2.6" strokeLinecap="round" fill="none" />
              <path d="M42 52c2.5 2.6 9.5 2.6 12 0" stroke={dark} strokeWidth="2.4" strokeLinecap="round" fill="none" />
            </>
          ) : null}
          {config.eyes === "visor" ? (
            <>
              <rect x="30" y="37" width="36" height="11" rx="5.5" fill={dark} />
              <rect x="34" y="40" width="10" height="4" rx="2" fill={plastic} opacity="0.7" />
              <path d="M42 54c2.5 2 9.5 2 12 0" stroke={dark} strokeWidth="2.4" strokeLinecap="round" fill="none" />
            </>
          ) : null}
          {config.eyes === "sleepy" ? (
            <>
              <path d="M34 42c2 2.2 6 2.2 8 0M54 42c2 2.2 6 2.2 8 0" stroke={dark} strokeWidth="2.5" strokeLinecap="round" fill="none" />
              <path d="M42 53c2.5 1.5 9.5 1.5 12 0" stroke={dark} strokeWidth="2.2" strokeLinecap="round" fill="none" />
            </>
          ) : null}
          {config.eyes === "stars" ? (
            <>
              <path d="m38 36 1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6L38 36Z" fill="#f2c063" />
              <path d="m58 36 1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6L58 36Z" fill="#f2c063" />
              <path d="M42 53c3 3 9 3 12 0" stroke={dark} strokeWidth="2.3" strokeLinecap="round" fill="none" />
            </>
          ) : null}
        </g>

        {/* --- борода и усы --- */}
        <g transform={`translate(${dx},0)`} fill={dark}>
          {config.beard === "stubble" ? (
            <>
              <circle cx="41" cy="55" r="1" /><circle cx="46" cy="57" r="1" /><circle cx="51" cy="57" r="1" /><circle cx="56" cy="55" r="1" />
            </>
          ) : null}
          {config.beard === "moustache" ? <path d="M48 52c-5-5-11-1-10 4 4 1 7 0 10-3 3 3 6 4 10 3 1-5-5-9-10-4Z" /> : null}
          {config.beard === "full" || config.beard === "braid" ? <path d="M35 51c2 15 7 20 13 20s11-5 13-20c-4 4-8 6-13 4-5 2-9 0-13-4Z" /> : null}
          {config.beard === "braid" ? <path d="M44 66h8l-1 14-3 5-3-5-1-14Z" /> : null}
        </g>

        {/* --- шапки (следуют за поворотом мягче лица) --- */}
        <g transform={`translate(${dx * 0.6},0)`}>
          {config.hat === "helmet" ? (
            <circle cx="48" cy="42" r="27" fill="none" stroke="#cfe8ff" strokeOpacity="0.75" strokeWidth="3" />
          ) : null}
          {config.hat === "cap" ? (
            <>
              <path d="M28 27a20 12 0 0 1 40 0v3H28v-3Z" fill={dark} opacity="0.85" />
              <path d={side ? "M32 28H18a4 4 0 0 0 1 6l13-2v-4Z" : "M64 28h14a4 4 0 0 1-1 6l-13-2v-4Z"} fill={dark} opacity="0.85" />
            </>
          ) : null}
          {config.hat === "crown" ? <path d="M32 25l5-9 6 6 5-9 5 9 6-6 5 9v3H32v-3Z" fill="#f2c063" /> : null}
          {config.hat === "cat" ? (
            <>
              <path d="M28 28l2-13 11 8-13 5Z" fill={plastic} />
              <path d="M68 28l-2-13-11 8 13 5Z" fill={plastic} />
              <path d="M31 25l1-7 6 4.5-7 2.5Z" fill={dark} opacity="0.3" />
              <path d="M65 25l-1-7-6 4.5 7 2.5Z" fill={dark} opacity="0.3" />
            </>
          ) : null}
          {config.hat === "fox" ? (
            <>
              <path d="M27 27l3-16 13 10-16 6ZM69 27l-3-16-13 10 16 6Z" fill="#e88a45" />
              <path d="m31 23 1-7 6 5-7 2ZM65 23l-1-7-6 5 7 2Z" fill={dark} opacity="0.55" />
            </>
          ) : null}
          {config.hat === "beanie" ? (
            <>
              <path d="M27 25c2-15 11-20 21-20s19 5 21 20H27Z" fill="#515dad" />
              <rect x="26" y="22" width="44" height="8" rx="4" fill="#414b94" />
              <circle cx="48" cy="5" r="5" fill="#515dad" />
            </>
          ) : null}
        </g>

        {/* --- в руке (при повороте — в передней руке, ближе к зрителю) --- */}
        <g transform={side ? "translate(-24,2)" : undefined}>
          {config.accessory === "spatula" ? (
            <g transform="rotate(20 70 74)">
              <rect x="68" y="60" width="4" height="16" rx="2" fill="#9a8a72" />
              <path d="M64 52h12l-2 9h-8l-2-9Z" fill="#cfd6d2" />
            </g>
          ) : null}
          {config.accessory === "wrench" ? (
            <g transform="rotate(-24 72 72)">
              <rect x="70" y="60" width="4.5" height="18" rx="2" fill="#cfd6d2" />
              <path d="M67 56a6 6 0 1 1 10.5 0l-3 3h-4.5l-3-3Z" fill="#cfd6d2" />
            </g>
          ) : null}
          {config.accessory === "heart" ? (
            <path
              d="M72 62c-2.8-2.6-7.5-.6-7.5 3 0 3 3.7 5.6 7.5 8.4 3.8-2.8 7.5-5.4 7.5-8.4 0-3.6-4.7-5.6-7.5-3Z"
              fill="#e8836f"
            />
          ) : null}
          {config.accessory === "caliper" ? (
            <g transform="rotate(18 72 68)" fill="none" stroke="#cfd6d2" strokeWidth="2.2" strokeLinecap="round">
              <path d="M70 54v25M66 57h10M66 75h8M70 64h6v7h-6" />
            </g>
          ) : null}
          {config.accessory === "solder" ? (
            <g transform="rotate(18 72 68)">
              <rect x="68" y="61" width="7" height="18" rx="3.5" fill="#515dad" />
              <path d="M71.5 61V51" stroke="#cfd6d2" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M71 79c5 5 8 2 7-2" stroke={dark} strokeWidth="1.6" fill="none" />
            </g>
          ) : null}
        </g>
      </g>
    </svg>
  );
}

// Аватар вне редактора: PNG-снапшот 3D-фигурки (рендерится при сохранении);
// SVG-маскот — фолбэк, пока снапшота нет (первый визит / нет WebGL). Общий примитив
// для ЛЮБОГО контекста показа персонажа — капсула шапки, меню, профиль (MF-15) и
// далее (MF-450/MF-1031) — проверка переиспользуемости снапшот-подхода, требуемая MF-449.
//
// `snapshots` — опциональный проп для показа ЧУЖОГО персонажа (лента/Make-галерея/лидерборд,
// MF-1030 отдаёт avatar_snapshots в списочных эндпоинтах): без него компонент читает свои
// снапшоты из localStorage (как и раньше, для капсулы/меню/профиля — их не трогаем).
export function AvatarBubble({
  config,
  size,
  facing,
  snapshots: snapshotsProp,
  label,
}: {
  config: AvatarConfig;
  size: number;
  facing: AvatarFacing;
  snapshots?: AvatarSnapshots | null;
  label?: string;
}) {
  const snapshots = snapshotsProp !== undefined ? resolveSnapshots(snapshotsProp ?? { front: null, left: null, right: null }) : storeSnapshots;
  if (snapshots?.[facing]) {
    return (
      <img
        src={snapshots[facing]!}
        width={size}
        height={size}
        alt={label ?? ""}
        decoding="async"
        style={{ display: "block", objectFit: "contain" }}
      />
    );
  }
  return <MakerAvatar config={config} size={size} facing={facing} label={label} />;
}

// Публичный интеграционный примитив: принимает только канонический mascot manifest,
// поэтому вызывающий код физически не может подсунуть photo/avatar_url или инициал.
export function UserAvatar({
  config,
  snapshots,
  size,
  label,
  facing = "front",
  seed,
}: {
  config?: AvatarConfig | null;
  snapshots?: AvatarSnapshots | null;
  size: number;
  label?: string;
  facing?: AvatarFacing;
  seed?: string;
}) {
  return (
    <AvatarBubble
      config={config ?? (seed ? deterministicAvatarConfig(seed) : DEFAULT_AVATAR)}
      snapshots={snapshots ?? null}
      size={size}
      facing={facing}
      label={label}
    />
  );
}