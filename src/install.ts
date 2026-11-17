// ホーム画面・デスクトップへのインストール（PWA）と、オフライン用の Service Worker。

import { PWA } from './config.ts';

/** Chrome / Edge がインストールできるときに出すイベント（標準の型定義にない） */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface StandaloneNavigator {
  standalone?: boolean;
}

export interface InstallElements {
  /** インストール項目全体（使えないときは隠す） */
  readonly control: HTMLElement;
  /** Android / PC 用のインストールボタン */
  readonly button: HTMLButtonElement;
  /** iPhone / iPad 用の手順 */
  readonly hint: HTMLElement;
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(PWA.SERVICE_WORKER_PATH).catch((error: unknown) => {
    console.warn('Service Worker を登録できません', error);
  });
}

/** すでにインストールしたアプリとして開いている */
function isInstalled(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & StandaloneNavigator).standalone === true
  );
}

/** iPhone / iPad（iPadOS はデスクトップの Mac として名乗るため、タッチの有無で見分ける） */
function isAppleMobile(): boolean {
  const { userAgent, maxTouchPoints } = navigator;
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * インストール項目を出し分ける。
 * Android / PC はブラウザのインストール確認を出すボタン、iPhone / iPad は「ホーム画面に追加」の手順を出す。
 */
export function setupInstall({ control, button, hint }: InstallElements): void {
  if (isInstalled()) return;

  if (isAppleMobile()) {
    control.hidden = false;
    hint.hidden = false;
    return;
  }

  let deferred: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    control.hidden = false;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    const prompt = deferred;
    if (!prompt) return;
    // 一度使ったイベントは再利用できない。断られても、ブラウザが再び出せるようになれば次のイベントが来る
    deferred = null;
    control.hidden = true;
    await prompt.prompt();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    control.hidden = true;
  });
}
