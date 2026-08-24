import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlagDialog } from "./flagdialog.tsx";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FlagDialog (MF-416)", () => {
  it("обозначает тип материала и отправляет флаг на пост", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        target: { type: "post", id: "post-1" },
        reason_code: "spam_or_fraud",
      });
      return response({ id: "flag-1", status: "open", target: { type: "post", id: "post-1", visibility: "visible" } }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();

    render(<FlagDialog target={{ type: "post", id: "post-1" }} onClose={() => {}} onHidden={() => {}} />);

    expect(screen.getByText("Тип материала: пост")).toBeTruthy();
    await interaction.click(screen.getByLabelText("Спам или мошенничество"));
    await interaction.click(screen.getByRole("button", { name: "Отправить жалобу" }));

    expect(await screen.findByText("Жалоба отправлена. Мы рассмотрим её.")).toBeTruthy();
  });

  it("не отправляет «другое» без пояснения, а после подтверждения API сообщает о временном скрытии", async () => {
    const onHidden = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/v1/community/flags");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        target: { type: "thread", id: "thread-1" },
        reason_code: "other",
        details: "Пожалуйста, проверьте опасную инструкцию",
      });
      expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(body.client_request_id);
      return response({ id: "flag-1", status: "actioned", target: { type: "thread", id: "thread-1", visibility: "hidden" } }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();

    render(<FlagDialog target={{ type: "thread", id: "thread-1" }} onClose={() => {}} onHidden={onHidden} />);

    await interaction.click(screen.getByLabelText("Другое"));
    const submit = screen.getByRole("button", { name: "Отправить жалобу" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await interaction.type(screen.getByLabelText(/Поясните, что произошло/), "Пожалуйста, проверьте опасную инструкцию");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await interaction.click(submit);

    expect(await screen.findByText("Жалоба отправлена. Материал временно скрыт на время проверки.")).toBeTruthy();
    expect(onHidden).toHaveBeenCalledTimes(1);
  });
});
