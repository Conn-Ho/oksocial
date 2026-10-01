'use client';
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const { sentryDsn } = useVariables();

  useEffect(() => {
    if (!sentryDsn) {
      return;
    }
    const eventId = Sentry.captureException(error);
    Sentry.showReportDialog({
      eventId,
      title: '页面出错了',
      subtitle: '请告诉我们发生了什么，帮助我们尽快修复。',
      labelComments: '发生了什么？',
      labelName: '你的名字',
      labelEmail: '你的邮箱',
      labelSubmit: '提交反馈',
      lang: 'zh-cn',
    });

  }, [error]);
  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
