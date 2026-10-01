/**
 * The translate function shared helpers accept: the frontend passes useT()'s t('key', '中文', { values }).
 * Server code and specs call the helpers without one and get the Chinese default (zhDefault).
 */
export type Translate = (
  key: string,
  fallback: string,
  values?: Record<string, unknown>
) => string;

/** Renders the Chinese default with its {{values}} filled in as they are (no HTML escaping). */
export const zhDefault: Translate = (_key, fallback, values) =>
  fallback.replace(/\{\{-?\s*(\w+)\s*\}\}/g, (_, name: string) =>
    String(values?.[name] ?? '')
  );
