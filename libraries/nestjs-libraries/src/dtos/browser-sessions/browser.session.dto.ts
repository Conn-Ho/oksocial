import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
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

  // A new account's exit IP (出口代理 id): its browser starts behind it, before the login page opens.
  @IsOptional()
  @IsString()
  proxyId?: string;

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
    message: '代理地址格式应为 http://user:pass@host:port 或 socks5://host:port',
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

// oksocial's login form: one step the user typed (an account, a password or a code). The value goes
// straight into the account's own browser; validation messages never repeat it.
export class LoginFormSubmitDto {
  @IsIn(['identifier', 'password', 'code'], { message: '不支持的登录步骤' })
  step: 'identifier' | 'password' | 'code';

  @IsString({ message: '请输入内容' })
  @Length(1, 512, { message: '请输入 1-512 个字符' })
  @Matches(/^[^\u0000-\u001f\u007f]*$/, { message: '不能包含换行或控制字符' })
  value: string;
}

// which page of the login to show in the account's browser: the login page, or its password form
export class BrowserLoginPageDto {
  @IsIn(['login', 'form'])
  page: 'login' | 'form';
}
