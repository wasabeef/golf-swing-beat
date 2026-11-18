// オフラインで使えるよう Service Worker を登録する（インストールはブラウザのメニューから行う）。

import { PWA } from './config.ts';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(PWA.SERVICE_WORKER_PATH).catch((error: unknown) => {
    console.warn('Service Worker を登録できません', error);
  });
}
