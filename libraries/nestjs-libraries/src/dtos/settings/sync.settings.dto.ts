import { IsBoolean, IsIn, IsOptional } from 'class-validator';

// 团队设置 › 同步与 AI: every switch is optional, so the panel sends only what changed.
export class UpdateSyncSettingsDto {
  @IsOptional() @IsBoolean() commentSync?: boolean;
  @IsOptional() @IsBoolean() dmSync?: boolean;
  @IsOptional() @IsBoolean() mentionSync?: boolean;
  @IsOptional() @IsBoolean() commentAiTag?: boolean;
  @IsOptional() @IsBoolean() dmAiTag?: boolean;
  @IsOptional() @IsBoolean() commentTranslateIn?: boolean;
  @IsOptional() @IsBoolean() commentTranslateOut?: boolean;
  @IsOptional() @IsBoolean() dmTranslateIn?: boolean;
  @IsOptional() @IsBoolean() dmTranslateOut?: boolean;
  // null: every AI 私信助手 follows its own setting
  @IsOptional() @IsIn(['ONCE', 'CONTINUOUS']) dmReplyPolicy?: 'ONCE' | 'CONTINUOUS' | null;
  @IsOptional() @IsBoolean() monitorCommentSync?: boolean;
  @IsOptional() @IsBoolean() monitorAiTag?: boolean;
  @IsOptional() @IsBoolean() competitorCommentSync?: boolean;
  @IsOptional() @IsBoolean() competitorAiTag?: boolean;
}
