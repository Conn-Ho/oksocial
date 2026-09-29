import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { REMAKE_LENGTHS, REMAKE_TONES } from '@gitroom/nestjs-libraries/dtos/monitor/monitor.dto';
import { IMAGE_ASPECTS } from '@gitroom/nestjs-libraries/openai/relay.image.service';
import { TRANSLATE_LANGUAGES } from '@gitroom/nestjs-libraries/creation/creation.ai.service';

const WORDS_MAX = 30;
const SOURCE_TEXT_MAX = 6000;

// 品牌档案
export class BrandDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string;
  @IsOptional() @IsString() @MaxLength(2000) products?: string;
  @IsOptional() @IsString() @MaxLength(1000) audience?: string;
  @IsOptional() @IsString() @MaxLength(500) tone?: string;
  @IsArray() @ArrayMaxSize(WORDS_MAX) @IsString({ each: true }) @MaxLength(40, { each: true }) keywords: string[];
  @IsArray() @ArrayMaxSize(WORDS_MAX) @IsString({ each: true }) @MaxLength(40, { each: true }) bannedWords: string[];
  @IsOptional() @IsString() @MaxLength(300) cta?: string;
  @IsOptional() @IsString() @MaxLength(3000) examples?: string;
  // the website URL or file name it was built from
  @IsOptional() @IsString() @MaxLength(1000) source?: string;
}

export class ExtractBrandDto {
  // a public website, or pasted text (a file goes to /brands/extract-file)
  @IsOptional() @IsString() @MaxLength(1000) url?: string;
  @IsOptional() @IsString() @MaxLength(20000) text?: string;
}

// 创作台 templates; every one may name a 品牌档案 (else the default is used)
export class AdaptDto {
  @IsOptional() @IsString() brandId?: string;
  @IsString() @IsNotEmpty() @MaxLength(SOURCE_TEXT_MAX) text: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) platforms: string[];
  @IsOptional() @IsString() @MaxLength(500) instruction?: string;
}

export class TitlesDto {
  @IsOptional() @IsString() brandId?: string;
  @IsString() @IsNotEmpty() @MaxLength(SOURCE_TEXT_MAX) text: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) count?: number;
}

export class CreationRemakeDto {
  @IsOptional() @IsString() brandId?: string;
  // pasted text, or one of: a pasted post link, a 监控 item, a monitored post
  @IsOptional() @IsString() @MaxLength(SOURCE_TEXT_MAX) text?: string;
  @IsOptional() @IsString() @MaxLength(1000) url?: string;
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() targetId?: string;
  @IsString() @IsNotEmpty() platform: string;
  @IsIn(REMAKE_TONES) tone: (typeof REMAKE_TONES)[number];
  @IsIn(REMAKE_LENGTHS) length: (typeof REMAKE_LENGTHS)[number];
  @IsOptional() @IsString() @MaxLength(500) instruction?: string;
}

export class ScriptDto {
  @IsOptional() @IsString() brandId?: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) brief: string;
  @Type(() => Number) @IsIn([15, 30, 60]) seconds: 15 | 30 | 60;
  @IsOptional() @IsString() platform?: string;
}

export class CoverDto {
  @IsOptional() @IsString() brandId?: string;
  // the text written on the cover (empty: a picture without text, then the brief is needed)
  @IsString() @MaxLength(40) title: string;
  @IsOptional() @IsString() @MaxLength(1000) brief?: string;
  @IsOptional() @IsString() @MaxLength(200) style?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsIn(IMAGE_ASPECTS) aspect?: (typeof IMAGE_ASPECTS)[number];
}

export class TranslateImageDto {
  @IsIn(Object.keys(TRANSLATE_LANGUAGES)) target: string;
}

export class CreationHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class CreationDraftPostDto {
  @IsString() @IsNotEmpty() integrationId: string;
  // one text, or the parts of a thread
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(25) @IsString({ each: true }) @MaxLength(5000, { each: true }) texts: string[];
}

export class CreationDraftsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CreationDraftPostDto)
  posts: CreationDraftPostDto[];
  // generated images (history ids) to attach
  @IsOptional() @IsArray() @ArrayMaxSize(9) @IsString({ each: true }) imageGenerationIds?: string[];
}
