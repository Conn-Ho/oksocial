import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import {
  BRAND_FILE_MAX_BYTES,
  BrandService,
} from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import { AiCreationService } from '@gitroom/nestjs-libraries/database/prisma/creation/creation.service';
import { BrandDto, ExtractBrandDto } from '@gitroom/nestjs-libraries/dtos/creation/creation.dto';

// 品牌档案: what every AI writer knows about the brand. Everyone reads them; admins and managers
// change them, since they steer inbox replies, automations and 监控 复刻 of the whole organization.
@ApiTags('Brands')
@Controller('/brands')
export class BrandsController {
  constructor(
    private _brandService: BrandService,
    private _creationService: AiCreationService
  ) {}

  @Get('/')
  list(@GetOrgFromRequest() org: Organization) {
    return this._brandService.list(org.id);
  }

  @Post('/')
  @RequireRoles('ADMIN', 'MANAGER')
  create(@GetOrgFromRequest() org: Organization, @Body() body: BrandDto) {
    return this._brandService.create(org.id, body);
  }

  // AI fills the fields from a website or pasted text; nothing is saved until the user saves.
  @Post('/extract')
  @RequireRoles('ADMIN', 'MANAGER')
  extract(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: ExtractBrandDto
  ) {
    return this._creationService.extractBrand(org.id, user.id, body.url ? { url: body.url } : { text: body.text });
  }

  // Same from a PDF / Word / TXT / Markdown file, read in memory and never stored.
  @Post('/extract-file')
  @RequireRoles('ADMIN', 'MANAGER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BRAND_FILE_MAX_BYTES }, defParamCharset: 'utf8' }))
  extractFile(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file?.buffer) {
      throw new HttpException('请选择文件', 400);
    }
    return this._creationService.extractBrand(org.id, user.id, {
      file: { buffer: file.buffer, originalname: file.originalname },
    });
  }

  @Put('/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  update(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Body() body: BrandDto) {
    return this._brandService.update(org.id, id, body);
  }

  @Post('/:id/default')
  @RequireRoles('ADMIN', 'MANAGER')
  setDefault(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._brandService.setDefault(org.id, id);
  }

  @Delete('/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._brandService.remove(org.id, id);
  }
}
