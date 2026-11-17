import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { AUDIO, CYCLE, RATIO, TEMPO } from '../src/config.ts';
import { Metronome } from '../src/metronome.ts';
import { cycleLayout } from '../src/timeline.ts';
import { advance, FakePlayer } from './helpers/fake-player.ts';

const EPSILON = 1e-9;

/** 鳴った音の間隔が、すべて指定テンポの整数拍になっているか */
function assertGapsAreWholeBeats(times: number[], bpm: number): void {
  const beat = 60 / bpm;
  for (const [i, t] of times.slice(1).entries()) {
    const beats = (t - times[i]!) / beat;
    assert.ok(Math.abs(beats - Math.round(beats)) < 1e-6, `#${i}: gap=${t - times[i]!}`);
  }
}

describe('Metronome', () => {
  let metronome: Metronome | undefined;
  afterEach(() => metronome?.stop());

  it('光が集まる 1 拍の後にスタート音が鳴り、以降は等間隔で 3 拍 + 休み', async () => {
    const player = new FakePlayer();
    metronome = new Metronome(player, 't1');
    const bpm = 60;
    await metronome.start(bpm);
    advance(metronome, player, 10);

    const beat = 60 / bpm;
    const firstStart = AUDIO.START_DELAY_SEC + CYCLE.CONVERGE_BEATS * beat;
    const [first] = player.played;
    assert.ok(first);
    assert.equal(first.kind, 'start');
    assert.ok(Math.abs(first.when - firstStart) < EPSILON);

    const length = cycleLayout(1).length;
    for (const [i, p] of player.played.entries()) {
      const cycle = Math.floor(i / CYCLE.TICK_KINDS.length);
      const inCycle = i % CYCLE.TICK_KINDS.length;
      const expected = firstStart + (cycle * length + inCycle) * beat;
      assert.equal(p.kind, CYCLE.TICK_KINDS[inCycle]);
      assert.ok(Math.abs(p.when - expected) < EPSILON, `#${i}: ${p.when} != ${expected}`);
    }
  });

  it('同じ拍を二重に予約しない', async () => {
    const player = new FakePlayer();
    metronome = new Metronome(player, 't1');
    await metronome.start(TEMPO.MAX);
    advance(metronome, player, 6, 0.005);
    const times = player.played.map((p) => p.when);
    assert.equal(new Set(times).size, times.length);
  });

  it('予約は先読み範囲内に限られる', async () => {
    const player = new FakePlayer();
    metronome = new Metronome(player, 't1');
    await metronome.start(TEMPO.DEFAULT);
    advance(metronome, player, 4);
    for (const p of player.scheduled) {
      assert.ok(p.when < player.currentTime + AUDIO.LOOKAHEAD_SEC);
    }
  });

  it('スケジューラが大きく遅れても、遅れた拍はずらして鳴らさずに飛ばす', async () => {
    const player = new FakePlayer();
    metronome = new Metronome(player, 't1');
    await metronome.start(60);
    advance(metronome, player, 1);
    player.currentTime += 2.5; // 2.5 秒間メインスレッドが止まった想定
    metronome.schedule();
    advance(metronome, player, 10);
    assertGapsAreWholeBeats(
      player.played.map((p) => p.when),
      60,
    );
    for (const p of player.played) assert.ok(p.when >= 0);
  });

  describe('テンポ変更', () => {
    it('予約済みの音も取り消して、新しいテンポで鳴らし直す', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1');
      await metronome.start(40);
      // 次の音を予約した直後（先読み範囲内に音がある状態）でテンポを変える
      // BPM 40 = 1 拍 1.5 秒。2 拍目（トップ）の 50 ms 前
      advance(metronome, player, AUDIO.START_DELAY_SEC + 2 * 1.5 - 0.05, 0.01);
      assert.ok(player.scheduled.some((p) => p.when > player.currentTime));
      const changeAt = player.currentTime;
      metronome.setTempo(80);
      advance(metronome, player, 12);

      assert.ok(player.scheduled.some((p) => p.cancelled), '取り消された予約があるはず');
      const after = player.played.filter((p) => p.when > changeAt).map((p) => p.when);
      assertGapsAreWholeBeats(after, 80);
    });

    it('同じテンポへの変更では予約を触らない', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1');
      await metronome.start(TEMPO.DEFAULT);
      advance(metronome, player, 1);
      metronome.setTempo(TEMPO.DEFAULT);
      assert.ok(player.scheduled.every((p) => !p.cancelled));
    });

    it('長押し（80 ms ごとに 1 ずつ）で変えても、二重に鳴らず拍が抜けない', async () => {
      const player = new FakePlayer(0.2);
      metronome = new Metronome(player, 't1');
      let bpm = TEMPO.MIN;
      await metronome.start(bpm);
      const step = 0.004;
      let nextChange = 1;
      while (player.currentTime < 30) {
        if (player.currentTime >= nextChange && bpm < TEMPO.MAX) {
          bpm += 1;
          metronome.setTempo(bpm);
          nextChange += 0.08;
        }
        player.currentTime += step;
        metronome.schedule();
      }
      const played = player.played;
      const times = played.map((p) => p.when);
      assert.equal(new Set(times).size, times.length, '二重に鳴った');
      // 鳴った音の種類が「スタート → トップ → インパクト」の順で欠けずに続く
      for (const [i, p] of played.entries()) {
        assert.equal(p.kind, CYCLE.TICK_KINDS[i % CYCLE.TICK_KINDS.length], `#${i}`);
      }
    });
  });

  describe('比率の変更', () => {
    /** 鳴った音を、スタート音ごとの 1 サイクルに分ける */
    function cycles(played: { kind: string; when: number }[]) {
      const result: { kind: string; when: number }[][] = [];
      for (const p of played) {
        if (p.kind === 'start') result.push([]);
        result.at(-1)?.push(p);
      }
      return result;
    }

    for (const ratio of RATIO.OPTIONS) {
      it(`比率 ${ratio}:1 で始めると、トップ → インパクトがバックスイングの 1/${ratio}`, async () => {
        const player = new FakePlayer();
        metronome = new Metronome(player, 't1', ratio);
        await metronome.start(60);
        advance(metronome, player, 12);
        const full = cycles(player.played).filter((c) => c.length === CYCLE.TICK_KINDS.length);
        assert.ok(full.length >= 2);
        for (const [start, top, impact] of full) {
          assert.ok(Math.abs(top!.when - start!.when - 1) < EPSILON);
          assert.ok(Math.abs(impact!.when - top!.when - 1 / ratio) < EPSILON);
        }
      });
    }

    it('スイングの途中で変えても、そのサイクルは元の比率のまま。次のスタートから切り替わる', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1', 1);
      await metronome.start(60);
      const firstStart = AUDIO.START_DELAY_SEC + CYCLE.CONVERGE_BEATS;
      // トップの直後（インパクトの前）で変える
      advance(metronome, player, firstStart + 1.1, 0.01);
      metronome.setRatio(3);
      advance(metronome, player, 20);
      const [first, second, ...rest] = cycles(player.played);
      assert.ok(first && second);
      assert.deepEqual(first.map((p) => p.kind), ['start', 'top', 'impact']);
      assert.ok(Math.abs(first[2]!.when - first[1]!.when - 1) < EPSILON, '途中のサイクルは 1:1');
      assert.ok(Math.abs(second[0]!.when - first[2]!.when - CYCLE.AFTER_IMPACT_BEATS) < EPSILON, '次のスタートの時刻は変わらない');
      for (const c of [second, ...rest].filter((c) => c.length === 3)) {
        assert.ok(Math.abs(c[2]!.when - c[1]!.when - 1 / 3) < EPSILON, '次のサイクルから 3:1');
      }
    });

    it('切り替え前に元の比率に戻したら、何も変わらない', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1', 2);
      await metronome.start(60);
      advance(metronome, player, 1.5);
      metronome.setRatio(3);
      metronome.setRatio(2);
      advance(metronome, player, 15);
      for (const c of cycles(player.played).filter((c) => c.length === 3)) {
        assert.ok(Math.abs(c[2]!.when - c[1]!.when - 1 / 2) < EPSILON);
      }
    });

    it('比率の切り替え待ちの間にテンポを変えても、音が抜けたり二重になったりしない', async () => {
      const player = new FakePlayer(0.1);
      metronome = new Metronome(player, 't1', 1);
      await metronome.start(60);
      advance(metronome, player, 1.2, 0.01);
      metronome.setRatio(3);
      advance(metronome, player, 1.9, 0.01);
      metronome.setTempo(90);
      advance(metronome, player, 20);
      const played = player.played;
      const times = played.map((p) => p.when);
      assert.equal(new Set(times).size, times.length, '二重に鳴った');
      for (const [i, p] of played.entries()) {
        assert.equal(p.kind, CYCLE.TICK_KINDS[i % CYCLE.TICK_KINDS.length], `#${i}`);
      }
      const last = cycles(played).filter((c) => c.length === 3).at(-1)!;
      assert.ok(Math.abs(last[1]!.when - last[0]!.when - 60 / 90) < EPSILON);
      assert.ok(Math.abs(last[2]!.when - last[1]!.when - 60 / 90 / 3) < EPSILON);
    });

    it('停止中に変えた比率で次に始まる', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1', 1);
      metronome.setRatio(3);
      await metronome.start(60);
      advance(metronome, player, 4);
      assert.equal(metronome.display?.ratio, 3);
      const [start, top, impact] = player.played;
      assert.ok(start && top && impact);
      assert.ok(Math.abs(impact.when - top.when - 1 / 3) < EPSILON);
    });
  });

  describe('音色の変更', () => {
    it('予約済みの音も新しい音色で鳴らし直す', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1');
      await metronome.start(TEMPO.MAX);
      advance(metronome, player, 2);
      const changeAt = player.currentTime + AUDIO.RESCHEDULE_GUARD_SEC;
      metronome.setSound('t2');
      advance(metronome, player, 6);
      const after = player.played.filter((p) => p.when > changeAt);
      assert.ok(after.length > 0);
      assert.ok(after.every((p) => p.sound === 't2'));
      // 音色を変えても拍の時刻は変わらない
      assertGapsAreWholeBeats(
        player.played.map((p) => p.when),
        TEMPO.MAX,
      );
    });
  });

  describe('停止', () => {
    it('停止後は拍位置が null になり、予約もしない', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1');
      await metronome.start(60);
      metronome.stop();
      assert.equal(metronome.beatPosition, null);
      const count = player.scheduled.length;
      advance(metronome, player, 5);
      assert.equal(player.scheduled.length, count);
    });

    it('STOP の後に、予約済みだった音が鳴らない', async () => {
      const player = new FakePlayer();
      metronome = new Metronome(player, 't1');
      await metronome.start(60);
      // スタート音の 50 ms 前（予約済み・未発音）で止める
      const firstStart = AUDIO.START_DELAY_SEC + CYCLE.CONVERGE_BEATS;
      advance(metronome, player, firstStart - 0.05, 0.01);
      assert.ok(player.scheduled.some((p) => p.when > player.currentTime));
      const stoppedAt = player.currentTime;
      metronome.stop();
      assert.ok(player.played.every((p) => p.when <= stoppedAt));
    });
  });
});

describe('Metronome: 開始・停止の境界', () => {
  /** 外から完了させられる resume */
  function deferredResume(player: FakePlayer) {
    const waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];
    player.resumeImpl = () => new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }));
    return {
      resolve: () => waiting.splice(0).forEach((w) => w.resolve()),
      reject: (error: Error) => waiting.splice(0).forEach((w) => w.reject(error)),
    };
  }

  it('開始処理中に START をもう一度押しても二重に始まらない', async () => {
    const player = new FakePlayer();
    const metronome = new Metronome(player, 't1');
    const gate = deferredResume(player);
    const first = metronome.start(60);
    const second = metronome.start(60);
    assert.equal(first, second);
    assert.ok(metronome.active && !metronome.running);
    gate.resolve();
    await first;
    advance(metronome, player, 10);
    const times = player.played.map((p) => p.when);
    assert.equal(new Set(times).size, times.length, '二重に鳴った');
    metronome.stop();
  });

  it('開始処理中に STOP したら、resume が終わっても始まらない', async () => {
    const player = new FakePlayer();
    const metronome = new Metronome(player, 't1');
    const gate = deferredResume(player);
    const starting = metronome.start(60);
    metronome.stop();
    assert.equal(metronome.active, false, 'STOP したらすぐ止まった表示になる');
    gate.resolve();
    await starting;
    assert.equal(metronome.running, false);
    assert.equal(metronome.active, false);
    advance(metronome, player, 5);
    assert.equal(player.scheduled.length, 0);
  });

  it('開始処理中に START → STOP → START と押したら、最後の START で始まる', async () => {
    const player = new FakePlayer();
    const metronome = new Metronome(player, 't1');
    const gate = deferredResume(player);
    const first = metronome.start(60);
    metronome.stop();
    const second = metronome.start(60);
    assert.notEqual(first, second, '中断された開始処理を使い回さない');
    assert.equal(metronome.active, true);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(metronome.running, true);
    assert.equal(metronome.active, true, '古い開始処理の完了で状態を消さない');
    advance(metronome, player, 3);
    const starts = player.played.filter((p) => p.kind === 'start');
    assert.equal(starts.length, 1, 'スタート音は 1 回だけ');
    metronome.stop();
  });

  it('resume に失敗したら reject し、止まった状態に戻る', async () => {
    const player = new FakePlayer();
    const metronome = new Metronome(player, 't1');
    const gate = deferredResume(player);
    const starting = metronome.start(60);
    gate.reject(new Error('interrupted'));
    await assert.rejects(starting, /interrupted/);
    assert.equal(metronome.active, false);
    // 失敗の後でも、もう一度始められる
    player.resumeImpl = async () => {};
    await metronome.start(60);
    assert.equal(metronome.running, true);
    metronome.stop();
  });

  it('STOP → START で、最初からやり直す（光が集まる 1 拍の後にスタート音）', async () => {
    const player = new FakePlayer();
    const metronome = new Metronome(player, 't1');
    await metronome.start(60);
    advance(metronome, player, 3.3);
    metronome.stop();
    const restartAt = player.currentTime;
    await metronome.start(60);
    advance(metronome, player, restartAt + 3);
    const afterRestart = player.played.filter((p) => p.when > restartAt);
    const [first] = afterRestart;
    assert.ok(first);
    assert.equal(first.kind, 'start');
    assert.ok(Math.abs(first.when - (restartAt + AUDIO.START_DELAY_SEC + CYCLE.CONVERGE_BEATS)) < 1e-9);
    // 再開後の最初の音は、STOP 時の消音が明けてから鳴る
    assert.ok(first.when - restartAt > AUDIO.STOP_MUTE_SEC);
    metronome.stop();
  });

  it('STOP で出力を絞る（実行中のときだけ）', async () => {
    const player = new FakePlayer();
    const metronome = new Metronome(player, 't1');
    metronome.stop();
    assert.equal(player.silenced, 0);
    await metronome.start(60);
    metronome.stop();
    assert.equal(player.silenced, 1);
  });

  it('表示のテンポは、その時点で聞こえている区間のテンポ（遅延中は変更前）', async () => {
    const player = new FakePlayer(0.3);
    const metronome = new Metronome(player, 't1');
    await metronome.start(40);
    advance(metronome, player, 3);
    metronome.setTempo(80);
    assert.equal(metronome.display?.bpm, 40, '遅延の間はまだ変更前のテンポが聞こえている');
    advance(metronome, player, 3.4);
    assert.equal(metronome.display?.bpm, 80);
    metronome.stop();
  });
});
