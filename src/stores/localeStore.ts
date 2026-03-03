import { defineStore } from 'pinia';
import { ref } from 'vue';

export type Locale = 'en' | 'de';

export const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

const STORAGE_KEY = 'locale';

function loadLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'de' ? 'de' : 'en';
}

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<Locale>(loadLocale());

  function setLocale(l: Locale) {
    locale.value = l;
    localStorage.setItem(STORAGE_KEY, l);
  }

  return { locale, setLocale };
});
