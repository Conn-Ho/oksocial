import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDefined,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsSafeWebhookUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

export class ImportMediaItemDto {
  @IsString()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      '链接必须是公网 HTTPS 地址，不能指向内网',
  })
  url: string;

  @IsString()
  @IsDefined()
  name: string;
}

export class ImportMediaDto {
  @ValidateNested({ each: true })
  @Type(() => ImportMediaItemDto)
  @ArrayMinSize(1)
  @IsDefined()
  items: ImportMediaItemDto[];
}
