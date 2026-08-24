import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayProvider } from "@platform/overlay";

const { scene, createScene } = vi.hoisted(() => {
  const sceneHandle = {
    reset: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    scene: sceneHandle,
    createScene: vi.fn(
      (
        _canvas: HTMLCanvasElement,
        _url: string,
        callbacks: { onLoaded?: () => void },
      ) => {
        queueMicrotask(() => callbacks.onLoaded?.());
        return sceneHandle;
      },
    ),
  };
});

vi.mock("./modelscene.ts", () => ({
  createModelScene: createScene,
}));

vi.mock("./deviceprofile.ts", () => ({ isMobileViewerProfile: () => false }));

import { ModelViewer } from "./modelviewer.tsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModelViewer — действия просмотра", () => {
  it("после загрузки поясняет действия полноэкранного просмотра при hover и focus", async () => {
    const user = userEvent.setup();
    render(
      <OverlayProvider>
        <ModelViewer modelId="m1" title="Тестовая модель" previewUrl="/preview.glb" thumbUrl={null} />
      </OverlayProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Покрутить" }));

    const fullscreen = await screen.findByRole("button", { name: "Открыть 3D-модель на весь экран" });
    const reset = screen.getByRole("button", { name: "Вернуть исходное положение 3D-модели" });
    expect(scene.dispose).not.toHaveBeenCalled();

    await user.hover(fullscreen);
    expect(screen.getByRole("tooltip").textContent).toBe("Открыть 3D-модель на весь экран");

    await user.unhover(fullscreen);
    await user.tab();
    await user.tab();
    expect(screen.getByRole("tooltip").textContent).toBe("Вернуть исходное положение 3D-модели");
    expect(reset.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("не оставляет пустой canvas при смене готовой модели", async () => {
    const user = userEvent.setup();
    const view = render(
      <OverlayProvider>
        <ModelViewer modelId="m1" title="Первая модель" previewUrl="/first.glb" thumbUrl={null} />
      </OverlayProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Покрутить" }));
    await screen.findByRole("button", { name: "Открыть 3D-модель на весь экран" });
    expect(scene.dispose).not.toHaveBeenCalled();

    view.rerender(
      <OverlayProvider>
        <ModelViewer modelId="m2" title="Вторая модель" previewUrl="/second.glb" thumbUrl={null} />
      </OverlayProvider>,
    );

    await screen.findByRole("button", { name: "Покрутить" });
    expect(scene.dispose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Покрутить" }));
    await screen.findByRole("button", { name: "Открыть 3D-модель на весь экран" });
    expect(createScene).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      "/second.glb",
      expect.any(Object),
      "gltf",
      false,
    );
  });

  it("показывает повтор при синхронной ошибке WebGL", async () => {
    const user = userEvent.setup();
    createScene.mockImplementationOnce(() => {
      throw new Error("WebGL unavailable");
    });
    render(
      <OverlayProvider>
        <ModelViewer modelId="m1" title="Тестовая модель" previewUrl="/preview.glb" thumbUrl={null} />
      </OverlayProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Покрутить" }));
    expect(await screen.findByText("Не удалось загрузить превью")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });
});
