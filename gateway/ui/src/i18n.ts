import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      "Dashboard": "Dashboard",
      "New Pipeline": "New Pipeline",
      "History": "History",
      "Accounts": "Accounts",
      "Skills": "Skills",
      "Workflows": "Workflows",
      "Rules": "Rules",
      "Models": "Models",
      "Settings": "Settings",
      "System Online": "System Online",
      "Active Pipeline": "Active Pipeline",
      "Launch Pipeline": "Launch Pipeline",
      "Back": "Back",
      "Next": "Next",
      "Launch": "Launch",
      "Quota": "Quota",
      "Free": "Free"
    }
  },
  tr: {
    translation: {
      "Dashboard": "Panel",
      "New Pipeline": "Yeni Pipeline",
      "History": "History",
      "Accounts": "Hesaplar",
      "Skills": "Skill'ler",
      "Workflows": "Workflow'lar",
      "Rules": "Kurallar",
      "Models": "Modeller",
      "Settings": "Ayarlar",
      "System Online": "System Online",
      "Active Pipeline": "Aktif Pipeline",
      "Launch Pipeline": "Launch Pipeline",
      "Back": "Geri",
      "Next": "İleri",
      "Launch": "Launch",
      "Quota": "Kota",
      "Free": "Empty"
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
