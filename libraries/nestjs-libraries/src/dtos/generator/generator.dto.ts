import { IsBoolean, IsIn, IsString, MinLength } from 'class-validator';

export class GeneratorDto {
  @IsString({ message: '请描述要写的内容' })
  @MinLength(10, { message: '至少写 10 个字' })
  research: string;

  @IsBoolean()
  isPicture: boolean;

  @IsString()
  @IsIn(['one_short', 'one_long', 'thread_short', 'thread_long'])
  format: 'one_short' | 'one_long' | 'thread_short' | 'thread_long';

  @IsString()
  @IsIn(['personal', 'company'])
  tone: 'personal' | 'company';
}
