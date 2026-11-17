// Web Audio でカウント音を合成する。

import { AUDIO, VOLUME, type SoundKind, type TickKind } from './config.ts';

const volumeToGain = (volume: number): number => (volume / VOLUME.MAX) ** 2;

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * iOS Safari（16.4 以降）では、Web Audio は既定で消音スイッチに従って鳴らない。
 * 音声セッションを再生用にして、消音スイッチがオンでも鳴るようにする。
 */
function useMediaPlaybackSession(): void {
  const session = (navigator as Navigator & AudioSessionNavigator).audioSession;
  if (!session) return;
  try {
    session.type = 'playback';
  } catch {
    // 非対応の値なら既定のまま
  }
}

interface Graph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly echoSend: GainNode;
}

export interface Clock {
  /** 音を予約するための時刻（AudioContext の処理時刻） */
  readonly currentTime: number;
  /** いまスピーカーから聞こえている音の時刻。光の描画に使う */
  readonly heardTime: number;
}

export interface OutputTimestampLike {
  readonly contextTime?: number;
  readonly performanceTime?: number;
}

/**
 * スピーカーから実際に聞こえている音の AudioContext 時刻を推定する。
 * currentTime は処理中の時刻で、出力までの遅延（スマホで数十 ms、Bluetooth で 100 ms 超）の分だけ先に進んでいる。
 * それで光を描くと光が音より早くなるため、出力タイムスタンプで補正する。
 * タイムスタンプが無効・異常（基準時刻の違い、古すぎる、ありえない遅延）なら、報告された遅延で補正する。
 */
export function estimateHeardTime(
  currentTime: number,
  timestamp: OutputTimestampLike | null,
  performanceNow: number,
  reportedLatencySec: number,
): number {
  const fallback = currentTime - reportedLatencySec;
  const contextTime = timestamp?.contextTime;
  const performanceTime = timestamp?.performanceTime;
  if (contextTime === undefined || performanceTime === undefined || performanceTime <= 0) {
    return fallback;
  }

  const elapsedSec = (performanceNow - performanceTime) / 1000;
  const { TOLERANCE_SEC, MAX_AGE_SEC, MAX_OUTPUT_LATENCY_SEC } = AUDIO.OUTPUT_TIMESTAMP;
  if (elapsedSec < -TOLERANCE_SEC || elapsedSec > MAX_AGE_SEC) return fallback;

  const heard = contextTime + elapsedSec;
  if (heard > currentTime + TOLERANCE_SEC || heard < currentTime - MAX_OUTPUT_LATENCY_SEC) {
    return fallback;
  }
  return Math.min(currentTime, heard);
}

/**
 * 聞こえている時刻の小さな逆戻り（タイムスタンプ更新の揺れ）だけを抑える。
 * 大きく戻った場合は出力遅延が増えた（Bluetooth に切り替わった等）とみなし、新しい値を採用する。
 */
export function steadyHeardTime(previous: number | null, estimated: number): number {
  if (previous === null || estimated >= previous) return estimated;
  return previous - estimated <= AUDIO.OUTPUT_TIMESTAMP.JITTER_SEC ? previous : estimated;
}

/** 予約済みのカウント音。鳴る前なら取り消せる */
export interface ScheduledClick {
  cancel(): void;
}

export interface ClickPlayer extends Clock {
  /** 再生できる状態にする。できなければ reject する */
  resume(): Promise<void>;
  play(kind: TickKind, sound: SoundKind, when: number): ScheduledClick;
  /** 停止時に、出力中の音と余韻を短くフェードアウトさせる */
  silence(): void;
}

const NOOP_CLICK: ScheduledClick = { cancel: () => undefined };

export class ClickEngine implements ClickPlayer {
  #graph: Graph | null = null;
  #volume: number = VOLUME.DEFAULT;
  #lastHeardTime: number | null = null;

  /** 着信・Bluetooth 切断などで音が止まったときに呼ばれる */
  onInterrupted: (() => void) | null = null;

  get currentTime(): number {
    return this.#graph?.ctx.currentTime ?? 0;
  }

  get heardTime(): number {
    if (!this.#graph) return 0;
    const { ctx } = this.#graph;
    const timestamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    const reportedLatency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const estimated = estimateHeardTime(ctx.currentTime, timestamp, performance.now(), reportedLatency);
    this.#lastHeardTime = steadyHeardTime(this.#lastHeardTime, estimated);
    return this.#lastHeardTime;
  }

  /** ユーザー操作の中で呼ぶ（iOS / Safari の自動再生制限のため） */
  async resume(): Promise<void> {
    const { ctx } = this.#ensureGraph();
    if (ctx.state !== 'running') await ctx.resume();
    // iOS では着信中などに resume しても running にならないことがある
    if ((ctx.state as string) !== 'running') throw new Error(`音声を再生できません（${ctx.state}）`);
    this.#lastHeardTime = null;
  }

  setVolume(volume: number): void {
    this.#volume = volume;
    if (!this.#graph) return;
    const { ctx, master } = this.#graph;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(volumeToGain(volume), ctx.currentTime, AUDIO.VOLUME_SMOOTHING_SEC);
  }

  play(kind: TickKind, sound: SoundKind, when: number): ScheduledClick {
    if (!this.#graph) return NOOP_CLICK;
    const { ctx, master, echoSend } = this.#graph;
    return scheduleClick(ctx, { master, echoSend }, kind, sound, when);
  }

  silence(): void {
    if (!this.#graph) return;
    const { ctx, master } = this.#graph;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(0, now, AUDIO.VOLUME_SMOOTHING_SEC);
    master.gain.setTargetAtTime(
      volumeToGain(this.#volume),
      now + AUDIO.STOP_MUTE_SEC,
      AUDIO.VOLUME_SMOOTHING_SEC,
    );
  }

  #ensureGraph(): Graph {
    if (this.#graph) return this.#graph;
    useMediaPlaybackSession();
    const ctx = new AudioContext();
    ctx.addEventListener('statechange', () => {
      if ((ctx.state as string) !== 'running') this.onInterrupted?.();
    });
    this.#graph = { ctx, ...buildOutput(ctx, volumeToGain(this.#volume)) };
    return this.#graph;
  }
}

export interface ClickOutput {
  /** 音量をかける最終段 */
  readonly master: GainNode;
  /** t2 の余韻（ディレイ）への送り */
  readonly echoSend: GainNode;
}

/** 出力段を組み立てる（OfflineAudioContext でも使えるよう BaseAudioContext を受ける） */
export function buildOutput(ctx: BaseAudioContext, gain: number): ClickOutput {
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(ctx.destination);

  // t2 の余韻: send → delay ⇄ (lowpass → feedback) → master
  const echoSend = ctx.createGain();
  echoSend.gain.value = AUDIO.ECHO.SEND;
  const delay = ctx.createDelay();
  delay.delayTime.value = AUDIO.ECHO.DELAY_SEC;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = AUDIO.ECHO.LOWPASS_HZ;
  const feedback = ctx.createGain();
  feedback.gain.value = AUDIO.ECHO.FEEDBACK;

  echoSend.connect(delay);
  delay.connect(lowpass);
  lowpass.connect(feedback);
  feedback.connect(delay);
  lowpass.connect(master);

  return { master, echoSend };
}

/** 1 回分のカウント音を時刻 when に予約する */
export function scheduleClick(
  ctx: BaseAudioContext,
  output: ClickOutput,
  kind: TickKind,
  sound: SoundKind,
  when: number,
): ScheduledClick {
  const voice = sound === 't2' ? AUDIO.T2 : AUDIO.T1;
  const pitch = kind === 'impact' ? AUDIO.IMPACT_PITCH_RATIO : 1;
  const end = when + voice.ATTACK_SEC + voice.DECAY_SEC;

  const osc = ctx.createOscillator();
  osc.type = voice.WAVE;
  osc.frequency.setValueAtTime(voice.FREQ_HZ * pitch, when);

  // 立ち上がりは直線にする。指数カーブだと無音付近に長く留まり、聞こえ始めが予約時刻より遅れる
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(voice.PEAK, when + voice.ATTACK_SEC);
  env.gain.exponentialRampToValueAtTime(AUDIO.SILENT_GAIN, end);

  osc.connect(env);
  env.connect(output.master);
  if (sound === 't2') env.connect(output.echoSend);

  osc.start(when);
  osc.stop(end);
  osc.onended = () => env.disconnect();

  return {
    cancel: () => {
      // 出力から切り離せば、まだ鳴っていない音は鳴らない
      env.disconnect();
      try {
        osc.stop();
      } catch {
        // すでに停止済み
      }
    },
  };
}
