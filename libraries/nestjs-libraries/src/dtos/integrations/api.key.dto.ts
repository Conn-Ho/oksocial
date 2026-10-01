import { IsString, MinLength } from 'class-validator';

export class ApiKeyDto {
  @IsString()
  @MinLength(4, {
    message: '至少要 4 个字符',
  })
  api: string;
}
