import i18next from './i18next';
import { cookieName, fallbackLng, headerName, languages } from './i18n.config';
import { cookies, headers } from 'next/headers';

// The server shares one i18next instance across requests, so never changeLanguage here:
// pick the request's language (the header proxy.ts sets, else the language cookie) per call.
const requestLanguage = async () => {
  const lng =
    (await headers()).get(headerName) ||
    (await cookies()).get(cookieName)?.value;
  return lng && languages.includes(lng)
    ? lng
    : i18next.resolvedLanguage || fallbackLng;
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
