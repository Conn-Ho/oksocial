import { Body, Controller, Get, HttpException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { CouponService } from '@gitroom/nestjs-libraries/database/prisma/billing/coupon.service';
import { CreateCouponDto } from '@gitroom/nestjs-libraries/dtos/billing/usage.dto';

// 兑换券管理: platform superadmins only (User.isSuperAdmin), like the rest of /admin.
@ApiTags('Admin')
@Controller('/admin/coupons')
export class AdminCouponsController {
  constructor(private _couponService: CouponService) {}

  private assertSuperAdmin(user: User) {
    if (!user?.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }
  }

  @Get('/')
  @ApiOperation({ summary: '兑换券列表（超级管理员）' })
  list(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._couponService.list();
  }

  @Post('/')
  @ApiOperation({ summary: '创建兑换券（超级管理员）', description: '送积分和/或套餐天数，可设过期时间和可兑换的团队数。' })
  create(@GetUserFromRequest() user: User, @Body() body: CreateCouponDto) {
    this.assertSuperAdmin(user);
    return this._couponService.create(user.id, body);
  }

  @Post('/:id/disable')
  @ApiOperation({ summary: '停用兑换券（超级管理员）' })
  async disable(@GetUserFromRequest() user: User, @Param('id') id: string) {
    this.assertSuperAdmin(user);
    return { disabled: await this._couponService.disable(id) };
  }
}
