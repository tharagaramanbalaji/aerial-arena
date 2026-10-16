export class SoundSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted = false;
  private volume = 0.5;

  // Continuous sound sources
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private boostNoise: AudioBufferSourceNode | null = null;
  private boostGain: GainNode | null = null;
  private isBoostingPlaying = false;

  constructor() {
    // AudioContext will be initialized on first user gesture
  }

  private initContext(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.startEngineSound();
      this.updateMusic();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public enableAudio(): void {
    this.initContext();
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : this.volume;
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && !this.isMuted) {
      this.masterGain.gain.value = this.volume;
    }
  }

  private startEngineSound(): void {
    if (!this.ctx || !this.masterGain) return;

    this.engineOsc = this.ctx.createOscillator();
    this.engineGain = this.ctx.createGain();

    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 45; // Idle rumble
    this.engineGain.gain.value = 0; // raised by updateEngineSpeed only during a match

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 350;

    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc.start();
  }

  public updateEngineSpeed(speedRatio: number): void {
    if (!this.engineOsc || !this.engineGain) return;
    const clamped = Math.max(0, Math.min(1, speedRatio));
    // Frequency shifts from 45Hz idle to 160Hz top speed
    this.engineOsc.frequency.setTargetAtTime(45 + clamped * 115, this.ctx?.currentTime || 0, 0.05);
    // Silent outside a match: the idle drone used to buzz in the lobby.
    const gain = this.scene === 'match' ? 0.08 + clamped * 0.06 : 0;
    this.engineGain.gain.setTargetAtTime(gain, this.ctx?.currentTime || 0, 0.05);
  }

  // ---------------------------------------------------------------------------
  // Lobby music: a calm synthesized loop (original, generated here; no audio files).
  // Am - F - C - G pad chords with a soft plucked arpeggio, scheduled bar by bar.
  // ---------------------------------------------------------------------------
  private scene: 'menu' | 'match' = 'menu';
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private nextBarTime = 0;
  private bar = 0;
  private static readonly BAR_SEC = 4; // 60 BPM, 4 beats per bar
  private static readonly CHORDS = [
    [57, 60, 64], // A minor
    [53, 57, 60], // F major
    [48, 55, 64], // C major
    [55, 59, 62], // G major
  ];

  /** 'menu' plays the lobby music; 'match' fades it out and enables the engine sound. */
  public setScene(scene: 'menu' | 'match'): void {
    this.scene = scene;
    this.updateMusic();
    if (scene === 'menu') this.updateEngineSpeed(0);
  }

  private updateMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    if (!this.musicGain) {
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1800; // soft and warm, no harsh highs
      this.musicGain.connect(tone);
      tone.connect(this.masterGain);
    }
    const on = this.scene === 'menu';
    this.musicGain.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, on ? 1.2 : 0.25);
    if (on && this.musicTimer === null) {
      this.nextBarTime = ctx.currentTime + 0.1;
      this.musicTimer = window.setInterval(() => this.scheduleMusic(), 250);
      this.scheduleMusic();
    } else if (!on && this.musicTimer !== null) {
      // Stop scheduling once the fade-out has finished.
      const timer = this.musicTimer;
      this.musicTimer = null;
      window.setTimeout(() => window.clearInterval(timer), 1500);
    }
  }

  /** Look-ahead scheduler: queue any bar that starts within the next second. */
  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || this.scene !== 'menu') return;
    while (this.nextBarTime < ctx.currentTime + 1) {
      const t = this.nextBarTime;
      const chord = SoundSystem.CHORDS[this.bar % SoundSystem.CHORDS.length];
      const len = SoundSystem.BAR_SEC;
      for (const n of chord) this.note(n, t, len + 0.6, 0.045, 'triangle', 1.2); // pad
      this.note(chord[0] - 12, t, len, 0.06, 'sine', 0.3); // bass
      const arp = [chord[0], chord[1], chord[2], chord[1] + 12, chord[2], chord[1], chord[0] + 12, chord[2]];
      arp.forEach((n, i) => this.note(n + 12, t + (i * len) / 8, 0.9, 0.025, 'sine', 0.01)); // pluck
      this.nextBarTime += len;
      this.bar++;
    }
  }

  private note(midi: number, start: number, dur: number, peak: number, type: OscillatorType, attack: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur); // smooth release, no clicks
    osc.connect(g);
    g.connect(this.musicGain!);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  public setBoosting(boosting: boolean): void {
    if (!this.ctx || !this.masterGain) return;

    if (boosting && !this.isBoostingPlaying) {
      this.isBoostingPlaying = true;
      this.startBoostRoar();
    } else if (!boosting && this.isBoostingPlaying) {
      this.isBoostingPlaying = false;
      this.stopBoostRoar();
    }
  }

  private startBoostRoar(): void {
    if (!this.ctx || !this.masterGain) return;

    // Generate white noise buffer
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.boostNoise = this.ctx.createBufferSource();
    this.boostNoise.buffer = buffer;
    this.boostNoise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 480;
    filter.Q.value = 1.2;

    this.boostGain = this.ctx.createGain();
    this.boostGain.gain.setValueAtTime(0.01, this.ctx.currentTime);
    this.boostGain.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + 0.1);

    this.boostNoise.connect(filter);
    filter.connect(this.boostGain);
    this.boostGain.connect(this.masterGain);

    this.boostNoise.start();
  }

  private stopBoostRoar(): void {
    if (!this.ctx || !this.boostGain || !this.boostNoise) return;
    // Capture this roar's nodes: a quick re-tap starts new nodes that must not be stopped here.
    const noise = this.boostNoise;
    const gain = this.boostGain;
    this.boostNoise = null;
    gain.gain.cancelScheduledValues(this.ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    setTimeout(() => {
      noise.stop();
      noise.disconnect();
      gain.disconnect();
    }, 160);
  }

  public playJump(): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(450, this.ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  public playDodge(): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.18);
  }

  public playBallHit(strength = 1.0): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + 0.12);

    const hitVol = Math.min(0.4, 0.15 + strength * 0.25);
    gain.gain.setValueAtTime(hitVol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  public playGoalExplosion(): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;

    // Sub-bass boom
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(120, t);
    subOsc.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    subGain.gain.setValueAtTime(0.5, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(t);
    subOsc.stop(t + 0.9);

    // Celebratory brass synth chord
    const frequencies = [330, 440, 554, 660];
    for (const freq of frequencies) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t + 0.1);

      gain.gain.setValueAtTime(0.08, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t + 0.1);
      osc.stop(t + 1.2);
    }
  }

  public playCountdown(isGo = false): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const freq = isGo ? 880 : 440;
    const dur = isGo ? 0.35 : 0.12;

    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  }

  public playPadPickup(): void {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, t); // D5
    osc.frequency.setValueAtTime(880.0, t + 0.08); // A5

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.22);
  }
}
