// What CopilotKit's chat says outside the messages (its defaults are English).
export const copilotLabels = (t: (key: string, fallback: string) => string) => ({
  placeholder: t('copilot_placeholder', '输入消息…'),
  error: t('copilot_error', '❌ 出错了，请再试一次。'),
  stopGenerating: t('copilot_stop', '停止生成'),
  regenerateResponse: t('copilot_regenerate', '重新生成'),
  copyToClipboard: t('copilot_copy', '复制'),
  thumbsUp: t('copilot_thumbs_up', '有帮助'),
  thumbsDown: t('copilot_thumbs_down', '没帮助'),
  copied: t('copilot_copied', '已复制'),
});
