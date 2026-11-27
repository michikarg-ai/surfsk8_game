import { t } from '../i18n/i18n';
import { InputState, ManeuverEvent, SurfskateController } from '../physics/SurfskateController';

export const TUTORIAL_SEEN_STORAGE_KEY = 'surfsk8.tutorialSeen.v1';

export type TutorialControlMode = 'arrows' | 'wasd';

export interface FirstRunTutorialOptions {
  getControlMode?: () => TutorialControlMode;
  isTouchDevice?: () => boolean;
  onStart?: () => void;
  onComplete?: (skipped: boolean) => void;
  onStepComplete?: (stepIndex: number) => void;
  onAllStepsComplete?: () => void;
}

const TOTAL_STEPS = 5;
const STEP_FLASH_DURATION = 0.55;
const CELEBRATE_DURATION = 1.8;

/**
 * Live, non-blocking 5-step Learn-by-Doing HUD Tutorial (#tutorial-hud).
 * Runs while the player skates live in the 3D park with the session timer paused,
 * auto-advances on physics/input triggers, and supports instant Skip.
 */
export class FirstRunTutorial {
  private hudEl: HTMLElement | null;
  private cardEl: HTMLElement | null;
  private stepCountEl: HTMLElement | null;
  private dotEls: HTMLElement[] = [];
  private doneBadgeEl: HTMLElement | null;
  private skipBtn: HTMLButtonElement | null;
  private promptEl: HTMLElement | null;
  private hintEl: HTMLElement | null;
  private metronomeEl: HTMLElement | null;
  private barFillEl: HTMLElement | null;

  private active = false;
  private stepIndex = 0;
  private stepElapsed = 0;
  private stepDonePending = false;
  private stepFlashTimer = 0;
  private isCelebrating = false;
  private celebrateTimer = 0;

  // Per-step live detection state
  private carveLeftDone = false;
  private carveRightDone = false;
  private stepStartPumpCount = 0;
  private stepStartFlow = 0;
  private compressHeldWhileCarving = 0;
  private compressedDuringStep = false;
  private compressReleasedAfterHold = false;
  private sawGroundedInStep = false;

  // Cached UI values to avoid redundant DOM writes at 60fps
  private lastHintSignature = '';
  private lastBarPct = -1;
  private needsStepStartSnapshot = false;

  constructor(private options: FirstRunTutorialOptions = {}) {
    this.hudEl = document.getElementById('tutorial-hud');
    this.cardEl = document.getElementById('tut-hud-card');
    this.stepCountEl = document.getElementById('tutorial-step-count');
    this.doneBadgeEl = document.getElementById('tutorial-done-badge');
    this.skipBtn = document.getElementById('tutorial-skip-btn') as HTMLButtonElement | null;
    this.promptEl = document.getElementById('tutorial-prompt');
    this.hintEl = document.getElementById('tutorial-hint');
    this.metronomeEl = document.getElementById('tutorial-metronome');
    this.barFillEl = document.getElementById('tutorial-bar-fill');

    const dotsContainer = document.getElementById('tutorial-dots');
    if (dotsContainer) {
      this.dotEls = Array.from(dotsContainer.querySelectorAll<HTMLElement>('.tut-hud-dot'));
    }

    this.bindEvents();
  }

  private bindEvents(): void {
    this.skipBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.skip();
    });
  }

  public hasSeen(): boolean {
    try {
      return localStorage.getItem(TUTORIAL_SEEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  public markSeen(): void {
    try {
      localStorage.setItem(TUTORIAL_SEEN_STORAGE_KEY, '1');
    } catch {
      // ignore storage quota / privacy mode errors
    }
  }

  public shouldAutoOpenOnStart(): boolean {
    return !this.hasSeen();
  }

  public isOpen(): boolean {
    return this.active;
  }

  public isActive(): boolean {
    return this.active;
  }

  private isTouchView(): boolean {
    if (this.options.isTouchDevice) {
      return this.options.isTouchDevice();
    }
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    );
  }

  private resetStepTracking(): void {
    this.stepElapsed = 0;
    this.stepDonePending = false;
    this.stepFlashTimer = 0;
    this.carveLeftDone = false;
    this.carveRightDone = false;
    this.stepStartPumpCount = 0;
    this.stepStartFlow = 0;
    this.compressHeldWhileCarving = 0;
    this.compressedDuringStep = false;
    this.compressReleasedAfterHold = false;
    this.sawGroundedInStep = false;
    this.needsStepStartSnapshot = true;
    this.lastHintSignature = '';
    this.lastBarPct = -1;
  }

  public open(): void {
    if (!this.hudEl) return;
    this.active = true;
    this.isCelebrating = false;
    this.celebrateTimer = 0;
    this.stepIndex = 0;
    this.resetStepTracking();
    this.render();
    this.hudEl.classList.remove('hidden');
    this.options.onStart?.();
  }

  public skip(): void {
    if (!this.active) return;
    this.markSeen();
    this.hideInternal();
    this.options.onComplete?.(true);
  }

  public abort(): void {
    if (!this.active) return;
    this.hideInternal();
    this.options.onComplete?.(true);
  }

  public close(completed: boolean): void {
    if (completed) {
      if (!this.active) return;
      this.markSeen();
      this.hideInternal();
      this.options.onComplete?.(false);
    } else {
      this.skip();
    }
  }

  private hideInternal(): void {
    this.active = false;
    this.isCelebrating = false;
    this.stepDonePending = false;
    this.celebrateTimer = 0;
    this.stepFlashTimer = 0;
    this.hudEl?.classList.add('hidden');
    this.metronomeEl?.classList.add('hidden');
    this.cardEl?.classList.remove('is-step-done', 'is-celebrating');
    this.doneBadgeEl?.classList.add('hidden');
  }

  public refresh(): void {
    if (!this.active) return;
    this.lastHintSignature = '';
    this.render();
  }

  public handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (e.code === 'Escape') {
      this.skip();
      return true;
    }
    return false;
  }

  public notifyManeuver(ev: ManeuverEvent): void {
    if (!this.active || this.isCelebrating || this.stepDonePending) return;
    if (this.stepIndex !== 3) return;

    const isTrickOrLip =
      Boolean(ev.trick) ||
      ev.name.includes('Lip') ||
      ev.name.includes('Grind');

    if (isTrickOrLip) {
      this.completeCurrentStep();
    }
  }

  public update(dt: number, controller: SurfskateController, input: InputState): void {
    if (!this.active || !this.hudEl) return;

    if (this.isCelebrating) {
      this.celebrateTimer -= dt;
      if (this.celebrateTimer <= 0) {
        this.hideInternal();
        this.options.onComplete?.(false);
      }
      return;
    }

    if (this.stepDonePending) {
      this.stepFlashTimer -= dt;
      if (this.stepFlashTimer <= 0) {
        this.stepDonePending = false;
        this.stepIndex += 1;
        this.resetStepTracking();
        this.render();
      }
      return;
    }

    if (this.needsStepStartSnapshot) {
      this.needsStepStartSnapshot = false;
      this.stepStartPumpCount = controller.pumpCount;
      this.stepStartFlow = controller.flowMeter;
      this.sawGroundedInStep = controller.isGrounded;
    }

    this.stepElapsed += dt;

    if (this.stepIndex === 0) {
      // Step 1: Push & Roll -> speed >= 2.2 m/s
      const pct = Math.min(98, Math.round((controller.speed / 2.2) * 100));
      this.setProgressBar(pct);
      if (this.stepElapsed >= 0.18 && controller.speed >= 2.2) {
        this.completeCurrentStep();
      }
      return;
    }

    if (this.stepIndex === 1) {
      // Step 2: Carve Left & Right
      const analog = input.analogSteer ?? 0;
      if (
        controller.leanAngle <= -0.15 ||
        ((input.steerLeft || analog < -0.25) && controller.speed >= 0.4)
      ) {
        this.carveLeftDone = true;
      }
      if (
        controller.leanAngle >= 0.15 ||
        ((input.steerRight || analog > 0.25) && controller.speed >= 0.4)
      ) {
        this.carveRightDone = true;
      }

      const pct = (this.carveLeftDone ? 50 : 0) + (this.carveRightDone ? 50 : 0);
      this.setProgressBar(pct);
      this.updateStep2Hint();

      if (this.stepElapsed >= 0.2 && this.carveLeftDone && this.carveRightDone) {
        this.completeCurrentStep();
      }
      return;
    }

    if (this.stepIndex === 2) {
      // Step 3: Pump for Speed (Compress while carving OR rhythmic carve pump / flow gain)
      const analog = input.analogSteer ?? 0;
      const isCarvingOrWall =
        Math.abs(controller.leanAngle) >= 0.08 ||
        input.steerLeft ||
        input.steerRight ||
        Math.abs(analog) > 0.15 ||
        controller.currentSurface.height >= 0.15;

      const slopeMag = Math.hypot(
        controller.currentSurface.slopeX,
        controller.currentSurface.slopeZ
      );
      const isCompressing =
        input.compressCrouch || (Boolean(input.downSmartBrake) && slopeMag >= 0.14);

      if (isCompressing && controller.speed >= 0.9 && isCarvingOrWall) {
        this.compressHeldWhileCarving += dt;
        if (this.compressHeldWhileCarving >= 0.08) {
          this.compressedDuringStep = true;
        }
      } else if (!isCompressing && this.compressedDuringStep) {
        this.compressReleasedAfterHold = true;
      }

      const pumpsInStep = controller.pumpCount - this.stepStartPumpCount;
      const flowSatisfied =
        (this.stepStartFlow < 30 && controller.flowMeter >= 30) ||
        (controller.flowMeter >= 30 && controller.flowMeter >= this.stepStartFlow + 5) ||
        controller.flowMeter >= 65;
      const compressSatisfied =
        this.compressReleasedAfterHold || this.compressHeldWhileCarving >= 0.55;

      const compressPct = Math.max(
        this.compressedDuringStep ? 65 : 0,
        (this.compressHeldWhileCarving / 0.55) * 100
      );
      const flowPct =
        this.stepStartFlow < 30
          ? (controller.flowMeter / 30) * 100
          : ((controller.flowMeter - this.stepStartFlow) / 5) * 100;
      this.setProgressBar(Math.min(96, Math.max(0, Math.round(Math.max(compressPct, flowPct)))));

      if (this.stepElapsed >= 0.2 && (pumpsInStep >= 1 || flowSatisfied || compressSatisfied)) {
        this.completeCurrentStep();
      }
      return;
    }

    if (this.stepIndex === 3) {
      // Step 4: Land a Surf Trick (completed in notifyManeuver)
      const slidingOrSpinning =
        controller.bertSlideActive || controller.laybackActive || controller.reverseActive;
      if (slidingOrSpinning) {
        this.setStep4Hint('hold');
        this.setProgressBar(72);
      } else if (controller.speed < 3.4 && (this.stepElapsed > 3.0 || Boolean(controller.snapFeedback))) {
        this.setStep4Hint('faster');
        this.setProgressBar(Math.min(55, Math.round((controller.speed / 3.6) * 55)));
      } else {
        this.setStep4Hint('default');
        this.setProgressBar(Math.min(45, Math.round((controller.speed / 3.6) * 45)));
      }
      return;
    }

    if (this.stepIndex === 4) {
      // Step 5: Pop an Ollie
      if (controller.isGrounded) {
        this.sawGroundedInStep = true;
      }
      this.setProgressBar(input.jumpOllie ? 70 : 15);
      if (
        this.stepElapsed >= 0.15 &&
        ((this.sawGroundedInStep && !controller.isGrounded) ||
          (input.jumpOllie && !controller.isGrounded))
      ) {
        this.completeCurrentStep();
      }
    }
  }

  private completeCurrentStep(): void {
    if (this.stepDonePending || this.isCelebrating) return;

    this.setProgressBar(100);

    if (this.stepIndex >= TOTAL_STEPS - 1) {
      // Step 5 done -> Celebratory banner (~1.8s), mark seen, then finish
      this.markSeen();
      this.isCelebrating = true;
      this.celebrateTimer = CELEBRATE_DURATION;
      this.renderCelebration();
      this.options.onAllStepsComplete?.();
      return;
    }

    this.stepDonePending = true;
    this.stepFlashTimer = STEP_FLASH_DURATION;
    this.cardEl?.classList.add('is-step-done');
    if (this.doneBadgeEl) {
      this.doneBadgeEl.textContent = t('tutorial.doneBadge');
      this.doneBadgeEl.classList.remove('hidden');
    }
    this.options.onStepComplete?.(this.stepIndex);
  }

  private kbd(label: string): string {
    return `<kbd class="tut-kbd">${label}</kbd>`;
  }

  private pill(label: string): string {
    return `<span class="tut-pill">${label}</span>`;
  }

  private setProgressBar(pct: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (clamped === this.lastBarPct) return;
    this.lastBarPct = clamped;
    if (this.barFillEl) {
      this.barFillEl.style.width = `${clamped}%`;
    }
  }

  private updateStep2Hint(): void {
    if (!this.hintEl) return;
    const sig = `s2:${this.carveLeftDone ? 1 : 0}:${this.carveRightDone ? 1 : 0}`;
    if (sig === this.lastHintSignature) return;
    this.lastHintSignature = sig;
    const leftChip = `<span class="tut-dir-chip${this.carveLeftDone ? ' done' : ''}">◀${this.carveLeftDone ? ' ✓' : ''}</span>`;
    const rightChip = `<span class="tut-dir-chip${this.carveRightDone ? ' done' : ''}">▶${this.carveRightDone ? ' ✓' : ''}</span>`;
    this.hintEl.innerHTML = t('tutorial.s2.hint', { left: leftChip, right: rightChip });
  }

  private setStep4Hint(mode: 'default' | 'hold' | 'faster'): void {
    if (!this.hintEl) return;
    const isTouch = this.isTouchView();
    const sig = `s4:${mode}:${isTouch ? 1 : 0}`;
    if (sig === this.lastHintSignature) return;
    this.lastHintSignature = sig;
    const key =
      mode === 'hold'
        ? 'tutorial.s4.hintHold'
        : mode === 'faster'
          ? 'tutorial.s4.hintFaster'
          : isTouch
            ? 'tutorial.s4.hintTouch'
            : 'tutorial.s4.hint';
    this.hintEl.textContent = t(key);
  }

  private renderCelebration(): void {
    this.metronomeEl?.classList.add('hidden');
    this.cardEl?.classList.remove('is-step-done');
    this.cardEl?.classList.add('is-celebrating');
    if (this.doneBadgeEl) {
      this.doneBadgeEl.textContent = '✓ 5/5';
      this.doneBadgeEl.classList.remove('hidden');
    }
    if (this.stepCountEl) {
      this.stepCountEl.textContent = t('tutorial.stepCounter', {
        step: TOTAL_STEPS,
        total: TOTAL_STEPS,
      });
    }
    this.dotEls.forEach((dot) => {
      dot.classList.remove('active');
      dot.classList.add('done');
    });
    if (this.skipBtn) {
      this.skipBtn.textContent = t('tutorial.skip');
    }
    if (this.promptEl) {
      this.promptEl.textContent = t('tutorial.completeTitle');
    }
    if (this.hintEl) {
      this.hintEl.textContent = t('tutorial.completeHint');
    }
    this.setProgressBar(100);
  }

  private render(): void {
    if (this.isCelebrating) {
      this.renderCelebration();
      return;
    }

    const step = this.stepIndex;
    const isTouch = this.isTouchView();
    const ctrlMode = this.options.getControlMode?.() ?? 'arrows';

    this.cardEl?.classList.remove('is-step-done', 'is-celebrating');
    this.doneBadgeEl?.classList.add('hidden');

    if (this.stepCountEl) {
      this.stepCountEl.textContent = t('tutorial.stepCounter', {
        step: step + 1,
        total: TOTAL_STEPS,
      });
    }
    this.dotEls.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === step);
      dot.classList.toggle('done', idx < step);
    });
    if (this.skipBtn) {
      this.skipBtn.textContent = t('tutorial.skip');
    }

    if (!this.promptEl || !this.hintEl) return;

    this.metronomeEl?.classList.toggle('hidden', step !== 2);

    if (step === 0) {
      const pushKey = ctrlMode === 'wasd' ? this.kbd('W') : this.kbd('↑');
      this.promptEl.innerHTML = isTouch
        ? t('tutorial.s1.promptTouch', { pill: this.pill('▲ PUMP') })
        : t('tutorial.s1.promptDesktop', { key: pushKey });
      this.hintEl.textContent = t('tutorial.s1.hint');
      this.setProgressBar(0);
    } else if (step === 1) {
      const carveKeys =
        ctrlMode === 'wasd'
          ? `${this.kbd('A')} ${this.kbd('D')}`
          : `${this.kbd('←')} ${this.kbd('→')}`;
      this.promptEl.innerHTML = isTouch
        ? t('tutorial.s2.promptTouch', { keys: `${this.pill('◀')} ${this.pill('▶ CARVE')}` })
        : t('tutorial.s2.promptDesktop', { keys: carveKeys });
      this.lastHintSignature = '';
      this.updateStep2Hint();
      this.setProgressBar(0);
    } else if (step === 2) {
      const carveKeys =
        ctrlMode === 'wasd' ? `${this.kbd('A')} ${this.kbd('D')}` : `${this.kbd('←')} ${this.kbd('→')}`;
      const pumpKeys = `${carveKeys} / ${this.kbd('Shift')}`;
      this.promptEl.innerHTML = isTouch
        ? t('tutorial.s3.promptTouch', {
            compress: this.pill('COMPRESS'),
            carve: this.pill('◀ ↔ ▶'),
          })
        : t('tutorial.s3.promptDesktop', { keys: pumpKeys });
      this.hintEl.textContent = isTouch
        ? t('tutorial.s3.hintTouch')
        : t('tutorial.s3.hintDesktop');
      this.setProgressBar(0);
    } else if (step === 3) {
      this.promptEl.innerHTML = isTouch
        ? t('tutorial.s4.promptTouch', { pill: this.pill('TRICK') })
        : t('tutorial.s4.promptDesktop', { keys: this.kbd('C') });
      this.lastHintSignature = '';
      this.setStep4Hint('default');
      this.setProgressBar(0);
    } else {
      this.promptEl.innerHTML = isTouch
        ? t('tutorial.s5.promptTouch', { pill: this.pill('OLLIE') })
        : t('tutorial.s5.promptDesktop', { key: this.kbd('Space') });
      this.hintEl.textContent = t('tutorial.s5.hint');
      this.setProgressBar(15);
    }
  }
}
