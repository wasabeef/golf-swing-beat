// Canvas に光のメーターを描く。
// 中央の細いトラックの上を、尾を引く丸い光が スタート ⇄ トップを往復する。

import { METER } from './config.ts';
import type { DisplayState } from './metronome.ts';
import { beatSeconds, closingRing, meterLights, startFlash, type ClosingRing, type Light } from './timeline.ts';

interface Palette {
  readonly light: string;
  readonly startLine: string;
  readonly track: string;
  readonly label: string;
}

// 大きさはすべて canvas の高さに対する比
const DOT_RADIUS_RATIO = 0.1;
const GLOW_RATIO = 0.35;
const TRACK_WIDTH_RATIO = 0.04;
const START_LINE_HEIGHT_RATIO = 0.6;
const START_LINE_WIDTH_RATIO = 0.015;
const START_LINE_ALPHA = 0.7;
const TOP_MARKER_HEIGHT_RATIO = 0.44;
const TOP_MARKER_WIDTH_RATIO = 0.008;
const TOP_MARKER_DASH_RATIO = 0.025;
// スタート拍の演出。地面に置いたスマホを離れて見ても気付けるよう、2 つを重ねる
// 1. メーター全体をうっすら光らせる
const FLASH_TINT_ALPHA = 0.22;
// 2. スタートラインから輪が広がる（大きさは高さに対する比）
const FLASH_RING_MAX_RATIO = 1.1;
const FLASH_RING_WIDTH_RATIO = 0.05;
// スタート前に縮む輪の、縮み始めの大きさと線の太さ（高さに対する比）
const CLOSING_RING_MAX_RATIO = 0.9;
const CLOSING_RING_WIDTH_RATIO = 0.035;
const LABEL_FONT_RATIO = 0.075;
// ラベルとマーカーの間のすき間（フォントの大きさに対する比）
const LABEL_GAP_RATIO = 0.6;
// 画面が小さくてもラベルが読めるようにする最小の文字サイズ（CSS px）
const LABEL_MIN_FONT_PX = 9;
const LABEL_FONT_WEIGHT = 700;
const LABEL_LETTER_SPACING_EM = 0.12;
const START_LABEL = 'START · IMPACT';
const TOP_LABEL = 'TOP';
const MIN_LINE_PX = 2;

function readPalette(el: HTMLElement): Palette {
  const style = getComputedStyle(el);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    light: read('--meter-light'),
    startLine: read('--meter-start-line'),
    track: read('--meter-track'),
    label: read('--meter-label'),
  };
}

export class MeterView {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  #palette: Palette;
  #mirrored = false;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context を取得できません');
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#palette = readPalette(canvas);
    new ResizeObserver(() => this.#resize()).observe(canvas);
    this.#resize();
  }

  set mirrored(value: boolean) {
    this.#mirrored = value;
  }

  refreshPalette(): void {
    this.#palette = readPalette(this.#canvas);
  }

  /** state: 画面に出す拍位置・テンポ・比率（停止中は null） */
  draw(state: DisplayState | null): void {
    const { width, height } = this.#canvas;
    this.#ctx.clearRect(0, 0, width, height);
    this.#drawTrack();
    this.#drawTopMarker();
    this.#drawStartLine();
    this.#drawLabels();
    if (state === null) return;
    const { position: u, bpm, ratio } = state;

    const ring = closingRing(u, ratio);
    if (ring) this.#drawClosingRing(ring);
    const flash = startFlash(u, ratio);
    if (flash > 0) this.#drawFlash(flash);

    const trailStep = METER.TRAIL_INTERVAL_SEC / beatSeconds(bpm);
    for (let i = METER.TRAIL_COUNT; i >= 0; i -= 1) {
      const alpha = METER.TRAIL_DECAY ** i;
      for (const light of meterLights(u - i * trailStep, ratio)) this.#drawLight(light, alpha);
    }
  }

  #toPx(x: number): number {
    const px = this.#mirrored ? 1 - x : x;
    return px * this.#canvas.width;
  }

  get #centerY(): number {
    return this.#canvas.height / 2;
  }

  #drawTrack(): void {
    const ctx = this.#ctx;
    const y = this.#centerY;
    ctx.save();
    ctx.strokeStyle = this.#palette.track;
    ctx.lineWidth = Math.max(MIN_LINE_PX, this.#canvas.height * TRACK_WIDTH_RATIO);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.#toPx(METER.START_X), y);
    ctx.lineTo(this.#toPx(METER.TOP_X), y);
    ctx.stroke();
    ctx.restore();
  }

  /** トップの位置を点線で示す */
  #drawTopMarker(): void {
    const { height } = this.#canvas;
    const ctx = this.#ctx;
    const x = this.#toPx(METER.TOP_X);
    const half = (height * TOP_MARKER_HEIGHT_RATIO) / 2;
    const dash = height * TOP_MARKER_DASH_RATIO;
    ctx.save();
    ctx.strokeStyle = this.#palette.label;
    ctx.lineWidth = Math.max(MIN_LINE_PX, height * TOP_MARKER_WIDTH_RATIO);
    ctx.setLineDash([dash, dash]);
    ctx.beginPath();
    ctx.moveTo(x, this.#centerY - half);
    ctx.lineTo(x, this.#centerY + half);
    ctx.stroke();
    ctx.restore();
  }

  #drawStartLine(): void {
    this.#ctx.save();
    this.#ctx.globalAlpha = START_LINE_ALPHA;
    this.#strokeStartLine(this.#palette.startLine);
    this.#ctx.restore();
  }

  /** スタートラインに向かって縮む輪。閉じた瞬間がスタート */
  #drawClosingRing({ size, intensity }: ClosingRing): void {
    const { height } = this.#canvas;
    const ctx = this.#ctx;
    const minRadius = height * DOT_RADIUS_RATIO;
    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.strokeStyle = this.#palette.light;
    ctx.shadowColor = this.#palette.light;
    ctx.shadowBlur = height * GLOW_RATIO;
    ctx.lineWidth = Math.max(MIN_LINE_PX, height * CLOSING_RING_WIDTH_RATIO);
    ctx.beginPath();
    ctx.arc(this.#toPx(METER.START_X), this.#centerY, minRadius + (height * CLOSING_RING_MAX_RATIO - minRadius) * size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * スタート拍の瞬間の演出。strength は 1 から 0 へ減っていく。
   * メーター全体をうっすら光らせ、スタートラインから輪を広げる
   */
  #drawFlash(strength: number): void {
    const { width, height } = this.#canvas;
    const ctx = this.#ctx;
    const x = this.#toPx(METER.START_X);
    const y = this.#centerY;
    // startFlash は (1 - 経過) ** 2 なので、平方根で経過の割合（0 → 1）に戻す
    const progress = 1 - Math.sqrt(strength);
    ctx.save();
    ctx.fillStyle = this.#palette.light;
    ctx.strokeStyle = this.#palette.light;

    ctx.globalAlpha = FLASH_TINT_ALPHA * strength;
    ctx.fillRect(0, 0, width, height);

    ctx.shadowColor = this.#palette.light;
    ctx.shadowBlur = height * GLOW_RATIO;
    const minRadius = height * DOT_RADIUS_RATIO;
    const radius = minRadius + (height * FLASH_RING_MAX_RATIO - minRadius) * progress;
    ctx.globalAlpha = 1 - progress;
    ctx.lineWidth = Math.max(MIN_LINE_PX, height * FLASH_RING_WIDTH_RATIO * (1 - progress));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  #strokeStartLine(color: string): void {
    const { height } = this.#canvas;
    const ctx = this.#ctx;
    const x = this.#toPx(METER.START_X);
    const half = (height * START_LINE_HEIGHT_RATIO) / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(MIN_LINE_PX, height * START_LINE_WIDTH_RATIO);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, this.#centerY - half);
    ctx.lineTo(x, this.#centerY + half);
    ctx.stroke();
  }

  #drawLabels(): void {
    const { height } = this.#canvas;
    const ctx = this.#ctx;
    const ratio = window.devicePixelRatio || 1;
    const fontPx = Math.max(LABEL_MIN_FONT_PX * ratio, height * LABEL_FONT_RATIO);
    const gap = fontPx * LABEL_GAP_RATIO;
    ctx.save();
    ctx.fillStyle = this.#palette.label;
    ctx.font = `${LABEL_FONT_WEIGHT} ${fontPx}px system-ui, -apple-system, sans-serif`;
    ctx.letterSpacing = `${fontPx * LABEL_LETTER_SPACING_EM}px`;
    ctx.textBaseline = 'bottom';
    const startTop = this.#centerY - (height * START_LINE_HEIGHT_RATIO) / 2;
    const topTop = this.#centerY - (height * TOP_MARKER_HEIGHT_RATIO) / 2;
    this.#fillLabel(START_LABEL, METER.START_X, startTop - gap);
    this.#fillLabel(TOP_LABEL, METER.TOP_X, topTop - gap);
    ctx.restore();
  }

  /** マーカーの真上に文字を置く。canvas からはみ出す場合は内側へずらす */
  #fillLabel(text: string, x: number, y: number): void {
    const ctx = this.#ctx;
    const half = ctx.measureText(text).width / 2;
    const center = Math.min(Math.max(this.#toPx(x), half), this.#canvas.width - half);
    ctx.textAlign = 'center';
    ctx.fillText(text, center, y);
  }

  #drawLight(light: Light, alpha: number): void {
    const intensity = light.intensity * alpha;
    if (intensity <= 0) return;
    const { height } = this.#canvas;
    const ctx = this.#ctx;
    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.shadowColor = this.#palette.light;
    ctx.shadowBlur = height * GLOW_RATIO;
    ctx.fillStyle = this.#palette.light;
    ctx.beginPath();
    ctx.arc(this.#toPx(light.x), this.#centerY, height * DOT_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #resize(): void {
    const rect = this.#canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.#canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.#canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }
}
