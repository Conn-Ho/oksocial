import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsString,
  ValidateIf,
} from 'class-validator';

export class AddTeamMemberDto {
  @IsDefined({ message: '请输入邮箱' })
  @IsEmail({}, { message: '请输入正确的邮箱地址' })
  @ValidateIf((o) => o.sendEmail)
  email: string;

  @IsString()
  @IsIn(['USER', 'ADMIN', 'MANAGER', 'VIEWER'])
  role: string;

  @IsDefined()
  @IsBoolean()
  sendEmail: boolean;
}
