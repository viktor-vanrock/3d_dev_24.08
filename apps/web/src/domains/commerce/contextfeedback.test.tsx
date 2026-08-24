import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextChip, ContextFeedbackDoor, ProblemTag, TypeSelect } from "./contextfeedback.tsx";

afterEach(() => cleanup());

describe("ContextFeedbackDoor", () => {
  it("problem-пресет — иконка + «Сообщить о проблеме», навигирует на /issue/new с type=problem", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<ContextFeedbackDoor preset="problem" context={{ category: "catalog", ref: { type: "model", id: "42", title: "Вещь" } }} />);
    fireEvent.click(screen.getByText("Сообщить о проблеме"));
    expect(pushState).toHaveBeenCalledWith(
      null,
      "",
      "/issue/new?category=catalog&type=problem&ref_type=model&ref_id=42&ref_title=%D0%92%D0%B5%D1%89%D1%8C",
    );
  });

  it("suggest-пресет — «Предложить», без явного type в URL (дефолт формы — идея)", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<ContextFeedbackDoor preset="suggest" context={{ category: "account" }} />);
    fireEvent.click(screen.getByText("Предложить"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/issue/new?category=account");
  });
});

describe("ContextChip", () => {
  it("рендерит label, дублирует ✕ отвязать", () => {
    const onDismiss = vi.fn();
    render(<ContextChip label='Из карточки: «Держатель катушки v2»' onDismiss={onDismiss} />);
    expect(screen.getByText('Из карточки: «Держатель катушки v2»')).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Отвязать контекст"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("без onOpen — тап по лейблу не кликабелен (disabled)", () => {
    render(<ContextChip label="X" onDismiss={() => {}} />);
    expect((screen.getByText("X") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TypeSelect", () => {
  it("переключает idea/problem нативным дропдауном", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TypeSelect value="idea" onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Тип обращения" }), "problem");

    expect(onChange).toHaveBeenCalledWith("problem");
  });

  it("показывает подсказку про исключение проблемы из ленты голосования", () => {
    render(<TypeSelect value="problem" onChange={() => {}} />);
    expect(screen.getByText(/не попадает в общую ленту голосования/)).toBeTruthy();
  });
});

describe("ProblemTag", () => {
  it("рендерит нейтральную пилюлю «Проблема»", () => {
    render(<ProblemTag />);
    expect(screen.getByText("Проблема")).toBeTruthy();
  });
});
