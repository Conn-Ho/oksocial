import { IsDefined, IsString, Validate } from 'class-validator';
import { ValidUrlExtension } from '@gitroom/helpers/utils/valid.url.path';
import { IsSafeWebhookUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

export class UploadDto {
  @IsString()
  @IsDefined()
  @Validate(ValidUrlExtension)
  @IsSafeWebhookUrl({
    message:
      '链接必须是公网 HTTPS 地址，不能指向内网',
  })
  url: string;
}
