import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

dayjs.extend(utc);

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The create-post request the post editor sends, for posts oksocial writes on the server (监控
 * 复刻, automations, AI 创作): every text as editor paragraphs so line breaks survive opening it
 * in the editor; more than one text is a thread; images ride on the first part. Pure.
 */
export const editorPostBody = (
  integration: { id: string; providerIdentifier: string },
  texts: string[],
  date: Date,
  o: { type?: 'draft' | 'now' | 'schedule'; images?: Array<{ id: string; path: string }> } = {}
): CreatePostDto => ({
  type: o.type ?? 'draft',
  shortLink: false,
  date: dayjs(date).utc().format('YYYY-MM-DDTHH:mm:ss'),
  tags: [],
  posts: [
    {
      group: makeId(10),
      integration: { id: integration.id },
      value: texts
        .filter((text) => text.trim())
        .map((text, i) => ({
          id: '',
          delay: 0,
          content: text
            .trim()
            .split('\n')
            .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
            .join(''),
          image: i === 0 ? o.images ?? [] : [],
        })),
      settings: { __type: integration.providerIdentifier as any },
    },
  ],
});
