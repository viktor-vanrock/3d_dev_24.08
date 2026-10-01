import { useId, useState } from "react";
import { Eyebrow, IconButton, Input } from "@shared/ui";
import type { MaterialVendor } from "./catalog.ts";

export function BrandSelect({ value, vendors, onChange, field = "brand" }: {
  field?: "brand" | "type" | "color";
  value: string;
  vendors: readonly MaterialVendor[];
  onChange: (value: string) => void;
}) {
  const labels = field === "color"
    ? { title: "ЦВЕТ", placeholder: "Выберите цвет", clear: "Очистить цвет", list: "Цвета материалов", empty: "Цвета не найдены" }
    : field === "type"
    ? { title: "ТИП", placeholder: "Выберите тип", clear: "Очистить тип", list: "Типы материалов", empty: "Типы не найдены" }
    : { title: "БРЕНД", placeholder: "Выберите бренд", clear: "Очистить бренд", list: "Бренды", empty: "Бренды не найдены" };
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = vendors.find((vendor) => vendor.slug === value || vendor.name === value);
  const displayValue = selected?.name ?? value;
  const query = displayValue.trim().toLocaleLowerCase("ru-RU");
  const options = selected ? vendors : vendors.filter((vendor) =>
    `${vendor.name} ${vendor.slug}`.toLocaleLowerCase("ru-RU").includes(query));
  const activeOption = options[active];
  function choose(vendor: MaterialVendor) {
    onChange(field === "color" ? vendor.slug : vendor.name);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div className="materialsField materialsBrandSelect" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
    }}>
      <label htmlFor={`${id}-input`}><Eyebrow>{labels.title}</Eyebrow></label>
      <div className="materialsTextControl">
        <Input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && activeOption ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          value={displayValue}
          placeholder={labels.placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const next = options.length === 0 ? -1 : event.key === "ArrowDown"
                ? (active + 1) % options.length : (active <= 0 ? options.length - 1 : active - 1);
              setActive(next);
              requestAnimationFrame(() => document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: "nearest" }));
            } else if (event.key === "Enter" && open && activeOption) {
              event.preventDefault(); choose(activeOption);
            } else if (event.key === "Escape" && open) {
              event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
            }
          }}
        />
        {value ? <IconButton variant="transparent" label={labels.clear} onClick={() => {
          onChange(""); setOpen(true); setActive(-1);
          document.getElementById(`${id}-input`)?.focus();
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </IconButton> : null}
      </div>
      {open ? <div className="materialsBrandMenu">
        <ul id={`${id}-list`} role="listbox" aria-label={labels.list}>
          {options.map((vendor, index) => <li
            id={`${id}-option-${index}`} key={vendor.id} role="option"
            aria-selected={selected?.id === vendor.id}
            data-active={active === index || undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(vendor)}
          >{vendor.name}<span aria-hidden="true">{selected?.id === vendor.id ? "✓" : ""}</span></li>)}
        </ul>
        {options.length === 0 ? <p role="status">{labels.empty}</p> : null}
      </div> : null}
    </div>
  );
}
