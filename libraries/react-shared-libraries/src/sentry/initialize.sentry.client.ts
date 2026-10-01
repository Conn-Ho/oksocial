import * as Sentry from '@sentry/nextjs';
import { initializeSentryBasic } from '@gitroom/react/sentry/initialize.sentry.next.basic';

export const setSentryUser = (
  user?: { id: string; email?: string; orgId: string } | null
) => {
  try {
    if (user?.id) {
      Sentry.setUser({
        id: user.id,
        ...(user.email ? { email: user.email } : {}),
      });
      Sentry.setTag('organization.id', user.orgId);
    } else {
      Sentry.setUser(null);
      Sentry.setTag('organization.id', undefined);
    }
  } catch (err) {
    /* never let telemetry break the app */
  }
};

export const initializeSentryClient = (environment: string, dsn: string) =>
  initializeSentryBasic(environment, dsn, {
    integrations: [
      // Add default integrations back
      Sentry.browserTracingIntegration(),
      Sentry.browserProfilingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        maskAllInputs: false,
        blockAllMedia: false,
      }),
      Sentry.feedbackIntegration({
        // Disable the injection of the default widget
        autoInject: false,
        showEmail: false,
        // The widget's own texts default to English
        triggerLabel: '反馈',
        triggerAriaLabel: '反馈',
        formTitle: '反馈问题',
        nameLabel: '名字',
        namePlaceholder: '你的名字',
        emailLabel: '邮箱',
        emailPlaceholder: 'you@example.com',
        messageLabel: '描述',
        messagePlaceholder: '遇到了什么问题？你期望的结果是什么？',
        isRequiredLabel: '（必填）',
        addScreenshotButtonLabel: '添加截图',
        removeScreenshotButtonLabel: '移除截图',
        highlightToolText: '标注',
        hideToolText: '遮挡',
        submitButtonLabel: '提交反馈',
        cancelButtonLabel: '取消',
        confirmButtonLabel: '确认',
        successMessageText: '感谢你的反馈！',
      }),
      Sentry.replayCanvasIntegration(),
    ],
    replaysSessionSampleRate: 0.4,
    replaysOnErrorSampleRate: 1.0,

    profilesSampleRate: environment === 'development' ? 1.0 : 0.60,
  });
