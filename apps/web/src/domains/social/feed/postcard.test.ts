import { describe, expect, it } from "vitest";
import { editorialSummaryFromMarkdown, formatStars, isScoreApprox, markdownSnippet, postKindLabel } from "./postcard.tsx";
import type { FeedPost } from "./api.ts";

describe("markdownSnippet (feed.md §2.2 — заголовки/списки схлопнуты в текст)", () => {
  it("схлопывает заголовки/списки в текст", () => {
    expect(markdownSnippet("## Привет\n- пункт один\n- пункт два")).toBe("Привет пункт один пункт два");
  });

  it("вырезает картинки, ссылки оставляет текстом", () => {
    expect(markdownSnippet("текст ![alt](img.png) и [ссылка](https://x)")).toBe("текст и ссылка");
  });

  it("вырезает блоки кода целиком", () => {
    expect(markdownSnippet("до\n```\nconst x = 1;\n```\nпосле")).toBe("до после");
  });

  it("вырезает portal:embed блоки целиком, не оставляя сырой HTML-комментарий/JSON в превью", () => {
    const body =
      'текст поста.\n\n<!-- portal:embed {"kind":"sources","items":[{"url":"https://x","title":"X"}]} -->\nИсточники: [X](https://x)\n<!-- /portal:embed -->';
    expect(markdownSnippet(body)).toBe("текст поста.");
  });
});

describe("editorialSummaryFromMarkdown (MF-2064 — структура новости в карточке)", () => {
  it("выделяет лид, подзаголовки и Mermaid-схему", () => {
    const summary = editorialSummaryFromMarkdown(
      "Главный вывод новости и контекст для читателя.\n\n## Что изменилось\n\nПодробности.\n\n### Что это значит для мейкера\n\n```mermaid\ngraph LR\nA-->B\n```",
    );
    expect(summary.lead).toBe("Главный вывод новости и контекст для читателя.");
    expect(summary.sections).toEqual(["Что изменилось", "Что это значит для мейкера"]);
    expect(summary.visualSource).toContain("```mermaid");
    expect(summary.structured).toBe(true);
  });

  it("поддерживает обычную markdown-картинку старых публикаций", () => {
    const summary = editorialSummaryFromMarkdown("Лид.\n\n![Стенд](https://dev.3mf.tech/media/stand.jpg)");
    expect(summary.lead).toBe("Лид.");
    expect(summary.visualSource).toContain('"kind":"image"');
    expect(summary.visualSource).toContain("https://dev.3mf.tech/media/stand.jpg");
    expect(summary.structured).toBe(true);
  });

  it("для простого текста оставляет прежний компактный режим", () => {
    const summary = editorialSummaryFromMarkdown("Обычный короткий пост без структуры.");
    expect(summary.structured).toBe(false);
    expect(summary.visualSource).toBeNull();
  });
});

function post(overrides: Partial<FeedPost>): FeedPost {
  return {
    id: "1",
    type: "text",
    title: "t",
    body: null,
    community_id: null,
    author_id: "a",
    model_id: null,
    media_s3_key: null,
    votes_up: 0,
    votes_down: 0,
    comments_count: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("isScoreApprox (feed.md §3 — размытый счёт первые 10 минут)", () => {
  it("нулевой рейтинг не получает бессмысленный префикс «~»", () => {
    expect(isScoreApprox(post({ created_at: new Date().toISOString() }))).toBe(false);
  });

  it("свежий ненулевой рейтинг (<10 мин) — approx=true без явного флага API", () => {
    expect(isScoreApprox(post({ created_at: new Date().toISOString(), votes_up: 3 }))).toBe(true);
  });

  it("старый пост (>10 мин) — approx=false", () => {
    expect(isScoreApprox(post({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }))).toBe(false);
  });

  it("явный score_approx от API имеет приоритет", () => {
    expect(isScoreApprox(post({ created_at: new Date().toISOString(), score_approx: false }))).toBe(false);
  });
});

describe("postKindLabel (2026-07-21 — агентские посты получают «Новости», не generic-лейбл)", () => {
  it("текстовый пост человека без co-автора остаётся «Обсуждение»", () => {
    expect(postKindLabel(post({ type: "text" }))).toBe("Обсуждение");
  });

  it("текстовый пост с co_author_agent_id — «Новости»", () => {
    expect(postKindLabel(post({ type: "text", co_author_agent_id: "agent-1" }))).toBe("Новости");
  });

  it("медиа-пост человека (фото) остаётся «Фотоотчёт»", () => {
    expect(postKindLabel(post({ type: "media", media_kind: "image" }))).toBe("Фотоотчёт");
  });

  it("медиа-пост с co_author_agent_id — «Новости», а не «Фотоотчёт»", () => {
    expect(postKindLabel(post({ type: "media", media_kind: "image", co_author_agent_id: "agent-1" }))).toBe("Новости");
  });

  it("type-специфичные лейблы (Новинка/3D-проект/GitVerse/Напечатано) не перекрываются co-автором", () => {
    expect(postKindLabel(post({ type: "printer_announcement", co_author_agent_id: "agent-1" }))).toBe("Новинка");
    expect(postKindLabel(post({ type: "model_link", co_author_agent_id: "agent-1" }))).toBe("3D-проект");
  });
});

describe("formatStars (feed.md §2.2 — «⭐ 1.2k» бейдж GitVerse-репо)", () => {
  it("до 1000 — точное число", () => {
    expect(formatStars(42)).toBe("42");
    expect(formatStars(999)).toBe("999");
  });

  it("от 1000 — округление до одной десятой 'k'", () => {
    expect(formatStars(1200)).toBe("1.2k");
    expect(formatStars(15000)).toBe("15k");
  });
});
