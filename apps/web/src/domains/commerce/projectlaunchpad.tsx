import type { ModelDetail } from "./models.ts";
import { projectConfigurationsFor } from "./projectconfig.ts";
import { apiAssetUrl } from "@shared/api";
import "./projectlaunchpad.css";

export function ProjectLaunchpad({
  model,
  onStart,
}: {
  model: ModelDetail;
  onStart: (configurationId: string) => void;
}) {
  const configurations = projectConfigurationsFor(model);
  return (
    <section className="projectLaunchpad" aria-labelledby="project-launchpad-title">
      <header className="projectLaunchpadHead">
        <div>
          <span>Варианты проекта</span>
          <h2 id="project-launchpad-title">Выберите, что хотите собрать</h2>
          <p>
            Сначала сравните результат и требования. Пошаговая работа откроется отдельно и сохранит ваш прогресс.
          </p>
        </div>
        <div className="projectLaunchpadFlow" aria-label="Как устроен проект">
          <span>1 · выбрать</span>
          <span>2 · проверить комплект</span>
          <span>3 · начать сборку</span>
        </div>
      </header>

      <div className="projectLaunchpadGrid">
        {configurations.map((configuration) => (
          <article
            className="projectConfigCard"
            data-recommended={configuration.recommended || undefined}
            key={configuration.id}
          >
            <div className="projectConfigMedia">
              {configuration.imageUrl ? <img src={apiAssetUrl(configuration.imageUrl)} alt="" loading="lazy" /> : null}
              <span>{configuration.label}</span>
              {configuration.recommended ? <strong>Рекомендуем начать здесь</strong> : null}
            </div>
            <div className="projectConfigBody">
              <div>
                <h3>{configuration.title}</h3>
                <p>{configuration.summary}</p>
              </div>
              <dl>
                {configuration.requirements.map((requirement) => (
                  <div key={requirement.label}>
                    <dt>{requirement.label}</dt>
                    <dd>{requirement.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="projectConfigResult">
                <span>Результат</span>
                <p>{configuration.result}</p>
              </div>
              <button
                type="button"
                className="projectConfigStart pressable"
                onClick={() => onStart(configuration.id)}
              >
                Начать проект
                <small>{configuration.estimatedSteps} этапов</small>
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
