import { useMemo, useState } from "react";
import type { SessionUser } from "@shared/types";
import type { Section } from "@platform/nav";
import { useOverlay } from "@platform/overlay";
import { modelPath, navigate, projectStudioPath } from "../../router.ts";
import { AuroraBackground, Button, Card, Eyebrow, Heading, StatusPill } from "@shared/ui";
import {
  ProjectHeadConflictError,
  mergeManifestPreservingExtensions,
  readDemoManifest,
  resetDemoManifest,
  saveDemoManifest,
} from "./projectmanifest.editor.ts";
import { PROJECT_CODE_CONTRACT_VERSION } from "./projectmanifest.constants.ts";
import "./projectstudio.css";

type StudioView = "source" | "configurations" | "kit" | "guide" | "changes" | "release";

const VIEWS: Array<{ id: StudioView; label: string; short: string }> = [
  { id: "source", label: "Исходники", short: "01" },
  { id: "configurations", label: "Варианты", short: "02" },
  { id: "kit", label: "Комплект", short: "03" },
  { id: "guide", label: "Инструкция", short: "04" },
  { id: "changes", label: "Изменения", short: "05" },
  { id: "release", label: "Релиз", short: "06" },
];

const COMMIT = "fda892cba81032c46c40976a48c9ceadbf40a9ca";
const RAW = `https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/${COMMIT}`;
const FOLLOWER_IMAGE = `${RAW}/media/SO101_Follower.webp`;
const LEADER_IMAGE = `${RAW}/media/SO101_Leader.webp`;

const DETECTED_GROUPS = [
  { icon: "▱", count: "29", title: "Файлы для печати", detail: "SO‑100, SO‑101, trays и отдельные STL", path: "STL/" },
  { icon: "◇", count: "18", title: "Исходники CAD", detail: "STEP-сборки и отдельные детали", path: "STEP/" },
  { icon: "⌘", count: "2", title: "Симуляции", detail: "URDF и MuJoCo для SO‑101", path: "Simulation/" },
  { icon: "≡", count: "6", title: "Документация", detail: "README, BOM, печать и лицензия", path: "README.md" },
];

const KIT_GROUPS: Array<{ title: string; tone: string; items: Array<[string, string, string]> }> = [
  {
    title: "Напечатать",
    tone: "print",
    items: [
      ["Комплект SO‑101 follower", "1 комплект", "STL/SO101/Follower/"],
      ["Калибровочный gauge", "1 шт.", "STL/SO101/Individual/"],
      ["Крепление камеры", "опционально", "STL/Optional/"],
    ],
  },
  {
    title: "Купить",
    tone: "buy",
    items: [
      ["Feetech STS3215 7.4V", "6 шт.", "Найдено 4 аналога"],
      ["Motor Control Board", "1 шт.", "Найдено 2 аналога"],
      ["Блок питания 5V", "1 шт.", "Найдено 18 аналогов"],
      ["USB‑C кабель", "1 шт.", "Найдено 40+ аналогов"],
      ["Комплект крепежа M3", "1 комплект", "По BOM автора"],
    ],
  },
  {
    title: "Инструменты",
    tone: "tool",
    items: [
      ["FDM-принтер", "стол от 220 × 220 мм", "Мой принтер подходит"],
      ["Крестовые отвёртки", "#0 и #1", "есть"],
      ["Бокорезы", "1 шт.", "не отмечено"],
      ["Компьютер", "Linux / macOS", "есть"],
    ],
  },
];

const GUIDE_STEPS = [
  { phase: "ПЕЧАТЬ", title: "Проверить посадку", body: "Сначала напечатайте gauge и проверьте посадку STS3215.", action: "Отправить gauge в печать", media: FOLLOWER_IMAGE },
  { phase: "ПЕЧАТЬ", title: "Напечатать детали", body: "Выберите tray под стол 220 × 220 или отдельные STL.", action: "Открыть комплект на столе", media: FOLLOWER_IMAGE },
  { phase: "СБОРКА", title: "Настроить ID сервоприводов", body: "Присвойте номера 1–6 до установки в корпус.", action: "Открыть схему нумерации", media: LEADER_IMAGE },
  { phase: "СБОРКА", title: "Собрать механику", body: "Закрепите звенья по порядку и оставьте свободную петлю кабеля.", action: "Показать сцену сборки", media: LEADER_IMAGE },
  { phase: "ЭЛЕКТРИКА", title: "Подключить контроллер", body: "Соедините сервоприводы, питание и USB‑C. Проверьте полярность.", action: "Показать проводку", media: FOLLOWER_IMAGE },
  { phase: "КОД", title: "Установить LeRobot", body: "Создайте Python-окружение и установите закреплённую версию.", action: "Открыть команды", media: LEADER_IMAGE },
  { phase: "КАЛИБРОВКА", title: "Откалибровать суставы", body: "Сохраните профиль этой руки и проверьте диапазоны.", action: "Запустить калибровку", media: FOLLOWER_IMAGE },
  { phase: "ПРОВЕРКА", title: "Первое движение", body: "Запустите короткий тест и убедитесь, что кабели не натягиваются.", action: "Добавить критерий готовности", media: LEADER_IMAGE },
];

const RECENT_COMMITS = [
  ["fda892c", "Update README.md", "26 фев 2026"],
  ["aec17b1", "Update actuator model params", "12 янв 2026"],
  ["9a6f6d7", "Add compliant soft finray gripper", "2 дек 2025"],
  ["787c510", "Update Seeed Studio mounting plate", "18 ноя 2025"],
];

function isStudioView(value?: string): value is StudioView {
  return VIEWS.some((view) => view.id === value);
}

export function ProjectStudioScreen({
  id,
  initialView,
  source,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  id: string;
  initialView?: string;
  source?: string;
}) {
  const overlay = useOverlay();
  const [view, setView] = useState<StudioView>(isStudioView(initialView) ? initialView : "source");
  const [manifestRead, setManifestRead] = useState(() => readDemoManifest());
  const [savedHead, setSavedHead] = useState(manifestRead.head_sha);
  const [dirty, setDirty] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState("so101-follower");
  const [selectedStep, setSelectedStep] = useState(0);
  const [releaseVersion, setReleaseVersion] = useState(manifestRead.manifest.project.release?.version ?? "0.1.14-portal.1");
  const [title, setTitle] = useState(manifestRead.manifest.project.title);
  const repoUrl = source || manifestRead.manifest.project.upstream?.url || "https://github.com/TheRobotStudio/SO-ARM100";
  const readyCount = useMemo(() => (dirty ? 5 : 6), [dirty]);

  function chooseView(next: StudioView) {
    setView(next);
    navigate(projectStudioPath(id, { view: next, source: repoUrl }));
  }

  function saveDraft(publish = false) {
    const currentManifest = mergeManifestPreservingExtensions(manifestRead.manifest, {
      project: {
        ...manifestRead.manifest.project,
        title,
        release: { version: releaseVersion, notes: publish ? "Готово к публикации на Portal." : "Рабочая версия." },
      },
    });
    try {
      const result = saveDemoManifest({
        contract_version: PROJECT_CODE_CONTRACT_VERSION,
        base_head_sha: savedHead,
        manifest: currentManifest,
        commit_message: publish ? `release: ${releaseVersion}` : "docs: update Portal project",
      });
      const next = { ...manifestRead, ...result, manifest: currentManifest };
      setManifestRead(next);
      setSavedHead(result.head_sha);
      setDirty(false);
      overlay.toast({
        severity: "success",
        title: publish ? `Версия ${releaseVersion} опубликована` : "Рабочая версия сохранена",
        message: publish ? "Лендинг и новые сборочные сессии закреплены на этой ревизии." : "Создан commit в portal/dev.",
      });
    } catch (error) {
      if (error instanceof ProjectHeadConflictError) {
        overlay.toast({
          severity: "critical",
          title: "В проекте появились новые изменения",
          message: "Обновите рабочую версию и повторите сохранение — чужие правки не перезаписаны.",
          duration: "sticky",
        });
      }
    }
  }

  function resetDemo() {
    resetDemoManifest();
    const reset = readDemoManifest();
    setManifestRead(reset);
    setSavedHead(reset.head_sha);
    setTitle(reset.manifest.project.title);
    setReleaseVersion(reset.manifest.project.release?.version ?? "0.1.14-portal.1");
    setDirty(false);
    overlay.toast({ severity: "info", title: "Тестовый импорт сброшен" });
  }

  return (
    <div className="home projectStudioPage">
      <AuroraBackground />
      <main className="homeContent homeWorkspaceBody projectStudioBody">
        <header className="projectStudioHero">
          <div className="projectStudioHeroMedia">
            <img src={FOLLOWER_IMAGE} alt="SO-101 follower arm" />
            <span className="projectStudioSourceBadge">Git · main</span>
          </div>
          <div className="projectStudioHeroCopy">
            <Eyebrow>Авторская мастерская</Eyebrow>
            <div className="projectStudioTitleRow">
              <Heading size="hero">SO‑ARM100</Heading>
              <StatusPill tone="ok">структура прочитана</StatusPill>
            </div>
            <p>Соберите из репозитория понятный продукт: варианты, покупки, печать, код и проверяемый результат.</p>
            <a href={repoUrl} target="_blank" rel="noreferrer" className="projectStudioRepoLink">
              TheRobotStudio/SO-ARM100 <span>↗</span>
            </a>
          </div>
          <div className="projectStudioHeroState">
            <span>Рабочая версия</span>
            <strong>{dirty ? "Есть несохранённые правки" : "Сохранено"}</strong>
            <code>portal/dev · {savedHead.slice(0, 8)}</code>
            <div className="projectStudioHeroActions">
              <Button variant="secondary" icon={null} onClick={() => saveDraft(false)}>Сохранить</Button>
              <button type="button" className="projectStudioBackLink pressable" onClick={() => navigate(modelPath(id))}>
                <span aria-hidden="true">←</span>
                К проекту
              </button>
            </div>
          </div>
        </header>

        <nav className="projectStudioNav" aria-label="Разделы авторской мастерской">
          {VIEWS.map((item) => (
            <button
              type="button"
              key={item.id}
              className="projectStudioNavItem pressable"
              data-active={view === item.id || undefined}
              onClick={() => chooseView(item.id)}
            >
              <span>{item.short}</span>
              {item.label}
              {item.id !== "release" ? <i aria-label="Раздел заполнен">✓</i> : null}
            </button>
          ))}
        </nav>

        <div className="projectStudioWorkspace">
          <div className="projectStudioMain">
            {view === "source" ? <SourceView repoUrl={repoUrl} onContinue={() => chooseView("configurations")} /> : null}
            {view === "configurations" ? (
              <ConfigurationsView
                selected={selectedConfig}
                onSelect={(value) => {
                  setSelectedConfig(value);
                  setDirty(true);
                }}
                onContinue={() => chooseView("kit")}
              />
            ) : null}
            {view === "kit" ? <KitView onChange={() => setDirty(true)} onContinue={() => chooseView("guide")} /> : null}
            {view === "guide" ? (
              <GuideView
                selectedStep={selectedStep}
                onSelect={setSelectedStep}
                onChange={() => setDirty(true)}
                onContinue={() => chooseView("changes")}
              />
            ) : null}
            {view === "changes" ? <ChangesView onContinue={() => chooseView("release")} /> : null}
            {view === "release" ? (
              <ReleaseView
                title={title}
                onTitle={(value) => {
                  setTitle(value);
                  setDirty(true);
                }}
                version={releaseVersion}
                onVersion={(value) => {
                  setReleaseVersion(value);
                  setDirty(true);
                }}
                onPublish={() => saveDraft(true)}
                onPreview={() => navigate(modelPath(id))}
              />
            ) : null}
          </div>
          <aside className="projectStudioAside">
            <Card className="projectStudioReadiness">
              <div className="projectStudioReadinessHead">
                <Eyebrow>Готовность</Eyebrow>
                <strong>{readyCount}/6</strong>
              </div>
              <div className="projectStudioProgress"><span style={{ width: `${(readyCount / 6) * 100}%` }} /></div>
              <ul>
                {VIEWS.map((item) => (
                  <li key={item.id} data-current={view === item.id || undefined}>
                    <span>{item.id === "release" && dirty ? "○" : "✓"}</span>
                    <button type="button" onClick={() => chooseView(item.id)}>{item.label}</button>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="projectStudioConsumer">
              <Eyebrow>Так увидит человек</Eyebrow>
              <img src={selectedConfig === "so101-pair" ? LEADER_IMAGE : FOLLOWER_IMAGE} alt="" />
              <strong>{selectedConfig === "so101-pair" ? "Пара leader + follower" : "Одна follower-рука"}</strong>
              <small>Комплект → покупки → 8 шагов → результат</small>
              <button type="button" className="projectStudioTextLink pressable" onClick={() => navigate(modelPath(id))}>
                Открыть лендинг →
              </button>
            </Card>
            <button type="button" className="projectStudioReset pressable" onClick={resetDemo}>Сбросить тестовый импорт</button>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="projectStudioSectionHead">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading size="md">{title}</Heading>
      <p>{text}</p>
    </div>
  );
}

function SourceView({ repoUrl, onContinue }: { repoUrl: string; onContinue: () => void }) {
  return (
    <section className="projectStudioView">
      <SectionHead
        eyebrow="Импорт завершён"
        title="Мы разобрали репозиторий"
        text="Portal ничего не переносил молча: ниже видны найденные сущности и то, как они попадут в проект."
      />
      <Card className="projectStudioRepoCard">
        <div className="projectStudioRepoIdentity"><span>GH</span><div><strong>TheRobotStudio / SO-ARM100</strong><small>Apache‑2.0 · public</small></div></div>
        <div><small>Ветка</small><strong>main</strong></div>
        <div><small>Закреплён commit</small><code>fda892cb</code></div>
        <a href={repoUrl} target="_blank" rel="noreferrer">Открыть GitHub ↗</a>
      </Card>
      <div className="projectStudioDetected">
        {DETECTED_GROUPS.map((group) => (
          <Card className="projectStudioDetectedCard" key={group.title}>
            <span className="projectStudioDetectedIcon">{group.icon}</span>
            <strong>{group.count}</strong>
            <div><b>{group.title}</b><small>{group.detail}</small><code>{group.path}</code></div>
          </Card>
        ))}
      </div>
      <div className="projectStudioNotice">
        <span>!</span>
        <div><strong>Готового portal.project.yaml нет</strong><p>Создадим его в <code>make/</code>. Исходные STL, STEP и README останутся на местах; репозиторий продолжит работать вне Portal.</p></div>
        <button type="button">Посмотреть будущий файл</button>
      </div>
      <div className="projectStudioActions"><Button onClick={onContinue}>Настроить варианты сборки</Button></div>
    </section>
  );
}

function ConfigurationsView({
  selected,
  onSelect,
  onContinue,
}: {
  selected: string;
  onSelect: (value: string) => void;
  onContinue: () => void;
}) {
  const configs = [
    { id: "so101-follower", badge: "Рекомендуем начать", title: "Одна follower-рука", text: "Первый рабочий результат без второй руки.", image: FOLLOWER_IMAGE, print: "≈ 600 г PLA+", parts: "6 сервоприводов", steps: "8 шагов" },
    { id: "so101-pair", badge: "Телеприсутствие", title: "Leader + follower", text: "Пара для управления и записи датасетов.", image: LEADER_IMAGE, print: "≈ 1,2 кг PLA+", parts: "12 сервоприводов", steps: "10 шагов" },
  ];
  return (
    <section className="projectStudioView">
      <SectionHead eyebrow="Результаты" title="Что человек сможет собрать" text="Один репозиторий может давать несколько законченных конфигураций с разными комплектами и инструкциями." />
      <div className="projectStudioConfigGrid">
        {configs.map((config) => (
          <button type="button" className="projectStudioConfig pressable" data-selected={selected === config.id || undefined} key={config.id} onClick={() => onSelect(config.id)}>
            <img src={config.image} alt="" />
            <span>{config.badge}</span>
            <strong>{config.title}</strong>
            <p>{config.text}</p>
            <ul><li>{config.print}</li><li>{config.parts}</li><li>{config.steps}</li></ul>
            <i>{selected === config.id ? "✓ Выбрано" : "Выбрать"}</i>
          </button>
        ))}
        <button type="button" className="projectStudioConfig projectStudioConfigAdd pressable"><b>＋</b><strong>Добавить вариант</strong><p>Например, SO‑100 или крепление камеры.</p></button>
      </div>
      <div className="projectStudioActions"><Button onClick={onContinue}>Собрать комплект</Button></div>
    </section>
  );
}

function KitView({ onChange, onContinue }: { onChange: () => void; onContinue: () => void }) {
  const [checked, setChecked] = useState<string[]>(["Комплект SO‑101 follower", "Feetech STS3215 7.4V", "Motor Control Board", "FDM-принтер"]);
  function toggle(item: string) {
    setChecked((current) => (current.includes(item) ? current.filter((value) => value !== item) : [...current, item]));
    onChange();
  }
  return (
    <section className="projectStudioView">
      <SectionHead eyebrow="Комплект проекта" title="Что напечатать, купить и подготовить" text="Автор задаёт требования, а Portal отдельно подбирает актуальные карточки и аналоги на доступных рынках." />
      <div className="projectStudioKitSummary">
        <div><span>Печать</span><strong>11 ч 40 мин</strong><small>≈ 584 г PLA+</small></div>
        <div><span>Покупки</span><strong>9 позиций</strong><small>4 требуют аналога</small></div>
        <div><span>Совместимость</span><strong>220 × 220 мм</strong><small>подходит 18 принтеров</small></div>
      </div>
      <div className="projectStudioKitGroups">
        {KIT_GROUPS.map((group) => (
          <Card className="projectStudioKitGroup" key={group.title}>
            <div className="projectStudioKitGroupHead" data-tone={group.tone}><strong>{group.title}</strong><span>{group.items.length}</span></div>
            {group.items.map(([name, quantity, hint]) => (
              <label key={name} className="projectStudioKitItem">
                <input type="checkbox" checked={checked.includes(name)} onChange={() => toggle(name)} />
                <span><strong>{name}</strong><small>{hint}</small></span>
                <b>{quantity}</b>
              </label>
            ))}
          </Card>
        ))}
      </div>
      <Card className="projectStudioMarketplace">
        <div><Eyebrow>Подбор аналогов</Eyebrow><strong>Карточки магазина не хранятся в проекте навсегда</strong><p>В манифесте остаются характеристики компонента. Перед покупкой Portal найдёт доступные предложения на Ozon, Яндекс Маркете и у профильных продавцов — автор подтверждает соответствие.</p></div>
        <button type="button" className="pressable">Проверить 4 аналога</button>
      </Card>
      <div className="projectStudioActions"><Button onClick={onContinue}>Собрать инструкцию</Button></div>
    </section>
  );
}

function GuideView({
  selectedStep,
  onSelect,
  onChange,
  onContinue,
}: {
  selectedStep: number;
  onSelect: (value: number) => void;
  onChange: () => void;
  onContinue: () => void;
}) {
  const step = GUIDE_STEPS[selectedStep]!;
  return (
    <section className="projectStudioView">
      <SectionHead eyebrow="Путь пользователя" title="Инструкция — это исполняемый сценарий" text="Каждый шаг связывает объяснение, нужные детали, визуальную сцену и безопасное действие Portal." />
      <div className="projectStudioGuide">
        <ol className="projectStudioStepRail">
          {GUIDE_STEPS.map((item, index) => (
            <li key={item.title} data-active={index === selectedStep || undefined}>
              <button type="button" onClick={() => onSelect(index)}><span>{String(index + 1).padStart(2, "0")}</span><small>{item.phase}</small><strong>{item.title}</strong></button>
            </li>
          ))}
          <li className="projectStudioStepAdd"><button type="button" onClick={onChange}>＋ Добавить шаг</button></li>
        </ol>
        <Card className="projectStudioStepEditor">
          <div className="projectStudioStepEditorTop"><Eyebrow>Шаг {selectedStep + 1} · {step.phase}</Eyebrow><button type="button">•••</button></div>
          <label>Заголовок<input defaultValue={step.title} onChange={onChange} /></label>
          <label>Что нужно сделать<textarea defaultValue={step.body} onChange={onChange} rows={4} /></label>
          <div className="projectStudioStepMedia">
            <img src={step.media} alt="" />
            <div><strong>Визуальная подсказка</strong><small>Фото сейчас · 3D-сцена может заменить его позже</small><button type="button">Заменить медиа</button></div>
          </div>
          <div className="projectStudioStepAction"><span>Действие Portal</span><strong>⚡ {step.action}</strong><small>Пользователь увидит кнопку только при совместимом устройстве.</small></div>
          <div className="projectStudioStepEditorActions"><button type="button" onClick={onChange}>＋ Деталь</button><button type="button" onClick={onChange}>＋ Предупреждение</button><button type="button" onClick={onChange}>＋ Критерий готовности</button></div>
        </Card>
      </div>
      <div className="projectStudioActions"><Button onClick={onContinue}>Проверить изменения</Button></div>
    </section>
  );
}

function ChangesView({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="projectStudioView">
      <SectionHead eyebrow="Разработка" title="Меняйте проект как код — или через Portal" text="Обе поверхности работают с одной рабочей версией. Файлы, шаги и BOM не расходятся в две копии." />
      <div className="projectStudioBranchFlow">
        <Card><Eyebrow>Рабочая версия</Eyebrow><strong>portal/dev</strong><code>fda892cb + 1 commit</code><StatusPill tone="warn">есть правки</StatusPill></Card>
        <span>→</span>
        <Card><Eyebrow>Выпуск</Eyebrow><strong>main</strong><code>fda892cb</code><StatusPill tone="ok">опубликовано</StatusPill></Card>
      </div>
      <div className="projectStudioChangeActions">
        <button type="button" className="pressable"><span>◇</span><div><strong>Изменить 3D-модель</strong><small>Загрузить новую ревизию STL/STEP или заменить файл в Git.</small></div><i>→</i></button>
        <button type="button" className="pressable"><span>⌘</span><div><strong>Изменить код и прошивку</strong><small>Открыть связанные файлы, ветку и проверки.</small></div><i>→</i></button>
        <button type="button" className="pressable"><span>≡</span><div><strong>Изменить инструкцию</strong><small>Редактор обновит make/manifest и создаст commit.</small></div><i>→</i></button>
      </div>
      <Card className="projectStudioHistory">
        <div className="projectStudioHistoryHead"><div><Eyebrow>История источника</Eyebrow><strong>Последние изменения</strong></div><a href="https://github.com/TheRobotStudio/SO-ARM100/commits/main" target="_blank" rel="noreferrer">Вся история ↗</a></div>
        {RECENT_COMMITS.map(([sha, subject, date], index) => <div className="projectStudioCommit" key={sha}><span>{index === 0 ? "●" : "○"}</span><code>{sha}</code><strong>{subject}</strong><small>{date}</small></div>)}
      </Card>
      <div className="projectStudioActions"><Button onClick={onContinue}>Подготовить релиз</Button></div>
    </section>
  );
}

function ReleaseView({
  title,
  onTitle,
  version,
  onVersion,
  onPublish,
  onPreview,
}: {
  title: string;
  onTitle: (value: string) => void;
  version: string;
  onVersion: (value: string) => void;
  onPublish: () => void;
  onPreview: () => void;
}) {
  const checks = [
    ["Структура проекта", "Все ссылки на файлы разрешены"],
    ["2 конфигурации", "У каждой есть комплект и workflow"],
    ["8 шагов", "Печать → сборка → код → проверка"],
    ["Совместимость", "Размер стола и материал указаны"],
    ["Лицензия", "Apache‑2.0 найдена в репозитории"],
  ];
  return (
    <section className="projectStudioView">
      <SectionHead eyebrow="Публикация" title="Выпустите стабильную версию" text="Новые сборки закрепятся на этой ревизии. Следующие изменения останутся в рабочей версии до нового релиза." />
      <div className="projectStudioReleaseGrid">
        <Card className="projectStudioReleaseForm">
          <label>Название проекта<input value={title} onChange={(event) => onTitle(event.target.value)} /></label>
          <label>Версия выпуска<input value={version} onChange={(event) => onVersion(event.target.value)} /></label>
          <label>Что изменилось<textarea defaultValue="Первый выпуск на Portal: две конфигурации, проверенный BOM и интерактивная сборка SO‑101." rows={5} /></label>
          <div className="projectStudioReleaseTarget"><span>Будет создано</span><strong>main · tag v{version}</strong><code>manifest + release notes</code></div>
        </Card>
        <Card className="projectStudioReleaseChecks">
          <Eyebrow>Проверки перед выпуском</Eyebrow>
          {checks.map(([titleValue, textValue]) => <div key={titleValue}><span>✓</span><p><strong>{titleValue}</strong><small>{textValue}</small></p></div>)}
          <StatusPill tone="ok">можно публиковать</StatusPill>
        </Card>
      </div>
      <Card className="projectStudioReleasePreview">
        <img src={FOLLOWER_IMAGE} alt="" />
        <div><Eyebrow>Публичный лендинг</Eyebrow><strong>SO‑ARM100 / SO‑101</strong><p>Человек выберет вариант, проверит совместимость, соберёт корзину и начнёт личную пошаговую сессию.</p><button type="button" onClick={onPreview}>Предпросмотр лендинга →</button></div>
      </Card>
      <div className="projectStudioActions projectStudioActionsSplit"><Button variant="secondary" icon={null} onClick={onPreview}>Предпросмотр</Button><Button onClick={onPublish}>Опубликовать версию</Button></div>
    </section>
  );
}
