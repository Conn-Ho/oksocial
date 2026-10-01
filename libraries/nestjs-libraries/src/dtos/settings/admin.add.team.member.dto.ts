import { IsDefined, IsEmail, IsIn, IsString } from 'class-validator';

export class AdminAddTeamMemberDto {
  @IsDefined({ message: '请输入邮箱' })
  @IsEmail({}, { message: '请输入正确的邮箱地址' })
  email: string;

  @IsString()
  @IsIn(['USER', 'ADMIN', 'MANAGER', 'VIEWER'])
  role: string;
}
