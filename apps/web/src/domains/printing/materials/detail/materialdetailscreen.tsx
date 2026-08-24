import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное межданное ребро (Этап 8): printing→access useGuestLogin (рантайм-хук гостевого входа), разрядка отложена до pages/DI. Cм. MIGRATION.md.
import { useGuestLogin } from "@domains/access";
import { HomeHeader, type Section } from "@platform/nav";
import { navigate } from "../../../../router.ts";
import { AuroraBackground, Button, EmptyState, IconButton } from "@shared/ui";
import { getMaterialDetail, type MaterialDetail, type MaterialMake, type MaterialVariant } from "./api.ts";
import "./materialdetail.css";

const KIND_LABEL: Record<MaterialDetail["kind"], string> = {
  filament: "Филамент",
  resin: "Смола",
  plywood: "Фанера",
  aluminum: "Алюминий",
};

const VALID_HEX = /^#[0-9a-f]{6}$/i;

export function MaterialDetailScreen({
  user,
  section,
  onSectionChange,
  id,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  id: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "not_found" | "unauthorized" | "error">("loading");
  const [material, setMaterial] = useState<MaterialDetail | null>(null);
  const [makes, setMakes] = useState<MaterialMake[]>([]);
  const [makesHasMore, setMakesHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [variantsExpanded, setVariantsExpanded] = useState(false);
  const promptGuestLogin = useGuestLogin();

  const loadInitial = useCallback(async () => {
    setStatus("loading");
    setMaterial(null);
    setMakes([]);
    setVariantsExpanded(false);
    const result = await getMaterialDetail(id);
    if (result.kind === "ok") {
      setMaterial(result.data.material);
      // Spread: CatalogMaterialDetailDto.makes is readonly in generated schema; useState holds a mutable array.
      setMakes([...result.data.makes]);
      setMakesHasMore(result.data.makes_has_more);
      setStatus("ready");
    } else {
      setStatus(result.kind);
    }
  }, [id]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  function backToCatalog() {
    // В новом browser context единственная предыдущая запись — about:blank.
    // Возвращаемся через историю только когда перед detail действительно есть
    // отдельная страница, иначе сохраняем query текущего detail в каталоге.
    if (window.history.length > 2) {
      window.history.back();
      return;
    }
    navigate(`/materials${window.location.search}`, "back");
  }

  async function loadMoreMakes() {
    if (!makesHasMore || loadingMore) return;
    setLoadingMore(true);
    const result = await getMaterialDetail(id, makes.length);
    if (result.kind === "ok") {
      setMakes((current) => [...current, ...result.data.makes]);
      setMakesHasMore(result.data.makes_has_more);
    }
    setLoadingMore(false);
  }

  return (
    <div className="home materialDetailPage">
      <AuroraBackground />
      <div className="materialDetailHeader">
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode="full" />
      </div>
      <main className="homeContent materialDetailContent">
        <IconButton label="Назад к материалам" onClick={backToCatalog}>
          <BackIcon />
        </IconButton>
        {status === "loading" ? <MaterialDetailSkeleton /> : null}
        {status === "not_found" ? (
          <DetailState title="Такого материала у нас пока нет" text="Проверьте ссылку или вернитесь в каталог материалов." action={<Button variant="secondary" onClick={backToCatalog}>К материалам</Button>} />
        ) : null}
        {status === "unauthorized" ? (
          <DetailState title="Войдите, чтобы открыть материал" text="Ссылка и текущий каталог сохранятся после входа." action={<Button variant="primary" onClick={() => promptGuestLogin()}>Войти</Button>} />
        ) : null}
        {status === "error" ? (
          <DetailState title="Не удалось загрузить материал" text="Сервис каталога временно недоступен." action={<Button variant="primary" onClick={() => void loadInitial()}>Повторить</Button>} />
        ) : null}
        {status === "ready" && material ? (
          <MaterialDetailBody
            material={material}
            makes={makes}
            makesHasMore={makesHasMore}
            loadingMore={loadingMore}
            variantsExpanded={variantsExpanded}
            onToggleVariants={() => setVariantsExpanded((current) => !current)}
            onLoadMoreMakes={() => void loadMoreMakes()}
          />
        ) : null}
      </main>
    </div>
  );
}

function MaterialDetailBody({
  material,
  makes,
  makesHasMore,
  loadingMore,
  variantsExpanded,
  onToggleVariants,
  onLoadMoreMakes,
}: {
  material: MaterialDetail;
  makes: MaterialMake[];
  makesHasMore: boolean;
  loadingMore: boolean;
  variantsExpanded: boolean;
  onToggleVariants: () => void;
  onLoadMoreMakes: () => void;
}) {
  const visibleVariants = variantsExpanded ? material.variants : material.variants.slice(0, 6);
  const makeCount = material.make_stats.make_count;
  const modelCount = material.make_stats.model_count;
  const variantsHeadingRef = useRef<HTMLHeadingElement>(null);

  function toggleVariants() {
    onToggleVariants();
    if (variantsExpanded) window.requestAnimationFrame(() => variantsHeadingRef.current?.focus());
  }

  return (
    <article className="materialDetail" aria-labelledby="material-title">
      <header className="materialIdentity">
        <div className="materialEyebrow">{material.vendor.name}</div>
        <h1 id="material-title">{material.name}</h1>
        <p>{material.material_type.name} · {KIND_LABEL[material.kind]}</p>
      </header>

      <div className="materialDetailBodyGrid">
        <section className="materialSection" aria-labelledby="material-variants-title">
          <h2 id="material-variants-title" ref={variantsHeadingRef} tabIndex={-1}>Варианты</h2>
          {visibleVariants.length > 0 ? (
            <div className="materialVariantList">
              {visibleVariants.map((variant) => <VariantRow key={variant.id} variant={variant} />)}
            </div>
          ) : (
            <p className="materialMuted">Варианты этого материала ещё не добавлены</p>
          )}
          {material.variants.length > 6 ? (
            <Button variant="ghost" icon={null} className="materialTextButton" onClick={toggleVariants}>
              {variantsExpanded ? "Свернуть варианты" : "Показать ещё"}
            </Button>
          ) : null}
        </section>

        <section className="materialSection" aria-labelledby="material-makes-title">
          <div className="materialSectionHeading">
            <div>
              <h2 id="material-makes-title">Примеры печати · {makeCount}</h2>
              <p className="materialSectionMeta">Моделей · {modelCount}</p>
            </div>
          </div>
          {makes.length > 0 ? (
            <div className="materialMakeList">
              {makes.map((make) => <MakeRow key={make.id} make={make} />)}
            </div>
          ) : (
            <p className="materialMuted">Печатей этим материалом пока нет</p>
          )}
          {makesHasMore ? (
            <Button variant="secondary" loading={loadingMore} aria-busy={loadingMore} onClick={onLoadMoreMakes}>
              {loadingMore ? "Загружаем…" : "Показать ещё"}
            </Button>
          ) : null}
        </section>
      </div>
    </article>
  );
}

function VariantRow({ variant }: { variant: MaterialVariant }) {
  const dimensions = [
    variant.diameter_mm ? `${variant.diameter_mm.toLocaleString("ru-RU")} мм` : null,
    variant.weight_g ? formatWeight(variant.weight_g) : null,
  ].filter(Boolean);
  const details = [
    variant.spool_type,
    variant.sku ? `SKU ${variant.sku}` : null,
  ].filter(Boolean);
  return (
    <div className="materialVariantRow">
      <div className="materialVariantName">
        {variant.color_hex && VALID_HEX.test(variant.color_hex) ? <span className="materialColorDot" style={{ backgroundColor: variant.color_hex }} aria-hidden="true" /> : null}
        <strong>{variant.color_name}</strong>
      </div>
      <div className="materialVariantSpecs">
        {dimensions.length > 0 ? <div className="materialVariantMeta materialVariantMeta--primary">{dimensions.join(" · ")}</div> : null}
        {details.length > 0 ? <div className="materialVariantMeta">{details.join(" · ")}</div> : null}
      </div>
    </div>
  );
}

function MakeRow({ make }: { make: MaterialMake }) {
  const author = make.user.display_name || `@${make.user.username}`;
  const rating = make.printability_rating == null ? null : `${make.printability_rating}/5`;
  return (
    <article className="materialMakeRow">
      {make.caption ? <h3>{make.caption}</h3> : null}
      {make.model ? <p className="materialMakeModel">{make.model.title}</p> : null}
      <p className="materialMakeMeta">
        {rating ? <span>Оценка печати: {rating}</span> : null}
        <span>{new Date(make.created_at).toLocaleDateString("ru-RU")}</span>
        <span>{author}</span>
      </p>
    </article>
  );
}

function formatWeight(weightG: number): string {
  return weightG >= 1000 ? `${(weightG / 1000).toLocaleString("ru-RU")} кг` : `${weightG.toLocaleString("ru-RU")} г`;
}

function MaterialDetailSkeleton() {
  return (
    <div className="materialDetailSkeleton" role="status" aria-label="Загрузка материала">
      <span className="materialSkeletonLine materialSkeletonLine--small" />
      <span className="materialSkeletonLine materialSkeletonLine--title" />
      <span className="materialSkeletonLine materialSkeletonLine--meta" />
      <span className="materialSkeletonBlock" />
      <span className="materialSkeletonBlock materialSkeletonBlock--short" />
    </div>
  );
}

function DetailState({ title, text, action }: { title: string; text: string; action: ReactNode }) {
  return (
    <div className="materialDetailState" role="alert">
      <EmptyState icon={<span aria-hidden="true">!</span>} title={title} sub={text} action={action} />
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
