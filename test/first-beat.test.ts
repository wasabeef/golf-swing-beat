// 1 拍目（スタート）の音と光が一致しているかを多角的に確かめる。

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { estimateHeardTime, steadyHeardTime } from '../src/audio.ts';
import { AUDIO, CYCLE, METER, RATIO, TEMPO, type SwingRatio } from '../src/config.ts';
import { Metronome, type DisplayState } from '../src/metronome.ts';
import { closingRing, cycleLayout, meterLights, startFlash } from '../src/timeline.ts';
import { advance, FakePlayer } from './helpers/fake-player.ts';

const EPSILON = 1e-6;
const EVEN: SwingRatio = 1;
const CYCLE_BEATS = cycleLayout(EVEN).length;

/** 音が「聞こえる瞬間」の、画面に出ている状態 */
function displayWhenHeard(metronome: Metronome, player: FakePlayer, when: number): DisplayState {
  const saved = player.currentTime;
  // 画面に出るまでの 1 フレーム分を差し引き、表示される瞬間の位置を求める
  player.currentTime = when + player.outputLatency - AUDIO.DISPLAY_LEAD_SEC;
  const display = metronome.display;
  player.currentTime = saved;
  assert.ok(display !== null);
  return display;
}

/** 表示中の拍位置が、サイクルの始まり（スタート）から何拍離れているか */
const distanceToCycleStart = ({ position: u, ratio }: DisplayState): number => {
  const length = cycleLayout(ratio).length;
  const r = ((u % length) + length) % length;
  return Math.min(r, length - r);
};

describe('1 拍目: 光の形', () => {
  it('拍ちょうどで輪が閉じ、それより前には閉じていない', () => {
    const justBefore = closingRing(-1e-6, EVEN);
    assert.ok(justBefore);
    assert.ok(justBefore.size < 1e-5);
    assert.ok(justBefore.intensity > 0.99);
    // スタートラインで待っている光も、拍の直前に最も明るくなる
    const [light] = meterLights(-1e-6, EVEN);
    assert.ok(light && light.x === METER.START_X && light.intensity > 0.99);
  });

  it('0.1 拍前にはまだ 10% 以上開いている（早く閉じて見えない）', () => {
    const ring = closingRing(-0.1, EVEN);
    assert.ok(ring && ring.size >= 0.1, `size=${ring?.size}`);
  });

  it('輪は拍に向かって加速しながら縮む', () => {
    const at = (u: number) => closingRing(u, EVEN)!.size;
    const early = at(-0.9) - at(-0.8);
    const late = at(-0.1) - at(-1e-6);
    assert.ok(late > early, `early=${early}, late=${late}`);
  });

  it('拍の瞬間にスタートラインが最も強く光り、拍の前は光らない', () => {
    assert.equal(startFlash(0, EVEN), 1);
    assert.equal(startFlash(CYCLE_BEATS, EVEN), 1);
    assert.equal(startFlash(-1e-6, EVEN), 0);
    assert.equal(startFlash(CYCLE_BEATS - 1e-6, EVEN), 0);
    assert.ok(startFlash(METER.START_FLASH_BEATS / 2, EVEN) < 1);
    assert.equal(startFlash(METER.START_FLASH_BEATS, EVEN), 0);
  });

  it('スタート拍の直後、光はスタートラインから離れ始める（同じ位置から出発する）', () => {
    const [light] = meterLights(0, EVEN);
    assert.ok(light && Math.abs(light.x - METER.START_X) < EPSILON);
  });
});

describe('1 拍目: 音と光のタイミング', () => {
  let metronome: Metronome | undefined;
  afterEach(() => metronome?.stop());

  for (const latency of [0, 0.04, 0.25]) {
    for (const bpm of [TEMPO.MIN, TEMPO.DEFAULT, TEMPO.MAX]) {
      it(`出力遅延 ${latency * 1000} ms・テンポ ${bpm}: スタート音が聞こえる瞬間に輪が閉じる`, async () => {
        const player = new FakePlayer(latency);
        metronome = new Metronome(player, 't1');
        await metronome.start(bpm);
        advance(metronome, player, 30);

        const starts = player.played.filter((p) => p.kind === 'start');
        assert.ok(starts.length >= 3, `starts=${starts.length}`);
        for (const { when } of starts) {
          const display = displayWhenHeard(metronome, player, when);
          assert.ok(distanceToCycleStart(display) < EPSILON, `when=${when} u=${display.position}`);
          assert.ok(startFlash(display.position + EPSILON, display.ratio) > 0.99);
        }
      });
    }
  }

  it('最初のスタート音の前に、ちょうど 1 拍分の縮む輪が見える', async () => {
    const player = new FakePlayer(0);
    metronome = new Metronome(player, 't1');
    const bpm = TEMPO.DEFAULT;
    await metronome.start(bpm);
    advance(metronome, player, 3);

    const first = player.played[0];
    assert.ok(first && first.kind === 'start');
    const beat = 60 / bpm;
    assert.ok(Math.abs(first.when - (AUDIO.START_DELAY_SEC + CYCLE.CONVERGE_BEATS * beat)) < EPSILON);

    // 縮み始める瞬間は輪が最も大きい
    const { position } = displayWhenHeard(metronome, player, first.when - CYCLE.CONVERGE_BEATS * beat);
    assert.ok(Math.abs(position + CYCLE.CONVERGE_BEATS) < EPSILON);
    assert.ok(closingRing(position + EPSILON, EVEN)!.size > 0.99);
  });

  /**
   * 時計を進めながらテンポを変え、すべてのスタート音について
   * 「表示される瞬間」に時計を合わせて、その時点で輪が閉じているかを調べる。
   * 予約済みの音の取り消しと、遅延中の旧テンポ区間の両方が正しくないと通らない。
   */
  async function checkAllStartsWhileChanging(
    latency: number,
    changes: ReadonlyArray<readonly [number, number | { ratio: SwingRatio }]>,
    end: number,
  ): Promise<number> {
    const player = new FakePlayer(latency);
    metronome = new Metronome(player, 't2');
    await metronome.start(TEMPO.DEFAULT);

    const step = 0.004;
    let checked = 0;
    let nextChange = 0;
    const checkedStarts = new Set<number>();
    while (player.currentTime < end) {
      const change = changes[nextChange];
      if (change && player.currentTime >= change[0]) {
        const value = change[1];
        if (typeof value === 'number') metronome.setTempo(value);
        else metronome.setRatio(value.ratio);
        nextChange += 1;
      }
      const stepEnd = player.currentTime + step;
      const due = player.played.filter((p) => {
        const shownAt = p.when + latency - AUDIO.DISPLAY_LEAD_SEC;
        return p.kind === 'start' && !checkedStarts.has(p.when) && shownAt <= stepEnd;
      });
      for (const p of due) {
        checkedStarts.add(p.when);
        const display = displayWhenHeard(metronome, player, p.when);
        assert.ok(distanceToCycleStart(display) < EPSILON, `when=${p.when} u=${display.position}`);
        checked += 1;
      }
      player.currentTime = stepEnd;
      metronome.schedule();
    }
    return checked;
  }

  it('テンポを何度変えても（拍の直前・遅延の最中を含む）、スタート音は輪が閉じる瞬間に鳴る', async () => {
    const changes = [
      [1.3, 45],
      [2.71, 80],
      [4.05, 20],
      [7.77, 63],
      [9.1, 79],
      [11.6, 30],
      [19.95, 72],
      [20.0, 41],
      [20.05, 77],
    ] as const;
    for (const latency of [0.03, 0.1, 0.3]) {
      const checked = await checkAllStartsWhileChanging(latency, changes, 60);
      assert.ok(checked >= 10, `latency=${latency} checked=${checked}`);
      metronome?.stop();
    }
  });

  it('比率をテンポと混ぜて何度変えても、スタート音は輪が閉じる瞬間に鳴る', async () => {
    const changes = [
      [1.2, { ratio: 3 }],
      [2.5, 100],
      [3.33, { ratio: 2 }],
      [3.34, { ratio: 3 }],
      [6.1, 45],
      [6.15, { ratio: 1 }],
      [9.9, TEMPO.MAX],
      [12.4, { ratio: 2 }],
      [12.45, 70],
    ] as const;
    for (const latency of [0.03, 0.3]) {
      const checked = await checkAllStartsWhileChanging(latency, changes, 40);
      assert.ok(checked >= 8, `latency=${latency} checked=${checked}`);
      metronome?.stop();
    }
  });

  it('長押しでテンポを連続して変えている最中も、スタート音は輪が閉じる瞬間に鳴る', async () => {
    const changes: Array<[number, number]> = [];
    for (let i = 0; i <= TEMPO.MAX - TEMPO.MIN; i += 1) changes.push([1 + i * 0.08, TEMPO.MIN + i]);
    for (let i = 0; i <= TEMPO.MAX - TEMPO.MIN; i += 1) changes.push([12 + i * 0.08, TEMPO.MAX - i]);
    const checked = await checkAllStartsWhileChanging(0.2, changes, 60);
    assert.ok(checked >= 8, `checked=${checked}`);
  });
});

describe('estimateHeardTime', () => {
  it('出力タイムスタンプがあれば、それと経過時間から聞こえている時刻を求める', () => {
    const heard = estimateHeardTime(10.3, { contextTime: 10.1, performanceTime: 5000 }, 5050, 0);
    assert.ok(Math.abs(heard - 10.15) < EPSILON);
  });

  it('処理中の時刻より先にはならない', () => {
    const heard = estimateHeardTime(10.0, { contextTime: 10.1, performanceTime: 5000 }, 5100, 0);
    assert.equal(heard, 10.0);
  });

  it('タイムスタンプがまだ無効（0）なら、報告された遅延を差し引く', () => {
    const heard = estimateHeardTime(2.0, { contextTime: 0, performanceTime: 0 }, 100, 0.12);
    assert.ok(Math.abs(heard - 1.88) < EPSILON);
  });

  it('getOutputTimestamp が無いブラウザでも動く', () => {
    assert.ok(Math.abs(estimateHeardTime(3, null, 0, 0.05) - 2.95) < EPSILON);
  });
});

describe('estimateHeardTime: 異常なタイムスタンプ', () => {
  it('タイムスタンプが現在時刻より先なら、報告された遅延を使う', () => {
    const heard = estimateHeardTime(10, { contextTime: 10.5, performanceTime: 5000 }, 5000, 0.2);
    assert.ok(Math.abs(heard - 9.8) < EPSILON);
  });

  it('ありえない大きな遅延（1 秒超）なら、報告された遅延を使う', () => {
    const heard = estimateHeardTime(10, { contextTime: 3, performanceTime: 5000 }, 5000, 0.2);
    assert.ok(Math.abs(heard - 9.8) < EPSILON);
  });

  it('古すぎる・基準時刻が違うタイムスタンプなら、報告された遅延を使う', () => {
    assert.ok(Math.abs(estimateHeardTime(10, { contextTime: 9.8, performanceTime: 1000 }, 5000, 0.2) - 9.8) < EPSILON);
    assert.ok(Math.abs(estimateHeardTime(10, { contextTime: 9.8, performanceTime: 9000 }, 5000, 0.2) - 9.8) < EPSILON);
  });
});

describe('steadyHeardTime', () => {
  it('数 ms の逆戻りは抑える', () => {
    assert.equal(steadyHeardTime(5, 4.999), 5);
  });

  it('大きく戻った（遅延が増えた）ら新しい値を採用する', () => {
    assert.equal(steadyHeardTime(5, 4.8), 4.8);
  });

  it('前の値がなければそのまま', () => {
    assert.equal(steadyHeardTime(null, 3), 3);
  });
});
