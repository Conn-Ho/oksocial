import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewPostsDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
