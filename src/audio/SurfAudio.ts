import { SurfskateController } from '../physics/SurfskateController';
import { resolveAssetUrl } from '../utils/assetUrl';

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
  private brownNoise: AudioBuffer | null = null;

  // 3-layer procedural surfskate physics audio nodes (roll hum, rail carve, urethane slide)
  private surfRollFilter: BiquadFilterNode | null = null;
  private surfRollGain: GainNode | null = null;
  private surfCarveFilter: BiquadFilterNode | null = null;
  private surfCarveGain: GainNode | null = null;
  private surfSlideFilter: BiquadFilterNode | null = null;
  private surfSlideGritOsc: OscillatorNode | null = null;
  private surfSlideGritFilter: BiquadFilterNode | null = null;
  private surfSlideGritGain: GainNode | null = null;
  private surfSlideGain: GainNode | null = null;
  private surfNodesReady = false;

  // Throttle resume attempts and gate redundant AudioParam automation events
  private lastResumeAttemptMs = 0;
  private surfLayersSilenced = true;
  private surfSlideSilenced = true;
  private legacyAudioSilenced = true;
  private lastLegacyRollFreq = -1;
  private lastLegacyRollGain = -1;
  private lastLegacySlideGain = -1;
  private lastSurfRollFreq = -1;
  private lastSurfRollGain = -1;
  private lastSurfCarveFreq = -1;
  private lastSurfCarveQ = -1;
  private lastSurfCarveGain = -1;
  private lastSurfSlideFreq = -1;
  private lastSurfGritFreq = -1;
  private lastSurfGritOscFreq = -1;
  private lastSurfSlideGain = -1;

  private isMuted = false;
  private isPaused = true;

  // High-energy background soundtrack playlist
  private playlist: string[] = [
    'audio/surfskate_anthem_1.mp3',
    'audio/surfskate_anthem_2.mp3',
    'audio/surfskate_anthem_3.mp3',
  ];
  private currentTrackIndex = Math.floor(Math.random() * 3);
  private music: HTMLAudioElement | null = null;
  private garageMusic: HTMLAudioElement | null = null;
  private isGarageMode = true; // Starts in garage mode (LandingPage)
  private isMusicMuted = false;
  private musicVolume = 0.38;
  private garageVolume = 0.35;
  private duckTimer: number | null = null;

  public onTrackChange?: (trackIndex: number) => void;

  private resolveUrl(relPath: string): string {
    return resolveAssetUrl(relPath);
  }

  private getTrackUrl(index: number): string {
    const safeIndex = ((index % this.playlist.length) + this.playlist.length) % this.playlist.length;
    return this.resolveUrl(this.playlist[safeIndex]);
  }

  public initOnFirstGesture(): void {
    if (!this.garageMusic) {
      try {
        this.garageMusic = new Audio(this.resolveUrl('audio/garage_theme.mp3'));
        this.garageMusic.loop = true;
        this.garageMusic.volume = this.garageVolume;
        this.garageMusic.preload = 'auto';
      } catch {
        // Audio element not supported
      }
    }

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

    // Play appropriate music on initial gesture depending on mode
    if (this.isGarageMode) {
      if (!this.isMusicMuted && !this.isMuted && this.garageMusic) {
        this.garageMusic.play().catch(() => {});
      }
    } else {
      if (!this.isPaused && !this.isMusicMuted && !this.isMuted && this.music) {
        this.music.play().catch(() => {});
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
      this.brownNoise = noiseBuffer;

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

      this.ensureSurfskateNodes();
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
    this.rampSurfskateLayersToZero(now, 0.015);
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
    this.legacyAudioSilenced = true;
    this.lastLegacyRollGain = 0;
    this.lastLegacySlideGain = 0;
    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0, now);
      this.masterGain.gain.value = 0;
    }
    if (this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  public playGarageMusic(): void {
    this.isGarageMode = true;
    if (this.music) {
      this.music.pause();
    }
    this.initOnFirstGesture();
    if (this.garageMusic) {
      this.garageMusic.volume = this.garageVolume;
      if (!this.isMusicMuted && !this.isMuted) {
        this.garageMusic.play().catch(() => {});
      }
    }
  }

  public stopGarageMusic(): void {
    this.isGarageMode = false;
    if (this.garageMusic) {
      this.garageMusic.pause();
    }
  }

  public resume(): void {
    this.isPaused = false;
    const startingFromGarage = this.isGarageMode;
    this.stopGarageMusic();
    this.initOnFirstGesture();
    if (startingFromGarage) {
      this.currentTrackIndex = Math.floor(Math.random() * this.playlist.length);
      if (this.music) {
        this.music.src = this.getTrackUrl(this.currentTrackIndex);
        this.music.currentTime = 0;
      }
      this.onTrackChange?.(this.currentTrackIndex);
    }
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

  private tryAutoResume(): void {
    if (!this.ctx || this.ctx.state !== 'suspended' || this.isPaused || this.isMuted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastResumeAttemptMs < 1000) return;
    this.lastResumeAttemptMs = nowMs;
    this.ctx.resume().catch(() => {});
  }

  private setParamTarget(
    param: AudioParam,
    target: number,
    now: number,
    timeConstant: number,
    lastValue: number,
    eps: number
  ): number {
    if (Math.abs(target - lastValue) <= eps) {
      return lastValue;
    }
    param.setTargetAtTime(target, now, timeConstant);
    return target;
  }

  public update(ctrl: SurfskateController): void {
    if (!this.ctx || !this.rollGain || !this.rollFilter || !this.slideGain || this.isMuted || this.isPaused) return;

    if (this.ctx.state !== 'running') {
      this.tryAutoResume();
      return;
    }
    if (this.masterGain && this.masterGain.gain.value < 0.5) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }

    const now = this.ctx.currentTime;
    const groundedFactor = ctrl.isGrounded ? 1.0 : 0.0;
    const speedNorm = Math.min(1.0, ctrl.speed / 12.0);
    const carveBoost = 1.0 + Math.abs(ctrl.leanAngle) * 0.9;

    const targetRollFreq = 110 + speedNorm * 290 * carveBoost;
    const targetRollGain = groundedFactor * speedNorm * 0.14;
    const targetSlideGain = ctrl.isGrinding ? 0.22 : ctrl.sprayIntensity * 0.18;

    this.lastLegacyRollFreq = this.setParamTarget(
      this.rollFilter.frequency,
      targetRollFreq,
      now,
      0.05,
      this.lastLegacyRollFreq,
      1.0
    );
    this.lastLegacyRollGain = this.setParamTarget(
      this.rollGain.gain,
      targetRollGain,
      now,
      0.05,
      this.lastLegacyRollGain,
      0.002
    );
    this.lastLegacySlideGain = this.setParamTarget(
      this.slideGain.gain,
      targetSlideGain,
      now,
      0.04,
      this.lastLegacySlideGain,
      0.002
    );
    this.legacyAudioSilenced = targetRollGain <= 0.001 && targetSlideGain <= 0.001;
  }

  private ensureSurfskateNodes(): boolean {
    if (this.surfNodesReady) return true;
    if (!this.ctx || !this.masterGain) return false;

    const ctx = this.ctx;
    if (!this.whiteNoise) {
      this.whiteNoise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const wn = this.whiteNoise.getChannelData(0);
      for (let i = 0; i < wn.length; i++) wn[i] = Math.random() * 2 - 1;
    }
    if (!this.brownNoise) {
      const bufferSize = ctx.sampleRate * 2;
      this.brownNoise = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const out = this.brownNoise.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        out[i] = (lastOut + 0.04 * white) / 1.04;
        lastOut = out[i];
        out[i] *= 2.5;
      }
    }

    // 1. Subtle Concrete Roll Hum (lowpass-filtered brown/pink noise bed)
    const rollSource = ctx.createBufferSource();
    rollSource.buffer = this.brownNoise;
    rollSource.loop = true;

    this.surfRollFilter = ctx.createBiquadFilter();
    this.surfRollFilter.type = 'lowpass';
    this.surfRollFilter.frequency.value = 110;
    this.surfRollFilter.Q.value = 0.75;

    this.surfRollGain = ctx.createGain();
    this.surfRollGain.gain.value = 0.0;

    rollSource.connect(this.surfRollFilter);
    this.surfRollFilter.connect(this.surfRollGain);
    this.surfRollGain.connect(this.masterGain);
    rollSource.start(0, 0.13);

    // 2. Urethane Rail-Grip Carve Sound (~450-1100 Hz bandpass)
    const carveSource = ctx.createBufferSource();
    carveSource.buffer = this.whiteNoise;
    carveSource.loop = true;

    this.surfCarveFilter = ctx.createBiquadFilter();
    this.surfCarveFilter.type = 'bandpass';
    this.surfCarveFilter.frequency.value = 480;
    this.surfCarveFilter.Q.value = 2.1;

    this.surfCarveGain = ctx.createGain();
    this.surfCarveGain.gain.value = 0.0;

    carveSource.connect(this.surfCarveFilter);
    this.surfCarveFilter.connect(this.surfCarveGain);
    this.surfCarveGain.connect(this.masterGain);
    carveSource.start(0, 0.37);

    // 3. Urethane Slide Screech (~1200-2400 Hz resonant bandpass + gritty harmonic texture)
    const slideSource = ctx.createBufferSource();
    slideSource.buffer = this.whiteNoise;
    slideSource.loop = true;

    this.surfSlideFilter = ctx.createBiquadFilter();
    this.surfSlideFilter.type = 'bandpass';
    this.surfSlideFilter.frequency.value = 1450;
    this.surfSlideFilter.Q.value = 4.2;

    this.surfSlideGain = ctx.createGain();
    this.surfSlideGain.gain.value = 0.0;

    slideSource.connect(this.surfSlideFilter);
    this.surfSlideFilter.connect(this.surfSlideGain);
    this.surfSlideGain.connect(this.masterGain);
    slideSource.start(0, 0.91);

    this.surfSlideGritOsc = ctx.createOscillator();
    this.surfSlideGritOsc.type = 'sawtooth';
    this.surfSlideGritOsc.frequency.value = 240;

    this.surfSlideGritFilter = ctx.createBiquadFilter();
    this.surfSlideGritFilter.type = 'bandpass';
    this.surfSlideGritFilter.frequency.value = 1550;
    this.surfSlideGritFilter.Q.value = 3.0;

    this.surfSlideGritGain = ctx.createGain();
    this.surfSlideGritGain.gain.value = 0.18;

    this.surfSlideGritOsc.connect(this.surfSlideGritFilter);
    this.surfSlideGritFilter.connect(this.surfSlideGritGain);
    this.surfSlideGritGain.connect(this.surfSlideGain);
    this.surfSlideGritOsc.start();

    this.surfNodesReady = true;
    return true;
  }

  private rampSurfskateLayersToZero(now: number, timeConstant: number): void {
    if (this.surfLayersSilenced || !this.ctx || this.ctx.state !== 'running') return;
    if (this.surfRollGain) {
      this.surfRollGain.gain.setTargetAtTime(0, now, timeConstant);
    }
    if (this.surfCarveGain) {
      this.surfCarveGain.gain.setTargetAtTime(0, now, timeConstant);
    }
    if (this.surfSlideGain && !this.surfSlideSilenced) {
      this.surfSlideGain.gain.setTargetAtTime(0, now, timeConstant);
    }
    this.surfLayersSilenced = true;
    this.surfSlideSilenced = true;
    this.lastSurfRollGain = 0;
    this.lastSurfCarveGain = 0;
    this.lastSurfSlideGain = 0;
  }

  /**
   * Continuous 3-layer procedural WebAudio surfskate physics soundscape:
   *  1. Subtle warm lowpass concrete roll hum
   *  2. Urethane rail-grip carve hiss (~450-1100 Hz)
   *  3. Resonant urethane slide screech (~1200-2400 Hz + harmonic grit)
   */
  public updateSurfskateAudio(
    speed: number,
    leanAbs: number,
    isGrounded: boolean,
    isSliding: boolean,
    railDrift: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
    if (!this.ensureSurfskateNodes()) return;

    if (this.ctx.state !== 'running') {
      this.tryAutoResume();
      return;
    }

    const now = this.ctx.currentTime;

    if (this.isMuted || this.isPaused) {
      this.rampSurfskateLayersToZero(now, 0.02);
      return;
    }

    if (this.masterGain.gain.value < 0.5) {
      this.masterGain.gain.setTargetAtTime(1.0, now, 0.02);
    }

    const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    const safeLean = Number.isFinite(leanAbs) ? Math.max(0, leanAbs) : 0;
    const safeDrift = Number.isFinite(railDrift) ? Math.max(0, railDrift) : 0;

    if (!isGrounded || safeSpeed < 0.3) {
      this.rampSurfskateLayersToZero(now, 0.025);
      return;
    }

    this.surfLayersSilenced = false;

    const speedNorm = Math.min(1, Math.max(0, (safeSpeed - 0.3) / 9.2));
    const leanNorm = Math.min(1, safeLean / 0.7);
    const driftNorm = Math.min(1, safeDrift);

    // 1. Subtle Concrete Roll Hum
    if (this.surfRollFilter && this.surfRollGain) {
      const rollFreq = 95 + speedNorm * 230 + leanNorm * 45;
      const rollTarget = 0.016 + speedNorm * 0.055;
      this.lastSurfRollFreq = this.setParamTarget(
        this.surfRollFilter.frequency,
        rollFreq,
        now,
        0.055,
        this.lastSurfRollFreq,
        1.0
      );
      this.lastSurfRollGain = this.setParamTarget(
        this.surfRollGain.gain,
        rollTarget,
        now,
        0.05,
        this.lastSurfRollGain,
        0.001
      );
    }

    // 2. Urethane Rail-Grip Carve Sound
    if (this.surfCarveFilter && this.surfCarveGain) {
      const carveLoad = Math.min(1, leanNorm * 0.78 + driftNorm * 0.42);
      const carveFreq = 450 + carveLoad * 520 + speedNorm * 130;
      const carveQ = 1.8 + driftNorm * 1.1;
      const carveTarget = speedNorm * Math.pow(carveLoad, 1.35) * 0.11;
      this.lastSurfCarveFreq = this.setParamTarget(
        this.surfCarveFilter.frequency,
        carveFreq,
        now,
        0.05,
        this.lastSurfCarveFreq,
        1.5
      );
      this.lastSurfCarveQ = this.setParamTarget(
        this.surfCarveFilter.Q,
        carveQ,
        now,
        0.05,
        this.lastSurfCarveQ,
        0.02
      );
      this.lastSurfCarveGain = this.setParamTarget(
        this.surfCarveGain.gain,
        carveTarget,
        now,
        0.045,
        this.lastSurfCarveGain,
        0.001
      );
    }

    // 3. Urethane Slide Screech (Bert Slide / Layback / Snap)
    if (this.surfSlideFilter && this.surfSlideGain && this.surfSlideGritOsc && this.surfSlideGritFilter) {
      if (isSliding) {
        this.surfSlideSilenced = false;
        const slideEnergy = Math.min(1, 0.45 + speedNorm * 0.4 + driftNorm * 0.35);
        const slideFreq = Math.min(2400, 1250 + speedNorm * 750 + driftNorm * 380);
        const gritOscFreq = 210 + speedNorm * 130 + leanNorm * 40;
        this.lastSurfSlideFreq = this.setParamTarget(
          this.surfSlideFilter.frequency,
          slideFreq,
          now,
          0.03,
          this.lastSurfSlideFreq,
          2.0
        );
        this.lastSurfGritFreq = this.setParamTarget(
          this.surfSlideGritFilter.frequency,
          Math.min(2400, slideFreq * 1.05),
          now,
          0.03,
          this.lastSurfGritFreq,
          2.0
        );
        this.lastSurfGritOscFreq = this.setParamTarget(
          this.surfSlideGritOsc.frequency,
          gritOscFreq,
          now,
          0.04,
          this.lastSurfGritOscFreq,
          1.0
        );
        this.lastSurfSlideGain = this.setParamTarget(
          this.surfSlideGain.gain,
          slideEnergy * 0.16,
          now,
          0.015,
          this.lastSurfSlideGain,
          0.001
        );
      } else if (!this.surfSlideSilenced) {
        // ~80ms smooth fade-out when slide ends
        this.surfSlideSilenced = true;
        this.lastSurfSlideGain = 0;
        this.surfSlideGain.gain.setTargetAtTime(0, now, 0.025);
      }
    }
  }

  /**
   * Immediately ramps all continuous roll/carve/slide gains smoothly to 0
   * (used for pause, landing page, or summary modal transitions).
   */
  public stopSurfskateAudio(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.surfLayersSilenced && this.legacyAudioSilenced) return;
    const now = this.ctx.currentTime;
    this.rampSurfskateLayersToZero(now, 0.015);
    if (!this.legacyAudioSilenced) {
      if (this.rollGain) {
        this.rollGain.gain.setTargetAtTime(0, now, 0.015);
      }
      if (this.slideGain) {
        this.slideGain.gain.setTargetAtTime(0, now, 0.015);
      }
      this.legacyAudioSilenced = true;
      this.lastLegacyRollGain = 0;
      this.lastLegacySlideGain = 0;
    }
  }

  /**
   * Tactile rail-switch / wall-pump whoosh-snap (~160-220ms):
   * sweeping bandpass noise + warm subtle low-mid board-compression thump.
   */
  public playPumpWhoosh(intensity = 0.8, isWallPump = false): void {
    if (!this.ctx || this.isMuted || this.isPaused || !this.masterGain) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (!this.whiteNoise) {
      this.whiteNoise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const wn = this.whiteNoise.getChannelData(0);
      for (let i = 0; i < wn.length; i++) wn[i] = Math.random() * 2 - 1;
    }

    const now = ctx.currentTime;
    const master = this.masterGain;
    const amp = Number.isFinite(intensity) ? Math.min(1.25, Math.max(0.2, intensity)) : 0.8;
    const dur = isWallPump ? 0.215 : 0.165;

    // 1. Sweeping bandpass noise whoosh-snap
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = isWallPump ? 1.9 : 1.6;
    bp.frequency.setValueAtTime(isWallPump ? 420 : 380, now);
    bp.frequency.exponentialRampToValueAtTime(isWallPump ? 2200 : 1550, now + dur * 0.35);
    bp.frequency.exponentialRampToValueAtTime(isWallPump ? 780 : 680, now + dur);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime((isWallPump ? 0.22 : 0.17) * amp, now + 0.022);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(master);
    src.start(now, Math.random() * 1.0);
    src.stop(now + dur + 0.02);

    // 2. Warm subtle low-mid thump
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(isWallPump ? 135 : 155, now);
    thump.frequency.exponentialRampToValueAtTime(isWallPump ? 54 : 78, now + dur * 0.72);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime((isWallPump ? 0.24 : 0.16) * amp, now + 0.012);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.8);

    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(now);
    thump.stop(now + dur * 0.85);
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
  public playTrickSwoosh(
    trick: 'SNAP' | 'LAYBACK' | 'BERTSLIDE' | 'REVERSE360' | 'INDYGRAB',
    perfect = false
  ): void {
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
      INDYGRAB: { pre: 0.14, main: 1.15, top: 3400, low: 340, pan: 0, boom: 75 },
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
    if (this.isGarageMode) {
      if (this.garageMusic) {
        if (this.isMusicMuted) {
          this.garageMusic.pause();
        } else {
          this.garageMusic.play().catch(() => {});
        }
      }
    } else {
      if (this.music) {
        if (this.isMusicMuted) {
          this.music.pause();
        } else if (!this.isPaused) {
          this.music.play().catch(() => {});
        }
      }
    }
    return !this.isMusicMuted;
  }

  public playNextTrack(): void {
    this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
    if (this.music) {
      this.music.src = this.getTrackUrl(this.currentTrackIndex);
      this.music.currentTime = 0;
      if (!this.isGarageMode && !this.isPaused && !this.isMusicMuted && !this.isMuted) {
        this.music.play().catch(() => {});
      }
    }
    this.onTrackChange?.(this.currentTrackIndex);
  }

  public handleVisibilityChange(visible: boolean): void {
    if (!visible) {
      if (this.garageMusic) this.garageMusic.pause();
      if (this.music) this.music.pause();
    } else {
      if (!this.isMusicMuted && !this.isMuted) {
        if (this.isGarageMode) {
          this.garageMusic?.play().catch(() => {});
        } else if (!this.isPaused) {
          this.music?.play().catch(() => {});
        }
      }
    }
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

  /**
   * Rewarding Munich pretzel pickup sound:
   * Single pretzel: bright rising bell chime (D5 -> A5).
   * All 5 collected: triumphant Bavarian victory arpeggio fanfare (C5 -> E5 -> G5 -> C6).
   */
  /**
   * Sound of wiping out / falling off the skateboard:
   * Low concrete impact thud + harsh wheel bite / slide screech.
   */
  public playBailSound(): void {
    this.duckMusic(1.1);
    if (!this.ctx || !this.whiteNoise || this.isMuted || this.isPaused || !this.masterGain) return;
    const ctx = this.ctx;
    const master = this.masterGain;
    const now = ctx.currentTime;

    // 1. Heavy low impact "THUD" (falling onto ground)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.28);
    oscGain.gain.setValueAtTime(0.42, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(now);
    osc.stop(now + 0.33);

    // 2. Concrete slide & wheel-bite scrape (white noise through resonant bandpass)
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(1400, now);
    bp.frequency.exponentialRampToValueAtTime(420, now + 0.42);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    src.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(master);
    src.start(now);
    src.stop(now + 0.49);
  }

  public playPretzelPickup(isAllCollected = false): void {
    if (!this.ctx || this.isMuted || this.isPaused || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const master = this.masterGain;

    const notes = isAllCollected
      ? [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
      : [587.33, 880.0];                 // D5, A5 bell chime

    const noteStep = isAllCollected ? 0.09 : 0.07;
    const duration = isAllCollected ? 0.45 : 0.28;

    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const t0 = now + idx * noteStep;

      osc.type = isAllCollected ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(isAllCollected ? 0.22 : 0.16, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(gain);
      gain.connect(master);

      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    });
  }

  /**
   * Heavy commercial twin-engine passenger jet flyover sound effect for the Airport Skatepark.
   * Procedural Web Audio synthesis featuring:
   * - Resonant lowpass-filtered aerodynamic jet roar & air displacement with Doppler sweep (950 Hz -> 220 Hz)
   * - Dual-oscillator harmonic turbine blade whine with characteristic Doppler pitch drop (265 Hz -> 165 Hz)
   * - Sub-bass engine rumble (38 - 62 Hz)
   * - Smooth stereo panning across the airspace and background music ducking
   */
  public playJetFlyover(durationSec = 12): void {
    if (!this.ctx || this.isMuted || this.isPaused || !this.masterGain) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const master = this.masterGain;
    const now = ctx.currentTime;
    const end = now + durationSec;
    const tPeak = now + durationSec * 0.42; // Closest Point of Approach (CPA)

    this.duckMusic(durationSec);

    // Dynamic stereo panning across the airspace
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime(-0.85, now);
      panner.pan.linearRampToValueAtTime(0.85, end);
    }
    const sfxOut: AudioNode = panner ? (panner.connect(master), panner) : master;

    // 1. Aerodynamic exhaust roar & air displacement (Filtered noise)
    let noiseBuf = this.whiteNoise;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.Q.value = 1.6;
    // Doppler shift: higher approach cutoff, steep drop after CPA, deep rumble tail
    noiseFilter.frequency.setValueAtTime(950, now);
    noiseFilter.frequency.setValueAtTime(920, tPeak - 0.5);
    noiseFilter.frequency.exponentialRampToValueAtTime(220, end);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.46, tPeak);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, end);

    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(sfxOut);

    noiseSrc.start(now);
    noiseSrc.stop(end + 0.1);

    // 2. Twin-engine turbine compressor blade whines (Doppler-shifted oscillators)
    // Fundamental whine (~265 Hz -> ~165 Hz)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(265, now);
    osc1.frequency.setValueAtTime(255, tPeak - 0.4);
    osc1.frequency.exponentialRampToValueAtTime(165, end);

    const osc1Filter = ctx.createBiquadFilter();
    osc1Filter.type = 'bandpass';
    osc1Filter.Q.value = 4.2;
    osc1Filter.frequency.setValueAtTime(265, now);
    osc1Filter.frequency.setValueAtTime(255, tPeak - 0.4);
    osc1Filter.frequency.exponentialRampToValueAtTime(165, end);

    const osc1Gain = ctx.createGain();
    osc1Gain.gain.setValueAtTime(0.0001, now);
    osc1Gain.gain.exponentialRampToValueAtTime(0.18, tPeak);
    osc1Gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc1.connect(osc1Filter);
    osc1Filter.connect(osc1Gain);
    osc1Gain.connect(sfxOut);

    osc1.start(now);
    osc1.stop(end + 0.1);

    // Overtone whine (blade passing frequency shimmer: ~680 Hz -> ~420 Hz)
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(680, now);
    osc2.frequency.setValueAtTime(650, tPeak - 0.4);
    osc2.frequency.exponentialRampToValueAtTime(420, end);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.0001, now);
    osc2Gain.gain.exponentialRampToValueAtTime(0.12, tPeak);
    osc2Gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc2.connect(osc2Gain);
    osc2Gain.connect(sfxOut);

    osc2.start(now);
    osc2.stop(end + 0.1);

    // 3. Deep sub-bass engine roar (felt in headphones/speakers)
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(62, now);
    subOsc.frequency.exponentialRampToValueAtTime(38, end);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.32, tPeak);
    subGain.gain.exponentialRampToValueAtTime(0.0001, end);

    subOsc.connect(subGain);
    subGain.connect(sfxOut);

    subOsc.start(now);
    subOsc.stop(end + 0.1);
  }
}
