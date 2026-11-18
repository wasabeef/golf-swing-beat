import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STORAGE_KEY, TEMPO, VOLUME } from '../src/config.ts';
import { DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings } from '../src/settings.ts';

class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  clear(): void {
    this.#map.clear();
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
}

class BrokenStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('SecurityError');
  }
  override setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

describe('parseSettings', () => {
  it('不正な値は既定値に戻し、範囲外は丸める', () => {
    const parsed = parseSettings({
      tempo: TEMPO.MAX + 100,
      ratio: 4,
      sound: 't9',
      volume: VOLUME.MAX + 1,
      leftHanded: 'yes',
      keepRunning: 1,
    });
    assert.deepEqual(parsed, {
      tempo: TEMPO.MAX,
      ratio: DEFAULT_SETTINGS.ratio,
      sound: DEFAULT_SETTINGS.sound,
      volume: VOLUME.MAX,
      leftHanded: DEFAULT_SETTINGS.leftHanded,
      keepRunning: DEFAULT_SETTINGS.keepRunning,
    });
  });

  it('オブジェクトでなければ既定値', () => {
    assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(parseSettings('70'), DEFAULT_SETTINGS);
  });
});

describe('loadSettings / saveSettings', () => {
  it('保存した設定を読み戻せる（電源を切っても設定が残る）', () => {
    const storage = new MemoryStorage();
    const settings = { tempo: 62, ratio: 3 as const, sound: 't2' as const, volume: 30, leftHanded: true, keepRunning: true };
    saveSettings(settings, storage);
    assert.deepEqual(loadSettings(storage), settings);
  });

  it('壊れた JSON は既定値', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{');
    assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  });

  it('ストレージが使えなくても例外を出さない', () => {
    const storage = new BrokenStorage();
    assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
    assert.doesNotThrow(() => saveSettings(DEFAULT_SETTINGS, storage));
  });
});
