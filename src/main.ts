// UI の組み立て。

import { ClickEngine } from './audio.ts';
import { AUDIO, RATIO, SOUND, TEMPO, UI, VOLUME, type SwingRatio } from './config.ts';
import { MeterView } from './meter.ts';
import { Metronome } from './metronome.ts';
import { loadSettings, saveSettings, type Settings } from './settings.ts';
import { clampTempo } from './timeline.ts';
import { ScreenKeeper } from './wake-lock.ts';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

const els = {
  meter: byId<HTMLCanvasElement>('meter'),
  display: byId<HTMLOutputElement>('display'),
  startStop: byId<HTMLButtonElement>('startStop'),
  tempoDown: byId<HTMLButtonElement>('tempoDown'),
  tempoUp: byId<HTMLButtonElement>('tempoUp'),
  sound: byId<HTMLButtonElement>('sound'),
  volume: byId<HTMLInputElement>('volume'),
  hand: byId<HTMLButtonElement>('hand'),
  ratio: byId<HTMLDivElement>('ratio'),
  openSettings: byId<HTMLButtonElement>('openSettings'),
  settingsDialog: byId<HTMLDialogElement>('settingsDialog'),
  fullscreen: byId<HTMLButtonElement>('fullscreen'),
  fullscreenControl: byId<HTMLDivElement>('fullscreenControl'),
};

interface LockableOrientation {
  lock?: (orientation: 'landscape') => Promise<void>;
}

const settings: Settings = loadSettings();
const engine = new ClickEngine();
const metronome = new Metronome(engine, settings.sound, settings.ratio);
const meter = new MeterView(els.meter);
const screenKeeper = new ScreenKeeper();

let soundLabelTimer: ReturnType<typeof setTimeout> | undefined;
/** 表示部に一時的に出している文字（null ならテンポを表示） */
let temporaryLabel: string | null = null;
let lastFrameTime: number | null = null;
let frameInterval: number = AUDIO.DISPLAY_LEAD_SEC;

function persist(): void {
  saveSettings(settings);
}

function renderDisplay(): void {
  els.display.value = temporaryLabel ?? String(settings.tempo);
  els.display.classList.toggle('is-sound', temporaryLabel !== null);
}

function renderControls(): void {
  els.startStop.textContent = metronome.active ? 'STOP' : 'START';
  els.startStop.setAttribute('aria-pressed', String(metronome.active));
  els.tempoDown.disabled = settings.tempo <= TEMPO.MIN;
  els.tempoUp.disabled = settings.tempo >= TEMPO.MAX;
  for (const button of ratioButtons) {
    const selected = Number(button.dataset.ratio) === settings.ratio;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  els.sound.textContent = settings.sound;
  els.hand.textContent = settings.leftHanded ? '左打ち' : '右打ち';
  els.hand.setAttribute('aria-pressed', String(settings.leftHanded));
  meter.mirrored = settings.leftHanded;
}

function changeTempo(delta: number): void {
  const next = clampTempo(settings.tempo + delta);
  if (next === settings.tempo) return;
  settings.tempo = next;
  metronome.setTempo(next);
  clearTimeout(soundLabelTimer);
  temporaryLabel = null;
  persist();
  renderDisplay();
  renderControls();
}

const ratioLabel = (ratio: SwingRatio): string => `${ratio}${UI.RATIO_SEPARATOR}1`;

/** 比率の選択ボタンを作る（バックスイング : ダウンスイング） */
function createRatioButtons(): HTMLButtonElement[] {
  return RATIO.OPTIONS.map((ratio) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn segment';
    button.setAttribute('role', 'radio');
    button.dataset.ratio = String(ratio);
    button.textContent = ratioLabel(ratio);
    button.setAttribute('aria-label', `バックスイング ${ratio}、ダウンスイング 1`);
    button.addEventListener('click', () => changeRatio(ratio));
    els.ratio.append(button);
    return button;
  });
}

const ratioButtons = createRatioButtons();

function changeRatio(ratio: SwingRatio): void {
  if (ratio === settings.ratio) return;
  settings.ratio = ratio;
  metronome.setRatio(ratio);
  persist();
  showMessage(ratioLabel(ratio));
  renderControls();
}

function cycleRatio(): void {
  const index = RATIO.OPTIONS.indexOf(settings.ratio);
  changeRatio(RATIO.OPTIONS[(index + 1) % RATIO.OPTIONS.length] ?? RATIO.DEFAULT);
}

function cycleSound(): void {
  const index = SOUND.KINDS.indexOf(settings.sound);
  settings.sound = SOUND.KINDS[(index + 1) % SOUND.KINDS.length] ?? SOUND.DEFAULT;
  metronome.setSound(settings.sound);
  persist();
  showMessage(settings.sound);
  renderControls();
}

async function stopRunning(): Promise<void> {
  metronome.stop();
  renderControls();
  await screenKeeper.disable();
}

async function toggleRunning(): Promise<void> {
  if (metronome.active) {
    await stopRunning();
    return;
  }
  metronome.setRatio(settings.ratio);
  const starting = metronome.start(settings.tempo);
  renderControls();
  try {
    await starting;
  } catch (error) {
    console.warn(error);
    showMessage(UI.ERROR_LABEL);
  }
  renderControls();
  if (metronome.running) await screenKeeper.enable();
}

/** 表示部に一時的に文字を出す（音色・比率の切り替え、エラー表示） */
function showMessage(text: string): void {
  temporaryLabel = text;
  clearTimeout(soundLabelTimer);
  soundLabelTimer = setTimeout(() => {
    temporaryLabel = null;
    renderDisplay();
  }, UI.SOUND_LABEL_MS);
  renderDisplay();
}

/** 全画面にして横向きに固定する（Android Chrome など。iPhone の Safari は非対応） */
async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await (screen.orientation as ScreenOrientation & LockableOrientation).lock?.('landscape');
  } catch {
    // 拒否・非対応の場合は通常表示のまま
  }
}

function renderFullscreen(): void {
  const active = document.fullscreenElement !== null;
  els.fullscreen.textContent = active ? '全画面を解除' : '全画面';
  els.fullscreen.setAttribute('aria-pressed', String(active));
}

/** 画面ロックやアプリ切り替えでページが隠れたら止める（戻ったときに音と光がずれないように） */
async function stopWhenHidden(): Promise<void> {
  if (document.visibilityState !== 'hidden' || !metronome.active) return;
  await stopRunning();
}

function toggleHand(): void {
  settings.leftHanded = !settings.leftHanded;
  persist();
  renderControls();
}

/** 押している間、一定間隔で繰り返す（長押しでテンポを連続変更） */
function bindRepeat(button: HTMLButtonElement, action: () => void): void {
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatTimer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    action();
    delayTimer = setTimeout(() => {
      repeatTimer = setInterval(action, UI.REPEAT_INTERVAL_MS);
    }, UI.REPEAT_DELAY_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    button.addEventListener(type, stop);
  }
  // キーボード操作（Enter / Space）は click で 1 段階ずつ
  button.addEventListener('click', (event) => {
    if (event.detail === 0) action();
  });
}

function bindKeyboard(): void {
  document.addEventListener('keydown', (event) => {
    if (els.settingsDialog.open) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input')) return;
    switch (event.key) {
      case ' ':
        event.preventDefault();
        void toggleRunning();
        break;
      case 'ArrowUp':
      case 'ArrowRight':
        event.preventDefault();
        changeTempo(TEMPO.STEP);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        event.preventDefault();
        changeTempo(-TEMPO.STEP);
        break;
      case 's':
      case 'S':
        cycleSound();
        break;
      case 'r':
      case 'R':
        cycleRatio();
        break;
    }
  });
}

/** 実測したフレーム間隔を、光が画面に出るまでの遅れとして使う（60 Hz / 120 Hz の違いに合わせる） */
function updateDisplayLead(now: number): void {
  if (lastFrameTime !== null) {
    const interval = (now - lastFrameTime) / 1000;
    frameInterval += (interval - frameInterval) * AUDIO.FRAME_INTERVAL_SMOOTHING;
    metronome.displayLeadSec = Math.min(
      AUDIO.DISPLAY_LEAD_MAX_SEC,
      Math.max(AUDIO.DISPLAY_LEAD_MIN_SEC, frameInterval),
    );
  }
  lastFrameTime = now;
}

function frame(now: number): void {
  updateDisplayLead(now);
  meter.draw(metronome.display);
  requestAnimationFrame(frame);
}

function init(): void {
  els.volume.min = String(VOLUME.MIN);
  els.volume.max = String(VOLUME.MAX);
  els.volume.value = String(settings.volume);
  engine.setVolume(settings.volume);

  els.startStop.addEventListener('click', () => void toggleRunning());
  els.sound.addEventListener('click', cycleSound);
  els.hand.addEventListener('click', toggleHand);
  els.openSettings.addEventListener('click', () => els.settingsDialog.showModal());
  // 枠の外（背景）を押したら閉じる
  els.settingsDialog.addEventListener('click', (event) => {
    if (event.target === els.settingsDialog) els.settingsDialog.close();
  });
  els.volume.addEventListener('input', () => {
    settings.volume = Number(els.volume.value);
    engine.setVolume(settings.volume);
    persist();
  });
  bindRepeat(els.tempoDown, () => changeTempo(-TEMPO.STEP));
  bindRepeat(els.tempoUp, () => changeTempo(TEMPO.STEP));
  bindKeyboard();

  engine.onInterrupted = () => {
    if (metronome.active) void stopRunning();
  };
  els.fullscreenControl.hidden = !document.fullscreenEnabled;
  els.fullscreen.addEventListener('click', () => void toggleFullscreen());
  document.addEventListener('fullscreenchange', renderFullscreen);
  document.addEventListener('visibilitychange', () => void stopWhenHidden());
  // 長押し時のコンテキストメニューを防ぐ（テンポの長押し用）
  document.addEventListener('contextmenu', (event) => {
    if ((event.target as HTMLElement | null)?.closest('.btn')) event.preventDefault();
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => meter.refreshPalette());

  renderDisplay();
  renderControls();
  requestAnimationFrame(frame);
}

init();
