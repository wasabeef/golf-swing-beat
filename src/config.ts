// アプリ全体の定数。

export type TickKind = 'start' | 'top' | 'impact';
export type SoundKind = 't1' | 't2';

export const TEMPO = {
  MIN: 20,
  MAX: 120,
  DEFAULT: 80,
  STEP: 1,
} as const;

// 1 サイクルの拍構成。BPM は「始動 → トップ」の 1 拍あたりの数として扱う。
// スタート → トップ → インパクト → 休み（フォロースルーと、次のスタートへ光が集まる時間）を繰り返す。
// トップ → インパクトの長さは比率（バックスイング : ダウンスイング）で決まる。
export const CYCLE = {
  TICK_KINDS: ['start', 'top', 'impact'] as const satisfies readonly TickKind[],
  // 始動からトップまでの拍数
  BACKSWING_BEATS: 1,
  // インパクトから次のスタートまでの拍数
  AFTER_IMPACT_BEATS: 2,
  // 休みの最後の CONVERGE_BEATS 拍で、両端から光がスタートラインへ集まる
  CONVERGE_BEATS: 1,
  // インパクト後にフォロースルー方向へ光が流れて消えるまでの拍数
  FOLLOW_THROUGH_BEATS: 0.5,
} as const;

// バックスイングとダウンスイングの時間の比（N : 1）。
// 1 は等間隔、2 はパター・アプローチ、3 はフルスイングのツアー選手の平均に近い
export type SwingRatio = number;

export const RATIO = {
  MIN: 1,
  MAX: 3,
  STEP: 0.1,
  // STEP に合わせた小数点以下の桁数（表示と丸めに使う）
  DECIMALS: 1,
  DEFAULT: 1,
} as const;

// メーター上の位置（0 = 左端、1 = 右端。右打ち時は表示部側が右）
export const METER = {
  START_X: 0.14,
  TOP_X: 0.94,
  FINISH_X: 0.02,
  LEFT_EDGE_X: 0,
  RIGHT_EDGE_X: 1,
  // 残像の本数と間隔（秒）。速く動くほど残像が離れ、しなりが見える
  TRAIL_COUNT: 3,
  TRAIL_INTERVAL_SEC: 0.035,
  TRAIL_DECAY: 0.45,
  // トップから溜めて加速する度合い（easeIn の指数）
  WHIP_EXPONENT: 3,
  // 両端の光がスタートラインへ加速しながら集まる度合い（easeIn の指数）
  CONVERGE_EXPONENT: 2,
  // スタート拍でスタートラインが光る長さ（拍）
  START_FLASH_BEATS: 0.25,
} as const;

export const SOUND = {
  KINDS: ['t1', 't2'] as const satisfies readonly SoundKind[],
  DEFAULT: 't1' as SoundKind,
} as const;

export const VOLUME = {
  MIN: 0,
  MAX: 100,
  DEFAULT: 70,
} as const;

export interface VoiceConfig {
  readonly WAVE: OscillatorType;
  readonly FREQ_HZ: number;
  readonly PEAK: number;
  readonly ATTACK_SEC: number;
  readonly DECAY_SEC: number;
}

export const AUDIO = {
  // 先読み。予約は取り消して組み直せるので、長くしても音と光はずれない。
  // 短いとメインスレッドが止まったときに拍が抜けるため、余裕を持たせる
  LOOKAHEAD_SEC: 0.25,
  // バックグラウンドで続けるときの先読み。隠れたページのタイマーは 1 秒ごとまで間引かれるため、それより長く取る
  HIDDEN_LOOKAHEAD_SEC: 1.5,
  SCHEDULER_INTERVAL_MS: 25,
  START_DELAY_SEC: 0.05,
  // テンポ・音色を変えたとき、この時間より先の予約だけを取り消して予約し直す（処理中の音を壊さない）
  RESCHEDULE_GUARD_SEC: 0.01,
  // 描画した光が画面に出るまでの遅れ（約 1 フレーム）。実測したフレーム間隔で上書きする
  DISPLAY_LEAD_SEC: 0.016,
  DISPLAY_LEAD_MIN_SEC: 0.004,
  DISPLAY_LEAD_MAX_SEC: 0.05,
  // フレーム間隔の平滑化係数（指数移動平均）
  FRAME_INTERVAL_SMOOTHING: 0.1,
  // STOP 後に出力を絞る時間。再開時の最初の音（START_DELAY_SEC + 集まりの 1 拍以上先）より短くする
  STOP_MUTE_SEC: 0.3,
  OUTPUT_TIMESTAMP: {
    // 現在時刻より先・経過時間が負になる誤差の許容幅
    TOLERANCE_SEC: 0.005,
    // これより古いタイムスタンプは使わない
    MAX_AGE_SEC: 1,
    // これより大きい出力遅延はありえないとみなす
    MAX_OUTPUT_LATENCY_SEC: 1,
    // この幅までの逆戻りは揺れとして抑える
    JITTER_SEC: 0.005,
  },
  VOLUME_SMOOTHING_SEC: 0.01,
  IMPACT_PITCH_RATIO: 1.5,
  SILENT_GAIN: 0.0001,
  // t1: アタックがはっきりした短い音
  T1: {
    WAVE: 'triangle',
    FREQ_HZ: 2000,
    PEAK: 0.5,
    ATTACK_SEC: 0.002,
    DECAY_SEC: 0.06,
  } satisfies VoiceConfig,
  // t2: 余韻が残るなめらかな音（ディレイで 3 つの音がつながって聞こえるようにする）
  T2: {
    WAVE: 'sine',
    FREQ_HZ: 1320,
    PEAK: 0.45,
    ATTACK_SEC: 0.004,
    DECAY_SEC: 0.5,
  } satisfies VoiceConfig,
  ECHO: {
    DELAY_SEC: 0.11,
    FEEDBACK: 0.38,
    SEND: 0.5,
    LOWPASS_HZ: 2400,
  },
} as const;

export const UI = {
  SOUND_LABEL_MS: 1000,
  RATIO_SEPARATOR: ':',
  // 数字の下に出す「BPM · 3:1」
  TEMPO_UNIT: 'BPM',
  // 比率を変えている間、数字の下に出す
  RATIO_UNIT: 'RATIO',
  DISPLAY_SUB_SEPARATOR: ' · ',
  ERROR_LABEL: 'Err',
  REPEAT_DELAY_MS: 400,
  REPEAT_INTERVAL_MS: 80,
} as const;

export const PWA = {
  // index.html からの相対パス。scope をアプリ全体にするため、ルートに置く
  SERVICE_WORKER_PATH: 'sw.js',
} as const;

export const STORAGE_KEY = 'golf-swing-beat:settings';
