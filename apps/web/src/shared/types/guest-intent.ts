// Тип гостевого намерения (отложенное действие до логина). В shared, т.к. на
// него ссылается commerce как на тип (см. микроэтап 7.6). Рантайм
// (saveGuestIntent/takeGuestIntent/…) остаётся в domains/access/guestintent.ts.
export type GuestIntent =
  | { kind: "vote_model"; modelId: string; value: 1 | -1; returnTo: string }
  | {
      kind: "vote_feed";
      // 'thread'/'post' — форум (community.md §7.4, VoteArrows обобщён feed/vote.tsx на 4
      // subjectType). Сегодня недостижимо гостем (community/* закрыты AuthGate, app.tsx), но
      // компонент/интент типизированы на весь контракт сразу — тот же приём, что и остальные
      // "путь уже собран, экран/сценарий подключится позже" места в этом файле.
      subjectType: "feed_post" | "feed_comment" | "thread" | "post";
      subjectId: string;
      value: 1 | -1;
      returnTo: string;
    }
  | { kind: "download"; modelId: string; role: string; returnTo: string }
  | { kind: "fork"; modelId: string; returnTo: string }
  | { kind: "comment_model"; modelId: string; parentId?: string; body: string; returnTo: string }
  | { kind: "generate"; prompt: string; returnTo: string }
  | { kind: "printer_connect"; printerId: string; level: "managed-local" | "managed-bridge" | "custom"; ip?: string; returnTo: string };
