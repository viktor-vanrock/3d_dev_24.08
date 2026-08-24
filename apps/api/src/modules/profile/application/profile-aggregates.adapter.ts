import { Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../analytics/public/index.ts";
import { FEED_PROFILE_READ_PORT, type FeedProfileReadPort } from "../../feed/public/index.ts";
import { MAKER_FOLLOW_READ_PORT, type MakerFollowReadPort } from "../../makers/public/index.ts";
import { MODEL_READ_PORT, type ModelReadPort } from "../../models/public/index.ts";
import { PRINTER_PROFILE_READ_PORT, type PrinterProfileReadPort } from "../../printers/public/index.ts";
import type { ProfileAggregates, ProfileAggregatesPort } from "../public/index.ts";

@Injectable()
export class ProfileAggregatesAdapter implements ProfileAggregatesPort {
  constructor(
    @Inject(MODEL_READ_PORT) private readonly models: ModelReadPort,
    @Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort,
    @Inject(FEED_PROFILE_READ_PORT) private readonly feed: FeedProfileReadPort,
    @Inject(PRINTER_PROFILE_READ_PORT) private readonly printers: PrinterProfileReadPort,
    @Inject(MAKER_FOLLOW_READ_PORT) private readonly follows: MakerFollowReadPort,
  ) {}

  async forUser(userId: UserId, viewerId: UserId | null): Promise<ProfileAggregates> {
    const modelIds = await this.models.readyIdsByOwner(userId);
    const [modelsCount, projectViewsCount, projectDownloadsCount, feed, printersCount, follows] = await Promise.all([
      Promise.resolve(modelIds.length),
      this.analytics.countModelViews(modelIds),
      this.models.sumReadyDownloadsByOwner(userId),
      this.feed.statsByAuthor(userId),
      this.printers.countByUser(userId),
      this.follows.stats(userId, viewerId),
    ]);
    return {
      modelsCount,
      projectViewsCount,
      projectDownloadsCount,
      ...feed,
      printersCount,
      ...follows,
    };
  }
}
