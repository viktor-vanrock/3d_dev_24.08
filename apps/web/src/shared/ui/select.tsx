import { Children, Fragment, isValidElement, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { DataSelect } from "./dataselect.tsx";

// Native select retains form values, validation and existing change handlers.
export function Select({ children, className, style, id, value, defaultValue, onFocus, onBlur, autoFocus, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const native = useRef<HTMLSelectElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const [localValue, setLocalValue] = useState<string | undefined>(defaultValue === undefined ? undefined : String(defaultValue));
  function flatten(nodes: ReactNode): ReactNode[] {
    return Children.toArray(nodes).flatMap((node) => isValidElement<{ children?: ReactNode }>(node) && (node.type === Fragment || node.type === "optgroup") ? flatten(node.props.children) : [node]);
  }
  const options = flatten(children);
  const first = options.find((node) => isValidElement(node));
  const firstValue = isValidElement<{ value?: string | number; children: ReactNode }>(first) ? String(first.props.value ?? first.props.children ?? "") : "";
  const current = value === undefined ? localValue ?? firstValue : String(value);
  return <span className={`uiSelectHost${className ? ` ${className}` : ""}`} style={style} ref={root}>
    <select {...props} ref={native} className="uiSelectNative" tabIndex={-1} aria-hidden="true" value={value === undefined ? current : value}
      onChange={(event) => { setLocalValue(event.target.value); props.onChange?.(event); }}
      onFocus={onFocus} onBlur={onBlur}
      onInvalid={(event) => {
        event.preventDefault(); props.onInvalid?.(event);
        root.current?.querySelector<HTMLButtonElement>(".dataSelectTrigger")?.focus();
      }}>{children}</select>
    <DataSelect value={current} onChange={(next) => {
      const element = native.current;
      if (!element) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(element, next);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }} disabled={props.disabled} required={props.required} label={props["aria-label"]}
      triggerProps={{ id: inputId, autoFocus, "aria-labelledby": props["aria-labelledby"], "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"], title: props.title,
        onFocus: () => native.current?.dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
        onBlur: () => native.current?.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
      }}>
      {options}
    </DataSelect>
  </span>;
}
