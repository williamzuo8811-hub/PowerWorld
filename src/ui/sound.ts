// 合成音效与氛围音乐：用 WebAudio 现场合成，无需任何音频素材文件，离线可用。
// 浏览器要求用户手势后才能出声，故首个手势时调用 resume()。无音频环境时全部静默降级。
export class Sound {
  private ctx?: AudioContext;
  muted = false;
  volume = 0.7; // 音效音量 0..1
  musicOn = false; // 氛围背景音乐
  private musicNodes: { stop: () => void } | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem('powerworld.muted') === '1';
      const v = parseFloat(localStorage.getItem('powerworld.volume') ?? '');
      if (Number.isFinite(v)) this.volume = Math.max(0, Math.min(1, v));
      this.musicOn = localStorage.getItem('powerworld.music') === '1';
    } catch {
      /* 忽略 */
    }
  }

  private ac(): AudioContext | undefined {
    if (this.muted) return undefined;
    return this.acRaw();
  }
  private acRaw(): AudioContext | undefined {
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
      if (this.musicOn && !this.musicNodes) this.startMusic();
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
    if (m) this.stopMusic();
    else if (this.musicOn) this.startMusic();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem('powerworld.volume', String(this.volume));
    } catch {
      /* 忽略 */
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    try {
      localStorage.setItem('powerworld.music', on ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    if (on && !this.muted) this.startMusic();
    else this.stopMusic();
  }

  private musicFilter: BiquadFilterNode | null = null;
  private musicLfo: OscillatorNode | null = null;
  private tension = 0; // 0=平静 1=告急（状态感知 BGM）

  /** 状态感知 BGM：可靠性告急时滤波器打开、呼吸加快——音乐变"紧张" */
  setTension(t: number): void {
    const v = Math.max(0, Math.min(1, t));
    if (Math.abs(v - this.tension) < 0.05) return;
    this.tension = v;
    try {
      if (this.musicFilter) this.musicFilter.frequency.value = 320 + 900 * v;
      if (this.musicLfo) this.musicLfo.frequency.value = 0.06 + 0.5 * v;
    } catch {
      /* 忽略 */
    }
  }

  /** 氛围背景音乐：低音五度叠置的合成 pad，缓慢呼吸式起伏（程序化、零素材） */
  private startMusic(): void {
    if (this.musicNodes) return;
    const ctx = this.acRaw();
    if (!ctx) return;
    try {
      const master = ctx.createGain();
      master.gain.value = 0.012 * this.volume + 0.004;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320 + 900 * this.tension;
      filter.connect(master).connect(ctx.destination);
      this.musicFilter = filter;

      const oscs: OscillatorNode[] = [];
      for (const [freq, detune] of [[110, 0], [165, 3], [220, -4]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(filter);
        o.start();
        oscs.push(o);
      }
      // 呼吸式音量起伏（LFO）；紧张时呼吸加快
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06 + 0.5 * this.tension;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = master.gain.value * 0.5;
      lfo.connect(lfoGain).connect(master.gain);
      lfo.start();
      this.musicLfo = lfo;

      this.musicNodes = {
        stop: () => {
          for (const o of oscs) { try { o.stop(); } catch { /* */ } }
          try { lfo.stop(); } catch { /* */ }
          try { master.disconnect(); } catch { /* */ }
        },
      };
    } catch {
      this.musicNodes = null;
    }
  }

  private stopMusic(): void {
    this.musicNodes?.stop();
    this.musicNodes = null;
    this.musicFilter = null;
    this.musicLfo = null;
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
    g.gain.setValueAtTime(gain * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }

  /** 按 AudioContext 时钟精确排序的音列（不受 setTimeout 抖动影响） */
  private sequence(notes: { freq: number; dur: number; type?: OscillatorType; gain?: number }[], gap = 0.12): void {
    const ctx = this.ac();
    if (!ctx) return;
    let t = ctx.currentTime;
    for (const n of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = n.type ?? 'sine';
      o.frequency.setValueAtTime(n.freq, t);
      g.gain.setValueAtTime((n.gain ?? 0.1) * this.volume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + n.dur);
      t += gap;
    }
  }

  click(): void { this.tone(440, 0.05, 'square', 0.04); }
  build(): void { this.tone(330, 0.09, 'sine', 0.09); this.tone(495, 0.11, 'sine', 0.07); }
  error(): void { this.tone(160, 0.18, 'sawtooth', 0.08); }
  trip(): void { this.tone(220, 0.28, 'sawtooth', 0.12, 90); } // 下滑报警声（跳闸/严重事件）
  unlock(): void { this.tone(523, 0.1, 'sine', 0.09); this.tone(784, 0.16, 'sine', 0.08); } // 研发完成/成就
  win(): void { this.sequence([523, 659, 784, 1047].map((f) => ({ freq: f, dur: 0.18 }))); }
  lose(): void { this.sequence([330, 247, 165].map((f) => ({ freq: f, dur: 0.3, type: 'sawtooth' as OscillatorType })), 0.16); } // 破产
  /** 机组并网启动：低频上滑的"机器苏醒"声 */
  startup(): void { this.tone(80, 0.4, 'sawtooth', 0.05, 180); this.tone(160, 0.3, 'sine', 0.05, 240); }
  /** 黑启动完成 / 全网恢复：上行琶音报喜 */
  restore(): void { this.sequence([392, 523, 659].map((f) => ({ freq: f, dur: 0.14 })), 0.1); }
}
