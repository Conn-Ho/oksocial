import { IsBoolean, IsDefined, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { WEBHOOK_FORMATS, WebhookFormat } from '@gitroom/helpers/utils/webhook.formats';
import { Type } from 'class-transformer';
import { IsSafeWebhookUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

export class WebhooksIntegrationDto {
  @IsString()
  @IsDefined()
  id: string;
}

export class WebhooksDto {
  id: string;

  @IsString()
  @IsDefined()
  name: string;

  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'Webhook 地址必须是公网 HTTPS 地址，不能指向内网',
  })
  url: string;

  @Type(() => WebhooksIntegrationDto)
  @IsDefined()
  integrations: WebhooksIntegrationDto[];

  @IsOptional()
  @IsIn(WEBHOOK_FORMATS)
  format?: WebhookFormat;

  // 飞书/钉钉 bot signing secret; empty on edit keeps the stored one
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;

  @IsOptional()
  @IsBoolean()
  clearSecret?: boolean;

  @IsOptional()
  @IsBoolean()
  notifications?: boolean;
}

export class OnlyURL {
  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      '链接必须是公网 HTTPS 地址，不能指向内网',
  })
  url: string;
}

export class UpdateDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  name: string;

  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'Webhook 地址必须是公网 HTTPS 地址，不能指向内网',
  })
  url: string;

  @Type(() => WebhooksIntegrationDto)
  @IsDefined()
  integrations: WebhooksIntegrationDto[];

  @IsOptional()
  @IsIn(WEBHOOK_FORMATS)
  format?: WebhookFormat;

  // 飞书/钉钉 bot signing secret; empty on edit keeps the stored one
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;

  @IsOptional()
  @IsBoolean()
  clearSecret?: boolean;

  @IsOptional()
  @IsBoolean()
  notifications?: boolean;
}

export class TestWebhookDto {
  // a saved webhook: its stored secret is used when none is typed
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(WEBHOOK_FORMATS)
  format: WebhookFormat;

  @IsString()
  @IsUrl()
  @IsDefined()
  @IsSafeWebhookUrl({
    message:
      'Webhook 地址必须是公网 HTTPS 地址，不能指向内网',
  })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;
}
