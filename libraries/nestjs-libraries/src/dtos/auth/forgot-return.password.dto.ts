import {
  IsDefined,
  IsIn,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

export class ForgotReturnPasswordDto {
  @IsString({ message: '请输入新密码' })
  @IsDefined({ message: '请输入新密码' })
  @MinLength(8, { message: '密码至少 8 位' })
  password: string;

  @IsString({ message: '请再输入一次新密码' })
  @IsDefined({ message: '请再输入一次新密码' })
  @IsIn([makeId(10)], {
    message: '两次输入的密码不一致',
  })
  @ValidateIf((o) => o.password !== o.repeatPassword)
  repeatPassword: string;

  @IsString()
  @IsDefined()
  @MinLength(5)
  token: string;
}
