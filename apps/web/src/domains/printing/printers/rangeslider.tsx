import { useState } from "react";
import { useInteractionSound } from "@platform/sound";
import "./printers.css";

// `RangeSlider` — новый переиспользуемый примитив (docs/design/printers.catalog.md §2.3/§9):
// двойной ползунок, трек-пилюля 4px, заливка между бегунками, живые числовые подписи. Первое
// применение — фасет цены каталога принтеров; валюта/единица — параметр вызывающей стороны
// (`formatValue`), сам слайдер о деньгах не знает. Два наложенных нативных `<input type="range">`
// вместо самодельного pointer-драга — тач/клавиатура/скринридер работают бесплатно, бегунки стилизуются
// через `::-webkit-slider-thumb`/`::-moz-range-thumb` (printers.css).

export interface RangeSliderProps {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  step?: number;
  onChange: (min: number, max: number) => void;
  formatValue: (value: number) => string;
}

export function RangeSlider({ min, max, valueMin, valueMax, step = 1, onChange, formatValue }: RangeSliderProps) {
  const sound = useInteractionSound();
  const [bounce, setBounce] = useState<"min" | "max" | null>(null);
  const span = Math.max(max - min, 1);
  const fillStart = ((valueMin - min) / span) * 100;
  const fillEnd = ((valueMax - min) / span) * 100;

  function commit() {
    sound.tick();
  }

  return (
    <div className="prnRangeSlider">
      <div className="prnRangeSliderLabels">
        <span>{formatValue(valueMin)}</span>
        <span>{formatValue(valueMax)}</span>
      </div>
      <div className="prnRangeSliderTrack" style={{ ["--fill-start" as string]: `${fillStart}%`, ["--fill-end" as string]: `${fillEnd}%` }}>
        <input
          type="range"
          className="prnRangeSliderInput"
          data-thumb="min"
          data-bounce={bounce === "min" || undefined}
          min={min}
          max={max}
          step={step}
          value={valueMin}
          aria-label="Минимальное значение"
          onChange={(event) => {
            const next = Math.min(Number(event.target.value), valueMax);
            onChange(next, valueMax);
          }}
          onPointerUp={() => {
            setBounce("min");
            commit();
          }}
          onKeyUp={() => setBounce("min")}
        />
        <input
          type="range"
          className="prnRangeSliderInput"
          data-thumb="max"
          data-bounce={bounce === "max" || undefined}
          min={min}
          max={max}
          step={step}
          value={valueMax}
          aria-label="Максимальное значение"
          onChange={(event) => {
            const next = Math.max(Number(event.target.value), valueMin);
            onChange(valueMin, next);
          }}
          onPointerUp={() => {
            setBounce("max");
            commit();
          }}
          onKeyUp={() => setBounce("max")}
        />
      </div>
    </div>
  );
}
