import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import {
  AiCreationService,
  IMAGE_MAX_BYTES,
} from '@gitroom/nestjs-libraries/database/prisma/creation/creation.service';
import {
  AdaptDto,
  CoverDto,
  CreationDraftsDto,
  CreationHistoryQueryDto,
  CreationRemakeDto,
  ScriptDto,
  TitlesDto,
  TranslateImageDto,
} from '@gitroom/nestjs-libraries/dtos/creation/creation.dto';

// AI 创作 desk: templates that write in the chosen 品牌档案's voice, their history, and saving
// results as drafts (per channel) or into the media library. Generation runs in the request;
// an image takes 10-20 s. Read-only members can look at the history but not generate.
@ApiTags('Creation')
@Controller('/creation')
export class CreationController {
  constructor(private _creationService: AiCreationService) {}

  @Get('/platforms')
  platforms() {
    return this._creationService.platforms();
  }

  @Post('/adapt')
  adapt(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: AdaptDto) {
    return this._creationService.adapt(org.id, user.id, body);
  }

  @Post('/titles')
  titles(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: TitlesDto) {
    return this._creationService.titles(org.id, user.id, body);
  }

  @Post('/remake')
  remake(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: CreationRemakeDto) {
    return this._creationService.remake(org.id, user.id, body);
  }

  @Post('/script')
  script(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: ScriptDto) {
    return this._creationService.script(org.id, user.id, body);
  }

  @Post('/cover')
  cover(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: CoverDto) {
    return this._creationService.cover(org.id, user.id, body);
  }

  @Post('/translate-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES }, defParamCharset: 'utf8' }))
  translateImage(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: TranslateImageDto
  ) {
    if (!file?.buffer) {
      throw new HttpException('请选择图片', 400);
    }
    return this._creationService.translateImage(
      org.id,
      user.id,
      { buffer: file.buffer, originalname: file.originalname },
      body
    );
  }

  @Get('/history')
  history(@GetOrgFromRequest() org: Organization, @Query() query: CreationHistoryQueryDto) {
    return this._creationService.history(org.id, query.page || 1);
  }

  @Get('/history/:id')
  generation(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._creationService.generation(org.id, id);
  }

  @Post('/history/:id/media')
  saveToMedia(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._creationService.saveToMedia(org.id, id);
  }

  @Post('/drafts')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  drafts(@GetOrgFromRequest() org: Organization, @Body() body: CreationDraftsDto) {
    return this._creationService.saveDrafts(org.id, body);
  }
}
