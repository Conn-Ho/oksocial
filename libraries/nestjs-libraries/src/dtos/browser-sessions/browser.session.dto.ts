import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class StartBrowserLoginDto {
  @IsString()
  @IsNotEmpty()
  provider: string;

  // Set when re-scanning an existing channel whose login expired.
  @IsOptional()
  @IsString()
  integrationId?: string;

  // E2E only: connect a simulated account (worker slot sim-*). Superadmins with
  // OKSOCIAL_SIM_ACCOUNTS=1 only; everyone else gets 403.
  @IsOptional()
  @IsBoolean()
  simulated?: boolean;
}

export class CreateBrowserProxyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  // http(s):// or socks5:// with optional user:pass@
  @IsString()
  @Matches(/^(https?|socks5h?):\/\/([^\s:@/]+(:[^\s@/]*)?@)?[^\s:@/]+:\d{2,5}\/?$/, {
    message: 'proxy URL must look like http://user:pass@host:port or socks5://host:port',
  })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  region?: string;
}

export class SetChannelProxyDto {
  @ValidateIf((o) => o.proxyId !== null)
  @IsString()
  proxyId: string | null;
}
