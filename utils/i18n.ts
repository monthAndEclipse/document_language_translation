import { SupportedLocale } from '../types';
import { UI_STRINGS } from '../constants';

export const t = (key: string, locale: SupportedLocale = SupportedLocale.EN): string => {
  const dict = UI_STRINGS[locale] || UI_STRINGS[SupportedLocale.EN];
  return dict[key] || key;
};
