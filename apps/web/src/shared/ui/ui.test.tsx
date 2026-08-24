import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionCard, Button, Chip, IconButton, ProgressiveImage, TextField, Tooltip } from "./ui.tsx";

afterEach(() => {
  cleanup();
});

describe("ActionCard disabled state", () => {
  it("renders a disabled button outside keyboard focus and blocks activation", () => {
    const onClick = vi.fn();
    render(<ActionCard title="Недоступный уровень" icon={null} disabled onClick={onClick} />);

    const card = screen.getByRole("button", { name: "Недоступный уровень" });
    expect(card.getAttribute("disabled")).toBe("");
    card.focus();
    expect(document.activeElement).not.toBe(card);

    card.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("removes a disabled link from keyboard focus and prevents navigation", () => {
    render(<ActionCard title="Скоро" icon={null} href="/soon" disabled />);

    const card = screen.getByRole("link", { name: "Скоро" });
    expect(card.getAttribute("tabindex")).toBe("-1");

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(card.dispatchEvent(click)).toBe(false);
    expect(click.defaultPrevented).toBe(true);
  });
});

describe("Chip states", () => {
  it("exposes selected and disabled state to assistive technology", () => {
    render(<Chip selected disabled onClick={() => undefined}>Мои подписки</Chip>);

    const chip = screen.getByRole("button", { name: "Мои подписки" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect((chip as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Figma UI-kit control contract", () => {
  it("выводит вариант и размер кнопок без локальных CSS-классов экрана", () => {
    render(
      <>
        <Button variant="translucent" size="s">Контекст</Button>
        <IconButton label="Добавить" variant="accent" size="xs">+</IconButton>
      </>,
    );

    const button = screen.getByRole("button", { name: "Контекст" });
    expect(button.dataset.variant).toBe("translucent");
    expect(button.dataset.size).toBe("s");

    const iconButton = screen.getByRole("button", { name: "Добавить" });
    expect(iconButton.dataset.variant).toBe("accent");
    expect(iconButton.dataset.size).toBe("xs");
  });

  it("не придумывает primary-кнопке стрелку, если иконка отсутствует в макете", () => {
    const { container } = render(<Button>Сохранить</Button>);

    expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
    expect(container.querySelector(".uiButtonIconPlain")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("поддерживает Figma-варианты с иконкой слева и справа", () => {
    const { container } = render(
      <>
        <Button icon={<i data-testid="start-icon" />} iconPosition="start">Назад</Button>
        <Button icon={<i data-testid="end-icon" />} iconPosition="end">Дальше</Button>
      </>,
    );

    const [start, end] = Array.from(container.querySelectorAll(".uiButton"));
    expect(start?.getAttribute("data-icon-position")).toBe("start");
    expect(start?.firstElementChild?.classList.contains("uiButtonIconPlain")).toBe(true);
    expect(end?.getAttribute("data-icon-position")).toBe("end");
    expect(end?.lastElementChild?.classList.contains("uiButtonIconPlain")).toBe(true);
  });

  it("оставляет Figma-размеры desktop и включает 10-foot токены только для D-pad", () => {
    const tokens = readFileSync(resolve(process.cwd(), "src/platform/theme/tokens.css"), "utf8");

    expect(tokens).toMatch(/--button-radius:\s*var\(--pill-radius\)/);
    expect(tokens).toMatch(/--chip-radius:\s*var\(--pill-radius\)/);
    expect(tokens).toMatch(/--input-radius:\s*var\(--field-radius\)/);
    expect(tokens).toMatch(/:root\[data-input-mode="dpad"\]\s*\{[^}]*--tv-target-min:\s*64px/s);
    expect(tokens).not.toMatch(
      /@media \(min-width:\s*1200px\) and \(min-height:\s*640px\)\s*\{\s*:root\s*\{/,
    );
  });

  it("связывает label, hint и error с нативным полем", () => {
    const { rerender } = render(
      <TextField label="Название проекта" hint="До 80 символов" placeholder="Лампа" />,
    );

    const input = screen.getByRole("textbox", { name: "Название проекта" });
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("До 80 символов")).toBeTruthy();

    rerender(<TextField label="Название проекта" error="Заполните поле" />);
    expect(screen.getByRole("textbox", { name: "Название проекта" }).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Заполните поле")).toBeTruthy();
  });
});

describe("Tooltip", () => {
  it("открывает пояснение по touch и оставляет его связанным с контролом", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Добавить принтер к сравнению">
        <button type="button" aria-label="Добавить к сравнению">+</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Добавить к сравнению" });
    await user.pointer([{ target: trigger, keys: "[TouchA>]" }]);

    expect(screen.getByRole("tooltip").textContent).toBe("Добавить принтер к сравнению");
    expect(trigger.getAttribute("aria-describedby")).toBeTruthy();
  });
});

describe("ProgressiveImage (MF-2050)", () => {
  it("держит shimmer до load и затем проявляет изображение в том же контейнере", () => {
    const { container } = render(<ProgressiveImage src="/preview.webp" alt="Превью" />);
    const media = container.querySelector<HTMLElement>(".uiProgressiveMedia")!;
    const image = screen.getByRole("img", { name: "Превью" });

    expect(media.dataset.state).toBe("loading");
    expect(media.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".uiProgressiveMediaSkeleton")).toBeTruthy();

    fireEvent.load(image);
    expect(media.dataset.state).toBe("ready");
    expect(media.getAttribute("aria-busy")).toBeNull();
    expect(container.querySelector(".uiProgressiveMediaSkeleton")).toBeNull();
  });

  it("после ошибки показывает честный fallback, а не вечный skeleton", () => {
    const { container } = render(<ProgressiveImage src="/missing.webp" fallback={<span>Превью готовится</span>} />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("Превью готовится")).toBeTruthy();
    expect(container.querySelector<HTMLElement>(".uiProgressiveMedia")?.dataset.state).toBe("error");
  });
});

describe("Обратная связь интерактивных примитивов", () => {
  it("сохраняет границу аффорданса карточки и темнит её при hover без движения раскладки", () => {
    render(<ActionCard title="Сделать самому" sub="Описание действия" icon="→" onClick={() => undefined} />);

    const card = screen.getByRole("button", { name: /сделать самому/i });
    expect(card.classList.contains("pressable")).toBe(true);
    expect(card.classList.contains("uiActionCard")).toBe(true);

    const styles = readFileSync(resolve(process.cwd(), "src/shared/ui/ui.css"), "utf8");
    const tokens = readFileSync(resolve(process.cwd(), "src/platform/theme/tokens.css"), "utf8");

    expect(tokens).toMatch(/--state-hover-brightness:/);
    expect(tokens).toMatch(/--state-press-brightness:/);
    expect(styles).toMatch(/\.uiActionCardIcon\s*\{[^}]*border:\s*1px solid var\(--card-action-border\)/s);
    expect(styles).toMatch(/\.uiActionCard:not\([^)]*\):hover\s+\.uiActionCardIcon\s*\{[^}]*border-color:\s*var\(--card-action-border-hover\)/s);
  });

  it("оставляет базовые кнопки и чипы в общем контракте нажатия", () => {
    render(
      <>
        <Button variant="secondary">Вторичное действие</Button>
        <Chip onClick={() => undefined}>Фильтр</Chip>
      </>,
    );

    const secondaryButton = screen.getByRole("button", { name: "Вторичное действие" });
    const chip = screen.getByRole("button", { name: "Фильтр" });
    expect(secondaryButton.classList.contains("pressable") && secondaryButton.classList.contains("uiButton")).toBe(true);
    expect(chip.classList.contains("pressable") && chip.classList.contains("uiChip")).toBe(true);
  });
});
