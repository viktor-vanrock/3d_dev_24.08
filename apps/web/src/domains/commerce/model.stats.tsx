import { useEffect, useState } from "react";
import type { GuestIntent } from "@shared/types";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import { makePath, modelPath, navigate, profilePath, type ModelTab } from "../../router.ts";
import { SegmentToggle, type SegmentOption, Button, Chip, EmptyState, Eyebrow, StatTile } from "@shared/ui";
import {
  getMakeDetail,
  getMakeLeaderboard,
  listMakes,
  makePhotoUrl,
  type MakeLeaderboardEntry,
  type MakeSummary,
} from "./makes.ts";
import { ModelComments } from "./modelcomments.tsx";
import { DEMO_PROJECT_MEDIA, isDemoProjectId } from "./demoproject.ts";
import { LEROBOT_PROJECT_ID, LEROBOT_PROJECT_MEDIA } from "./lerobotproject.ts";
import type { ModelComboStat, ModelDetail, ModelMakeStats } from "./models.ts";

// Соцблоки страницы модели (MF-476, marketplace.v2.md §9.5 п.2; вынесено из model.tsx MF-911):
// вкладки-под-маршруты под героем, вместо «простыни» из трёх лент подряд. «Напечатали» показывает
// фото живых Make, автора-персонажа, принтер, оценку и агрегаты совместимости (MF-395/MF-779/
// MF-1794). «Статистика» — только владельцу (§6.1 v2: приватные метрики автора).
export function ModelSocialTabs({
  model,
  activeTab,
  mine,
  userId,
  onGuestComment,
  onAddMake,
}: {
  model: ModelDetail;
  activeTab: ModelTab | undefined;
  mine: boolean;
  userId: string | null;
  onGuestComment: (intent?: GuestIntent) => void;
  onAddMake: () => void;
}) {
  const options: SegmentOption<ModelTab>[] = [
    { value: "comments", label: "Обсуждение" },
    { value: "makes", label: "Напечатали" },
    ...(mine ? [{ value: "stats" as const, label: "Статистика" }] : []),
  ];
  const effectiveTab: ModelTab = activeTab === "stats" && !mine ? "comments" : (activeTab ?? "comments");

  return (
    <div className="modelSocialTabs">
      <SegmentToggle
        ariaLabel="Раздел проекта"
        options={options}
        value={effectiveTab}
        onChange={(next) => navigate(modelPath(model.id, next === "comments" ? undefined : next))}
      />
      <div className="modelSocialPanel">
        {effectiveTab === "comments" ? (
          isDemoProjectId(model.id) ? (
            <DemoProjectDiscussion model={model} onGuestComment={onGuestComment} />
          ) : (
            <ModelComments
              modelId={model.id}
              currentUserId={userId}
              ownerId={model.owner.id}
              onGuestComment={onGuestComment}
            />
          )
        ) : null}
        {effectiveTab === "makes" ? <ModelMakesPanel model={model} userId={userId} onAddMake={onAddMake} /> : null}
        {effectiveTab === "stats" && mine ? <OwnerStatsPanel model={model} /> : null}
      </div>
    </div>
  );
}

interface ProofMake extends MakeSummary {
  photoUrl: string | null;
}

const OTTO_PROJECT_PROOFS: ProofMake[] = [
  {
    id: "otto-make-1",
    model_id: "otto-diy",
    model_title: "Otto DIY",
    author: {
      id: "otto-maker-liza",
      username: "liza_prints",
      display_name: "Лиза",
      avatar_config: null,
      avatar_snapshots: null,
    },
    machine_id: "demo-machine-a1",
    machine_model: "Bambu Lab A1",
    material_ids: ["demo-pla-yellow"],
    caption: "Первый робот сына: детали сели без подгонки, сервоприводы спрятались аккуратно.",
    printability_rating: 5,
    geometry_quality_rating: 5,
    surface_quality_rating: 5,
    issue_tags: [],
    status: "published",
    cover_photo_s3_key: null,
    likes_count: 148,
    comments_count: 19,
    reposts_count: 7,
    views_count: 1840,
    created_at: "2026-07-11T15:30:00.000Z",
    photoUrl: DEMO_PROJECT_MEDIA.main,
  },
  {
    id: "otto-make-2",
    model_id: "otto-diy",
    model_title: "Otto DIY",
    author: {
      id: "otto-maker-roman",
      username: "roman_robotics",
      display_name: "Роман",
      avatar_config: null,
      avatar_snapshots: null,
    },
    machine_id: "demo-machine-ender",
    machine_model: "Creality Ender-3 V3",
    material_ids: ["demo-pla-blue"],
    caption: "Поменял лицо и добавил Bluetooth — теперь Otto управляется со смартфона.",
    printability_rating: 4,
    geometry_quality_rating: 5,
    surface_quality_rating: 4,
    issue_tags: [],
    status: "published",
    cover_photo_s3_key: null,
    likes_count: 96,
    comments_count: 11,
    reposts_count: 4,
    views_count: 972,
    created_at: "2026-07-14T09:20:00.000Z",
    photoUrl: DEMO_PROJECT_MEDIA.flyer,
  },
  {
    id: "otto-make-3",
    model_id: "otto-diy",
    model_title: "Otto DIY",
    author: {
      id: "otto-maker-school",
      username: "school_lab",
      display_name: "Школьная лаборатория",
      avatar_config: null,
      avatar_snapshots: null,
    },
    machine_id: "demo-machine-prusa",
    machine_model: "Original Prusa MK4",
    material_ids: ["demo-pla-white"],
    caption: "Собрали пять роботов на кружке. Полный комплект печатается за один учебный день.",
    printability_rating: 5,
    geometry_quality_rating: 5,
    surface_quality_rating: 5,
    issue_tags: [],
    status: "published",
    cover_photo_s3_key: null,
    likes_count: 81,
    comments_count: 8,
    reposts_count: 9,
    views_count: 1136,
    created_at: "2026-07-08T12:00:00.000Z",
    photoUrl: DEMO_PROJECT_MEDIA.head,
  },
];

const LEROBOT_PROJECT_PROOFS: ProofMake[] = [
  {
    id: "lerobot-make-so101",
    model_id: LEROBOT_PROJECT_ID,
    model_title: "LeRobotDepot",
    author: {
      id: "lerobot-maker-mira",
      username: "mira_makes",
      display_name: "Мира",
      avatar_config: null,
      avatar_snapshots: null,
    },
    machine_id: "lerobot-machine-a1",
    machine_model: "Bambu Lab A1",
    material_ids: ["lerobot-pla-plus"],
    caption: "Собрала follower SO‑101. Gauge сэкономил перепечатку: после компенсации отверстий все сервоприводы сели с первого раза.",
    printability_rating: 5,
    geometry_quality_rating: 5,
    surface_quality_rating: 5,
    issue_tags: [],
    status: "published",
    cover_photo_s3_key: null,
    likes_count: 214,
    comments_count: 27,
    reposts_count: 18,
    views_count: 4_280,
    created_at: "2026-07-15T16:40:00.000Z",
    photoUrl: LEROBOT_PROJECT_MEDIA.arm,
  },
  {
    id: "lerobot-make-lekiwi",
    model_id: LEROBOT_PROJECT_ID,
    model_title: "LeRobotDepot",
    author: {
      id: "lerobot-maker-sasha",
      username: "sasha_robotics",
      display_name: "Саша",
      avatar_config: null,
      avatar_snapshots: null,
    },
    machine_id: "lerobot-machine-ender",
    machine_model: "Creality Ender-3 V3",
    material_ids: ["lerobot-pla"],
    caption: "Сначала отладил руку на столе, потом перенёс её на LeKiwi. Такой порядок реально упрощает диагностику питания и камер.",
    printability_rating: 4,
    geometry_quality_rating: 5,
    surface_quality_rating: 4,
    issue_tags: [],
    status: "published",
    cover_photo_s3_key: null,
    likes_count: 173,
    comments_count: 34,
    reposts_count: 21,
    views_count: 3_940,
    created_at: "2026-07-13T11:12:00.000Z",
    photoUrl: LEROBOT_PROJECT_MEDIA.lekiwi,
  },
  {
    id: "lerobot-make-xlerobot",
    model_id: LEROBOT_PROJECT_ID,
    model_title: "LeRobotDepot",
    author: {
      id: "lerobot-maker-lab",
      username: "open_robot_lab",
      display_name: "Open Robot Lab",
      avatar_config: null,
      avatar_snapshots: null,
    },
    machine_id: "lerobot-machine-mk4",
    machine_model: "Original Prusa MK4",
    material_ids: ["lerobot-petg"],
    caption: "Две SO‑101, мобильная база и три камеры. Добавили свой держатель батареи и отправили ссылку на remix в обсуждение.",
    printability_rating: 5,
    geometry_quality_rating: 4,
    surface_quality_rating: 5,
    issue_tags: [],
    status: "published",
    cover_photo_s3_key: null,
    likes_count: 301,
    comments_count: 48,
    reposts_count: 39,
    views_count: 7_820,
    created_at: "2026-07-17T08:05:00.000Z",
    photoUrl: LEROBOT_PROJECT_MEDIA.xlerobot,
  },
];

function demoProjectProofs(modelId: string): ProofMake[] {
  return modelId === LEROBOT_PROJECT_ID ? LEROBOT_PROJECT_PROOFS : OTTO_PROJECT_PROOFS;
}

function demoProjectLeaderboard(modelId: string): MakeLeaderboardEntry[] {
  return demoProjectProofs(modelId).map((make) => ({
  id: make.id,
  user_id: make.author.id,
  username: make.author.username,
  display_name: make.author.display_name,
  avatar_url: null,
  avatar_config: make.author.avatar_config,
  avatar_snapshots: make.author.avatar_snapshots,
  caption: make.caption,
  printability_rating: make.printability_rating,
  likes_count: make.likes_count,
  comments_count: make.comments_count,
  reposts_count: make.reposts_count,
  views_count: make.views_count,
  created_at: make.created_at,
  }));
}

function ModelMakesPanel({ model, userId, onAddMake }: { model: ModelDetail; userId: string | null; onAddMake: () => void }) {
  const [sort, setSort] = useState<"new" | "popular">("popular");
  const [proofs, setProofs] = useState<ProofMake[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isDemoProjectId(model.id)) {
      const demoProofs = demoProjectProofs(model.id);
      const items =
        sort === "new"
          ? [...demoProofs].sort((a, b) => b.created_at.localeCompare(a.created_at))
          : demoProofs;
      setProofs(items);
      return () => {
        cancelled = true;
      };
    }
    if (!userId) {
      setProofs([]);
      return () => {
        cancelled = true;
      };
    }
    setProofs(null);
    void listMakes({ modelId: model.id, sort, limit: 6 }).then(async (result) => {
      if (!result || cancelled) {
        if (!cancelled) setProofs([]);
        return;
      }
      const items = await Promise.all(
        result.items.map(async (item): Promise<ProofMake> => {
          const detail = await getMakeDetail(item.id);
          const cover = detail?.photos.find((photo) => photo.is_cover) ?? detail?.photos[0];
          return { ...item, photoUrl: cover ? makePhotoUrl(item.id, cover.id) : null };
        }),
      );
      if (!cancelled) setProofs(items);
    });
    return () => {
      cancelled = true;
    };
  }, [model.id, sort, userId]);

  const hasMakes = model.make_stats.makes_count > 0;

  return (
    <div className="modelMakesProof">
      <header className="modelMakesProofHead">
        <div>
          <Eyebrow>Результаты сообщества</Eyebrow>
          <h2>Как проект получается у людей</h2>
          <p>Фотографии, реальный принтер, материал и честная оценка печатабельности.</p>
        </div>
        <Button variant="secondary" onClick={onAddMake}>
          Добавить свою печать
        </Button>
      </header>

      {hasMakes ? (
        <>
          <MakeStatsPanel stats={model.make_stats} combos={model.top_combos} />
          <div className="modelMakesProofToolbar">
            <span>Фото готовых работ</span>
            <div>
              <Chip selected={sort === "popular"} onClick={() => setSort("popular")}>
                Лучшие
              </Chip>
              <Chip selected={sort === "new"} onClick={() => setSort("new")}>
                Новые
              </Chip>
            </div>
          </div>
          {proofs && proofs.length > 0 ? (
            <div className="modelMakesProofGrid">
              {proofs.map((make) => (
                <article key={make.id} className="modelMakeProofCard">
                  <button
                    type="button"
                    className="modelMakeProofPhoto pressable"
                    onClick={() => navigate(makePath(make.id))}
                    aria-label={`Открыть результат @${make.author.username}`}
                  >
                    {make.photoUrl ? (
                      <img src={make.photoUrl} alt={`Печать проекта пользователем @${make.author.username}`} loading="lazy" />
                    ) : (
                      <span aria-label="Фото проходит модерацию">
                        <DiscussionIcon />
                        фото готовится
                      </span>
                    )}
                  </button>
                  <div className="modelMakeProofBody">
                    <div className="modelMakeProofAuthor">
                      <AvatarBubble
                        config={make.author.avatar_config ?? deterministicAvatarConfig(make.author.username || make.author.id)}
                        snapshots={make.author.avatar_config ? make.author.avatar_snapshots : null}
                        size={28}
                        facing="front"
                      />
                      <button type="button" className="pressable" onClick={() => navigate(profilePath(make.author.username))}>
                        @{make.author.username}
                      </button>
                    </div>
                    {make.caption ? <p>{make.caption}</p> : null}
                    <div className="modelMakeProofMeta">
                      <span>{make.machine_model ?? "Принтер не указан"}</span>
                      <span>▲ {make.likes_count}</span>
                    </div>
                    {/* MF-1962: три раздельные строки — печатаемость и геометрия оценивают сам
                        проект, поверхность — конкретный отпечаток этого автора на его станке/
                        филаменте. Не смешивать в одно число. */}
                    <div className="modelMakeProofRatings">
                      <span>Печатабельность</span>
                      <strong>{make.printability_rating ? `${make.printability_rating}/5` : "—"}</strong>
                    </div>
                    <div className="modelMakeProofRatings">
                      <span>Геометрия модели</span>
                      <strong>{make.geometry_quality_rating ? `${make.geometry_quality_rating}/5` : "—"}</strong>
                    </div>
                    <div className="modelMakeProofRatings">
                      <span>Поверхность отпечатка</span>
                      <strong>{make.surface_quality_rating ? `${make.surface_quality_rating}/5` : "—"}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : proofs === null ? null : (
            <p className="modelMakesProofUnavailable">Фотографии ещё проходят подготовку или доступны после входа.</p>
          )}
          <MakeLeaderboardPanel modelId={model.id} />
        </>
      ) : (
        <EmptyState
          icon={<DiscussionIcon />}
          title="Станьте первым, кто покажет результат"
          sub="Добавьте фотографии, принтер, материалы и оценку печатабельности — это поможет следующему мастеру."
          action={
            <Button variant="secondary" onClick={onAddMake}>
              Я сделал этот проект
            </Button>
          }
        />
      )}
    </div>
  );
}

// Вкладка «Статистика» владельца (docs/design/model.card.visual.md §4, v3 §5): 5 StatTile в
// существующей .uiStatTileGrid — «Комментарии»/«Напечатали» кликабельны (GAP-CSS §6.1, StatTile
// onClick), уводят на соседнюю вкладку. Тон dim→ok по факту >0 (§4.1); "—" — не ложный ноль,
// а честное «данные ещё не отданы API» (comments_count/views_count — GAP-API, см. models.ts).
function OwnerStatsPanel({ model }: { model: ModelDetail }) {
  const votesTotal = model.votes_up - model.votes_down;
  const allZero =
    model.downloads_count === 0 &&
    votesTotal === 0 &&
    (model.comments_count ?? 0) === 0 &&
    model.make_stats.makes_count === 0 &&
    (model.views_count ?? 0) === 0;

  return (
    <div className="modelOwnerStats">
      <div className="uiStatTileGrid">
        <StatTile label="Просмотры" value={model.views_count ?? "—"} tone={model.views_count ? "ok" : "dim"} />
        <StatTile label="Скачивания" value={model.downloads_count} tone={model.downloads_count > 0 ? "ok" : "dim"} />
        <StatTile
          label="Голоса"
          value={votesTotal}
          tone={votesTotal !== 0 ? "ok" : "dim"}
          hint={`▲${model.votes_up} ▼${model.votes_down}`}
        />
        <StatTile
          label="Комментарии"
          value={model.comments_count ?? "—"}
          tone={model.comments_count ? "ok" : "dim"}
          onClick={() => navigate(modelPath(model.id, "comments"))}
        />
        <StatTile
          label="Напечатали"
          value={model.make_stats.makes_count}
          tone={model.make_stats.makes_count > 0 ? "ok" : "dim"}
          onClick={() => navigate(modelPath(model.id, "makes"))}
        />
      </div>
      {allZero ? (
        <p className="modelOwnerStatsEmpty">Статистика появится, когда проект начнут смотреть и скачивать</p>
      ) : null}
    </div>
  );
}

// Агрегаты совместимости по опубликованным Make модели (MF-395 п.3/MF-779): число уникальных
// станков/филаментов, топ связок станок×филамент. Переиспользует StatTile — тот же примитив,
// что дашборд покрытия каталога (pages/catalogmetrics.tsx).
//
// MF-1962: три средние оценки показаны раздельными плитками в двух явно подписанных группах —
// «качество проекта» (печатаемость + геометрия/стыки — свойства самой модели, не зависят от
// того, кто и на чём печатал) и «качество результата» (поверхность конкретных отпечатков —
// зависит от станка/филамента печатавших). Не сворачиваем три числа в одно среднее — карточка
// прямо требует не смешивать оценку проекта с оценкой конкретного принтера/материала.
function MakeStatsPanel({ stats, combos }: { stats: ModelMakeStats; combos: ModelComboStat[] }) {
  return (
    <div className="modelMakeStats">
      <div className="uiStatTileGrid">
        <StatTile label="Напечатано раз" value={stats.makes_count} tone="ok" />
        <StatTile label="Станков" value={stats.machines_count} tone={stats.machines_count > 0 ? "ok" : "dim"} />
        <StatTile label="Филаментов" value={stats.materials_count} tone={stats.materials_count > 0 ? "ok" : "dim"} />
      </div>
      <Eyebrow>Качество проекта</Eyebrow>
      <div className="uiStatTileGrid">
        <StatTile
          label="Печатабельность"
          value={stats.avg_printability_rating != null ? stats.avg_printability_rating.toFixed(1) : "—"}
          tone={stats.avg_printability_rating != null ? "ok" : "dim"}
        />
        <StatTile
          label="Геометрия и стыки"
          value={stats.avg_geometry_quality_rating != null ? stats.avg_geometry_quality_rating.toFixed(1) : "—"}
          tone={stats.avg_geometry_quality_rating != null ? "ok" : "dim"}
        />
      </div>
      <Eyebrow>Качество результата (зависит от станка/филамента печатавших)</Eyebrow>
      <div className="uiStatTileGrid">
        <StatTile
          label="Поверхность отпечатков"
          value={stats.avg_surface_quality_rating != null ? stats.avg_surface_quality_rating.toFixed(1) : "—"}
          tone={stats.avg_surface_quality_rating != null ? "ok" : "dim"}
        />
      </div>
      {combos.length > 0 ? (
        <div className="modelMakeCombos">
          <Eyebrow>Топ станок × филамент</Eyebrow>
          <ul className="modelMakeComboList">
            {combos.map((combo) => (
              <li key={`${combo.machine.id}-${combo.material.id}`} className="modelMakeComboRow">
                <span>
                  {combo.machine.model} × {combo.material.name}
                </span>
                <span className="modelMakeComboCount">{combo.combo_count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// Лидерборд «лучшая печать по модели» (apps/api/src/makes/leaderboard.ts, MF-27 Ф3): топ Make
// по likes_count под агрегатами MakeStatsPanel. Персонаж-аватар автора — MF-1030/MF-1031.
function MakeLeaderboardPanel({ modelId }: { modelId: string }) {
  const [entries, setEntries] = useState<MakeLeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isDemoProjectId(modelId)) {
      setEntries(demoProjectLeaderboard(modelId));
      return () => {
        cancelled = true;
      };
    }
    setEntries(null);
    void getMakeLeaderboard(modelId).then((result) => {
      if (!cancelled) setEntries(result ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="modelMakeLeaderboard">
      <Eyebrow>Лучшие печати</Eyebrow>
      <ul className="modelMakeLeaderboardList">
        {entries.map((entry, index) => (
          <li key={entry.id} className="modelMakeLeaderboardRow">
            <span className="modelMakeLeaderboardRank">{index + 1}</span>
            {entry.avatar_config ? (
              <AvatarBubble config={entry.avatar_config} snapshots={entry.avatar_snapshots} size={24} facing="front" />
            ) : (
              <AvatarBubble
                config={deterministicAvatarConfig(entry.username || entry.user_id)}
                snapshots={null}
                size={24}
                facing="front"
              />
            )}
            <button type="button" className="modelMakeLeaderboardAuthor pressable" onClick={() => navigate(profilePath(entry.username))}>
              @{entry.username}
            </button>
            <span className="modelMakeLeaderboardLikes">▲ {entry.likes_count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LEROBOT_DISCUSSION = [
  {
    seed: "servo_sensei",
    username: "servo_sensei",
    label: "Сборка",
    text: "Сначала напечатайте Gauge_0 и Gauge_tight. Если сервопривод садится слишком туго, лучше поправить компенсацию отверстий до полного комплекта.",
    score: 38,
    replies: 6,
  },
  {
    seed: "mira_makes",
    username: "mira_makes",
    label: "SO‑101",
    text: "Для follower нужны шесть одинаковых STS3215. У leader передаточные числа отличаются — это стоит прямо подсветить рядом с BOM.",
    score: 27,
    replies: 4,
  },
  {
    seed: "open_robot_lab",
    username: "open_robot_lab",
    label: "Remix",
    text: "Сделали крепление батареи для XLeRobot и камеру на другой высоте. Добавлю GitVerse-ветку, когда в проекте появится связь «ремикс от».",
    score: 19,
    replies: 3,
  },
];

const OTTO_DISCUSSION = [
  {
    seed: "robotics_teacher",
    username: "robotics_teacher",
    label: "Совет",
    text: "Перед установкой сервоприводов выставьте их в 90°. Иначе ноги окажутся симметричными только на столе, а не в прошивке.",
    score: 24,
    replies: 5,
  },
  {
    seed: "liza_prints",
    username: "liza_prints",
    label: "Печать",
    text: "На A1 комплект получился без поддержек. Лицо покрасили акрилом уже после калибровки.",
    score: 17,
    replies: 2,
  },
];

function DemoProjectDiscussion({
  model,
  onGuestComment,
}: {
  model: ModelDetail;
  onGuestComment: (intent?: GuestIntent) => void;
}) {
  const discussion = model.id === LEROBOT_PROJECT_ID ? LEROBOT_DISCUSSION : OTTO_DISCUSSION;
  return (
    <section className="modelDemoDiscussion" aria-label="Демонстрационное обсуждение проекта">
      <header className="modelDemoDiscussionHead">
        <div>
          <Eyebrow>Сообщество проекта</Eyebrow>
          <h2>Вопросы, советы и ремиксы</h2>
          <p>Обсуждение привязано к сборке: видно контекст, полезность ответа и продолжение ветки.</p>
        </div>
        <Button variant="secondary" onClick={() => onGuestComment()}>
          Написать
        </Button>
      </header>
      <button type="button" className="modelDemoComposer pressable" onClick={() => onGuestComment()}>
        <AvatarBubble config={deterministicAvatarConfig("current-project-maker")} snapshots={null} size={38} facing="front" />
        <span>Спросить про печать, сборку или код…</span>
      </button>
      <div className="modelDemoCommentList">
        {discussion.map((comment) => (
          <article key={comment.username} className="modelDemoComment">
            <AvatarBubble
              config={deterministicAvatarConfig(comment.seed)}
              snapshots={null}
              size={42}
              facing="front"
            />
            <div>
              <header>
                <strong>@{comment.username}</strong>
                <span>{comment.label}</span>
                <small>сегодня</small>
              </header>
              <p>{comment.text}</p>
              <footer>
                <span>↑ {comment.score}</span>
                <span>{comment.replies} ответов</span>
                <button type="button" className="pressable" onClick={() => onGuestComment()}>
                  Ответить
                </button>
              </footer>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function DiscussionIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5h16v10H9l-4 3.5v-3.5H4v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
