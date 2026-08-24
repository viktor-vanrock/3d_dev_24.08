import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SchemaField } from "./schemafield.tsx";
import type { LeafField } from "./formstate.ts";

afterEach(() => {
  cleanup();
});

const EMPTY: LeafField = { value: "", notFound: false, sourceIndex: null };

// Три состояния SchemaField, никогда сетка прочерков (docs/design/research.workbench.md §2.5,
// §6 «Готово когда»): заполнено (значение + сноска), «искали, нет данных» (галка + приглушено),
// не трогали (обычное пустое поле, без сноски и без шума).
describe("SchemaField (MF-917)", () => {
  it("не трогали: пустое поле, обычный плейсхолдер, галка не отмечена, без сноски", () => {
    const { container } = render(<SchemaField label="Макс. температура" type="number" field={EMPTY} onChange={() => {}} />);
    const input = screen.getByPlaceholderText("Макс. температура") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.disabled).toBe(false);
    expect(container.querySelector('[role="checkbox"][aria-checked="true"]')).toBeNull();
    expect(container.querySelector(".rsSourceFootnote")).toBeNull();
  });

  it("заполнено: значение видно + сноска-источник кликабельна", () => {
    const field: LeafField = { value: "300", notFound: false, sourceIndex: 1 };
    const { container } = render(
      <SchemaField label="Макс. температура" type="number" field={field} onChange={() => {}} sourceLabel="[2] example.com" sources={["a", "b"]} />,
    );
    expect((container.querySelector(".rsInput") as HTMLInputElement).value).toBe("300");
    expect(screen.getByText("[2] example.com")).toBeTruthy();
  });

  it("«искали, нет данных»: поле приглушено/выключено, галка залита, плейсхолдер курсивный «не нашёл»", () => {
    const field: LeafField = { value: "", notFound: true, sourceIndex: null };
    const { container } = render(<SchemaField label="Материал хотэнда" type="text" field={field} onChange={() => {}} />);
    const input = screen.getByPlaceholderText("не нашёл") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(container.querySelector('[role="checkbox"][aria-checked="true"]')).toBeTruthy();
  });

  it("тап в поле снимает галку «не нашёл» (взаимоисключающе, без модалки)", () => {
    const field: LeafField = { value: "", notFound: true, sourceIndex: null };
    const onChange = vi.fn();
    const { container } = render(<SchemaField label="Материал хотэнда" type="text" field={field} onChange={onChange} />);
    fireEvent.click(container.querySelector('[role="checkbox"]')!);
    expect(onChange).toHaveBeenCalledWith({ ...field, notFound: false });
  });

  it("ввод значения снимает notFound (взаимоисключающе)", () => {
    const onChange = vi.fn();
    render(<SchemaField label="Покрытие" type="text" field={EMPTY} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Покрытие"), { target: { value: "PEI" } });
    expect(onChange).toHaveBeenCalledWith({ value: "PEI", notFound: false, sourceIndex: null });
  });

  it("состояние error: коралловая рамка + текст под полем", () => {
    const field: LeafField = { value: "abc", notFound: false, sourceIndex: null };
    render(<SchemaField label="Цена" type="number" field={field} onChange={() => {}} error="ожидается число" />);
    expect(screen.getByText("ожидается число")).toBeTruthy();
  });

  it("boolean-поле: Да/Нет переключаются как единое значение", () => {
    const onChange = vi.fn();
    render(<SchemaField label="Сопло сменное" type="boolean" field={EMPTY} onChange={onChange} />);
    fireEvent.click(screen.getByText("Да"));
    expect(onChange).toHaveBeenCalledWith({ value: "true", notFound: false, sourceIndex: null });
  });
});
