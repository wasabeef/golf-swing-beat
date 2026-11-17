// 練習中に画面が消えないようにする。非対応ブラウザでは何もしない。

export class ScreenKeeper {
  #sentinel: WakeLockSentinel | null = null;
  #wanted = false;

  constructor() {
    // タブが裏に回ると自動で解除されるため、戻ったら取り直す
    document.addEventListener('visibilitychange', () => {
      if (this.#wanted && document.visibilityState === 'visible') void this.#acquire();
    });
  }

  async enable(): Promise<void> {
    this.#wanted = true;
    await this.#acquire();
  }

  async disable(): Promise<void> {
    this.#wanted = false;
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    await sentinel?.release().catch(() => undefined);
  }

  async #acquire(): Promise<void> {
    if (!('wakeLock' in navigator) || this.#sentinel) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        if (this.#sentinel === sentinel) this.#sentinel = null;
      });
      this.#sentinel = sentinel;
    } catch {
      // 省電力モード等で拒否された場合は諦める
    }
  }
}
