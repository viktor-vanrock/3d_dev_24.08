import { useInteractionSound } from "@platform/sound";
import { navigate, printerPath } from "../../../router.ts";
import { ProgressiveImage, StatusPill } from "@shared/ui";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing→ai PrinterRecord, развязка отложена до pages/DI. См. MIGRATION.md.
import type { PrinterRecord } from "@domains/ai";
import { hasCapability, printerPrice, type CapabilityKey, type Currency } from "./facets.ts";
import { CAPABILITY_LABEL, KINEMATICS_LABEL, STATUS_LABEL, STATUS_TONE } from "./labels.ts";
import { VendorMark } from "./vendormark.tsx";
import "./printers.css";

// `PrinterTile` — новый переиспользуемый примитив (docs/design/printers.catalog.md §3/§9):
// отвечает на один вопрос «это он? открывать?» — не спека в миниатюре. Не путать с
// `homeModelTile` маркетплейса (слоёный псевдо-3D) — здесь плоское фото продукта 16:9.

function priceLabel(printer: PrinterRecord, currency: Currency, _todayMs: number): string {
  const price = printerPrice(printer, currency);
  if (price == null) return "цена уточняется";
  const formatted = currency === "rub" ? `${price.toLocaleString("ru-RU")} ₽` : `$${price.toLocaleString("en-US")}`;
  return formatted;
}

function tileChips(printer: PrinterRecord, contextCapability: CapabilityKey | null): string[] {
  const chips: string[] = [];
  if (contextCapability && hasCapability(printer, contextCapability)) {
    chips.push(CAPABILITY_LABEL[contextCapability]);
  }
  const bv = printer.build_volume as Record<string, unknown>;
  if (typeof bv.x === "number" && typeof bv.y === "number" && typeof bv.z === "number") {
    const label = `${bv.x}×${bv.y}×${bv.z}`;
    if (!chips.includes(label)) chips.push(label);
  }
  if (printer.kinematics && chips.length < 3) {
    const label = KINEMATICS_LABEL[printer.kinematics];
    if (label && !chips.includes(label)) chips.push(label);
  }
  if (chips.length < 3 && hasCapability(printer, "laser")) {
    if (!chips.includes(CAPABILITY_LABEL.laser)) chips.push(CAPABILITY_LABEL.laser);
  }
  if (chips.length < 3 && hasCapability(printer, "ams")) {
    if (!chips.includes(CAPABILITY_LABEL.ams)) chips.push(CAPABILITY_LABEL.ams);
  }
  return chips.slice(0, 3);
}

export interface PrinterTileProps {
  printer: PrinterRecord;
  index: number;
  currency: Currency;
  todayMs: number;
  contextCapability?: CapabilityKey | null;
  compareSelected: boolean;
  compareDisabled: boolean;
  onToggleCompare: () => void;
  onOpen?: () => void;
  muted?: boolean;
  gapField?: string | null;
}

export function PrinterTile({
  printer,
  index,
  currency,
  todayMs,
  contextCapability = null,
  compareSelected,
  compareDisabled,
  onToggleCompare,
  onOpen,
  muted = false,
  gapField = null,
}: PrinterTileProps) {
  const sound = useInteractionSound();
  const open = () => {
    onOpen?.();
    navigate(printerPath(printer.slug));
  };
  const statusKey = printer.status as keyof typeof STATUS_LABEL;
  const showStatus = statusKey !== "shipping";
  const chips = muted && gapField ? [`нет данных о «${gapField}»`] : tileChips(printer, contextCapability);
  const hero = printer.media.hero;

  return (
    <div
      className="prnTile"
      style={{ ["--i" as string]: index }}
      data-selected={compareSelected || undefined}
      data-muted={muted || undefined}
      data-has-verify={printer._meta.verified === false || undefined}
    >
      <div
        className="prnTilePhoto pressable"
        role="button"
        tabIndex={0}
        aria-label={`${printer.brand} ${printer.model}`}
        onPointerDown={sound.tick}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter") open();
        }}
      >
        <ProgressiveImage
          className="prnTilePhotoMedia"
          imageClassName="prnTilePhotoImg"
          src={hero}
          alt=""
          fallback={<div className="prnTilePlaceholder">
            <VendorMark brand={printer.brand} size={40} />
            <span className="prnTilePlaceholderBrand">{printer.brand}</span>
          </div>}
        />
        <div className="prnTileBadges">
          {showStatus ? (
            <StatusPill tone={STATUS_TONE[statusKey]} level={STATUS_TONE[statusKey] === "ok" ? 2 : undefined}>
              {STATUS_LABEL[statusKey]}
            </StatusPill>
          ) : null}
        </div>
        {printer._meta.verified === false ? (
          <div className="prnTileVerifyBadge">
            <StatusPill tone="warn">уточняется</StatusPill>
          </div>
        ) : null}
      </div>
      <div className="prnTileBody pressable" onClick={open} role="presentation">
        <div className="prnTileBrand">{printer.brand}</div>
        <div className="prnTileModel">{printer.model}</div>
        <div className="prnTilePrice">{priceLabel(printer, currency, todayMs)}</div>
        {chips.length > 0 ? (
          <div className="prnTileChips">
            {chips.map((chip) => (
              <span key={chip} className="prnTileChip" data-gap={muted || undefined}>
                {chip}
              </span>
            ))}
          </div>
        ) : null}
        <label className="prnTileCompareControl" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={compareSelected}
            disabled={compareDisabled && !compareSelected}
            onChange={() => {
              sound.toggle();
              onToggleCompare();
            }}
          />
          <span>{compareSelected ? "В сравнении" : "Добавить к сравнению"}</span>
        </label>
      </div>
    </div>
  );
}
