import { InputState } from '../physics/SurfskateController';

export interface TouchControlsOptions {
  frameElement: HTMLElement;
  onPause?: () => void;
  onVibrate?: (ms: number) => void;
  getSlideTricksEligibility?: () => { canBert: boolean; canLayback: boolean };
  getSurfTricksEligibility?: () => {
    canSnap: boolean;
    canBert: boolean;
    canLayback: boolean;
    canReverse: boolean;
  };
}

export class TouchControls {
  private container: HTMLDivElement;
  private carveZone: HTMLDivElement;
  private carveRocker: HTMLDivElement;
  private paddleLeft: HTMLButtonElement;
  private paddleRight: HTMLButtonElement;
  private pushBtn: HTMLButtonElement;
  private brakeBtn: HTMLButtonElement;
  private crouchBtn: HTMLButtonElement;

  private actionsZone: HTMLDivElement;
  private trickBtn: HTMLButtonElement;
  private ollieBtn: HTMLButtonElement;

  public isEnabled = false;
  public isVisible = false;

  private activeRockerPointerId: number | null = null;
  private activeCrouchPointerId: number | null = null;
  private currentSteerDir: -1 | 0 | 1 = 0;
  private isRockerCrouching = false;
  private isButtonCrouching = false;

  private state: InputState = {
    steerLeft: false,
    steerRight: false,
    forwardPush: false,
    compressCrouch: false,
    jumpOllie: false,
    grindSlash: false,
    snapTrick: false,
    laybackTrick: false,
    snapSlide: false,
    reverseTrick: false,
    indyGrabTrick: false,
    analogSteer: 0,
  };

  constructor(private options: TouchControlsOptions) {
    this.container = document.createElement('div');
    this.container.id = 'touch-controls-layer';
    this.container.className = 'touch-controls-hidden';

    // Build the DOM
    this.container.innerHTML = `
      <!-- Left zone: Ergonomic 4-Way Carve & Pump Steuerkreuz (#touch-left) -->
      <div id="touch-carve-zone" class="touch-zone touch-left" data-alias="touch-left">
        <button id="touch-btn-push" class="touch-aux-pill touch-push-pill touch-pump-btn" type="button" title="Push Off / Forward Pump (▲ PUMP)">
          <span>▲ PUMP</span>
        </button>

        <div id="touch-carve-rocker" class="touch-carve-rocker" role="group" aria-label="Steering & Carve Pump">
          <button id="touch-btn-left" class="touch-carve-paddle paddle-left touch-left-btn" type="button" title="Carve Left (◀ CARVE)">
            <span class="paddle-arrow">◀</span>
            <span class="paddle-label">CARVE</span>
          </button>
          <div class="rocker-divider"></div>
          <button id="touch-btn-right" class="touch-carve-paddle paddle-right touch-right-btn" type="button" title="Carve Right (▶ CARVE)">
            <span class="paddle-label">CARVE</span>
            <span class="paddle-arrow">▶</span>
          </button>
        </div>

        <button id="touch-btn-brake" class="touch-aux-pill touch-brake-pill touch-brake-btn" type="button" title="Brake / Slow Down / Compress (▼ BRAKE)">
          <span>▼ BRAKE</span>
        </button>

        <div class="touch-zone-label">CARVE &amp; PUMP</div>
      </div>

      <!-- Right zone: Action & Trick Cluster (#touch-right) -->
      <div id="touch-actions-zone" class="touch-zone touch-right" data-alias="touch-right">
        <!-- Ergonomic 2-Button Cluster: TRICK (SURF / 360) and OLLIE (AIR / GRAB) -->
        <div class="touch-tricks-cluster">
          <button id="touch-btn-trick" class="touch-trick-btn touch-surf-trick-btn touch-trick" type="button" title="Surf Trick (Snap, Bert Slide, Layback, Reverse 360)">
            <span class="trick-main">TRICK</span>
            <span class="trick-sub">SURF / 360</span>
          </button>
          <button id="touch-btn-ollie" class="touch-trick-btn touch-ollie-btn touch-ollie" type="button" title="Ollie / Hold for Indy Grab">
            <span class="trick-main">OLLIE</span>
            <span class="trick-sub">AIR / GRAB</span>
          </button>
        </div>

        <!-- Large Primary Action Button: Compress / Bowl Pump -->
        <button id="touch-btn-crouch" class="touch-action-primary touch-compress-primary touch-compress" type="button" title="Compress / Crouch / Bowl Pump">
          <span class="primary-main">COMPRESS</span>
          <span class="primary-sub">CROUCH &amp; PUMP</span>
        </button>
      </div>
    `;

    this.options.frameElement.appendChild(this.container);

    this.carveZone = this.container.querySelector('#touch-carve-zone')!;
    this.carveRocker = this.container.querySelector('#touch-carve-rocker')!;
    this.paddleLeft = this.container.querySelector('#touch-btn-left')!;
    this.paddleRight = this.container.querySelector('#touch-btn-right')!;
    this.pushBtn = this.container.querySelector('#touch-btn-push')!;
    this.brakeBtn = this.container.querySelector('#touch-btn-brake')!;

    this.actionsZone = this.container.querySelector('#touch-actions-zone')!;
    this.crouchBtn = this.container.querySelector('#touch-btn-crouch')!;
    this.trickBtn = this.container.querySelector('#touch-btn-trick')!;
    this.ollieBtn = this.container.querySelector('#touch-btn-ollie')!;

    this.bindEvents();

    const shouldEnable = TouchControls.isTouchDevice();
    this.setEnabled(shouldEnable);
    if (shouldEnable && typeof document !== 'undefined') {
      document.body.classList.add('has-touch-controls');
    }
  }

  public static isTouchDevice(): boolean {
    return (
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      (typeof window !== 'undefined' && window.innerWidth <= 960) ||
      window.location.search.includes('touch=1')
    );
  }

  public isTouchActive(): boolean {
    return this.isEnabled || TouchControls.isTouchDevice();
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.updateVisibility();
  }

  public toggleEnabled(): boolean {
    this.setEnabled(!this.isEnabled);
    return this.isEnabled;
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.updateVisibility();
    if (!visible) {
      this.resetState();
    }
  }

  private updateVisibility(): void {
    const show = this.isEnabled && this.isVisible;
    this.container.classList.toggle('touch-controls-visible', show);
    this.container.classList.toggle('touch-controls-hidden', !show);
  }

  public getState(): InputState {
    return { ...this.state };
  }

  public resetState(): void {
    this.state.steerLeft = false;
    this.state.steerRight = false;
    this.state.forwardPush = false;
    this.state.compressCrouch = false;
    this.state.jumpOllie = false;
    this.state.grindSlash = false;
    this.state.snapTrick = false;
    this.state.laybackTrick = false;
    this.state.snapSlide = false;
    this.state.reverseTrick = false;
    this.state.indyGrabTrick = false;
    this.state.analogSteer = 0;

    this.activeRockerPointerId = null;
    this.activeCrouchPointerId = null;
    this.currentSteerDir = 0;
    this.isRockerCrouching = false;
    this.isButtonCrouching = false;
    this.carveRocker?.classList.remove('crouching');
    this.paddleLeft?.classList.remove('active');
    this.paddleRight?.classList.remove('active');
    this.pushBtn?.classList.remove('active');
    this.brakeBtn?.classList.remove('active');
    this.crouchBtn?.classList.remove('active');
    this.trickBtn?.classList.remove('active');
    this.ollieBtn?.classList.remove('active');
  }

  private triggerHaptic(ms = 12): void {
    if (this.options.onVibrate) {
      this.options.onVibrate(ms);
    } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (_) {}
    }
  }

  private setSteerDirection(dir: -1 | 0 | 1): void {
    if (this.currentSteerDir === dir) return;

    this.currentSteerDir = dir;
    this.state.steerLeft = dir === -1;
    this.state.steerRight = dir === 1;
    this.state.analogSteer = dir;

    this.paddleLeft.classList.toggle('active', dir === -1);
    this.paddleRight.classList.toggle('active', dir === 1);

    if (dir !== 0) {
      this.triggerHaptic(12);
    }
  }

  private setCrouchFromRocker(active: boolean): void {
    if (this.isRockerCrouching === active) return;
    this.isRockerCrouching = active;
    this.updateCrouchState();
    this.brakeBtn?.classList.toggle('active', active);
    if (active) {
      this.triggerHaptic(14);
    }
  }

  private updateCrouchState(): void {
    const isCrouching = this.isRockerCrouching || this.isButtonCrouching;
    this.state.compressCrouch = isCrouching;
    this.crouchBtn.classList.toggle('active', isCrouching);
    this.carveRocker.classList.toggle('crouching', this.isRockerCrouching);
  }

  private bindEvents(): void {
    // -------------------------------------------------------------------------
    // 1. Unified Left Steuerkreuz Tracking (#touch-left / #touch-carve-zone)
    // Supports:
    // - Direct tapping Left / Right paddles, ▲ PUMP, or ▼ BRAKE
    // - Continuous sliding horizontally across center to carve & pump
    // - Continuous sliding vertically to engage ▲ PUMP (up) or ▼ BRAKE (down)
    // - Generous hit-slop so frantic left/right carving never drops input
    // -------------------------------------------------------------------------
    const updateZonePointer = (clientX: number, clientY: number) => {
      const rockerRect = this.carveRocker.getBoundingClientRect();
      const midX = rockerRect.left + rockerRect.width * 0.5;
      const deadzone = rockerRect.width * 0.04;

      // 1. Horizontal Steer Tracking (generous hit-slop / slide support):
      const deltaX = clientX - midX;
      if (deltaX < -deadzone) {
        this.setSteerDirection(-1);
      } else if (deltaX > deadzone) {
        this.setSteerDirection(1);
      } else {
        this.setSteerDirection(0);
      }

      // Smooth analog steer [-1.0 .. 1.0]
      const halfWidth = rockerRect.width * 0.45;
      this.state.analogSteer = Math.max(-1, Math.min(1, deltaX / Math.max(1, halfWidth)));

      // 2. Vertical Slide & Hit-Slop (▲ PUMP on top, ▼ BRAKE on bottom):
      const pumpThreshold = rockerRect.top - 2;
      const brakeThreshold = rockerRect.bottom + 2;

      if (clientY < pumpThreshold) {
        // Upper region: ▲ PUMP active
        if (!this.state.forwardPush) {
          this.state.forwardPush = true;
          this.pushBtn.classList.add('active');
          this.triggerHaptic(16);
        }
        if (this.isRockerCrouching) {
          this.setCrouchFromRocker(false);
          this.brakeBtn?.classList.remove('active');
        }
      } else if (clientY > brakeThreshold) {
        // Lower region: ▼ BRAKE active
        if (this.state.forwardPush) {
          this.state.forwardPush = false;
          this.pushBtn.classList.remove('active');
        }
        if (!this.isRockerCrouching) {
          this.setCrouchFromRocker(true);
          this.brakeBtn?.classList.add('active');
        }
      } else {
        // Middle rocker region: Carving only (neither pump nor brake active)
        if (this.state.forwardPush) {
          this.state.forwardPush = false;
          this.pushBtn.classList.remove('active');
        }
        if (this.isRockerCrouching) {
          this.setCrouchFromRocker(false);
          this.brakeBtn?.classList.remove('active');
        }
      }
    };

    const handleZonePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.activeRockerPointerId = e.pointerId;
      try {
        this.carveZone.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      updateZonePointer(e.clientX, e.clientY);
    };

    const handleZonePointerMove = (e: PointerEvent) => {
      if (this.activeRockerPointerId !== e.pointerId) return;
      e.preventDefault();
      updateZonePointer(e.clientX, e.clientY);
    };

    const handleZonePointerUp = (e: PointerEvent) => {
      if (this.activeRockerPointerId !== e.pointerId) return;
      e.preventDefault();
      try {
        this.carveZone.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      this.activeRockerPointerId = null;
      this.setSteerDirection(0);
      this.state.forwardPush = false;
      this.pushBtn.classList.remove('active');
      this.setCrouchFromRocker(false);
      this.brakeBtn?.classList.remove('active');
    };

    this.carveZone.addEventListener('pointerdown', handleZonePointerDown, { passive: false });
    this.carveZone.addEventListener('pointermove', handleZonePointerMove, { passive: false });
    this.carveZone.addEventListener('pointerup', handleZonePointerUp, { passive: false });
    this.carveZone.addEventListener('pointercancel', handleZonePointerUp, { passive: false });

    // -------------------------------------------------------------------------
    // 2. Action & Trick Cluster (Right Thumb): TRICK, OLLIE, COMPRESS
    // -------------------------------------------------------------------------
    const bindPressButton = (
      btn: HTMLButtonElement,
      onDown: () => void,
      onUp: () => void,
      hapticMs = 15
    ) => {
      let pointerId: number | null = null;

      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        pointerId = e.pointerId;
        btn.classList.add('active');
        try {
          btn.setPointerCapture?.(e.pointerId);
        } catch (_) {}
        onDown();
        this.triggerHaptic(hapticMs);
      };

      const up = (e: PointerEvent) => {
        if (pointerId !== e.pointerId) return;
        e.preventDefault();
        try {
          btn.releasePointerCapture?.(e.pointerId);
        } catch (_) {}
        pointerId = null;
        btn.classList.remove('active');
        onUp();
      };

      btn.addEventListener('pointerdown', down, { passive: false });
      btn.addEventListener('pointerup', up, { passive: false });
      btn.addEventListener('pointercancel', up, { passive: false });
    };
    bindPressButton(
      this.ollieBtn,
      () => {
        this.state.jumpOllie = true;
      },
      () => {
        this.state.jumpOllie = false;
        this.state.indyGrabTrick = false;
      },
      22
    );

    // Multi-Surf-Trick Button (Snap, Bert Slide, Layback, Reverse 360):
    // Queries the physics engine for currently eligible tricks and picks one.
    // If multiple are eligible at this moment, picks randomly among them.
    // If none are eligible yet (e.g. player is still building speed or mid-carve before threshold),
    // picks randomly between 'bert' and 'layback' so holding the button as the carve deepens still triggers a slide/layback!
    let activeSurfTrick: ('snap' | 'bert' | 'layback' | 'reverse') | null = null;

    bindPressButton(
      this.trickBtn,
      () => {
        const eligible: ('snap' | 'bert' | 'layback' | 'reverse')[] = [];

        if (this.options.getSurfTricksEligibility) {
          const el = this.options.getSurfTricksEligibility();
          if (el.canSnap) eligible.push('snap');
          if (el.canBert) eligible.push('bert');
          if (el.canLayback) eligible.push('layback');
          if (el.canReverse) eligible.push('reverse');
        } else if (this.options.getSlideTricksEligibility) {
          const el = this.options.getSlideTricksEligibility();
          if (el.canBert) eligible.push('bert');
          if (el.canLayback) eligible.push('layback');
        }

        if (eligible.length > 0) {
          activeSurfTrick = eligible[Math.floor(Math.random() * eligible.length)];
        } else {
          // If eligible list is empty (e.g. player building speed or mid-carve before threshold),
          // pick randomly between 'bert' and 'layback' so holding the button as the carve deepens still triggers a slide/layback!
          activeSurfTrick = Math.random() < 0.5 ? 'bert' : 'layback';
        }

        this.state.snapTrick = activeSurfTrick === 'snap';
        this.state.snapSlide = activeSurfTrick === 'bert';
        this.state.laybackTrick = activeSurfTrick === 'layback';
        this.state.reverseTrick = activeSurfTrick === 'reverse';
      },
      () => {
        activeSurfTrick = null;
        this.state.snapTrick = false;
        this.state.snapSlide = false;
        this.state.laybackTrick = false;
        this.state.reverseTrick = false;
      },
      18
    );

    // Compress / Crouch Button on the Right:
    bindPressButton(
      this.crouchBtn,
      () => {
        this.isButtonCrouching = true;
        this.updateCrouchState();
      },
      () => {
        this.isButtonCrouching = false;
        this.updateCrouchState();
      },
      14
    );
  }
}
