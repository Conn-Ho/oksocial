import {
  IsDefined,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Provider } from '@prisma/client';

export class CreateOrgUserDto {
  @IsString({ message: '请输入密码' })
  @MinLength(8, { message: '密码至少 8 位' })
  @MaxLength(64, { message: '密码最多 64 位' })
  @IsDefined({ message: '请输入密码' })
  @ValidateIf((o) => !o.providerToken)
  password: string;

  @IsString()
  @IsDefined()
  provider: Provider;

  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.password)
  providerToken: string;

  @IsEmail({}, { message: '请输入正确的邮箱地址' })
  @IsDefined({ message: '请输入邮箱' })
  @ValidateIf((o) => !o.providerToken)
  email: string;

  @IsString({ message: '请输入团队名称' })
  @IsDefined({ message: '请输入团队名称' })
  @MinLength(2, { message: '团队名称至少 2 个字' })
  @MaxLength(128, { message: '团队名称最多 128 个字' })
  company: string;

  datafast_visitor_id: string;
}
