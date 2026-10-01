import { Children, isValidElement, useEffect, useRef, useId, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import "./dataselect.css";

export function DataSelect({ value, onChange, children, disabled, required, label, triggerProps }: {
  value: string; onChange: (value: string) => void; children: ReactNode;
  disabled?: boolean; required?: boolean; label?: string; triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const options = Children.toArray(children).filter(isValidElement<{ value: string | number; children: ReactNode; disabled?: boolean }>).map((option) => ({ value: String(option.props.value ?? option.props.children ?? ""), label: option.props.children, disabled: option.props.disabled }));
  const selected = options.find((option) => option.value === value);
  const choose = (next: string) => { onChange(next); setOpen(false); setActive(-1); };
  return <span ref={rootRef} className="dataSelect" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button {...triggerProps} type="button" className="dataSelectTrigger" role="combobox" aria-label={label} aria-expanded={open && !disabled} aria-controls={`${id}-options`} aria-haspopup="listbox" aria-required={required} disabled={disabled}
      aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          if (options.length === 0) return;
          const next = event.key === "ArrowDown" ? (active + 1) % options.length : (active <= 0 ? options.length - 1 : active - 1);
          setActive(next);
          requestAnimationFrame(() => document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: "nearest" }));
        } else if (event.key === "Enter" && open && options[active] && !options[active].disabled) { event.preventDefault(); choose(options[active].value); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }}>
      <span>{selected?.label ?? "Выберите значение"}</span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && !disabled ? <span className="dataSelectMenu" role="listbox" id={`${id}-options`} aria-label={label}>
      {options.map((option, index) => <span role="option" id={`${id}-${index}`} key={option.value} aria-selected={value === option.value} aria-disabled={option.disabled || undefined} data-active={index === active || undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); if (!option.disabled) choose(option.value); }}>{option.label}</span>)}
    </span> : null}
  </span>;
}
