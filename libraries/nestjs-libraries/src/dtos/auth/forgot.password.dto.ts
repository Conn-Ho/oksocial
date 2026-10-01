import { IsDefined, IsEmail, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsString({ message: '请输入邮箱' })
  @IsDefined({ message: '请输入邮箱' })
  @IsEmail({}, { message: '请输入正确的邮箱地址' })
  email: string;
}
