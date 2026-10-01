'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { WordpressPostType } from '@gitroom/frontend/components/new-launch/providers/wordpress/wordpress.post.type';
import { WordpressTerms } from '@gitroom/frontend/components/new-launch/providers/wordpress/wordpress.terms';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { WordpressDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const WordpressSettings: FC = () => {
  const form = useSettings();
  const t = useT();
  return (
    <>
      <Input label="Title" {...form.register('title')} />
      <WordpressPostType {...form.register('type')} />
      <Select
        label={t('wordpress_status', '状态')}
        {...form.register('status', { value: 'publish' })}
      >
        <option value="publish">{t('wordpress_status_publish', '发布')}</option>
        <option value="draft">{t('draft', '草稿')}</option>
        <option value="pending">
          {t('wordpress_status_pending', '待审核')}
        </option>
        <option value="private">{t('wordpress_status_private', '私密')}</option>
      </Select>
      <WordpressTerms
        label={t('wordpress_categories', '分类目录')}
        func="categoriesList"
        {...form.register('categories')}
      />
      <WordpressTerms
        label={t('wordpress_tags', 'WordPress 标签')}
        func="tagsList"
        {...form.register('tags')}
      />
      <MediaComponent
        label={t('label_cover_picture', '封面图片')}
        description={t('add_a_cover_picture', '添加封面图片')}
        {...form.register('main_image')}
      />
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: WordpressSettings,
  CustomPreviewComponent: undefined, // WordpressPreview,
  dto: WordpressDto,
  maximumCharacters: 100000,
});
