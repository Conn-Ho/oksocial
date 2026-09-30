const ERROR_MAX = 1000;

/**
 * What a failed post's error says, from whatever the workflow caught. A Temporal activity failure
 * arrives as its JSON, with the activity's own message nested under `cause`; stored as is it is
 * pages of stack trace in the UI and the notification.
 */
export const postErrorText = (err: unknown): string => {
  const e = err as {
    message?: unknown;
    cause?: { message?: unknown; failure?: { message?: unknown } };
    failure?: { cause?: { message?: unknown } };
  } | null;
  const message =
    typeof err === 'string'
      ? err
      : [e?.cause?.failure?.message, e?.cause?.message, e?.failure?.cause?.message, e?.message].find(
          (m): m is string => typeof m === 'string' && m.length > 0
        ) ?? JSON.stringify(err);
  return message.slice(0, ERROR_MAX);
};
