import { IsBoolean, IsIn } from 'class-validator';

export class UpdateTeamRoleDto {
  @IsIn(['ADMIN', 'MANAGER', 'USER', 'VIEWER'])
  role: 'ADMIN' | 'MANAGER' | 'USER' | 'VIEWER';
}

export class PostApprovalSettingDto {
  @IsBoolean()
  enabled: boolean;
}
