import { SurfskateController } from '../physics/SurfskateController';

/**
 * Procedural Web Audio synthesizer for urethane wheel roll on smooth concrete,
 * S-turn pump whoosh, Bert slide / lip snap urethane screech, coping grind sparks,
 * and THPS-style maneuver combo chimes.
 */
export class SurfAudio {
  private ctx: AudioContext | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private whiteNoise: AudioBuffer | null = null;
  private isMuted = false;

  public initOnFirstGesture(): void {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

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
      this.rollGain.connect(this.ctx.destination);
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
      this.slideGain.connect(this.ctx.destination);
      slideSource.start();
    } catch {
      // Web Audio not available or blocked
    }
  }

  public update(ctrl: SurfskateController): void {
    if (!this.ctx || !this.rollGain || !this.rollFilter || !this.slideGain || this.isMuted) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
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
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.16);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  /**
   * Airy surf "swoosh" for the SNAP: band-passed white noise whose centre frequency sweeps
   * up and back down (like a board carving through the lip), layered with a soft low
   * "whoomp" of moving air and a short urethane-on-concrete hiss. No tonal beeps.
   */
  public playSnapSwoosh(perfect = false): void {
    if (!this.ctx || !this.whiteNoise || this.isMuted) return;
    const ctx = this.ctx;
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
    tail.connect(ctx.destination);
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
    ag.connect(ctx.destination);
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
    hg.connect(ctx.destination);
    hiss.start(now, 1.0);
    hiss.stop(t0 + 0.35);
  }
}
