// 時刻・テンポから拍と光の位置を求める純粋関数群（DOM / Web Audio に依存しない）。

import { CYCLE, METER, RATIO, TEMPO, type SwingRatio, type TickKind } from './config.ts';

export interface Timeline {
  /** 拍 0（最初のスタート音）の時刻（秒） */
  readonly origin: number;
  readonly bpm: number;
  /** バックスイング : ダウンスイング = ratio : 1 */
  readonly ratio: SwingRatio;
}

export interface Light {
  /** 0 = 左端、1 = 右端（右打ち基準） */
  readonly x: number;
  /** 0 〜 1 */
  readonly intensity: number;
}

export interface Tick {
  readonly kind: TickKind;
  readonly when: number;
}

/** 1 サイクル内の各音の拍位置と、サイクルの長さ（拍） */
export interface CycleLayout {
  readonly top: number;
  readonly impact: number;
  readonly length: number;
}

if (CYCLE.FOLLOW_THROUGH_BEATS + CYCLE.CONVERGE_BEATS > CYCLE.AFTER_IMPACT_BEATS) {
  throw new Error('CYCLE 設定が不正: フォロースルーと光の集まりが重なっています');
}

export function cycleLayout(ratio: SwingRatio): CycleLayout {
  const top = CYCLE.BACKSWING_BEATS;
  const impact = top + CYCLE.BACKSWING_BEATS / ratio;
  return { top, impact, length: impact + CYCLE.AFTER_IMPACT_BEATS };
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
const easeInOutSine = (p: number): number => -(Math.cos(Math.PI * p) - 1) / 2;
const easeOutQuad = (p: number): number => 1 - (1 - p) * (1 - p);
// 光の集まりは加速しながらスタートラインに着く。減速させると拍より前に着いて見え、1 拍目が早く感じる
const converge = (p: number): number => p ** METER.CONVERGE_EXPONENT;
const whip = (p: number): number => p ** METER.WHIP_EXPONENT;

export function clampTempo(bpm: number): number {
  return Math.min(TEMPO.MAX, Math.max(TEMPO.MIN, Math.round(bpm)));
}

/** 比率を範囲内に収め、STEP の刻みに丸める（0.1 を足し続けたときの誤差も消す） */
export function clampRatio(ratio: number): SwingRatio {
  const clamped = Math.min(RATIO.MAX, Math.max(RATIO.MIN, ratio));
  return Number(clamped.toFixed(RATIO.DECIMALS));
}

export function beatSeconds(bpm: number): number {
  return 60 / bpm;
}

export function createTimeline(origin: number, bpm: number, ratio: SwingRatio): Timeline {
  return { origin, bpm, ratio };
}

/** 拍位置 u の時刻 */
export function beatTime(timeline: Timeline, u: number): number {
  return timeline.origin + u * beatSeconds(timeline.bpm);
}

/** 時刻 t における拍位置（拍 0 からの経過拍数。負なら開始前） */
export function beatPosition(timeline: Timeline, t: number): number {
  return (t - timeline.origin) / beatSeconds(timeline.bpm);
}

/** 拍位置を保ったままテンポを変える */
export function retime(timeline: Timeline, t: number, bpm: number): Timeline {
  const u = beatPosition(timeline, t);
  return createTimeline(t - u * beatSeconds(bpm), bpm, timeline.ratio);
}

/** 時刻 t 以降で最初のスタート音の時刻（開始前なら最初のスタート音） */
export function nextCycleStart(timeline: Timeline, t: number): number {
  const { length } = cycleLayout(timeline.ratio);
  const cycle = Math.max(0, Math.ceil(beatPosition(timeline, t) / length));
  return beatTime(timeline, cycle * length);
}

/** 時刻 [from, to) に鳴る音（時刻順）。最初のスタートより前には鳴らさない */
export function ticksBetween(timeline: Timeline, from: number, to: number): Tick[] {
  const layout = cycleLayout(timeline.ratio);
  const offsets: Record<TickKind, number> = { start: 0, top: layout.top, impact: layout.impact };
  const last = beatPosition(timeline, to);
  const ticks: Tick[] = [];
  for (let cycle = Math.max(0, Math.floor(beatPosition(timeline, from) / layout.length)); cycle * layout.length < last; cycle += 1) {
    for (const kind of CYCLE.TICK_KINDS) {
      const when = beatTime(timeline, cycle * layout.length + offsets[kind]);
      if (when >= from && when < to) ticks.push({ kind, when });
    }
  }
  return ticks;
}

/**
 * 拍位置 u での光の一覧。
 * 開始前は、最初のスタート直前の光の集まりだけを表示する。
 */
export function meterLights(u: number, ratio: SwingRatio): Light[] {
  if (u < -CYCLE.CONVERGE_BEATS) return [];

  const { top, impact, length } = cycleLayout(ratio);
  const c = mod(u, length);
  const followThroughEnd = impact + CYCLE.FOLLOW_THROUGH_BEATS;
  const convergeFrom = length - CYCLE.CONVERGE_BEATS;

  if (c < top) {
    const p = easeInOutSine(c / top);
    return [{ x: lerp(METER.START_X, METER.TOP_X, p), intensity: 1 }];
  }

  if (c < impact) {
    const p = whip((c - top) / (impact - top));
    return [{ x: lerp(METER.TOP_X, METER.START_X, p), intensity: 1 }];
  }

  if (c < followThroughEnd) {
    const p = (c - impact) / CYCLE.FOLLOW_THROUGH_BEATS;
    return [{ x: lerp(METER.START_X, METER.FINISH_X, easeOutQuad(p)), intensity: 1 - p }];
  }

  if (c >= convergeFrom) {
    const p = (c - convergeFrom) / CYCLE.CONVERGE_BEATS;
    const e = converge(p);
    return [
      { x: lerp(METER.LEFT_EDGE_X, METER.START_X, e), intensity: p },
      { x: lerp(METER.RIGHT_EDGE_X, METER.START_X, e), intensity: p },
    ];
  }

  return [];
}

/**
 * スタート拍（1 拍目）の瞬間にスタートラインを光らせる強さ（0〜1）。
 * 光が集まった瞬間と音を目で結び付けやすくする。
 */
export function startFlash(u: number, ratio: SwingRatio): number {
  if (u < 0) return 0;
  const c = mod(u, cycleLayout(ratio).length);
  if (c >= METER.START_FLASH_BEATS) return 0;
  return (1 - c / METER.START_FLASH_BEATS) ** 2;
}
