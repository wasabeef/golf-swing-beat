// 先読みスケジューラ。音は AudioContext の時刻で予約し、光は「いま聞こえている時刻」から位置を計算する。
//
// 音と光がずれないための約束:
// - 予約済みでまだ鳴っていない音は、テンポ・音色の変更時に取り消して予約し直す
// - テンポ・比率の変更の前後でタイムラインを区間に分け、音も光もその時刻に有効な区間で計算する
//   （出力遅延の間に聞こえる音は変更前のテンポで鳴っているため）
// - 比率はスイングの途中では変えず、次のスタート音から切り替える

import type { ClickPlayer, ScheduledClick } from './audio.ts';
import { AUDIO, CYCLE, RATIO, TEMPO, type SoundKind, type SwingRatio } from './config.ts';
import {
  beatPosition,
  beatSeconds,
  createTimeline,
  nextCycleStart,
  retime,
  ticksBetween,
  type Timeline,
} from './timeline.ts';

interface Segment {
  /** この区間が有効になる AudioContext 時刻 */
  readonly from: number;
  readonly timeline: Timeline;
}

if (AUDIO.STOP_MUTE_SEC >= AUDIO.START_DELAY_SEC + CYCLE.CONVERGE_BEATS * beatSeconds(TEMPO.MAX)) {
  throw new Error('AUDIO 設定が不正: STOP 後の消音中に再開後の最初の音が来てしまいます');
}

export interface DisplayState {
  /** 画面に出す拍位置 */
  readonly position: number;
  /** その時点で有効なテンポ（残像の間隔用） */
  readonly bpm: number;
  /** その時点で有効な比率 */
  readonly ratio: SwingRatio;
}

interface PendingClick {
  readonly when: number;
  readonly handle: ScheduledClick;
}

export class Metronome {
  readonly #player: ClickPlayer;
  #sound: SoundKind;
  /** 次に始める・次のスタートから切り替える比率 */
  #ratio: SwingRatio;
  #segments: Segment[] = [];
  #pending: PendingClick[] = [];
  /** この時刻より前の音は予約済み */
  #scheduledUntil = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #starting: Promise<void> | null = null;
  /** start / stop のたびに増やし、resume 待ちの間に STOP されたことを検出する */
  #generation = 0;

  /** 描画した光が画面に出るまでの遅れ。実測したフレーム間隔で更新する */
  displayLeadSec: number = AUDIO.DISPLAY_LEAD_SEC;

  /** 何秒先まで音を予約するか。タイマーが間引かれるバックグラウンドでは長くする */
  lookaheadSec: number = AUDIO.LOOKAHEAD_SEC;

  constructor(player: ClickPlayer, sound: SoundKind, ratio: SwingRatio = RATIO.DEFAULT) {
    this.#player = player;
    this.#sound = sound;
    this.#ratio = ratio;
  }

  /** 拍を刻んでいる */
  get running(): boolean {
    return this.#segments.length > 0;
  }

  /** 拍を刻んでいる、または開始処理中（START/STOP ボタンの表示用） */
  get active(): boolean {
    return this.running || this.#starting !== null;
  }

  /** いま画面に出す拍位置とテンポ（聞こえている音に合わせる）。停止中は null */
  get display(): DisplayState | null {
    if (!this.running) return null;
    const shownAt = this.#player.heardTime + this.displayLeadSec;
    this.#pruneSegments(shownAt);
    const { timeline } = this.#segmentAt(shownAt);
    return { position: beatPosition(timeline, shownAt), bpm: timeline.bpm, ratio: timeline.ratio };
  }

  get beatPosition(): number | null {
    return this.display?.position ?? null;
  }

  /** 開始する。開始処理中に呼ばれても二重には始めない。再生できなければ reject する */
  start(bpm: number): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.#starting) return this.#starting;
    const starting = this.#begin(bpm).finally(() => {
      // STOP → START で新しい開始処理に置き換わっていたら触らない
      if (this.#starting === starting) this.#starting = null;
    });
    this.#starting = starting;
    return starting;
  }

  stop(): void {
    this.#generation += 1;
    // 開始処理中の STOP: その開始処理は resume 後に中断される。次の START で新しく始め直せるよう手放す
    this.#starting = null;
    clearInterval(this.#timer);
    this.#timer = undefined;
    if (!this.running) return;
    // まだ鳴っていない予約を取り消し、出力中の音と余韻も絞る（STOP 後に音が残らないように）
    const now = this.#player.currentTime;
    this.#cancelPendingWhere((when) => when > now);
    this.#player.silence();
    this.#pending = [];
    this.#segments = [];
  }

  async #begin(bpm: number): Promise<void> {
    const generation = ++this.#generation;
    await this.#player.resume();
    // resume を待っている間に STOP された
    if (generation !== this.#generation) return;

    // 最初のスタート音の前に、光が両端から集まる時間を取る
    const leadIn = CYCLE.CONVERGE_BEATS * beatSeconds(bpm);
    const origin = this.#player.currentTime + AUDIO.START_DELAY_SEC + leadIn;
    this.#segments = [
      { from: Number.NEGATIVE_INFINITY, timeline: createTimeline(origin, bpm, this.#ratio) },
    ];
    this.#pending = [];
    this.#scheduledUntil = this.#player.currentTime;
    this.schedule();
    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.schedule(), AUDIO.SCHEDULER_INTERVAL_MS);
  }

  setTempo(bpm: number): void {
    if (!this.running) return;
    this.#replan(bpm);
  }

  /** 比率を変える。実行中なら次のスタート音から切り替える */
  setRatio(ratio: SwingRatio): void {
    this.#ratio = ratio;
    if (!this.running) return;
    this.#replan(this.#currentTimeline().bpm);
  }

  setSound(sound: SoundKind): void {
    this.#sound = sound;
    if (!this.running) return;
    this.#rescheduleAfter(this.#rescheduleTime());
  }

  /** 先読み範囲内の音を予約する（テストから直接呼べるよう公開） */
  schedule(): void {
    if (!this.running) return;
    const now = this.#player.currentTime;
    const horizon = now + this.lookaheadSec;
    this.#pending = this.#pending.filter((p) => p.when > now);
    if (this.#scheduledUntil >= horizon) return;

    for (const [i, segment] of this.#segments.entries()) {
      const from = Math.max(this.#scheduledUntil, segment.from);
      const to = Math.min(horizon, this.#segments[i + 1]?.from ?? Number.POSITIVE_INFINITY);
      if (from >= to) continue;
      for (const { kind, when } of ticksBetween(segment.timeline, from, to)) {
        // スケジューラが遅れて過去になった音は、ずれた時刻に鳴らさず飛ばす
        if (when < now) continue;
        this.#pending.push({ when, handle: this.#player.play(kind, this.#sound, when) });
      }
    }
    this.#scheduledUntil = horizon;
  }

  /**
   * テンポ・比率の変更を反映する。
   * テンポはすぐに、比率は次のスタート音から切り替え、まだ鳴っていない予約を組み直す
   */
  #replan(bpm: number): void {
    const target = this.#currentTimeline();
    if (target.bpm === bpm && target.ratio === this.#ratio) return;
    const at = this.#rescheduleTime();
    // まだ有効になっていない変更（次のスタートからの比率変更）は、新しい設定で作り直す
    this.#segments = this.#segments.filter((segment) => segment.from <= at);
    let timeline = this.#currentTimeline();
    if (timeline.bpm !== bpm) {
      timeline = retime(timeline, at, bpm);
      this.#segments.push({ from: at, timeline });
    }
    if (timeline.ratio !== this.#ratio) {
      const from = nextCycleStart(timeline, at);
      this.#segments.push({ from, timeline: createTimeline(from, bpm, this.#ratio) });
    }
    this.#rescheduleAfter(at);
  }

  /** 取り消して予約し直してよい時刻（処理中の音には触れない） */
  #rescheduleTime(): number {
    return this.#player.currentTime + AUDIO.RESCHEDULE_GUARD_SEC;
  }

  #currentTimeline(): Timeline {
    const last = this.#segments.at(-1);
    if (!last) throw new Error('停止中です');
    return last.timeline;
  }

  #segmentAt(t: number): Segment {
    for (let i = this.#segments.length - 1; i >= 0; i -= 1) {
      const segment = this.#segments[i]!;
      if (segment.from <= t) return segment;
    }
    return this.#segments[0]!;
  }

  /** 表示時刻より前に終わった区間を捨てる（最後の区間は常に残す） */
  #pruneSegments(shownAt: number): void {
    while (this.#segments.length > 1 && this.#segments[1]!.from <= shownAt) {
      this.#segments.shift();
    }
  }

  #cancelPendingWhere(test: (when: number) => boolean): void {
    this.#pending = this.#pending.filter((p) => {
      if (!test(p.when)) return true;
      p.handle.cancel();
      return false;
    });
  }

  /** 時刻 t 以降の予約を取り消し、現在の区間で予約し直す */
  #rescheduleAfter(t: number): void {
    this.#cancelPendingWhere((when) => when >= t);
    this.#scheduledUntil = Math.min(this.#scheduledUntil, t);
    this.schedule();
  }
}
