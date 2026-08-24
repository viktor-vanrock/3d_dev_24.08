import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Eyebrow, Heading } from "@shared/ui";
import { ContextFeedbackDoor } from "./contextfeedback.tsx";
import { listMyIdeas, type IdeaSummary } from "./ideas.ts";
import { listMyMakes, type MakeSummary } from "./makes.ts";
import { BulbIcon, IdeaRow, MakeRow, PrintIcon } from "./profile.activity.tsx";
import { MyCatalogsSection } from "./profile.catalogs.tsx";
import { PayoutsPanel } from "./payouts.tsx";
import { PushSettingsSection } from "./profile.push.tsx";
import { PurchasesPanel } from "./purchases.tsx";

const PAGE_SIZE = 10;
type LoadState<T> = { status: "loading" } | { status: "error" } | { status: "ready"; items: T[] };

export function ProfileWorkshop() {
  const [ideas, setIdeas] = useState<LoadState<IdeaSummary>>({ status: "loading" });
  const [makes, setMakes] = useState<LoadState<MakeSummary>>({ status: "loading" });
  const [ideasHasMore, setIdeasHasMore] = useState(false);
  const [makesHasMore, setMakesHasMore] = useState(false);
  const [ideasLoadingMore, setIdeasLoadingMore] = useState(false);
  const [makesLoadingMore, setMakesLoadingMore] = useState(false);
  const ideasCursor = useRef<string | null>(null);
  const makesCursor = useRef<string | null>(null);

  function loadIdeas() {
    setIdeas({ status: "loading" });
    void listMyIdeas({ limit: PAGE_SIZE }).then((result) => {
      if (!result) return setIdeas({ status: "error" });
      // Spread: IdeasPageDto.items is readonly in generated schema; LoadState.items is mutable.
      setIdeas({ status: "ready", items: [...result.items] });
      ideasCursor.current = result.next_cursor;
      setIdeasHasMore(result.next_cursor !== null);
    });
  }

  function loadMakes() {
    setMakes({ status: "loading" });
    void listMyMakes({ limit: PAGE_SIZE }).then((result) => {
      if (!result) return setMakes({ status: "error" });
      // Spread: same readonly → mutable fix as loadIdeas.
      setMakes({ status: "ready", items: [...result.items] });
      makesCursor.current = result.next_cursor;
      setMakesHasMore(result.next_cursor !== null);
    });
  }

  useEffect(() => {
    loadIdeas();
    loadMakes();
  }, []);

  async function loadMoreIdeas() {
    if (ideas.status !== "ready" || ideasLoadingMore) return;
    setIdeasLoadingMore(true);
    const result = await listMyIdeas({ limit: PAGE_SIZE, cursor: ideasCursor.current ?? undefined });
    setIdeasLoadingMore(false);
    if (!result) return;
    setIdeas({ status: "ready", items: [...ideas.items, ...result.items] });
    ideasCursor.current = result.next_cursor;
    setIdeasHasMore(result.next_cursor !== null);
  }

  async function loadMoreMakes() {
    if (makes.status !== "ready" || makesLoadingMore) return;
    setMakesLoadingMore(true);
    const result = await listMyMakes({ limit: PAGE_SIZE, cursor: makesCursor.current ?? undefined });
    setMakesLoadingMore(false);
    if (!result) return;
    setMakes({ status: "ready", items: [...makes.items, ...result.items] });
    makesCursor.current = result.next_cursor;
    setMakesHasMore(result.next_cursor !== null);
  }

  return (
    <section className="profileWorkshop" aria-labelledby="profile-workshop-heading">
      <div className="profileWorkshopIntro">
        <Eyebrow>Только для вас</Eyebrow>
        <Heading size="md"><span id="profile-workshop-heading">Мастерская</span></Heading>
        <p>Оборудование, материалы, черновики и настройки не смешиваются с публичной витриной.</p>
      </div>

      <div className="profileWorkshopGrid">
        <ActivitySection
          eyebrow="Мои идеи"
          state={ideas}
          empty={<EmptyState icon={<BulbIcon />} title="Вы ещё не предлагали идей" action={<ContextFeedbackDoor preset="suggest" />} />}
          render={(item) => <IdeaRow key={item.id} idea={item} />}
          hasMore={ideasHasMore}
          loadingMore={ideasLoadingMore}
          onMore={() => void loadMoreIdeas()}
          onRetry={loadIdeas}
        />
        <ActivitySection
          eyebrow="Мои печати"
          state={makes}
          empty={<EmptyState icon={<PrintIcon />} title="Вы ещё не публиковали печати" sub="Отметьте модель как напечатанную со страницы проекта." />}
          render={(item) => <MakeRow key={item.id} make={item} />}
          hasMore={makesHasMore}
          loadingMore={makesLoadingMore}
          onMore={() => void loadMoreMakes()}
          onRetry={loadMakes}
        />
      </div>

      <MyCatalogsSection />
      <div className="profileWorkshopSettings">
        <PushSettingsSection />
        <PurchasesPanel />
        <PayoutsPanel />
      </div>
    </section>
  );
}

function ActivitySection<T extends { id: string }>({
  eyebrow,
  state,
  empty,
  render,
  hasMore,
  loadingMore,
  onMore,
  onRetry,
}: {
  eyebrow: string;
  state: LoadState<T>;
  empty: React.ReactNode;
  render: (item: T) => React.ReactNode;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="ideasSection profileWorkshopBlock">
      <Eyebrow>{eyebrow}{state.status === "ready" ? ` · ${state.items.length}` : ""}</Eyebrow>
      {state.status === "loading" ? (
        <div className="ideaList"><div className="ideaRowSkeleton" /><div className="ideaRowSkeleton" /></div>
      ) : state.status === "error" ? (
        <div className="ideasErrorRow">Не удалось загрузить · <button type="button" className="ideasRetry pressable" onClick={onRetry}>Повторить</button></div>
      ) : state.items.length === 0 ? empty : (
        <>
          <div className="ideaList">{state.items.map(render)}</div>
          {hasMore ? <Button variant="ghost" onClick={onMore} disabled={loadingMore}>{loadingMore ? "Загрузка…" : "Показать ещё"}</Button> : null}
        </>
      )}
    </div>
  );
}