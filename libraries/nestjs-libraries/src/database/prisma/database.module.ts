import { Global, Module } from '@nestjs/common';
import { PrismaRepository, PrismaService, PrismaTransaction } from './prisma.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { PaymentProviderManager } from '@gitroom/nestjs-libraries/services/payment/payment.provider.manager';
import { RevenueCatProvider } from '@gitroom/nestjs-libraries/services/payment/providers/revenuecat.provider';
import { XorPayProvider } from '@gitroom/nestjs-libraries/services/payment/providers/xorpay.provider';
import { BillingRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { BillingOrdersService } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';
import { ApiKeysRepository } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.repository';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.service';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { RelayImageService } from '@gitroom/nestjs-libraries/openai/relay.image.service';
import { DeepgramService } from '@gitroom/nestjs-libraries/deepgram/deepgram.service';
import { ClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';
import { ClippingRepository } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.repository';
import { AgenciesService } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.service';
import { AgenciesRepository } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.repository';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { WebhookSender } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhook.sender';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { BrowserSlotRepository } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.repository';
import { BrowserSlotService } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service';
import { InboxRepository } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { InboxAiService } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { ChannelStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository';
import { ChannelStatsService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';
import { WeeklyReportRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/weekly.report.repository';
import { WeeklyReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/weekly.report.service';
import { WeeklyReportAiService } from '@gitroom/nestjs-libraries/reports/weekly.report.ai.service';
import { AutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.repository';
import { AutomationRunner } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.runner';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.service';
import { AutomationAiService } from '@gitroom/nestjs-libraries/automations/automation.ai.service';
import { MonitorRepository } from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.repository';
import { MonitorService } from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service';
import { MonitorAiService } from '@gitroom/nestjs-libraries/monitor/monitor.ai.service';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.repository';
import { ThirdPartyRepository } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';
import { ThirdPartyService } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.service';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { FalService } from '@gitroom/nestjs-libraries/openai/fal.service';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import { ErrorsRepository } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.repository';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { BrandRepository } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.repository';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import { CreationRepository } from '@gitroom/nestjs-libraries/database/prisma/creation/creation.repository';
import { AiCreationService } from '@gitroom/nestjs-libraries/database/prisma/creation/creation.service';
import { CreationAiService } from '@gitroom/nestjs-libraries/creation/creation.ai.service';

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    UsersService,
    UsersRepository,
    OrganizationService,
    OrganizationRepository,
    SubscriptionService,
    SubscriptionRepository,
    NotificationService,
    NotificationsRepository,
    WebhooksRepository,
    WebhooksService,
    WebhookSender,
    IntegrationService,
    IntegrationRepository,
    PostsService,
    PostsRepository,
    StripeService,
    PaymentService,
    PaymentProviderManager,
    RevenueCatProvider,
    XorPayProvider,
    BillingRepository,
    PlanService,
    CreditsService,
    BillingOrdersService,
    ApiKeysRepository,
    ApiKeysService,
    SignatureRepository,
    AutopostRepository,
    AutopostService,
    SignatureService,
    MediaService,
    MediaRepository,
    AgenciesService,
    AgenciesRepository,
    IntegrationManager,
    RefreshIntegrationService,
    BrowserSlotRepository,
    BrowserSlotService,
    InboxRepository,
    InboxService,
    InboxAiService,
    ChannelStatsRepository,
    ChannelStatsService,
    ReportService,
    WeeklyReportRepository,
    WeeklyReportService,
    WeeklyReportAiService,
    AutomationRepository,
    AutomationRunner,
    AutomationService,
    AutomationAiService,
    MonitorRepository,
    MonitorService,
    MonitorAiService,
    BrandRepository,
    BrandService,
    CreationRepository,
    CreationAiService,
    AiCreationService,
    ExtractContentService,
    OpenaiService,
    RelayImageService,
    DeepgramService,
    ClippingService,
    ClippingRepository,
    FalService,
    EmailService,
    TrackService,
    ShortLinkService,
    SetsService,
    SetsRepository,
    ThirdPartyRepository,
    ThirdPartyService,
    OAuthRepository,
    OAuthService,
    VideoManager,
    AnnouncementsRepository,
    AnnouncementsService,
    ErrorsRepository,
    ErrorsService,
    AdminStatsRepository,
    AdminStatsService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
