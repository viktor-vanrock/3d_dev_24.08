import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { OverlayProvider, useOverlay } from "@platform/overlay";
import { PostAttachmentPicker, type PostAttachment } from "./attachmentpicker.tsx";

afterEach(() => cleanup());

const user = { id: "u1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function Picker() {
  const overlay = useOverlay();
  const [attachment, setAttachment] = useState<PostAttachment | null>(null);
  return <PostAttachmentPicker user={user} overlay={overlay} attachment={attachment} onChange={setAttachment} />;
}

describe("PostAttachmentPicker — GitVerse", () => {
  it("даёт полю ссылки доступное имя", () => {
    render(
      <OverlayProvider>
        <Picker />
      </OverlayProvider>,
    );

    expect(screen.getByRole("tablist", { name: "Тип публикации" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "GitVerse" }));

    expect(screen.getByRole("textbox", { name: "Ссылка на репозиторий GitVerse" })).toBeTruthy();
  });
});
