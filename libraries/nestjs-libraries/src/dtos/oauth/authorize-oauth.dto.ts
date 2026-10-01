import { IsDefined, IsIn, IsOptional, IsString } from 'class-validator';

export class AuthorizeOAuthQueryDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  @IsIn(['code'])
  response_type: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  code_challenge?: string;

  // Not validated with IsIn: static clients may send arbitrary values that
  // were always ignored; only dynamic clients get S256 enforced (in the service)
  @IsString()
  @IsOptional()
  code_challenge_method?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}

export class ApproveOAuthDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsOptional()
  state?: string;

  // silent: approve only when this first-party app was approved for the team before
  @IsString()
  @IsDefined()
  @IsIn(['approve', 'deny', 'silent'])
  action: 'approve' | 'deny' | 'silent';

  // the team the grant is for (the member's current team when absent or not theirs)
  @IsString()
  @IsOptional()
  organization_id?: string;

  @IsString()
  @IsOptional()
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  code_challenge?: string;

  // Not validated with IsIn: static clients may send arbitrary values that
  // were always ignored; only dynamic clients get S256 enforced (in the service)
  @IsString()
  @IsOptional()
  code_challenge_method?: string;
}
