import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { OkchatLinkService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.link.service';
import { isVerifiedEmail } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';

// okchat (customer service) for the team's DMs, as the 互动 card and the OAuth page show it.
@ApiTags('okchat')
@Controller('/okchat')
export class OkchatController {
  constructor(private _link: OkchatLinkService) {}

  @Get('/status')
  @ApiOperation({
    summary: '私信在 okchat 的接入状态',
    description: '团队是否已关联 okchat，以及每个小红书账号在 okchat 的渠道状态；org 可指定成员所在的另一个团队。未开通时 404。',
  })
  async status(@GetUserFromRequest() user: User, @GetOrgFromRequest() org: Organization, @Query('org') orgId?: string) {
    // okchat signs people in by their oksocial email only once it is verified, so the card asks for that first
    return { ...(await this._link.status(user.id, org.id, orgId)), emailVerified: isVerifiedEmail(user), email: user.email };
  }
}
