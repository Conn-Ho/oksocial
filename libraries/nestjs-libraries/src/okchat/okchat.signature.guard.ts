import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { okchatEnabled, okchatSecret } from '@gitroom/nestjs-libraries/okchat/okchat.config';
import {
  OKCHAT_SIGNATURE_HEADER,
  OKCHAT_TIMESTAMP_HEADER,
  verifyOkchat,
} from '@gitroom/nestjs-libraries/okchat/okchat.signature';

/**
 * okchat's partner calls (/public/okchat/verify, /replies, /link): 404 while the bridge is not
 * configured, 401 unless the signature is the one of the raw request bytes and fresh. Runs before
 * the body is validated, so nothing is looked at for an unsigned request.
 */
@Injectable()
export class OkchatSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (!okchatEnabled()) {
      throw new HttpException({ error: 'okchat 还没有开通' }, 404);
    }
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const ok = verifyOkchat({
      secret: okchatSecret(),
      timestamp: header(OKCHAT_TIMESTAMP_HEADER),
      signature: header(OKCHAT_SIGNATURE_HEADER),
      rawBody: req.rawBody,
    });
    if (!ok) {
      throw new HttpException({ error: '签名无效或已过期' }, 401);
    }
    return true;
  }
}
