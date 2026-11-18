// 設定の保存と読み込み。保存できない環境でも既定値で動く。

import { RATIO, SOUND, STORAGE_KEY, TEMPO, VOLUME, type SoundKind, type SwingRatio } from './config.ts';
import { clampRatio, clampTempo } from './timeline.ts';

export interface Settings {
  tempo: number;
  ratio: SwingRatio;
  sound: SoundKind;
  volume: number;
  leftHanded: boolean;
  /** 画面が隠れても止めずに続ける */
  keepRunning: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  tempo: TEMPO.DEFAULT,
  ratio: RATIO.DEFAULT,
  sound: SOUND.DEFAULT,
  volume: VOLUME.DEFAULT,
  leftHanded: false,
  keepRunning: false,
};

const isSound = (value: unknown): value is SoundKind =>
  (SOUND.KINDS as readonly unknown[]).includes(value);

const clampVolume = (value: number): number =>
  Math.min(VOLUME.MAX, Math.max(VOLUME.MIN, Math.round(value)));

/** 保存データを検証し、不正な項目は既定値に戻す */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const data = raw as Record<string, unknown>;
  return {
    tempo: typeof data.tempo === 'number' ? clampTempo(data.tempo) : DEFAULT_SETTINGS.tempo,
    ratio: typeof data.ratio === 'number' ? clampRatio(data.ratio) : DEFAULT_SETTINGS.ratio,
    sound: isSound(data.sound) ? data.sound : DEFAULT_SETTINGS.sound,
    volume: typeof data.volume === 'number' ? clampVolume(data.volume) : DEFAULT_SETTINGS.volume,
    leftHanded: typeof data.leftHanded === 'boolean' ? data.leftHanded : DEFAULT_SETTINGS.leftHanded,
    keepRunning: typeof data.keepRunning === 'boolean' ? data.keepRunning : DEFAULT_SETTINGS.keepRunning,
  };
}

export function loadSettings(storage: Storage | undefined = globalThis.localStorage): Settings {
  try {
    const json = storage?.getItem(STORAGE_KEY);
    return parseSettings(json ? JSON.parse(json) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: Settings,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // プライベートブラウズ等で保存できない場合は諦める
  }
}
