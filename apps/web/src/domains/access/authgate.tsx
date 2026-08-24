import type { ReactNode } from "react";
import type { SessionState, SessionUser } from "./session.ts";
import { HandleOnboarding } from "./onboarding.tsx";

// Гейт сессии всего приложения (docs/issues/002.auth.triple.md, снят точечно MF-850/MF-912:
// публичные роуты `/`, `/project`, `/project/:id`, `/feed` теперь читаются гостем). Это SPA-уровень:
// реальная защита данных — на apps/api (preHandler-гейт в server.ts), этот компонент только решает,
// что показать. Render-prop (не ReactNode) — чтобы children получал уже готового user, а не делал
// повторный fetch /auth/session сам. Гость получает `null` вместо мгновенного <LoginPage/> —
// app.tsx решает по маршруту, публичный он или нет (LoginPage — для закрытых экранов там же).
// `session` приходит снаружи (не свой useSession()) — app.tsx вызывает хук guest-intent resume
// (guestresume.tsx) безусловно на каждый рендер, а его входу нужен тот же `user`; два независимых
// useSession() задвоили бы /auth/session, плюс условный вызов children() здесь сломал бы
// Rules of Hooks, будь хук внутри самого render-prop.
export function AuthGate({ session, children }: { session: SessionState; children: (user: SessionUser | null) => ReactNode }) {
  if (session.status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
        }}
      >
        Проверяем доступ…
      </div>
    );
  }

  if (session.status === "guest") {
    return children(null);
  }

  // Регистрация не завершена (MF-355, Фаза 2): username сгенерирован автоматически при
  // первом входе, но ещё не подтверждён — вместо приложения показываем выбор хендла.
  if (!session.user.handle_confirmed) {
    return <HandleOnboarding user={session.user} />;
  }

  return children(session.user);
}
