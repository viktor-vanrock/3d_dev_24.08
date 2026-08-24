// Public API домена social (feed + community + projects + issue).
// Экраны и то, что импортируется извне домена.
export { FeedScreen } from "./feed/feedscreen.tsx";
export { FeedEditorScreen } from "./feed/editor.tsx";
export { FeedPostScreen } from "./feed/post.tsx";
export { FeedPostCard, FeedPostCardSkeleton } from "./feed/postcard.tsx";
export { VoteArrows } from "./feed/vote.tsx";
export { listAuthorFeed, voteFeedComment, voteFeedPost, type FeedPost } from "./feed/api.ts";

export { CommunitiesScreen } from "./community/communitylist.tsx";
export { CommunityScreen } from "./community/communityscreen.tsx";
export { ThreadScreen } from "./community/threadscreen.tsx";
export { ModerationScreen } from "./community/moderationscreen.tsx";
export { voteThread, votePost } from "./community/api.ts";

export { ProjectsPage } from "./projects/projectspage.tsx";
export { isWideProjectsEnabled } from "./projects/flags.ts";
export { mergePublishedShowcase } from "./projects/publishedshowcase.ts";

export { IdeaScreen } from "./issue/ideascreen.tsx";
export { IssueFeedScreen } from "./issue/issuescreen.tsx";
