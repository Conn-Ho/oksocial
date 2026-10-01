import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { OkchatLinkService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.link.service';
import { OkchatReplyService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.reply.service';
import { OkchatSignatureGuard } from '@gitroom/nestjs-libraries/okchat/okchat.signature.guard';
import { OkchatLinkDto, OkchatReplyDto, OkchatVerifyDto } from '@gitroom/nestjs-libraries/dtos/okchat/okchat.dto';

// What okchat calls (okchat contract §6), served at /api/public/okchat. verify / replies / link
// carry the partner signature over the raw body; accounts takes an oksocial OAuth access token.
// None of them takes an oksocial API key.
//
// Limited per client address (okchat calls from its servers, so the limits are okchat's): 120 a
// minute, replies 600 a minute (every agent's sends), verify 5000 per 15 minutes: okchat's 15-minute
// check calls it once per binding, back to back, and two checks can fall in one window.
@ApiTags('okchat')
@Controller('/public/okchat')
@UseGuards(ThrottlerRealIpGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class OkchatPublicController {
  constructor(private _link: OkchatLinkService, private _replies: OkchatReplyService) {}

  @Post('/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 5000, ttl: 15 * 60_000 } })
  @UseGuards(OkchatSignatureGuard)
  @ApiOperation({ summary: 'okchat 巡检账号登录状态', description: '不开浏览器，只读 oksocial 记录的状态：ok / logged_out / unbound。' })
  verify(@Body() body: OkchatVerifyDto) {
    return this._link.verify(body);
  }

  @Post('/replies')
  @HttpCode(202)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @UseGuards(OkchatSignatureGuard)
  @ApiOperation({ summary: 'okchat 回复私信', description: '排队发送，结果走 delivery 回执；同一 okchatMessageId 不重复发。409 账号掉线或解绑，422 内容为空或超长。' })
  replies(@Body() body: OkchatReplyDto) {
    return this._replies.accept(body);
  }

  @Post('/link')
  @HttpCode(200)
  @UseGuards(OkchatSignatureGuard)
  @ApiOperation({ summary: 'okchat 关联空间', description: '记录团队关联的 okchat 空间、成员和账号渠道；按团队覆盖，可重复调用。' })
  link(@Body() body: OkchatLinkDto) {
    return this._link.link(body);
  }

  @Get('/accounts')
  @ApiOperation({ summary: '团队的私信账号', description: '用 okchat 的 oksocial 访问令牌（Bearer）读取授权团队里的小红书账号。' })
  accounts(@Headers('authorization') authorization?: string) {
    return this._link.accountsForToken(authorization);
  }
}
