import { InputState } from '../physics/SurfskateController';

export interface TouchControlsOptions {
  frameElement: HTMLElement;
  onPause?: () => void;
  onVibrate?: (ms: number) => void;
}

export class TouchControls {
  private container: HTMLDivElement;
  private carveZone: HTMLDivElement;
  private carveRocker: HTMLDivElement;
  private paddleLeft: HTMLButtonElement;
  private paddleRight: HTMLButtonElement;
  private pushBtn: HTMLButtonElement;
  private crouchBtn: HTMLButtonElement;

  private actionsZone: HTMLDivElement;
  private ollieBtn: HTMLButtonElement;
  private snapBtn: HTMLButtonElement;
  private slideBtn: HTMLButtonElement;
  private laybackBtn: HTMLButtonElement;
  private revBtn: HTMLButtonElement;

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
      <!-- Left zone: Ergonomic Dual-Paddle Carve Rocker & Push/Crouch Cluster -->
      <div id="touch-carve-zone" class="touch-zone">
        <button id="touch-btn-push" class="touch-aux-pill touch-push-pill" type="button" title="Push Off / Forward Pump">
          <span>▲ PUSH</span>
        </button>

        <div id="touch-carve-rocker" class="touch-carve-rocker" role="group" aria-label="Steering & Carve Pump">
          <button id="touch-btn-left" class="touch-carve-paddle paddle-left" type="button" title="Carve Left">
            <span class="paddle-arrow">◄</span>
            <span class="paddle-label">LEFT</span>
          </button>
          <div class="rocker-divider"></div>
          <button id="touch-btn-right" class="touch-carve-paddle paddle-right" type="button" title="Carve Right">
            <span class="paddle-label">RIGHT</span>
            <span class="paddle-arrow">►</span>
          </button>
        </div>

        <button id="touch-btn-crouch" class="touch-aux-pill touch-crouch-pill" type="button" title="Crouch / Bowl Compression">
          <span>▼ CROUCH</span>
        </button>
        <div class="touch-zone-label">CARVE &amp; PUMP · SLIDE ↓ CROUCH</div>
      </div>

      <!-- Right zone: Action & Trick Cluster -->
      <div id="touch-actions-zone" class="touch-zone">
        <!-- Compact 4-Trick Arc -->
        <div class="touch-tricks-cluster">
          <button id="touch-btn-snap" class="touch-trick-btn" type="button" title="Top-turn Snap">
            <span>SNAP</span>
          </button>
          <button id="touch-btn-layback" class="touch-trick-btn" type="button" title="Layback Carve">
            <span>LAYBACK</span>
          </button>
          <button id="touch-btn-slide" class="touch-trick-btn" type="button" title="Bertslide">
            <span>SLIDE</span>
          </button>
          <button id="touch-btn-rev" class="touch-trick-btn" type="button" title="Reverse 360">
            <span>360</span>
          </button>
        </div>

        <!-- Large Primary Action Button: Ollie & Air Grab -->
        <button id="touch-btn-ollie" class="touch-action-primary" type="button" title="Ollie / Indy Grab in air">
          <span class="ollie-main">OLLIE</span>
          <span class="ollie-sub">HOLD: INDY</span>
        </button>
      </div>
    `;

    this.options.frameElement.appendChild(this.container);

    this.carveZone = this.container.querySelector('#touch-carve-zone')!;
    this.carveRocker = this.container.querySelector('#touch-carve-rocker')!;
    this.paddleLeft = this.container.querySelector('#touch-btn-left')!;
    this.paddleRight = this.container.querySelector('#touch-btn-right')!;
    this.pushBtn = this.container.querySelector('#touch-btn-push')!;
    this.crouchBtn = this.container.querySelector('#touch-btn-crouch')!;

    this.actionsZone = this.container.querySelector('#touch-actions-zone')!;
    this.ollieBtn = this.container.querySelector('#touch-btn-ollie')!;
    this.snapBtn = this.container.querySelector('#touch-btn-snap')!;
    this.slideBtn = this.container.querySelector('#touch-btn-slide')!;
    this.laybackBtn = this.container.querySelector('#touch-btn-layback')!;
    this.revBtn = this.container.querySelector('#touch-btn-rev')!;

    this.bindEvents();

    const shouldEnable = TouchControls.isTouchDevice();
    this.setEnabled(shouldEnable);
  }

  public static isTouchDevice(): boolean {
    return (
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      window.location.search.includes('touch=1')
    );
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
    this.carveRocker.classList.remove('crouching');
    this.paddleLeft.classList.remove('active');
    this.paddleRight.classList.remove('active');
    this.pushBtn.classList.remove('active');
    this.crouchBtn.classList.remove('active');
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
    // 1. Dual-Paddle Carve Rocker (Left Thumb)
    // Supports:
    // - Direct tapping Left / Right
    // - Continuous sliding left / right across the rocker to carve & pump
    // - Sliding DOWN from the left/right buttons to compress/crouch
    // -------------------------------------------------------------------------
    const updateRockerPointer = (clientX: number, clientY: number) => {
      const rect = this.carveRocker.getBoundingClientRect();
      const midX = rect.left + rect.width * 0.5;
      const deadzone = rect.width * 0.05;

      // Horizontal carve steering
      if (clientX < midX - deadzone) {
        this.setSteerDirection(-1);
      } else if (clientX > midX + deadzone) {
        this.setSteerDirection(1);
      }

      // Vertical slide detection:
      // When sliding down toward/past the bottom edge of the rocker into the crouch area,
      // engage crouch/compression.
      // Disengage with hysteresis when thumb moves back up toward center.
      const crouchEngageY = rect.top + rect.height * 0.78;
      const crouchDisengageY = rect.top + rect.height * 0.58;

      if (!this.isRockerCrouching && clientY > crouchEngageY) {
        this.setCrouchFromRocker(true);
      } else if (this.isRockerCrouching && clientY < crouchDisengageY) {
        this.setCrouchFromRocker(false);
      }
    };

    const handleRockerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.activeRockerPointerId = e.pointerId;
      try {
        this.carveRocker.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      updateRockerPointer(e.clientX, e.clientY);
    };

    const handleRockerMove = (e: PointerEvent) => {
      if (this.activeRockerPointerId !== e.pointerId) return;
      e.preventDefault();
      updateRockerPointer(e.clientX, e.clientY);
    };

    const handleRockerUp = (e: PointerEvent) => {
      if (this.activeRockerPointerId !== e.pointerId) return;
      e.preventDefault();
      try {
        this.carveRocker.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      this.activeRockerPointerId = null;
      this.setSteerDirection(0);
      this.setCrouchFromRocker(false);
    };

    this.carveRocker.addEventListener('pointerdown', handleRockerDown, { passive: false });
    this.carveRocker.addEventListener('pointermove', handleRockerMove, { passive: false });
    this.carveRocker.addEventListener('pointerup', handleRockerUp, { passive: false });
    this.carveRocker.addEventListener('pointercancel', handleRockerUp, { passive: false });

    // -------------------------------------------------------------------------
    // 2. Push & Crouch Aux Buttons (separated vertically, no slipping)
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
      this.pushBtn,
      () => {
        this.state.forwardPush = true;
      },
      () => {
        this.state.forwardPush = false;
      },
      16
    );

    // Dedicated crouch button also supports carving if sliding left/right while held
    const handleCrouchDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.activeCrouchPointerId = e.pointerId;
      try {
        this.crouchBtn.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      this.isButtonCrouching = true;
      this.updateCrouchState();
      this.triggerHaptic(14);

      const rect = this.carveRocker.getBoundingClientRect();
      const midX = rect.left + rect.width * 0.5;
      const deadzone = rect.width * 0.08;
      if (e.clientX < midX - deadzone) {
        this.setSteerDirection(-1);
      } else if (e.clientX > midX + deadzone) {
        this.setSteerDirection(1);
      }
    };

    const handleCrouchMove = (e: PointerEvent) => {
      if (this.activeCrouchPointerId !== e.pointerId) return;
      e.preventDefault();
      const rect = this.carveRocker.getBoundingClientRect();
      const midX = rect.left + rect.width * 0.5;
      const deadzone = rect.width * 0.08;
      if (e.clientX < midX - deadzone) {
        this.setSteerDirection(-1);
      } else if (e.clientX > midX + deadzone) {
        this.setSteerDirection(1);
      } else {
        this.setSteerDirection(0);
      }
    };

    const handleCrouchUp = (e: PointerEvent) => {
      if (this.activeCrouchPointerId !== e.pointerId) return;
      e.preventDefault();
      try {
        this.crouchBtn.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      this.activeCrouchPointerId = null;
      this.isButtonCrouching = false;
      this.updateCrouchState();
      if (this.activeRockerPointerId === null) {
        this.setSteerDirection(0);
      }
    };

    this.crouchBtn.addEventListener('pointerdown', handleCrouchDown, { passive: false });
    this.crouchBtn.addEventListener('pointermove', handleCrouchMove, { passive: false });
    this.crouchBtn.addEventListener('pointerup', handleCrouchUp, { passive: false });
    this.crouchBtn.addEventListener('pointercancel', handleCrouchUp, { passive: false });

    // -------------------------------------------------------------------------
    // 3. Primary Ollie / Indy Button & Trick Cluster (Right Thumb)
    // -------------------------------------------------------------------------
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

    bindPressButton(
      this.snapBtn,
      () => {
        this.state.snapTrick = true;
      },
      () => {
        this.state.snapTrick = false;
      },
      16
    );

    bindPressButton(
      this.slideBtn,
      () => {
        this.state.snapSlide = true;
      },
      () => {
        this.state.snapSlide = false;
      },
      16
    );

    bindPressButton(
      this.laybackBtn,
      () => {
        this.state.laybackTrick = true;
      },
      () => {
        this.state.laybackTrick = false;
      },
      16
    );

    bindPressButton(
      this.revBtn,
      () => {
        this.state.reverseTrick = true;
      },
      () => {
        this.state.reverseTrick = false;
      },
      16
    );
  }
}
