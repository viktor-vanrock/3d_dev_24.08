// Общие типы сессии/пользователя. Живут в shared, т.к. на них ссылаются
// несколько доменов (commerce, social) как на тип — домены друг друга не
// импортируют, а shared виден всем (см. apps/web/MIGRATION.md, микроэтап 7.6).
// Рантайм-логика сессии (useSession, startEmailAuth, …) остаётся в
// domains/access/session.ts, которая реэкспортирует эти типы отсюда.

export interface SessionUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  handle_confirmed: boolean;
  // RBAC (MF-878) — сегодня единственная не-"user" роль: researcher (гейт /research, MF-917).
  role: "user" | "researcher";
}

export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; user: SessionUser }
  | { status: "guest" };

export interface ProfilePatch {
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  website_url?: string | null;
  contacts?: { label: string; url: string }[];
}
