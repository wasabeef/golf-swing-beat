import type { ClickPlayer, ScheduledClick } from '../../src/audio.ts';
import type { SoundKind, TickKind } from '../../src/config.ts';
import type { Metronome } from '../../src/metronome.ts';

export interface Played {
  readonly kind: TickKind;
  readonly sound: SoundKind;
  readonly when: number;
  cancelled: boolean;
}

/** 時刻を手で進められる偽のプレイヤー。出力遅延も再現できる */
export class FakePlayer implements ClickPlayer {
  currentTime = 0;
  readonly scheduled: Played[] = [];
  /** 処理してから聞こえるまでの遅れ（秒） */
  readonly outputLatency: number;

  constructor(outputLatency = 0) {
    this.outputLatency = outputLatency;
  }

  get heardTime(): number {
    return this.currentTime - this.outputLatency;
  }

  /** 取り消されずに実際に鳴る音（時刻順） */
  get played(): Played[] {
    return this.scheduled.filter((p) => !p.cancelled).sort((a, b) => a.when - b.when);
  }

  /** silence() が呼ばれた回数 */
  silenced = 0;
  /** resume() の結果を外から制御したいときに設定する */
  resumeImpl: () => Promise<void> = async () => {};

  resume(): Promise<void> {
    return this.resumeImpl();
  }

  silence(): void {
    this.silenced += 1;
  }

  play(kind: TickKind, sound: SoundKind, when: number): ScheduledClick {
    const entry: Played = { kind, sound, when, cancelled: false };
    this.scheduled.push(entry);
    return {
      cancel: () => {
        // 処理済み（鳴り始めた）音は取り消せない
        if (when <= this.currentTime) throw new Error(`鳴り始めた音を取り消そうとした: ${when}`);
        entry.cancelled = true;
      },
    };
  }
}

/** 時刻を step 秒ずつ進めながらスケジューラを回す */
export function advance(metronome: Metronome, player: FakePlayer, until: number, step = 0.016): void {
  while (player.currentTime < until) {
    player.currentTime += step;
    metronome.schedule();
  }
}
