// Canvas に光のメーターを描く。

import { METER } from './config.ts';
import type { DisplayState } from './metronome.ts';
import { beatSeconds, meterLights, startFlash, type Light } from './timeline.ts';

interface Palette {
  readonly light: string;
  readonly startLine: string;
  readonly tick: string;
}

const SCALE_TICKS = 20;
const LIGHT_WIDTH_RATIO = 0.006;
const LIGHT_HEIGHT_RATIO = 0.62;
const GLOW_RATIO = 0.35;
const START_LINE_ALPHA = 0.35;
const TICK_HEIGHT_RATIO = 0.08;
const FLASH_WIDTH_SCALE = 2;

function readPalette(el: HTMLElement): Palette {
  const style = getComputedStyle(el);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    light: read('--meter-light'),
    startLine: read('--meter-start-line'),
    tick: read('--meter-tick'),
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
    this.#drawScale();
    this.#drawStartLine();
    if (state === null) return;
    const { position: u, bpm, ratio } = state;

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

  #drawScale(): void {
    const { width, height } = this.#canvas;
    const ctx = this.#ctx;
    const tickHeight = height * TICK_HEIGHT_RATIO;
    ctx.fillStyle = this.#palette.tick;
    for (let i = 1; i < SCALE_TICKS; i += 1) {
      const x = Math.round((width * i) / SCALE_TICKS);
      ctx.fillRect(x, 0, 1, tickHeight);
      ctx.fillRect(x, height - tickHeight, 1, tickHeight);
    }
  }

  #drawStartLine(): void {
    const { height } = this.#canvas;
    const ctx = this.#ctx;
    const x = this.#toPx(METER.START_X);
    const w = Math.max(2, this.#canvas.width * LIGHT_WIDTH_RATIO);
    ctx.globalAlpha = START_LINE_ALPHA;
    ctx.fillStyle = this.#palette.startLine;
    ctx.fillRect(x - w / 2, 0, w, height);
    ctx.globalAlpha = 1;
  }

  /** スタート拍の瞬間、スタートライン全体を光らせる */
  #drawFlash(strength: number): void {
    const { width, height } = this.#canvas;
    const ctx = this.#ctx;
    const x = this.#toPx(METER.START_X);
    const w = Math.max(4, width * LIGHT_WIDTH_RATIO * FLASH_WIDTH_SCALE);
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.shadowColor = this.#palette.light;
    ctx.shadowBlur = height * GLOW_RATIO * FLASH_WIDTH_SCALE;
    ctx.fillStyle = this.#palette.light;
    ctx.fillRect(x - w / 2, 0, w, height);
    ctx.restore();
  }

  #drawLight(light: Light, alpha: number): void {
    const intensity = light.intensity * alpha;
    if (intensity <= 0) return;
    const { width, height } = this.#canvas;
    const ctx = this.#ctx;
    const x = this.#toPx(light.x);
    const w = Math.max(2, width * LIGHT_WIDTH_RATIO);
    const h = height * LIGHT_HEIGHT_RATIO;

    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.shadowColor = this.#palette.light;
    ctx.shadowBlur = height * GLOW_RATIO;
    ctx.fillStyle = this.#palette.light;
    ctx.fillRect(x - w / 2, (height - h) / 2, w, h);
    ctx.restore();
  }

  #resize(): void {
    const rect = this.#canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.#canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.#canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }
}
