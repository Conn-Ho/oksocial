import { IsDefined, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

export const TEAM_NAME_MAX = 60;
export const TEAM_DESCRIPTION_MAX = 200;
// 团队编码: letters, digits, - and _ (empty clears it)
export const TEAM_CODE_PATTERN = /^[A-Za-z0-9_-]{0,16}$/;

// 创建团队
export class CreateTeamDto {
  @IsDefined({ message: '请输入团队名称' })
  @IsString({ message: '请输入团队名称' })
  @MaxLength(TEAM_NAME_MAX, { message: `团队名称最多 ${TEAM_NAME_MAX} 个字` })
  name: string;
}

// 团队设置 › 基本信息: only what changed is sent; null clears the avatar, '' the code or introduction.
export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MaxLength(TEAM_NAME_MAX, { message: `团队名称最多 ${TEAM_NAME_MAX} 个字` })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: '头像需要是 http(s) 图片链接' }
  )
  avatar?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(TEAM_CODE_PATTERN, { message: '团队编码最多 16 位，只能用字母、数字、- 和 _' })
  code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(TEAM_DESCRIPTION_MAX, { message: `团队介绍最多 ${TEAM_DESCRIPTION_MAX} 个字` })
  description?: string | null;
}

// 删除团队: the team's name, typed again
export class DeleteTeamDto {
  @IsDefined({ message: '请输入团队名称确认删除' })
  @IsString({ message: '请输入团队名称确认删除' })
  name: string;
}
