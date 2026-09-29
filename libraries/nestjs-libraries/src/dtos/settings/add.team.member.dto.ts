import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsString,
  ValidateIf,
} from 'class-validator';

export class AddTeamMemberDto {
  @IsDefined()
  @IsEmail()
  @ValidateIf((o) => o.sendEmail)
  email: string;

  @IsString()
  @IsIn(['USER', 'ADMIN', 'MANAGER', 'VIEWER'])
  role: string;

  @IsDefined()
  @IsBoolean()
  sendEmail: boolean;
}
