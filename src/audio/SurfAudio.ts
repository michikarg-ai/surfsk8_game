import { SurfskateController } from '../physics/SurfskateController';

/**
 * Procedural Web Audio synthesizer for urethane wheel roll on smooth concrete,
 * S-turn pump whoosh, Bert slide / lip snap urethane screech, coping grind sparks,
 * and THPS-style maneuver combo chimes.
 */
export class SurfAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private whiteNoise: AudioBuffer | null = null;
  private isMuted = false;
  private isPaused = true;

  // High-energy background soundtrack playlist
  private playlist: string[] = [
    'audio/surfskate_anthem_1.mp3',
    'audio/surfskate_anthem_2.mp3',
  ];
  private currentTrackIndex = 0;
  private music: HTMLAudioElement | null = null;
  private isMusicMuted = false;
  private musicVolume = 0.38;
  private duckTimer: number | null = null;

  public onTrackChange?: (trackIndex: number) => void;

  private getTrackUrl(index: number): string {
    const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
    const base = meta.env?.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : base + '/';
    const safeIndex = ((index % this.playlist.length) + this.playlist.length) % this.playlist.length;
    return `${prefix}${this.playlist[safeIndex]}`;
  }

  public initOnFirstGesture(): void {
    if (!this.music) {
      try {
        this.music = new Audio(this.getTrackUrl(this.currentTrackIndex));
        this.music.loop = false; // Alternating playlist: play next track on ended
        this.music.volume = this.musicVolume;
        this.music.preload = 'auto';

        this.music.addEventListener('ended', () => {
          this.playNextTrack();
        });
      } catch {
        // Audio element not supported
      }
    }

    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isPaused ? 0.0 : 1.0;
      this.masterGain.connect(this.ctx.destination);

      // White noise buffer for airy swooshes (SNAP)
      this.whiteNoise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const wn = this.whiteNoise.getChannelData(0);
      for (let i = 0; i < wn.length; i++) wn[i] = Math.random() * 2 - 1;

      // Pink/brown noise buffer for concrete urethane wheel roll & slide
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const out = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        out[i] = (lastOut + 0.04 * white) / 1.04;
        lastOut = out[i];
        out[i] *= 2.5;
      }

      // 1. Concrete Rolling Loop
      const rollSource = this.ctx.createBufferSource();
      rollSource.buffer = noiseBuffer;
      rollSource.loop = true;

      this.rollFilter = this.ctx.createBiquadFilter();
      this.rollFilter.type = 'bandpass';
      this.rollFilter.frequency.value = 180;
      this.rollFilter.Q.value = 1.4;

      this.rollGain = this.ctx.createGain();
      this.rollGain.gain.value = 0.0;

      rollSource.connect(this.rollFilter);
      this.rollFilter.connect(this.rollGain);
      this.rollGain.connect(this.masterGain);
      rollSource.start();

      // 2. Bert Slide / Lip Slash / Coping Grind Loop
      const slideSource = this.ctx.createBufferSource();
      slideSource.buffer = noiseBuffer;
      slideSource.loop = true;

      const slideFilter = this.ctx.createBiquadFilter();
      slideFilter.type = 'bandpass';
      slideFilter.frequency.value = 1350;
      slideFilter.Q.value = 2.5;

      this.slideGain = this.ctx.createGain();
      this.slideGain.gain.value = 0.0;

      slideSource.connect(slideFilter);
      slideFilter.connect(this.slideGain);
      this.slideGain.connect(this.masterGain);
      slideSource.start();
    } catch {
      // Web Audio not available or blocked
    }
  }

  public pause(): void {
    this.isPaused = true;
    if (this.duckTimer !== null) {
      window.clearTimeout(this.duckTimer);
      this.duckTimer = null;
    }
    if (this.music) {
      this.music.pause();
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.rollGain) {
      this.rollGain.gain.cancelScheduledValues(now);
      this.rollGain.gain.setValueAtTime(0, now);
      this.rollGain.gain.value = 0;
    }
    if (this.slideGain) {
      this.slideGain.gain.cancelScheduledValues(now);
      this.slideGain.gain.setValueAtTime(0, now);
      this.slideGain.gain.value = 0;
    }
    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0, now);
      this.masterGain.gain.value = 0;
    }
    if (this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  public resume(): void {
    this.isPaused = false;
    this.initOnFirstGesture();
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(1.0, now);
      this.masterGain.gain.value = 1.0;
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.music) {
      this.music.volume = this.musicVolume;
      if (!this.isMusicMuted && !this.isMuted) {
        this.music.play().catch(() => {});
      }
    }
  }

  public update(ctrl: SurfskateController): void {
    if (!this.ctx || !this.rollGain || !this.rollFilter || !this.slideGain || this.isMuted || this.isPaused) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.masterGain && this.masterGain.gain.value < 0.5) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }

    const now = this.ctx.currentTime;
    const groundedFactor = ctrl.isGrounded ? 1.0 : 0.0;
    const speedNorm = Math.min(1.0, ctrl.speed / 12.0);
    const carveBoost = 1.0 + Math.abs(ctrl.leanAngle) * 0.9;

    this.rollFilter.frequency.setTargetAtTime(110 + speedNorm * 290 * carveBoost, now, 0.05);
    this.rollGain.gain.setTargetAtTime(groundedFactor * speedNorm * 0.14, now, 0.05);

    const slideIntensity = ctrl.isGrinding ? 0.22 : ctrl.sprayIntensity * 0.18;
    this.slideGain.gain.setTargetAtTime(slideIntensity, now, 0.04);
  }

  public playManeuverChime(): void {
    if (!this.ctx || this.isMuted || this.isPaused || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.16);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  /**
   * Airy surf "swoosh" for the SNAP: band-passed white noise whose centre frequency sweeps
   * up and back down (like a board carving through the lip), layered with a soft low
   * "whoomp" of moving air and a short urethane-on-concrete hiss. No tonal beeps.
   */
  public playSnapSwoosh(perfect = false): void {
    this.duckMusic(0.95);
    if (!this.ctx || !this.whiteNoise || this.isMuted || this.isPaused || !this.masterGain) return;
    const ctx = this.ctx;
    const master = this.masterGain;
    const now = ctx.currentTime;
    const dur = perfect ? 0.95 : 0.8; // stretched to match the slow-motion moment

    // 1. Main swoosh: band-pass sweep 350 Hz -> 2.4 kHz -> 600 Hz
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(350, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + dur * 0.35);
    bp.frequency.exponentialRampToValueAtTime(600, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.32, now + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    // Gentle stereo movement (left -> right) if supported
    let tail: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(-0.6, now);
      pan.pan.linearRampToValueAtTime(0.6, now + dur);
      g.connect(pan);
      tail = pan;
    }
    src.connect(bp);
    bp.connect(g);
    tail.connect(master);
    src.start(now);
    src.stop(now + dur + 0.05);

    // 2. Low "whoomp" of displaced air
    const air = ctx.createBufferSource();
    air.buffer = this.whiteNoise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(220, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + dur * 0.8);
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, now);
    ag.gain.exponentialRampToValueAtTime(0.45, now + dur * 0.25);
    ag.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.85);
    air.connect(lp);
    lp.connect(ag);
    ag.connect(master);
    air.start(now, 0.5);
    air.stop(now + dur);

    // 3. Short urethane hiss as the wheels bite and release
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.whiteNoise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3800;
    const hg = ctx.createGain();
    const t0 = now + dur * 0.22;
    hg.gain.setValueAtTime(0.0001, now);
    hg.gain.setValueAtTime(0.0001, t0);
    hg.gain.exponentialRampToValueAtTime(perfect ? 0.09 : 0.06, t0 + 0.05);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    hiss.connect(hp);
    hp.connect(hg);
    hg.connect(master);
    hiss.start(now, 1.0);
    hiss.stop(t0 + 0.35);
  }

  /**
   * Big cinematic trick "SWOOSH" for every scoring trick (SNAP, LAYBACK, BERTSLIDE, FS REVERSE 360).
   * Built purely from filtered noise (no beeps):
   *  1. a rising suck-in whoosh (like air being pulled in before the move),
   *  2. the main release sweep flying across the stereo field,
   *  3. a deep sub "boom" of displaced air,
   *  4. a long airy shimmer tail through a feedback delay (cheap reverb).
   * Each trick gets its own pitch/length/pan character.
   */
  public playTrickSwoosh(trick: 'SNAP' | 'LAYBACK' | 'BERTSLIDE' | 'REVERSE360', perfect = false): void {
    this.duckMusic(1.2);
    if (!this.ctx || !this.whiteNoise || this.isMuted || this.isPaused || !this.masterGain) return;
    const ctx = this.ctx;
    const master = this.masterGain;
    const now = ctx.currentTime;

    const profile = {
      SNAP: { pre: 0.18, main: 0.75, top: 2600, low: 420, pan: 1, boom: 70 },
      LAYBACK: { pre: 0.28, main: 1.05, top: 1900, low: 300, pan: -1, boom: 55 },
      BERTSLIDE: { pre: 0.22, main: 0.95, top: 3200, low: 520, pan: 1, boom: 60 },
      REVERSE360: { pre: 0.3, main: 1.2, top: 2800, low: 350, pan: -1, boom: 50 },
    }[trick];
    const vol = perfect ? 1.0 : 0.85;
    const tHit = now + profile.pre;

    // Shared "room": feedback delay with low-pass damping for the airy tail
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.11;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    wet.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    damp.connect(master);

    const panNode = (from: number, to: number, t0: number, t1: number): AudioNode | null => {
      if (typeof ctx.createStereoPanner !== 'function') return null;
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(from, t0);
      p.pan.linearRampToValueAtTime(to, t1);
      return p;
    };

    const noiseVoice = (
      filterType: BiquadFilterType,
      q: number,
      freqs: [number, number][],
      gains: [number, number][],
      start: number,
      stop: number,
      pan: AudioNode | null,
      sendWet = true
    ): void => {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.Q.value = q;
      f.frequency.setValueAtTime(freqs[0][0], start);
      for (let i = 1; i < freqs.length; i++) f.frequency.exponentialRampToValueAtTime(freqs[i][0], freqs[i][1]);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      for (const [v, t] of gains) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * vol), t);
      src.connect(f);
      f.connect(g);
      const out: AudioNode = pan ? (g.connect(pan), pan) : g;
      out.connect(master);
      if (sendWet) out.connect(wet);
      src.start(start, Math.random() * 1.0);
      src.stop(stop + 0.05);
    };

    // 1. Suck-in: rising band-pass noise into the hit
    noiseVoice(
      'bandpass',
      1.4,
      [[180, now], [profile.top * 0.8, tHit]],
      [[0.22, tHit - 0.02], [0.0001, tHit + 0.06]],
      now,
      tHit + 0.08,
      panNode(-0.8 * profile.pan, 0, now, tHit)
    );

    // 2. Main release sweep: loud, wide, flying across the stereo field
    const mainEnd = tHit + profile.main;
    noiseVoice(
      'bandpass',
      0.9,
      [[profile.top, tHit], [profile.low, mainEnd]],
      [[0.5, tHit + 0.04], [0.18, tHit + profile.main * 0.45], [0.0001, mainEnd]],
      tHit,
      mainEnd,
      panNode(0, 0.9 * profile.pan, tHit, mainEnd)
    );
    // Layered low body of the swoosh
    noiseVoice(
      'lowpass',
      0.7,
      [[900, tHit], [160, mainEnd]],
      [[0.38, tHit + 0.05], [0.0001, tHit + profile.main * 0.8]],
      tHit,
      mainEnd,
      null
    );

    // 3. Deep sub boom of displaced air (very low sine, felt more than heard)
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(profile.boom * 2, tHit);
    boom.frequency.exponentialRampToValueAtTime(profile.boom * 0.6, tHit + 0.45);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, tHit);
    bg.gain.exponentialRampToValueAtTime(0.55 * vol, tHit + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, tHit + 0.55);
    boom.connect(bg);
    bg.connect(master);
    boom.start(tHit);
    boom.stop(tHit + 0.6);

    // 4. Airy shimmer / urethane spray tail
    noiseVoice(
      'highpass',
      0.5,
      [[4200, tHit], [6500, mainEnd + 0.3]],
      [[perfect ? 0.11 : 0.08, tHit + 0.08], [0.0001, mainEnd + 0.3]],
      tHit,
      mainEnd + 0.3,
      panNode(0.5 * profile.pan, -0.5 * profile.pan, tHit, mainEnd + 0.3)
    );

    // Tear down the delay network once everything has rung out
    window.setTimeout(() => {
      try {
        fb.disconnect();
        damp.disconnect();
      } catch {
        /* already gone */
      }
    }, (profile.pre + profile.main + 2.5) * 1000);
  }

  private duckMusic(durationSec = 1.1): void {
    if (!this.music || this.isMusicMuted || this.isPaused) return;
    if (this.duckTimer !== null) {
      window.clearTimeout(this.duckTimer);
    }
    this.music.volume = this.musicVolume * 0.55;
    this.duckTimer = window.setTimeout(() => {
      if (this.music && !this.isMusicMuted) {
        this.music.volume = this.musicVolume;
      }
      this.duckTimer = null;
    }, durationSec * 1000);
  }

  public toggleMusic(): boolean {
    this.isMusicMuted = !this.isMusicMuted;
    if (this.music) {
      if (this.isMusicMuted) {
        this.music.pause();
      } else if (!this.isPaused) {
        this.music.play().catch(() => {});
      }
    }
    return !this.isMusicMuted;
  }

  public playNextTrack(): void {
    this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
    if (this.music) {
      this.music.src = this.getTrackUrl(this.currentTrackIndex);
      this.music.currentTime = 0;
      if (!this.isPaused && !this.isMusicMuted && !this.isMuted) {
        this.music.play().catch(() => {});
      }
    }
    this.onTrackChange?.(this.currentTrackIndex);
  }

  public get trackInfo(): { current: number; total: number; currentSrc: string } {
    return {
      current: this.currentTrackIndex + 1,
      total: this.playlist.length,
      currentSrc: this.getTrackUrl(this.currentTrackIndex),
    };
  }

  public get isMusicActive(): boolean {
    return !this.isMusicMuted;
  }
}
