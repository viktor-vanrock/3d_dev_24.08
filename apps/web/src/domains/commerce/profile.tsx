import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { listAuthorFeed, type FeedPost } from "@domains/social";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { useOverlay } from "@platform/overlay";
import { AuroraBackground, EmptyState } from "@shared/ui";
import { marketPath, modelPath, navigate, profilePath } from "../../router.ts";
import { AccountEditor } from "./accounteditor.tsx";
import { AddModelFlow } from "./addmodel.tsx";
import "./market.css";
import { followUser, getUserProfile, listModels, unfollowUser, type MarketModel, type UserProfile } from "./models.ts";
import {
  ProfileHero,
  ProfilePosts,
  ProfileProjects,
  ProfileSidebar,
  ProfileTabs,
  type ProfileTab,
} from "./profile.public.tsx";
import { ProfileWorkshop } from "./profile.workshop.tsx";
import "./profile.css";

const PROJECT_PAGE_SIZE = 24;
const POST_PAGE_SIZE = 24;
const PROFILE_TABS = new Set<ProfileTab>(["overview", "projects", "posts", "workshop"]);

function requestedProfileTab(): ProfileTab {
  const tab = new URLSearchParams(window.location.search).get("tab") as ProfileTab | null;
  return tab && PROFILE_TABS.has(tab) ? tab : "overview";
}

export function ProfileScreen({
  user,
  section,
  onSectionChange,
  username,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  username: string;
}) {
  const overlay = useOverlay();
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [models, setModels] = useState<MarketModel[] | null>(null);
  const [posts, setPosts] = useState<FeedPost[] | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [followPending, setFollowPending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const modelsRef = useRef<MarketModel[] | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const projectsRailRef = useRef<HTMLDivElement>(null);
  modelsRef.current = models;
  const profileId = profile?.id;
  const requestedTab = requestedProfileTab();

  useEffect(() => {
    let cancelled = false;
    setProfile(undefined);
    void getUserProfile(username).then((result) => {
      if (!cancelled) setProfile(result);
    });
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab, username]);

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    void listModels({ owner: username, limit: PROJECT_PAGE_SIZE }).then((result) => {
      if (cancelled || !result) return;
      setModels(result.models);
      setHasMore(result.has_more);
      nextCursorRef.current = result.next_cursor;
    });
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setPosts(undefined);
    void listAuthorFeed(profileId, POST_PAGE_SIZE).then((result) => {
      if (!cancelled) setPosts(result?.items ?? null);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  const own = Boolean(profile && user && profile.username === user.username);

  useEffect(() => {
    if (profile && activeTab === "workshop" && !own) {
      setActiveTab("overview");
      window.history.replaceState(null, "", profilePath(username));
    }
  }, [activeTab, own, profile, username]);

  function selectTab(tab: ProfileTab) {
    if (tab === "workshop" && !own) return;
    setActiveTab(tab);
    window.history.replaceState(null, "", profilePath(username, tab));
  }

  async function loadMoreProjects() {
    const current = modelsRef.current;
    if (!current || loadingMore) return;
    setLoadingMore(true);
    const result = await listModels({
      owner: username,
      limit: PROJECT_PAGE_SIZE,
      cursor: nextCursorRef.current ?? undefined,
    });
    setLoadingMore(false);
    if (!result) return;
    setModels((previous) => previous ? [...previous, ...result.models] : result.models);
    setHasMore(result.has_more);
    nextCursorRef.current = result.next_cursor;
  }

  async function toggleFollow() {
    if (!profile || own || !user) {
      if (!user) overlay.toast({ title: "Войдите, чтобы подписаться" });
      return;
    }
    if (followPending) return;
    const wasFollowing = profile.is_following;
    setProfile((previous) => previous ? {
      ...previous,
      is_following: !wasFollowing,
      followers_count: previous.followers_count + (wasFollowing ? -1 : 1),
    } : previous);
    setFollowPending(true);
    const ok = await (wasFollowing ? unfollowUser(profile.username) : followUser(profile.username));
    setFollowPending(false);
    if (!ok) {
      setProfile((previous) => previous ? {
        ...previous,
        is_following: wasFollowing,
        followers_count: previous.followers_count + (wasFollowing ? 1 : -1),
      } : previous);
    }
  }

  function openEditProfile() {
    if (!profile || !own) return;
    overlay.modal({
      title: "Публичный профиль",
      size: "wide",
      content: (
        <AccountEditor
          profile={profile}
          onSaved={(updated) => setProfile((previous) => previous ? { ...previous, ...updated } : previous)}
        />
      ),
    });
  }

  function openAddModel() {
    const handle = overlay.modal({
      title: "Добавить проект",
      content: (
        <AddModelFlow
          overlay={overlay}
          onClose={() => handle.close()}
          onUploaded={(modelId) => {
            handle.close();
            navigate(modelPath(modelId));
          }}
        />
      ),
    });
  }

  function scrollProjects(direction: -1 | 1) {
    const rail = projectsRailRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.85, 280), behavior: "smooth" });
  }

  const projectProps = {
    user,
    own,
    models,
    hasMore,
    loadingMore,
    railRef: projectsRailRef,
    onAdd: openAddModel,
    onMore: () => void loadMoreProjects(),
    onScroll: scrollProjects,
  };

  return (
    <div className="home profilePage">
      <AuroraBackground />
      <div className="profileHeaderLayer">
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          activeSection={null}
          onSectionChange={onSectionChange}
          mode="full"
        />
      </div>
      <main className="profilePageContent">
        {profile === undefined ? <ProfilePageSkeleton /> : profile === null ? (
          <EmptyState
            icon={<UserIcon />}
            title="Пользователь не найден"
            action={<button type="button" className="modelGlassBtn pressable" onClick={() => navigate(marketPath())}>В проекты</button>}
          />
        ) : (
          <div className="profileShell">
            <ProfileHero
              profile={profile}
              own={own}
              followPending={followPending}
              onFollow={() => void toggleFollow()}
              onEdit={openEditProfile}
              onSelectTab={selectTab}
            />
            <ProfileTabs value={activeTab} own={own} onChange={selectTab} />
            <div className="profileWorkspace">
              <div className="profileMainColumn">
                {activeTab === "overview" ? (
                  <>
                    <ProfileProjects {...projectProps} compact />
                    <ProfilePosts user={user} posts={posts} own={own} compact />
                  </>
                ) : null}
                {activeTab === "projects" ? <ProfileProjects {...projectProps} /> : null}
                {activeTab === "posts" ? <ProfilePosts user={user} posts={posts} own={own} /> : null}
                {activeTab === "workshop" && own ? <ProfileWorkshop /> : null}
              </div>
              <ProfileSidebar profile={profile} own={own} onEdit={openEditProfile} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ProfilePageSkeleton() {
  return (
    <div className="profileShell" aria-label="Загрузка профиля">
      <div className="profileHero profileHeroSkeleton" />
      <div className="profileTabsSkeleton" />
      <div className="profileWorkspace">
        <div className="profileProjectSkeleton" />
        <div className="profileProofCard profileProjectSkeleton" />
      </div>
    </div>
  );
}

function UserIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 20c1.6-4 4.6-6 8-6s6.4 2 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
