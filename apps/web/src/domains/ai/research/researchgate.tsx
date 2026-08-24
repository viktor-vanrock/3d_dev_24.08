import type { ReactNode } from "react";
import type { SessionUser } from "@shared/types";
import { EmptyState } from "@shared/ui";
import "./research.css";

// Гейт роли (§0, общий для /research и /research/<slug>): роль есть → рендерим экран как есть;
// роли нет → EmptyState «вербует», не отказывает (тот же паттерн, что закрытый саб/«нет роли»,
// НЕ 404/403). Гостя AuthGate (auth/authgate.tsx) уже отсекает раньше — сюда экран приходит только
// с залогиненным SessionUser, так что здесь только развилка «есть роль»/«нет роли».

function SearchFolderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="m14.2 15.2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ResearcherRoleGate({ user, children }: { user: SessionUser; children: ReactNode }) {
  if (user.role !== "researcher") {
    return (
      <div className="rsGateWrap">
        <EmptyState
          icon={<SearchFolderIcon />}
          title="Это рабочее место команды Ресёрчеров"
          sub="Здесь заполняют базу принтеров — характеристики, фото, источники"
          action={
            <a className="uiButton pressable" data-variant="primary" href="mailto:team@3mf.tech?subject=Хочу%20заполнять%20каталог%20принтеров">
              <span>Хочу заполнять каталог →</span>
            </a>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}
