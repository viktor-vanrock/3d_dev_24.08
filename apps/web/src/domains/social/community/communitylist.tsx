import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { useOverlay } from "@platform/overlay";
import { communityPath, headerModeFor, navigate } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, Button, Chip, EmptyState, Input, SelectionTile } from "@shared/ui";
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_NAME_MAX_LENGTH,
  CommunityApiError,
  createCommunity,
  formatMemberCount,
  formatThreadCount,
  listCommunities,
  type Community,
  type CommunityKind,
  type CommunityVisibility,
} from "./api.ts";
import { CommunityKindBadge, RoleBadge } from "./badges.tsx";
import "./community.css";
import { communityDisplayName } from "./displayname.ts";
import { communityErrorMessage } from "./errors.ts";

// Список сообществ `/community` (docs/design/community.md §1). Кости — тот же скелет, что
// каталог маркета/принтеров (search+debounce+cursor-пагинация, market/market.tsx,
// printers/printersscreen.tsx): search-строка сверху, фильтр kind, сетка карточек.
// Фильтр kind — единый чип-ряд (не боковой сайдбар принтеров §2 printers.catalog.md): у формы
// всего 4 значения + «Все», сайдбар-раскладка была бы избыточна под такой размер фасета —
// чип-ряд уже и есть мобильный паттерн §1.4/§4 спеки, здесь он работает на всех ширинах.

const KIND_FILTERS: { value: CommunityKind | null; label: string }[] = [
  { value: null, label: "Все" },
  { value: "machine", label: "Принтер" },
  { value: "vendor", label: "Филамент" },
  { value: "craft", label: "Ремесло" },
  { value: "custom", label: "Своё" },
];

type LoadState = "loading" | "ready" | "error";

export function CommunitiesScreen({
  user,
  section,
  onSectionChange,
}: {
  // Как и вся community/* зона: API этой фазы 401-ит без сессии на каждой ручке (нет
  // гостевого read-пути, в отличие от market/printers) — экран не в GUEST_ALLOWED_SCREENS
  // (app.tsx), user гарантированно не null к этому моменту.
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const [items, setItems] = useState<Community[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [kind, setKind] = useState<CommunityKind | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [qInput]);

  function load() {
    setLoadState("loading");
    void listCommunities({ kind: kind ?? undefined, q: q || undefined }).then((result) => {
      if (!result) {
        setLoadState("error");
        return;
      }
      setItems(result.items);
      nextCursorRef.current = result.next_cursor;
      setLoadState("ready");
    });
  }

  useEffect(load, [kind, q]);

  function loadMore() {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void listCommunities({ kind: kind ?? undefined, q: q || undefined, cursor }).then((result) => {
      setLoadingMore(false);
      if (!result) return;
      setItems((prev) => [...prev, ...result.items]);
      nextCursorRef.current = result.next_cursor;
    });
  }

  function openCreate() {
    sound.tick();
    const handle = overlay.modal({
      title: "Создать сообщество",
      content: (
        <CreateCommunityForm
          onClose={() => handle.close()}
          onCreated={(community) => {
            handle.close();
            navigate(communityPath(community.slug));
          }}
        />
      ),
    });
  }

  const hasActiveFilter = q.trim().length > 0 || kind !== null;

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode={headerModeFor("communities")} />
      </div>
      <main className="homeContent cmtyContent">
        <section className="cmtyIntro" aria-labelledby="cmtyIntroTitle">
          <div className="cmtyIntroCopy">
            <span className="cmtyIntroEyebrow">Форум 3mf</span>
            <h1 id="cmtyIntroTitle" className="cmtyIntroTitle">
              Опыт мастерских, <span>собранный по делу</span>
            </h1>
            <p className="cmtyIntroLead">
              Находите настройки, проверяйте решения и обсуждайте печать с теми, кто уже держал деталь в руках.
            </p>
          </div>
          <ol className="cmtyRoute" aria-label="Как устроен форум">
            <li><span>01</span>Найдите сообщество</li>
            <li><span>02</span>Сверьте опыт</li>
            <li><span>03</span>Закройте вопрос</li>
          </ol>
        </section>

        <div className="cmtyDirectory" aria-label="Каталог сообществ">
          <div className="cmtySearchRow">
            <div className="cmtySearchBar">
              <SearchIcon />
              <input
                className="cmtySearchInput"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
                placeholder="Найти сообщество…"
                aria-label="Поиск сообществ"
              />
            </div>
            <Button type="button" className="uiButton pressable cmtyCreateBtn" variant="primary" onClick={openCreate}>
              <span>Создать сообщество</span>
            </Button>
          </div>

          <div className="cmtyKindScroll">
            <div className="cmtyKindRow">
              {KIND_FILTERS.map((filter) => (
                <Chip
                  key={filter.label}
                  selected={kind === filter.value}
                  onClick={() => {
                    sound.toggle();
                    setKind(filter.value);
                  }}
                >
                  {filter.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        {loadState === "error" ? (
          <div className="cmtyLoadError">
            <span>Не удалось загрузить сообщества</span>
            <Button type="button" className="uiButton pressable" variant="secondary" onClick={load}>
              Повторить
            </Button>
          </div>
        ) : null}

        {loadState === "loading" ? <CommunitySkeletonGrid /> : null}

        {loadState === "ready" && items.length === 0 ? (
          <EmptyState
            icon={<PeopleIcon />}
            title={hasActiveFilter ? "Ничего не нашлось" : "Сообществ пока нет"}
            sub="Создайте своё — будете первым"
            action={
              <Button type="button" className="uiButton pressable" variant="secondary" onClick={openCreate}>
                Создать сообщество
              </Button>
            }
          />
        ) : null}

        {loadState === "ready" && items.length > 0 ? (
          <>
            <div className="cmtyGrid stagger-reveal">
              {items.map((community, index) => (
                <CommunityCard key={community.id} community={community} index={index} />
              ))}
            </div>
            {nextCursorRef.current ? (
              <Button type="button" className="cmtyLoadMore uiButton pressable" variant="secondary" loading={loadingMore} onClick={loadMore}>
                {loadingMore ? "Загружаю…" : "Показать ещё"}
              </Button>
            ) : null}
          </>
        ) : null}
      </main>

      <Button variant="ghost" icon={null} type="button" className="cmtyCreateFab pressable" aria-label="Создать сообщество" onClick={openCreate}>
        <PlusIcon />
      </Button>
    </div>
  );
}

function CommunityCard({ community, index }: { community: Community; index: number }) {
  const displayName = communityDisplayName(community.name);
  return (
    <Button variant="ghost" icon={null}
      type="button"
      className="cmtyCard pressable reveal"
      style={{ ["--i" as string]: index }}
      title={displayName === community.name ? undefined : `Исходное имя: ${community.name}`}
      onClick={() => navigate(communityPath(community.slug))}
    >
      <div className="cmtyCardTop">
        <CommunityKindBadge kind={community.kind as CommunityKind} />
        <span className="cmtyCardArrow" aria-hidden="true">↗</span>
      </div>
      <div className="cmtyCardName">{displayName}</div>
      {community.description ? <div className="cmtyCardDesc">{community.description}</div> : null}
      <div className="cmtyCardMeta">
        <span className="cmtyCardMetrics">
          <span>{formatMemberCount(community.member_count)}</span>
          <span>{formatThreadCount(community.thread_count)}</span>
        </span>
        <RoleBadge role={community.viewer_role} />
      </div>
    </Button>
  );
}

function CreateCommunityForm({ onClose, onCreated }: { onClose: () => void; onCreated: (community: Community) => void }) {
  const sound = useInteractionSound();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("public");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= COMMUNITY_NAME_MAX_LENGTH;

  async function submit() {
    if (!nameValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const community = await createCommunity({
        name: trimmedName,
        description: description.trim() || undefined,
        visibility,
      });
      sound.cta();
      onCreated(community);
    } catch (err) {
      setError(communityErrorMessage(err instanceof CommunityApiError ? err.code : "unknown"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cmtyForm">
      <label className="cmtyFormLabel" htmlFor="cmtyCreateName">
        Название
      </label>
      <Input
        id="cmtyCreateName"
        value={name}
        maxLength={COMMUNITY_NAME_MAX_LENGTH}
        onChange={(event) => setName(event.target.value)}
        placeholder="Bambu Lab фанаты"
      />

      <label className="cmtyFormLabel" htmlFor="cmtyCreateDescription">
        Описание (необязательно)
      </label>
      <textarea
        id="cmtyCreateDescription"
        className="marketTextarea"
        maxLength={COMMUNITY_DESCRIPTION_MAX_LENGTH}
        rows={3}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />

      <div className="cmtyFormLabel">Видимость</div>
      <div className="cmtyVisibilityRow">
        <SelectionTile
          selected={visibility === "public"}
          onClick={() => {
            sound.toggle();
            setVisibility("public");
          }}
        >
          Публичное
        </SelectionTile>
        <SelectionTile
          selected={visibility === "unlisted"}
          onClick={() => {
            sound.toggle();
            setVisibility("unlisted");
          }}
        >
          По ссылке
        </SelectionTile>
      </div>

      {error ? <div className="marketFieldError">{error}</div> : null}

      <div className="cmtyFormActions">
        <Button type="button" className="uiButton pressable" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button type="button" className="uiButton pressable" variant="primary" disabled={!nameValid} loading={saving} onClick={() => void submit()}>
          <span>{saving ? "Создаю…" : "Создать сообщество"}</span>
        </Button>
      </div>
    </div>
  );
}

function CommunitySkeletonGrid() {
  return (
    <div className="cmtySkeletonGrid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="cmtySkeletonTile">
          <div className="cmtySkeletonLine" style={{ width: "40%" }} />
          <div className="cmtySkeletonLine" style={{ width: "85%" }} />
          <div className="cmtySkeletonLine" style={{ width: "60%" }} />
        </div>
      ))}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 8.5a2.6 2.6 0 1 0 0-5.2M18.5 19c0-2.4-1.7-4.3-4-4.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
