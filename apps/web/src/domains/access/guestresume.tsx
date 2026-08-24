import { useEffect, useRef } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): access→ai createThread/sendMessage/stashPendingRun (возобновление гостевого запроса открывает диалог с ассистентом), развязка отложена до pages/DI. См. MIGRATION.md.
import { createThread, sendMessage, stashPendingRun } from "@domains/ai";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { voteThread, votePost, voteFeedComment, voteFeedPost } from "@domains/social";
import { useOverlay } from "@platform/overlay";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { fileDownloadUrl, forkModel, getModel, postModelComment, triggerBrowserDownload, voteModel } from "@domains/commerce";
import { apiAssetUrl } from "@shared/api";
import { assistantWorkshopPath, modelPath, navigate } from "../../router.ts";
import { savePrinterResume, takeGuestIntent, type GuestIntent } from "./guestintent.ts";
import type { SessionUser } from "./session.ts";

// Доигрывает намерение гостя (см. guestintent.ts) один раз, как только сессия стала
// авторизованной — ровно тот момент, когда app.tsx получает `user` после логина (полный
// reload/редирект, см. комментарий в guestintent.ts).
function useResumeGuestIntent(user: SessionUser | null): void {
  const overlay = useOverlay();
  const resolvedOnce = useRef(false);

  useEffect(() => {
    if (!user || resolvedOnce.current) return;
    const intent = takeGuestIntent();
    if (!intent) return;
    resolvedOnce.current = true;
    void resume(intent, user, overlay.toast);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlay.toast стабилен по ссылке, resolvedOnce гасит повтор
  }, [user]);
}

// Компонент, не хук — рендерится в app.tsx безусловным соседом AuthGate (внутри OverlayProvider,
// нужен для useOverlay), не внутри его render-prop: там условные ветки (loading/guest/onboarding
// вызывают children() не всегда) сломали бы Rules of Hooks, вызови мы хук прямо там.
export function GuestIntentResumer({ user }: { user: SessionUser | null }) {
  useResumeGuestIntent(user);
  return null;
}

async function resume(
  intent: GuestIntent,
  user: SessionUser,
  toast: ReturnType<typeof useOverlay>["toast"],
): Promise<void> {
  if (window.location.pathname !== intent.returnTo) {
    navigate(intent.returnTo);
  }
  try {
    switch (intent.kind) {
      case "vote_model": {
        const result = await voteModel(intent.modelId, intent.value);
        if (!result) throw new Error("vote_model failed");
        toast({ severity: "success", title: "Голос учтён" });
        return;
      }
      case "vote_feed": {
        const voteFn =
          intent.subjectType === "feed_post"
            ? voteFeedPost
            : intent.subjectType === "feed_comment"
              ? voteFeedComment
              : intent.subjectType === "thread"
                ? voteThread
                : votePost;
        const result = await voteFn(intent.subjectId, intent.value);
        if (!result) throw new Error("vote_feed failed");
        toast({ severity: "success", title: "Голос учтён" });
        return;
      }
      case "fork": {
        const result = await forkModel(intent.modelId);
        if (!result) throw new Error("fork failed");
        navigate(modelPath(result.id));
        toast({ severity: "success", title: "Форк создан" });
        return;
      }
      case "comment_model": {
        const comment = await postModelComment(intent.modelId, intent.body, intent.parentId ?? null);
        if (!comment) throw new Error("comment failed");
        toast({ severity: "success", title: "Комментарий отправлен" });
        return;
      }
      case "download": {
        if (intent.role === "canonical_3mf") {
          const model = await getModel(intent.modelId);
          if (!model?.download_url) throw new Error("no download_url");
          triggerBrowserDownload(apiAssetUrl(model.download_url));
        } else {
          triggerBrowserDownload(fileDownloadUrl(intent.modelId, intent.role));
        }
        return;
      }
      case "generate": {
        // Вход не должен молча запускать дорогой generation job. Возвращаем гостя в
        // приватную мастерскую с сохранённым запросом; запуск он подтвердит после brief.
        const title = intent.prompt.length > 52 ? `${intent.prompt.slice(0, 49)}…` : intent.prompt;
        const thread = await createThread(title);
        if (!thread) throw new Error("createThread failed");
        const sent = await sendMessage(thread.id, intent.prompt);
        if ("run" in sent && sent.run) stashPendingRun(thread.id, sent.run.id);
        navigate(assistantWorkshopPath(thread.id));
        return;
      }
      case "printer_connect": {
        savePrinterResume(intent);
        navigate(intent.returnTo);
        toast({ severity: "info", title: "Вход выполнен", message: "Продолжите подключение принтера." });
        return;
      }
    }
  } catch {
    toast({ severity: "warn", title: "Не удалось продолжить действие", message: "Попробуйте ещё раз." });
  }
}
