import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ApiTags } from '@nestjs/swagger';
import {
  MarkNotificationsReadDto,
  NotificationCenterQueryDto,
} from '@gitroom/nestjs-libraries/dtos/notifications/notification.center.dto';
import { AllowViewer } from '@gitroom/backend/services/auth/permissions/roles.decorator';

@ApiTags('Notifications')
@Controller('/notifications')
export class NotificationsController {
  constructor(private _notificationsService: NotificationService) {}
  @Get('/')
  async mainPageList(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    return this._notificationsService.getMainPageCount(
      organization.id,
      user.id
    );
  }

  // 通知中心: every notification of the team, by category and read state
  @Get('/center')
  center(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Query() query: NotificationCenterQueryDto
  ) {
    return this._notificationsService.center(organization.id, user.id, query);
  }

  // reading is open to 只读成员 too: it only changes their own read marks
  @Post('/read')
  @AllowViewer()
  markRead(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Body() body: MarkNotificationsReadDto
  ) {
    return this._notificationsService.markRead(organization.id, user.id, body.ids);
  }

  @Post('/read-all')
  @AllowViewer()
  async markAllRead(@GetUserFromRequest() user: User) {
    await this._notificationsService.markAllRead(user.id);
    return { ok: true };
  }

  @Get('/list')
  async notifications(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    return this._notificationsService.getNotifications(
      organization.id,
      user.id
    );
  }
}
