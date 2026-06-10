// 合成音效：用 WebAudio 现场合成，无需任何音频素材文件，离线可用。
// 浏览器要求用户手势后才能出声，故首个手势时调用 resume()。无音频环境时全部静默降级。
export class Sound {
  private ctx?: AudioContext;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('powerworld.muted') === '1';
    } catch {
      /* 忽略 */
    }
  }

  private ac(): AudioContext | undefined {
    if (this.muted) return undefined;
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return undefined;
        this.ctx = new Ctor();
      } catch {
        return undefined;
      }
    }
    return this.ctx;
  }

  /** 首个用户手势后调用，解除浏览器自动播放限制 */
  resume(): void {
    try {
      this.ctx?.resume?.();
    } catch {
      /* 忽略 */
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem('powerworld.muted', m ? '1' : '0');
    } catch {
      /* 忽略 */
    }
  }

  /** 单音：频率、时长、波形、音量、可选滑音终点 */
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, slideTo?: number): void {
    const ctx = this.ac();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }

  click(): void { this.tone(440, 0.05, 'square', 0.04); }
  build(): void { this.tone(330, 0.09, 'sine', 0.09); this.tone(495, 0.11, 'sine', 0.07); }
  error(): void { this.tone(160, 0.18, 'sawtooth', 0.08); }
  trip(): void { this.tone(220, 0.28, 'sawtooth', 0.12, 90); } // 下滑报警声
  unlock(): void { this.tone(523, 0.1, 'sine', 0.09); this.tone(784, 0.16, 'sine', 0.08); }
  win(): void { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'sine', 0.1), i * 120)); }
  lose(): void { [330, 247, 165].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'sawtooth', 0.1), i * 160)); }
}
