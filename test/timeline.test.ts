import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CYCLE, METER, RATIO, TEMPO, type SwingRatio } from '../src/config.ts';
import {
  beatPosition,
  beatSeconds,
  beatTime,
  clampTempo,
  createTimeline,
  cycleLayout,
  meterLights,
  nextCycleStart,
  retime,
  ticksBetween,
} from '../src/timeline.ts';

const EPSILON = 1e-9;
const EVEN: SwingRatio = 1;
const CYCLE_BEATS = cycleLayout(EVEN).length;

describe('clampTempo', () => {
  it('範囲内の値はそのまま返す', () => {
    assert.equal(clampTempo(70), 70);
  });

  it('範囲外は MIN / MAX で止める', () => {
    assert.equal(clampTempo(TEMPO.MIN - 5), TEMPO.MIN);
    assert.equal(clampTempo(TEMPO.MAX + 5), TEMPO.MAX);
  });

  it('小数は整数に丸める', () => {
    assert.equal(clampTempo(68.6), 69);
  });
});

describe('beatTime / beatPosition', () => {
  it('BPM 60 なら 1 拍 1 秒', () => {
    const timeline = createTimeline(10, 60, EVEN);
    assert.equal(beatSeconds(60), 1);
    assert.equal(beatTime(timeline, 3), 13);
    assert.equal(beatPosition(timeline, 12.5), 2.5);
  });

  it('BPM 70 の拍間隔は 60/70 秒', () => {
    const timeline = createTimeline(0, 70, EVEN);
    assert.ok(Math.abs(beatTime(timeline, 1) - 60 / 70) < EPSILON);
  });
});

describe('retime', () => {
  it('テンポを変えても変更時点の拍位置は変わらない', () => {
    const before = createTimeline(2, 60, EVEN);
    const t = 5.25;
    const after = retime(before, t, 80);
    assert.equal(after.bpm, 80);
    assert.ok(Math.abs(beatPosition(after, t) - beatPosition(before, t)) < EPSILON);
  });

  it('変更後の拍間隔は新しいテンポになる', () => {
    const after = retime(createTimeline(0, 60, EVEN), 3, 75);
    assert.ok(Math.abs(beatTime(after, 5) - beatTime(after, 4) - 60 / 75) < EPSILON);
  });
});

describe('ticksBetween', () => {
  it('比率 1:1 は スタート・トップ・インパクトが等間隔で、その後 2 拍休む', () => {
    const ticks = ticksBetween(createTimeline(0, 60, EVEN), 0, 8);
    assert.deepEqual(
      ticks.map((t) => [t.kind, t.when]),
      [['start', 0], ['top', 1], ['impact', 2], ['start', 4], ['top', 5], ['impact', 6]],
    );
  });

  for (const ratio of RATIO.OPTIONS) {
    it(`比率 ${ratio}:1 はトップからインパクトまでがバックスイングの 1/${ratio}`, () => {
      const [start, top, impact, next] = ticksBetween(createTimeline(0, 60, ratio), 0, 10);
      assert.ok(start && top && impact && next);
      assert.deepEqual([start.kind, top.kind, impact.kind, next.kind], ['start', 'top', 'impact', 'start']);
      const backswing = top.when - start.when;
      assert.ok(Math.abs(backswing - 60 / 60) < EPSILON, 'BPM はバックスイングの 1 拍');
      assert.ok(Math.abs(backswing / (impact.when - top.when) - ratio) < EPSILON);
      assert.ok(Math.abs(next.when - impact.when - CYCLE.AFTER_IMPACT_BEATS) < EPSILON);
    });
  }

  it('範囲は [from, to)。開始前（負の拍）は鳴らさない', () => {
    const timeline = createTimeline(5, 60, EVEN);
    assert.deepEqual(ticksBetween(timeline, 0, 5), []);
    assert.deepEqual(ticksBetween(timeline, 5, 6).map((t) => t.when), [5]);
    assert.deepEqual(ticksBetween(timeline, 5.5, 6), []);
  });
});

describe('nextCycleStart', () => {
  it('時刻以降で最初のスタート音の時刻を返す', () => {
    const timeline = createTimeline(2, 60, 3);
    const length = cycleLayout(3).length;
    assert.equal(nextCycleStart(timeline, 0), 2);
    assert.equal(nextCycleStart(timeline, 2), 2);
    assert.ok(Math.abs(nextCycleStart(timeline, 2.1) - (2 + length)) < EPSILON);
  });
});

describe('meterLights', () => {
  const single = (u: number) => {
    const lights = meterLights(u, EVEN);
    assert.equal(lights.length, 1, `u=${u} で光は 1 本のはず`);
    return lights[0]!;
  };

  it('スタート拍でスタートライン、トップ拍で表示部側の端、インパクト拍でスタートラインに戻る', () => {
    assert.ok(Math.abs(single(0).x - METER.START_X) < EPSILON);
    assert.ok(Math.abs(single(1).x - METER.TOP_X) < EPSILON);
    assert.ok(Math.abs(single(2).x - METER.START_X) < EPSILON);
  });

  it('次のサイクルでも同じ位置になる', () => {
    assert.ok(Math.abs(single(CYCLE_BEATS + 1).x - METER.TOP_X) < EPSILON);
  });

  it('切り返し直後は遅く、インパクト直前で速い（しなり）', () => {
    const early = Math.abs(single(1.1).x - single(1).x);
    const late = Math.abs(single(2 - EPSILON).x - single(1.9).x);
    assert.ok(late > early * 5, `early=${early}, late=${late}`);
  });

  it('次のスタート直前は両端から光が集まる', () => {
    const start = CYCLE_BEATS - CYCLE.CONVERGE_BEATS;
    const [left, right] = meterLights(start + 0.01, EVEN);
    assert.ok(left && right);
    assert.ok(left.x < METER.START_X && right.x > METER.START_X);

    const [nearLeft, nearRight] = meterLights(CYCLE_BEATS - 0.001, EVEN);
    assert.ok(nearLeft && nearRight);
    assert.ok(Math.abs(nearLeft.x - METER.START_X) < 0.01);
    assert.ok(Math.abs(nearRight.x - METER.START_X) < 0.01);
  });

  it('最初のスタート前の 1 拍も光が集まり、それより前は何も出ない', () => {
    assert.equal(meterLights(-0.5, EVEN).length, 2);
    assert.deepEqual(meterLights(-CYCLE.CONVERGE_BEATS - 0.01, EVEN), []);
  });

  it('光の位置と強さは常に 0〜1 に収まる（どの比率でも）', () => {
    for (const ratio of RATIO.OPTIONS) {
      for (let u = -1; u < cycleLayout(ratio).length * 2; u += 0.01) {
        for (const { x, intensity } of meterLights(u, ratio)) {
          assert.ok(x >= 0 && x <= 1, `ratio=${ratio} u=${u} x=${x}`);
          assert.ok(intensity >= 0 && intensity <= 1, `ratio=${ratio} u=${u} intensity=${intensity}`);
        }
      }
    }
  });

  it('比率を変えても、トップで表示部側の端、インパクトでスタートラインに来る', () => {
    for (const ratio of RATIO.OPTIONS) {
      const { top, impact } = cycleLayout(ratio);
      assert.ok(Math.abs(meterLights(top, ratio)[0]!.x - METER.TOP_X) < EPSILON);
      assert.ok(Math.abs(meterLights(impact, ratio)[0]!.x - METER.START_X) < EPSILON);
    }
  });
});
