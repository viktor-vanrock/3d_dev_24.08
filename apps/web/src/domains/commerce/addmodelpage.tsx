import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { useOverlay } from "@platform/overlay";
import { AuroraBackground, Card, Eyebrow, Heading } from "@shared/ui";
import { marketPath, modelPath, navigate, projectStudioPath } from "../../router.ts";
import { AddModelFlow } from "./addmodel.tsx";
import "./market.css";

// Страница «Добавить проект» (MF-476, marketplace.v2.md §9.5 п.1): аплоад-флоу вынесен из
// модалки поверх каталога на отдельный полноэкранный маршрут `/project/add` — самый тяжёлый
// «кадр в кадре» (дропзона + прогресс + reveal + шаг «Опубликовать») больше не живёт над сеткой.
// Пост-аплоад-редирект (§7 v2) не меняется: «Опубликовать» → страница модели, не сюда.
export function AddModelPage({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const overlay = useOverlay();

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          onSectionChange={onSectionChange}
          onBack={() => navigate(marketPath())}
        />
      </div>
      <main className="homeContent marketAddWorkspace">
        <div className="marketAddPage">
          <section className="marketAddPageIntro">
            <Eyebrow>Новый проект</Eyebrow>
            <Heading size="md">Добавьте то, что уже есть</Heading>
            <p>
              Не нужно сначала выбирать тип проекта или заполнять длинную форму. Portal посмотрит на состав и покажет
              только нужные шаги.
            </p>
            <ol aria-label="Уровни проекта">
              <li>
                <span aria-hidden="true">○</span>
                <div>
                  <strong>Одна модель</strong>
                  <small>Превью, печать и отзывы</small>
                </div>
              </li>
              <li>
                <span aria-hidden="true">◐</span>
                <div>
                  <strong>Набор деталей</strong>
                  <small>Комплект, материалы и простая сборка</small>
                </div>
              </li>
              <li>
                <span aria-hidden="true">●</span>
                <div>
                  <strong>Код и электроника</strong>
                  <small>Фазы печати, сборки и настройки</small>
                </div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Подготовлено для Portal</strong>
                  <small>make/README или portal.project.yaml</small>
                </div>
              </li>
            </ol>
            <p className="marketAddPageNote">
              Всё можно дополнить позже. Для папки со сложной структурой безопаснее использовать ZIP или Git.
            </p>
          </section>
          <Card className="marketAddPageCard">
            <div className="marketAddPageCardHead">
              <Eyebrow>Исходники</Eyebrow>
              <strong>С чего начнём</strong>
              <span>Файл остаётся на устройстве до создания черновика.</span>
            </div>
            <AddModelFlow
              overlay={overlay}
              onClose={() => navigate(marketPath())}
              onUploaded={(modelId) => navigate(modelPath(modelId))}
              onRepoImport={(repoUrl) =>
                navigate(projectStudioPath("so-arm100", { source: repoUrl }))
              }
            />
          </Card>
        </div>
      </main>
    </div>
  );
}
