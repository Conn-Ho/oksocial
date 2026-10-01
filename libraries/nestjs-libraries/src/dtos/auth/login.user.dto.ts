import {
  IsDefined,
  IsEmail,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Provider } from '@prisma/client';

export class LoginUserDto {
  @IsString({ message: '请输入密码' })
  @IsDefined({ message: '请输入密码' })
  @ValidateIf((o) => !o.providerToken)
  @MinLength(1, { message: '请输入密码' })
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
  email: string;

  datafast_visitor_id: string;
}
