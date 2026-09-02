import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { AuthGuard } from "./auth/auth.guard.ts";
import { PermissionGuard } from "../modules/permissions/guards/permission.guard.ts";
import { PermissionsModule } from "../modules/permissions/permissions.module.ts";
import { SessionVerifierModule } from "./auth/session-verifier.module.ts";
import { DatabaseModule } from "./database/database.module.ts";
import { HealthController } from "./health/health.controller.ts";
import { validateRuntimeEnvironment } from "./config/runtime-config.ts";
import { ApiExceptionFilter } from "./errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "./observability/correlation.interceptor.ts";
import { LoggingInterceptor } from "./observability/logging.interceptor.ts";
import { MetricsModule } from "./observability/metrics.module.ts";
import { RequestContext } from "./observability/request-context.ts";
import { RuntimeLogger } from "./observability/runtime-logger.ts";
import { QueueModule } from "./queue/queue.module.ts";
import { PushModule } from "../modules/push/push.module.ts";
import { AnalyticsModule } from "../modules/analytics/analytics.module.ts";
import { ModelsModule } from "../modules/models/models.module.ts";
import { ProjectsModule } from "../modules/projects/projects.module.ts";
import { ProfileModule } from "../modules/profile/profile.module.ts";
import { SeoModule } from "../modules/seo/seo.module.ts";
import { ModerationModule } from "../modules/moderation/moderation.module.ts";
import { AchievementsModule } from "../modules/achievements/achievements.module.ts";
import { CatalogModule } from "../modules/catalog/catalog.module.ts";
import { CatalogIntegrationModule } from "./integration/catalog.adapters.ts";
import { MasterServicesModule } from "../modules/masterServices/master-services.module.ts";
import { MakesModule } from "../modules/makes/makes.module.ts";
import { SlicerProfilesModule } from "../modules/slicerProfiles/slicerProfiles.module.ts";
import { FeedModule } from "../modules/feed/feed.module.ts";
import { CommunityModule } from "../modules/community/community.module.ts";
import { MakersModule } from "../modules/makers/makers.module.ts";
import { PrintersModule } from "../modules/printers/printers.module.ts";
import { AuthModule } from "../modules/auth/auth.module.ts";
import { IdeasModule } from "../modules/ideas/ideas.module.ts";
import { ImportsModule } from "../modules/imports/imports.module.ts";
import { ImportsIntegrationModule } from "./integration/imports.adapters.ts";
import { BillingIntegrationModule } from "./integration/billing.adapters.ts";
import { BillingModule } from "../modules/billing/billing.module.ts";
import { SecurityIntegrationModule } from "./integration/security.adapters.ts";
import { SecurityModule } from "../modules/security/security.module.ts";
import { MasterModule } from "../modules/master/master.module.ts";
import { MasterEquipmentModule } from "../modules/masterEquipment/master-equipment.module.ts";
import { OrdersIntegrationModule } from "./integration/orders.adapters.ts";
import { OrdersModule } from "../modules/orders/orders.module.ts";
import { PrintRequestsIntegrationModule } from "./integration/print-requests.adapters.ts";
import { PrintRequestsModule } from "../modules/printRequests/print-requests.module.ts";
import { PublicApiIntegrationModule } from "./integration/publicapi.adapters.ts";
import { PublicApiModule } from "../modules/publicapi/publicapi.module.ts";
import { AgentsIntegrationModule } from "./integration/agents.adapters.ts";
import { AgentsModule } from "../modules/agents/agents.module.ts";
import { OrganizationsIntegrationModule } from "./integration/organizations.adapters.ts";
import { OrganizationsModule } from "../modules/organizations/organizations.module.ts";
import { IdeasIntegrationModule } from "./integration/ideas.adapters.ts";
import { FeedIntegrationModule } from "./integration/feed.adapters.ts";
import { CommunityIntegrationModule } from "./integration/community.adapters.ts";
import { MakesIntegrationModule } from "./integration/makes.adapters.ts";
import { PrintersIntegrationModule } from "./integration/printers.adapters.ts";
import { DevicesIntegrationModule } from "./integration/devices.adapters.ts";
import { ProfilePrintersIntegrationModule } from "./integration/profile-printers.adapters.ts";
import { DevicesModule } from "../modules/devices/devices.module.ts";
import { RelayInternalModule } from "../modules/relayInternal/relay-internal.module.ts";
import { GenerationsIntegrationModule } from "./integration/generations.adapters.ts";
import { GenerationsModule } from "../modules/generations/generations.module.ts";
import { AssistantIntegrationModule } from "./integration/assistant.adapters.ts";
import { AssistantModule } from "../modules/assistant/assistant.module.ts";
import { SanctionsModule } from "../modules/sanctions/sanctions.module.ts";
import { createApiValidationPipe } from "./validation/api-validation.pipe.ts";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test",
      envFilePath: [".env.local", ".env"],
      validate: validateRuntimeEnvironment,
    }),
    SessionVerifierModule,
    PermissionsModule,
    MetricsModule,
    DatabaseModule,
    QueueModule,
    AnalyticsModule,
    ModelsModule,
    ProjectsModule,
    FeedIntegrationModule,
    FeedModule,
    CommunityIntegrationModule,
    CommunityModule,
    MakersModule,
    PrintersIntegrationModule,
    PrintersModule,
    DevicesIntegrationModule,
    DevicesModule,
    RelayInternalModule,
    GenerationsIntegrationModule,
    GenerationsModule,
    AssistantIntegrationModule,
    AssistantModule,
    SanctionsModule,
    ProfilePrintersIntegrationModule,
    ProfileModule,
    SeoModule,
    ModerationModule,
    AchievementsModule,
    CatalogIntegrationModule,
    CatalogModule,
    MasterServicesModule,
    MakesIntegrationModule,
    MakesModule,
    SlicerProfilesModule,
    PushModule,
    AuthModule,
    IdeasIntegrationModule,
    IdeasModule,
    ImportsIntegrationModule,
    ImportsModule,
    BillingIntegrationModule,
    BillingModule,
    SecurityIntegrationModule,
    SecurityModule,
    MasterModule,
    MasterEquipmentModule,
    OrdersIntegrationModule,
    OrdersModule,
    PrintRequestsIntegrationModule,
    PrintRequestsModule,
    PublicApiIntegrationModule,
    PublicApiModule,
    AgentsIntegrationModule,
    AgentsModule,
    OrganizationsIntegrationModule,
    OrganizationsModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContext,
    RuntimeLogger,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
  exports: [RequestContext],
})
export class AppModule {}
