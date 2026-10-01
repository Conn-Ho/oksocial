import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

// Bodies okchat sends to /public/okchat (partner-signed; okchat contract §6). Text limits and the
// reasons okchat shows are checked by the services, so an empty reply is a 422, not a 400.

export class OkchatVerifyDto {
  @IsString()
  @IsNotEmpty()
  bindingId: string;

  @IsString()
  @IsNotEmpty()
  integrationId: string;
}

export class OkchatReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  okchatMessageId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  bindingId: string;

  @IsString()
  @IsNotEmpty()
  integrationId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  threadId: string;

  @IsString()
  text: string;
}

export class OkchatBindingDto {
  @IsString()
  @IsNotEmpty()
  integrationId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  bindingId: string;

  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
  hookUrl: string;
}

export class OkchatLinkUserDto {
  @IsString()
  @IsNotEmpty()
  oksocialUserId: string;

  // okchat sends a number today; kept as text
  @IsNotEmpty()
  okchatUserId: string | number;
}

export class OkchatLinkDto {
  @IsString()
  @IsNotEmpty()
  oksocialOrgId: string;

  // okchat's public space id ("w…")
  @IsNotEmpty()
  okchatAccountId: string | number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OkchatLinkUserDto)
  users?: OkchatLinkUserDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OkchatBindingDto)
  bindings: OkchatBindingDto[];
}
