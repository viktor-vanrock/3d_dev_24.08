// Сессия/JWT мигрированы в Nest (nest/auth/session-verifier.ts + modules/auth). Здесь остаётся
// только разделяемый тип идентичности пользователя, который переиспользует git/paths.ts
// (gitAuthorForUser) как форму «id + username» — чтобы не заводить второй тип под тот же смысл.
export interface SessionUser {
  id: string;
  username: string;
}
