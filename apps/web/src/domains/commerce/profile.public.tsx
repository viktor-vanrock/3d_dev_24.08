import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { FeedPostCard, FeedPostCardSkeleton, type FeedPost } from "@domains/social";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import { feedNewPath, feedPostPath, navigate } from "../../router.ts";
import { SegmentToggle, Button, Card, CubeIcon, EmptyState, Eyebrow, Heading, IconButton } from "@shared/ui";
import { ModelTile } from "./market.tsx";
import type { MarketModel, UserProfile } from "./models.ts";
import "./profile.layout.css";

export type ProfileTab = "overview" | "projects" | "posts" | "workshop";

const BADGE_LABELS: Record<string, string> = {
  verified: "Проверенный",
  top_farm: "Топ-ферма",
  popular: "Популярный",
};

const TRUST_LABELS = ["Новичок", "Участник", "Проверенный участник", "Опытный автор", "Хранитель сообщества"];
const number = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

function formatMetric(value: number): string {
  return number.format(value);
}

export function ProfileHero({
  profile,
  own,
  followPending,
  onFollow,
  onEdit,
  onSelectTab,
}: {
  profile: UserProfile;
  own: boolean;
  followPending: boolean;
  onFollow: () => void;
  onEdit: () => void;
  onSelectTab: (tab: ProfileTab) => void;
}) {
  const totalViews = profile.project_views_count + profile.post_views_count;
  return (
    <Card className="profileHero">
      <div className="profileHeroLight" aria-hidden="true" />
      <div className="profileHeroCharacter" aria-label={`Персонаж @${profile.username}`}>
        <AvatarBubble
          config={profile.avatar_config ?? deterministicAvatarConfig(profile.username || profile.id)}
          snapshots={profile.avatar_config ? (profile.avatar_snapshots ?? null) : null}
          size={210}
          facing="front"
        />
        <span className="profileHeroShadow" aria-hidden="true" />
      </div>

      <div className="profileHeroIdentity">
        <Eyebrow>Профиль мейкера</Eyebrow>
        <h1>{profile.display_name || `@${profile.username}`}</h1>
        <div className="profileHeroHandle">@{profile.username}</div>
        {profile.badges.length ? (
          <div className="profileHeroBadges">
            {profile.badges.map((badge) => <span key={badge}>{BADGE_LABELS[badge] ?? badge}</span>)}
          </div>
        ) : null}
        <p className="profileHeroBio">
          {profile.bio || (own ? "Расскажите, что вы строите, печатаете и исследуете." : "Мейкер пока не добавил описание.")}
        </p>
        {profile.website_url || profile.contacts.length ? (
          <div className="profileHeroLinks">
            {profile.website_url ? (
              <a href={profile.website_url} target="_blank" rel="noreferrer noopener">
                {profile.website_url.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
            {profile.contacts.map((contact, index) => (
              <a key={`${contact.label}-${index}`} href={contact.url} target="_blank" rel="noreferrer noopener">
                {contact.label}
              </a>
            ))}
          </div>
        ) : null}
        <div className="profileHeroActions">
          {own ? (
            <Button variant="secondary" icon={<EditIcon />} onClick={onEdit}>Редактировать профиль</Button>
          ) : (
            <Button
              variant={profile.is_following ? "secondary" : "primary"}
              onClick={onFollow}
              disabled={followPending}
            >
              {profile.is_following ? "Вы подписаны" : "Подписаться"}
            </Button>
          )}
        </div>
      </div>

      <div className="profileHeroStats" aria-label="Краткая статистика">
        <button type="button" onClick={() => onSelectTab("projects")}>
          <strong>{formatMetric(profile.models_count)}</strong><span>Проекты</span>
        </button>
        <button type="button" onClick={() => onSelectTab("posts")}>
          <strong>{formatMetric(profile.posts_count)}</strong><span>Посты</span>
        </button>
        <div><strong>{formatMetric(totalViews)}</strong><span>Просмотры</span></div>
        <div><strong>{formatMetric(profile.followers_count)}</strong><span>Подписчики</span></div>
      </div>
    </Card>
  );
}

export function ProfileTabs({
  value,
  own,
  onChange,
}: {
  value: ProfileTab;
  own: boolean;
  onChange: (value: ProfileTab) => void;
}) {
  const options: { value: ProfileTab; label: string }[] = [
    { value: "overview", label: "Обзор" },
    { value: "projects", label: "Проекты" },
    { value: "posts", label: "Посты" },
  ];
  if (own) options.push({ value: "workshop", label: "Мастерская" });
  return <SegmentToggle className="profileTabs" ariaLabel="Разделы профиля" options={options} value={value} onChange={onChange} />;
}

export function ProfileProjects({
  user,
  own,
  models,
  compact,
  hasMore,
  loadingMore,
  railRef,
  onAdd,
  onMore,
  onScroll,
}: {
  user: SessionUser | null;
  own: boolean;
  models: MarketModel[] | null;
  compact?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  railRef: React.RefObject<HTMLDivElement | null>;
  onAdd: () => void;
  onMore: () => void;
  onScroll: (direction: -1 | 1) => void;
}) {
  return (
    <section className="profileContentSection" aria-labelledby="profile-projects-heading">
      <div className="profileSectionHead">
        <div>
          <Eyebrow>Работы</Eyebrow>
          <Heading size="md"><span id="profile-projects-heading">Проекты</span></Heading>
        </div>
        <div className="profileSectionActions">
          {models && models.length >= 4 ? (
            <>
              <IconButton label="Предыдущие проекты" onClick={() => onScroll(-1)}><ChevronIcon direction="left" /></IconButton>
              <IconButton label="Следующие проекты" onClick={() => onScroll(1)}><ChevronIcon direction="right" /></IconButton>
            </>
          ) : null}
          {own ? <Button className="profileAddProjectButton" variant="secondary" icon={<PlusIcon />} onClick={onAdd}>Добавить проект</Button> : null}
        </div>
      </div>

      {models === null ? <div className="profileProjectSkeleton" /> : models.length === 0 ? (
        <EmptyState
          icon={<CubeIcon />}
          title={own ? "Начните с первого проекта" : "Проектов пока нет"}
          sub={own ? "Опубликуйте вещь, репозиторий или модель — она станет частью вашей истории." : undefined}
          action={own ? <Button className="profileAddProjectButton" variant="secondary" icon={<PlusIcon />} onClick={onAdd}>Добавить проект</Button> : undefined}
        />
      ) : (
        <>
          {models.length >= 4 ? (
            <div className={`profileProjectCarousel${compact ? " profileProjectCarousel--compact" : ""}`} role="region" aria-label="Проекты пользователя">
              <div ref={railRef} className="profileProjectTrack">
                {models.map((model, index) => (
                  <ModelTile key={model.id} model={model} index={index} mine={model.owner.id === user?.id} />
                ))}
              </div>
            </div>
          ) : (
            <div className="homeGallery profileProjectGrid">
              {models.map((model, index) => (
                <ModelTile key={model.id} model={model} index={index} mine={model.owner.id === user?.id} />
              ))}
            </div>
          )}
          {hasMore && !compact ? (
            <button type="button" className="marketShowMore pressable" onClick={onMore} disabled={loadingMore}>
              {loadingMore ? "Загрузка…" : "Показать ещё"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ProfilePosts({
  user,
  posts,
  own,
  compact,
}: {
  user: SessionUser | null;
  posts: FeedPost[] | null | undefined;
  own: boolean;
  compact?: boolean;
}) {
  const visible = compact ? posts?.slice(0, 3) : posts;
  return (
    <section className="profileContentSection" aria-labelledby="profile-posts-heading">
      <div className="profileSectionHead">
        <div>
          <Eyebrow>Журнал мастерской</Eyebrow>
          <Heading size="md"><span id="profile-posts-heading">Посты</span></Heading>
        </div>
        {own ? <Button variant="secondary" icon={<PlusIcon />} onClick={() => navigate(feedNewPath())}>Написать пост</Button> : null}
      </div>
      <div className="profilePostList">
        {posts === undefined ? (
          <><FeedPostCardSkeleton /><FeedPostCardSkeleton /></>
        ) : posts === null ? (
          <div className="profileInlineMessage">Не удалось загрузить посты.</div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<ChatIcon />}
            title={own ? "Расскажите, что сделали" : "Постов пока нет"}
            sub={own ? "Фото, проект, модель или репозиторий — всё это можно показать сообществу." : undefined}
            action={own ? <Button variant="secondary" icon={<PlusIcon />} onClick={() => navigate(feedNewPath())}>Написать пост</Button> : undefined}
          />
        ) : visible?.map((post) => (
          <FeedPostCard key={post.id} user={user} post={post} onOpen={() => navigate(feedPostPath(post.id))} />
        ))}
      </div>
    </section>
  );
}

export function ProfileSidebar({ profile, own, onEdit }: { profile: UserProfile; own: boolean; onEdit: () => void }) {
  const trustLabel = TRUST_LABELS[Math.min(profile.trust_level, TRUST_LABELS.length - 1)] ?? TRUST_LABELS[0];
  const rows = [
    ["Просмотры проектов", profile.project_views_count],
    ["Скачивания проектов", profile.project_downloads_count],
    ["Просмотры постов", profile.post_views_count],
    ["Ответы на посты", profile.post_comments_count],
  ] as const;
  return (
    <aside className="profileSidebar">
      <Card className="profileProofCard">
        <Eyebrow>След мастера</Eyebrow>
        <div className="profileProofScore">
          <strong>{formatMetric(profile.reputation_score)}</strong>
          <span>репутация · TL{profile.trust_level}</span>
        </div>
        <div className="profileTrustLabel">{trustLabel}</div>
        <dl>
          {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatMetric(value)}</dd></div>)}
        </dl>
      </Card>
      <Card className="profileProofCard">
        <Eyebrow>Сообщество</Eyebrow>
        <dl>
          <div><dt>Подписчики</dt><dd>{formatMetric(profile.followers_count)}</dd></div>
          <div><dt>Подписки</dt><dd>{formatMetric(profile.following_count)}</dd></div>
          <div><dt>Рейтинг постов</dt><dd>{formatMetric(profile.post_score)}</dd></div>
        </dl>
      </Card>
      {own ? (
        <Card className="profileOwnerShortcut">
          <Eyebrow>Это ваш профиль</Eyebrow>
          <p>Так его видят другие участники портала.</p>
          <Button variant="ghost" icon={<EditIcon />} onClick={onEdit}>Изменить данные</Button>
        </Card>
      ) : null}
    </aside>
  );
}

function PlusIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function EditIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 16-.5 4.5L8 20l11-11-4-4L4 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function ChatIcon() {
  return <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18.5 3.5 21v-5A8 8 0 1 1 5 18.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={direction === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
