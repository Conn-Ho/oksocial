import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { isXorPayBilling } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';

@Catch(SubscriptionException)
export class SubscriptionExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const error: { section: Sections; action: AuthorizationActions } =
      exception.getResponse() as any;

    const message = getErrorMessage(error);

    response.status(status).json({
      statusCode: status,
      message,
      // oksocial plans are bought on the usage page, Stripe plans on the billing page
      url:
        process.env.FRONTEND_URL + (isXorPayBilling() ? '/usage' : '/billing'),
    });
  }
}

const getErrorMessage = (error: {
  section: Sections;
  action: AuthorizationActions;
}) => {
  switch (error.section) {
    case Sections.POSTS_PER_MONTH:
      return '本月发帖数已达套餐上限，请升级套餐后继续发布。';
    case Sections.CHANNEL:
      return '账号数已达套餐上限，请升级套餐后再添加账号。';
    case Sections.WEBHOOKS:
      return 'Webhook 数量已达套餐上限，请升级套餐后再添加。';
    case Sections.VIDEOS_PER_MONTH:
      return '本月视频生成次数已用完，请升级套餐。';
    case Sections.CLIPPING_MINUTES:
      return '本月视频剪辑时长已用完，请升级套餐。';
    case Sections.TEAM_MEMBERS:
      return '当前套餐不含团队协作，请升级套餐后再邀请成员。';
    case Sections.STORAGE:
      return '素材空间已用满，请删除不用的素材或升级套餐。';
    default:
      return '当前套餐不含这项功能，请升级套餐。';
  }
};
