import {
  IsDefined,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class PinterestSettingsDto {
  @IsString()
  @ValidateIf((o) => !!o.title)
  @MaxLength(100)
  title: string;

  @IsString()
  @ValidateIf((o) => !!o.link)
  @IsUrl()
  link: string;

  @IsString()
  @ValidateIf((o) => !!o.dominant_color)
  dominant_color: string;

  @IsDefined({
    message: '请选择画板',
  })
  @IsString({
    message: '请选择画板',
  })
  @MinLength(1, {
    message: '请选择画板',
  })
  @Matches(/^\d+$/, {
    message:
      '画板要填数字 ID（可在账号的画板列表里查到），不能填画板名称',
  })
  @JSONSchema({
    description:
      'The numeric id of the board (from the boards list of the channel), not the board name',
  })
  board: string;
}
