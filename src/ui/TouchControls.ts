import { InputState } from '../physics/SurfskateController';

export interface TouchControlsOptions {
  frameElement: HTMLElement;
  onPause?: () => void;
  onVibrate?: (ms: number) => void;
}

export class TouchControls {
  private container: HTMLDivElement;
  private joystickZone: HTMLDivElement;
  private joystickBase: HTMLDivElement;
  private joystickStick: HTMLDivElement;

  private actionsZone: HTMLDivElement;
  private ollieBtn: HTMLButtonElement;
  private snapBtn: HTMLButtonElement;
  private slideBtn: HTMLButtonElement;
  private laybackBtn: HTMLButtonElement;
  private revBtn: HTMLButtonElement;

  public isEnabled = false;
  public isVisible = false;

  private activeJoystickPointerId: number | null = null;
  private joystickOrigin = { x: 0, y: 0 };
  private readonly maxRadius = 46;

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
      <!-- Left zone: Analog Carve & Pump Joystick -->
      <div id="touch-joystick-zone" class="touch-zone">
        <div id="touch-joystick-base">
          <div class="joystick-axis-marker h"></div>
          <div class="joystick-axis-marker v"></div>
          <div id="touch-joystick-stick">
            <div class="stick-core"></div>
          </div>
        </div>
        <div class="touch-zone-label">CARVE &amp; PUMP</div>
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

    this.joystickZone = this.container.querySelector('#touch-joystick-zone')!;
    this.joystickBase = this.container.querySelector('#touch-joystick-base')!;
    this.joystickStick = this.container.querySelector('#touch-joystick-stick')!;

    this.actionsZone = this.container.querySelector('#touch-actions-zone')!;
    this.ollieBtn = this.container.querySelector('#touch-btn-ollie')!;
    this.snapBtn = this.container.querySelector('#touch-btn-snap')!;
    this.slideBtn = this.container.querySelector('#touch-btn-slide')!;
    this.laybackBtn = this.container.querySelector('#touch-btn-layback')!;
    this.revBtn = this.container.querySelector('#touch-btn-rev')!;

    this.bindEvents();

    // Auto-enable if touch device detected or URL override ?touch=1
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

    this.activeJoystickPointerId = null;
    this.joystickStick.style.transform = 'translate3d(0px, 0px, 0px)';
    this.joystickBase.classList.remove('active');
  }

  private triggerHaptic(ms = 15): void {
    if (this.options.onVibrate) {
      this.options.onVibrate(ms);
    } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (_) {}
    }
  }

  private bindEvents(): void {
    // -------------------------------------------------------------------------
    // 1. Virtual Joystick (Left Thumb)
    // -------------------------------------------------------------------------
    const handleJoystickDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.activeJoystickPointerId = e.pointerId;
      this.joystickZone.setPointerCapture?.(e.pointerId);

      const rect = this.joystickBase.getBoundingClientRect();
      this.joystickOrigin = {
        x: rect.left + rect.width * 0.5,
        y: rect.top + rect.height * 0.5,
      };

      this.joystickBase.classList.add('active');
      this.processJoystickMove(e.clientX, e.clientY);
    };

    const handleJoystickMove = (e: PointerEvent) => {
      if (this.activeJoystickPointerId !== e.pointerId) return;
      e.preventDefault();
      this.processJoystickMove(e.clientX, e.clientY);
    };

    const handleJoystickUp = (e: PointerEvent) => {
      if (this.activeJoystickPointerId !== e.pointerId) return;
      e.preventDefault();
      try {
        this.joystickZone.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      this.activeJoystickPointerId = null;
      this.state.steerLeft = false;
      this.state.steerRight = false;
      this.state.forwardPush = false;
      this.state.compressCrouch = false;
      this.state.analogSteer = 0;

      this.joystickStick.style.transform = 'translate3d(0px, 0px, 0px)';
      this.joystickBase.classList.remove('active');
    };

    this.joystickZone.addEventListener('pointerdown', handleJoystickDown, { passive: false });
    this.joystickZone.addEventListener('pointermove', handleJoystickMove, { passive: false });
    this.joystickZone.addEventListener('pointerup', handleJoystickUp, { passive: false });
    this.joystickZone.addEventListener('pointercancel', handleJoystickUp, { passive: false });

    // -------------------------------------------------------------------------
    // 2. Primary Ollie / Indy Button (Right Thumb)
    // -------------------------------------------------------------------------
    const bindButton = (
      btn: HTMLButtonElement,
      onDown: () => void,
      onUp: () => void,
      hapticMs = 15
    ) => {
      let activePointerId: number | null = null;

      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        activePointerId = e.pointerId;
        btn.classList.add('active');
        btn.setPointerCapture?.(e.pointerId);
        onDown();
        this.triggerHaptic(hapticMs);
      };

      const up = (e: PointerEvent) => {
        if (activePointerId !== e.pointerId) return;
        e.preventDefault();
        try {
          btn.releasePointerCapture?.(e.pointerId);
        } catch (_) {}
        activePointerId = null;
        btn.classList.remove('active');
        onUp();
      };

      btn.addEventListener('pointerdown', down, { passive: false });
      btn.addEventListener('pointerup', up, { passive: false });
      btn.addEventListener('pointercancel', up, { passive: false });
    };

    bindButton(
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

    bindButton(
      this.snapBtn,
      () => {
        this.state.snapTrick = true;
      },
      () => {
        this.state.snapTrick = false;
      },
      18
    );

    bindButton(
      this.slideBtn,
      () => {
        this.state.snapSlide = true;
      },
      () => {
        this.state.snapSlide = false;
      },
      18
    );

    bindButton(
      this.laybackBtn,
      () => {
        this.state.laybackTrick = true;
      },
      () => {
        this.state.laybackTrick = false;
      },
      18
    );

    bindButton(
      this.revBtn,
      () => {
        this.state.reverseTrick = true;
      },
      () => {
        this.state.reverseTrick = false;
      },
      18
    );
  }

  private processJoystickMove(clientX: number, clientY: number): void {
    const rawDx = clientX - this.joystickOrigin.x;
    const rawDy = clientY - this.joystickOrigin.y;
    const dist = Math.hypot(rawDx, rawDy);

    const clampedDist = Math.min(this.maxRadius, dist);
    const angle = Math.atan2(rawDy, rawDx);

    const stickX = Math.cos(angle) * clampedDist;
    const stickY = Math.sin(angle) * clampedDist;

    this.joystickStick.style.transform = `translate3d(${stickX.toFixed(1)}px, ${stickY.toFixed(1)}px, 0px)`;

    const normX = stickX / this.maxRadius; // -1 (left) .. +1 (right)
    const normY = stickY / this.maxRadius; // -1 (up/push) .. +1 (down/crouch)

    // Smooth continuous analog steering with deadzone
    if (Math.abs(normX) > 0.12) {
      this.state.analogSteer = normX;
      this.state.steerLeft = normX < -0.18;
      this.state.steerRight = normX > 0.18;
    } else {
      this.state.analogSteer = 0;
      this.state.steerLeft = false;
      this.state.steerRight = false;
    }

    // Vertical push / crouch
    this.state.forwardPush = normY < -0.32;
    this.state.compressCrouch = normY > 0.32;
  }
}
