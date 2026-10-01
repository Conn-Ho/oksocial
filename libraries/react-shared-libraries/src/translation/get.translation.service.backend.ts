import i18next from './i18next';
import { cookieName, fallbackLng, languages } from './i18n.config';
import { cookies } from 'next/headers';

// The server shares one i18next instance across requests, so never changeLanguage here: pick the
// request's language per call. Same rule as the app layout and the browser: the language cookie,
// else zh (proxy.ts also guesses one from Accept-Language, but the client never sees that guess,
// so using it here would mix two languages on one page).
const requestLanguage = async () => {
  const lng = (await cookies()).get(cookieName)?.value;
  return lng && languages.includes(lng) ? lng : fallbackLng;
};

export async function getT(ns?: string, options?: any) {
  const lng = await requestLanguage();
  await i18next.loadLanguages(lng);
  if (ns && !i18next.hasLoadedNamespace(ns)) {
    await i18next.loadNamespaces(ns);
  }
  return i18next.getFixedT(
    lng,
    Array.isArray(ns) ? ns[0] : ns,
    options?.keyPrefix
  );
}
