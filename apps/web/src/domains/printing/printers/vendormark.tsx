// Иконка вендора без фото (MF-2039): вместо одинакового generic PrinterIcon для всех брендов —
// цветной кружок с первой буквой бренда, цвет детерминирован по имени (тот же приём hueFromId,
// что уже есть в market/market.tile.tsx и home/modeltile.tsx — раздельные копии по модулям,
// повторяем конвенцию, а не тащим кросс-модульный импорт market→printers ради 3 строк). Кружок
// ВСЕГДА закрашен сплошным hsl-фоном — исключает саму возможность "иконки без фона/невидимой на
// тёмной теме", которую поймали на скриншоте 3dmake (Stratasys/3D Systems/Markforged там едва
// видны на тёмном фоне — сырые лого без подложки).
function hueFromBrand(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function VendorMark({ brand, size = 32 }: { brand: string; size?: number }) {
  const initial = brand.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      className="prnVendorMark"
      style={{ ["--mark-hue" as string]: hueFromBrand(brand), width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
