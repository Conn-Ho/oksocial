'use client';
import dayjs, { ConfigType } from 'dayjs';
import { FC, useEffect } from 'react';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh';
import i18next from '@gitroom/react/translation/i18next';
import { fallbackLng } from '@gitroom/react/translation/i18n.config';
dayjs.extend(timezone);
dayjs.extend(utc);
dayjs.extend(relativeTime);

// Relative times ("3 小时前") and month / weekday names follow the UI language on every page,
// not only once the calendar (which loads the other locales) has been opened
const updateDayjsLocale = () => {
  dayjs.locale(i18next.resolvedLanguage || fallbackLng);
};
i18next.on('languageChanged', updateDayjsLocale);
updateDayjsLocale();

const { utc: originalUtc } = dayjs;

export const getTimezone = () => {
  if (typeof window === 'undefined') {
    return dayjs.tz.guess();
  }
  return localStorage.getItem('timezone') || dayjs.tz.guess();
};

export const newDayjs = (config?: ConfigType) => {
  return dayjs(config);
};

const SetTimezone: FC = () => {
  useEffect(() => {
    dayjs.utc = (config?: ConfigType, format?: string, strict?: boolean) => {
      const result = originalUtc(config, format, strict);

      // Attach `.local()` method to the returned Dayjs object
      result.local = function () {
        return result.tz(getTimezone());
      };

      return result;
    };
    if (localStorage.getItem('timezone')) {
      dayjs.tz.setDefault(getTimezone());
    }
  }, []);
  return null;
};

export default SetTimezone;
