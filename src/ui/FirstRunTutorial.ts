import { t } from '../i18n/i18n';

export const TUTORIAL_SEEN_STORAGE_KEY = 'surfsk8.tutorialSeen.v1';

export type TutorialControlMode = 'arrows' | 'wasd';

export interface FirstRunTutorialOptions {
  getControlMode?: () => TutorialControlMode;
  onToggleControlMode?: () => void;
  isTouchDevice?: () => boolean;
  onOpen?: () => void;
  onClose?: (completed: boolean) => void;
}

const TOTAL_STEPS = 4;

/**
 * Interactive 4-step First-Run Tutorial modal controller (#tutorial-modal).
 * Automatically adapts copy to Desktop (Arrows / WASD) vs Touch controls and
 * persists completion under `surfsk8.tutorialSeen.v1`.
 */
export class FirstRunTutorial {
  private modalEl: HTMLElement | null;
  private closeXBtn: HTMLButtonElement | null;
  private modeDesktopBtn: HTMLButtonElement | null;
  private modeTouchBtn: HTMLButtonElement | null;
  private ctrlToggleBtn: HTMLButtonElement | null;
  private stepTitleEl: HTMLElement | null;
  private stepSubtitleEl: HTMLElement | null;
  private progressFillEl: HTMLElement | null;
  private bodyEl: HTMLElement | null;
  private skipBtn: HTMLButtonElement | null;
  private prevBtn: HTMLButtonElement | null;
  private nextBtn: HTMLButtonElement | null;
  private stepCountEl: HTMLElement | null;
  private dotBtns: HTMLButtonElement[] = [];

  private stepIndex = 0;
  private isTouchView = false;

  constructor(private options: FirstRunTutorialOptions = {}) {
    this.modalEl = document.getElementById('tutorial-modal');
    this.closeXBtn = document.getElementById('tutorial-close-x') as HTMLButtonElement | null;
    this.modeDesktopBtn = document.getElementById('tutorial-mode-desktop') as HTMLButtonElement | null;
    this.modeTouchBtn = document.getElementById('tutorial-mode-touch') as HTMLButtonElement | null;
    this.ctrlToggleBtn = document.getElementById('tutorial-ctrl-toggle') as HTMLButtonElement | null;
    this.stepTitleEl = document.getElementById('tutorial-step-title');
    this.stepSubtitleEl = document.getElementById('tutorial-step-subtitle');
    this.progressFillEl = document.getElementById('tutorial-progress-fill');
    this.bodyEl = document.getElementById('tutorial-body');
    this.skipBtn = document.getElementById('tutorial-skip-btn') as HTMLButtonElement | null;
    this.prevBtn = document.getElementById('tutorial-prev-btn') as HTMLButtonElement | null;
    this.nextBtn = document.getElementById('tutorial-next-btn') as HTMLButtonElement | null;
    this.stepCountEl = document.getElementById('tutorial-step-count');

    const dotsContainer = document.getElementById('tutorial-dots');
    if (dotsContainer) {
      this.dotBtns = Array.from(dotsContainer.querySelectorAll<HTMLButtonElement>('.tut-dot'));
    }

    this.bindEvents();
  }

  private bindEvents(): void {
    this.closeXBtn?.addEventListener('click', () => this.close(false));
    this.skipBtn?.addEventListener('click', () => this.close(false));
    this.prevBtn?.addEventListener('click', () => this.prevStep());
    this.nextBtn?.addEventListener('click', () => this.nextStep());

    this.modeDesktopBtn?.addEventListener('click', () => {
      this.isTouchView = false;
      this.renderStep();
    });
    this.modeTouchBtn?.addEventListener('click', () => {
      this.isTouchView = true;
      this.renderStep();
    });
    this.ctrlToggleBtn?.addEventListener('click', () => {
      this.options.onToggleControlMode?.();
      this.renderStep();
    });

    this.dotBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => this.goToStep(idx));
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
    return Boolean(this.modalEl && !this.modalEl.classList.contains('hidden'));
  }

  private detectTouchMode(): boolean {
    const coarse =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    return coarse || Boolean(this.options.isTouchDevice?.());
  }

  public open(): void {
    if (!this.modalEl) return;
    this.isTouchView = this.detectTouchMode();
    this.stepIndex = 0;
    this.renderStep();
    this.modalEl.classList.remove('hidden');
    this.options.onOpen?.();
    window.setTimeout(() => {
      this.nextBtn?.focus({ preventScroll: true });
    }, 20);
  }

  public close(completed: boolean): void {
    if (!this.modalEl || !this.isOpen()) return;
    this.markSeen();
    this.modalEl.classList.add('hidden');
    this.options.onClose?.(completed);
  }

  public goToStep(index: number): void {
    const clamped = Math.max(0, Math.min(TOTAL_STEPS - 1, index));
    if (clamped === this.stepIndex) return;
    this.stepIndex = clamped;
    this.renderStep();
  }

  public prevStep(): void {
    if (this.stepIndex > 0) {
      this.stepIndex -= 1;
      this.renderStep();
    }
  }

  public nextStep(): void {
    if (this.stepIndex < TOTAL_STEPS - 1) {
      this.stepIndex += 1;
      this.renderStep();
    } else {
      this.close(true);
    }
  }

  public refresh(): void {
    if (this.isOpen()) {
      this.renderStep();
    }
  }

  public handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.isOpen()) return false;
    const code = e.code;
    if (code === 'Escape') {
      this.close(false);
      return true;
    }
    if (code === 'ArrowRight' || code === 'Enter' || code === 'NumpadEnter') {
      this.nextStep();
      return true;
    }
    if (code === 'ArrowLeft') {
      this.prevStep();
      return true;
    }
    return false;
  }

  private kbd(label: string): string {
    return `<kbd class="tut-kbd">${label}</kbd>`;
  }

  private touchPill(label: string, accent = false): string {
    return `<span class="tut-touch-pill${accent ? ' is-accent' : ''}">${label}</span>`;
  }

  private getDesktopKeys(): {
    push: string;
    carve: string;
    brake: string;
    compress: string;
    ollie: string;
    indy: string;
    snap: string;
    bert: string;
    layback: string;
    reverse: string;
    modeLabel: string;
  } {
    const mode = this.options.getControlMode?.() ?? 'arrows';
    if (mode === 'wasd') {
      return {
        push: this.kbd('W'),
        carve: `${this.kbd('A')} ${this.kbd('D')}`,
        brake: this.kbd('S'),
        compress: `${this.kbd('Shift')} / ${this.kbd('S')}`,
        ollie: this.kbd('Space'),
        indy: `${this.kbd('Space')} <span class="tut-or">/</span> ${this.kbd('I')}`,
        snap: `${this.kbd('O')} <span class="tut-or">/</span> ${this.kbd('F')}`,
        bert: `${this.kbd('K')} <span class="tut-or">/</span> ${this.kbd('V')}`,
        layback: `${this.kbd('P')} <span class="tut-or">/</span> ${this.kbd('G')}`,
        reverse: `${this.kbd('L')} <span class="tut-or">/</span> ${this.kbd('B')}`,
        modeLabel: 'WASD',
      };
    }
    return {
      push: this.kbd('↑'),
      carve: `${this.kbd('←')} ${this.kbd('→')}`,
      brake: this.kbd('↓'),
      compress: `${this.kbd('Shift')} / ${this.kbd('↓')}`,
      ollie: this.kbd('Space'),
      indy: `${this.kbd('Space')} <span class="tut-or">/</span> ${this.kbd('I')}`,
      snap: `${this.kbd('Q')} <span class="tut-or">/</span> ${this.kbd('F')}`,
      bert: `${this.kbd('A')} <span class="tut-or">/</span> ${this.kbd('V')}`,
      layback: `${this.kbd('W')} <span class="tut-or">/</span> ${this.kbd('G')}`,
      reverse: `${this.kbd('S')} <span class="tut-or">/</span> ${this.kbd('B')}`,
      modeLabel: 'ARROWS',
    };
  }

  private renderStep(): void {
    const step = this.stepIndex;
    const keys = this.getDesktopKeys();

    // Device & control mode pills
    this.modeDesktopBtn?.classList.toggle('active', !this.isTouchView);
    this.modeTouchBtn?.classList.toggle('active', this.isTouchView);
    if (this.ctrlToggleBtn) {
      this.ctrlToggleBtn.classList.toggle('hidden', this.isTouchView);
      this.ctrlToggleBtn.textContent = `${keys.modeLabel} ⇄`;
    }

    // Progress bar & footer controls
    if (this.progressFillEl) {
      this.progressFillEl.style.width = `${((step + 1) / TOTAL_STEPS) * 100}%`;
    }
    if (this.stepCountEl) {
      this.stepCountEl.textContent = t('tutorial.stepCounter', { step: step + 1, total: TOTAL_STEPS });
    }
    this.dotBtns.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === step);
      dot.classList.toggle('done', idx < step);
      dot.setAttribute('aria-current', idx === step ? 'step' : 'false');
    });

    if (this.prevBtn) {
      this.prevBtn.disabled = step === 0;
      this.prevBtn.textContent = `← ${t('tutorial.back')}`;
    }
    if (this.skipBtn) {
      this.skipBtn.textContent = t('tutorial.skip');
    }
    if (this.nextBtn) {
      const isLast = step === TOTAL_STEPS - 1;
      this.nextBtn.textContent = isLast ? `⚡ ${t('tutorial.finish')}` : `${t('tutorial.next')} →`;
      this.nextBtn.classList.toggle('is-finish', isLast);
    }

    if (!this.bodyEl || !this.stepTitleEl || !this.stepSubtitleEl) return;

    if (step === 0) {
      this.stepTitleEl.textContent = t('tutorial.s1.title');
      this.stepSubtitleEl.textContent = t('tutorial.s1.subtitle');
      const pushControl = this.isTouchView ? this.touchPill('▲ PUMP', true) : keys.push;
      const carveControl = this.isTouchView ? this.touchPill('◀ / ▶ CARVE') : keys.carve;
      const brakeControl = this.isTouchView ? this.touchPill('▼ BRAKE') : keys.brake;

      this.bodyEl.innerHTML = `
        <div class="tut-cards-grid tut-cards-3">
          <div class="tut-card">
            <div class="tut-card-head">
              <span class="tut-card-icon">🦶</span>
              <span class="tut-card-title">${t('tutorial.s1.pushTitle')}</span>
            </div>
            <div class="tut-control-row">${pushControl}</div>
            <p class="tut-card-desc">${t('tutorial.s1.pushDesc')}</p>
          </div>
          <div class="tut-card">
            <div class="tut-card-head">
              <span class="tut-card-icon">🌊</span>
              <span class="tut-card-title">${t('tutorial.s1.carveTitle')}</span>
            </div>
            <div class="tut-control-row">${carveControl}</div>
            <p class="tut-card-desc">${t('tutorial.s1.carveDesc')}</p>
          </div>
          <div class="tut-card">
            <div class="tut-card-head">
              <span class="tut-card-icon">🛑</span>
              <span class="tut-card-title">${t('tutorial.s1.brakeTitle')}</span>
            </div>
            <div class="tut-control-row">${brakeControl}</div>
            <p class="tut-card-desc">${t('tutorial.s1.brakeDesc')}</p>
          </div>
        </div>
        <div class="tut-callout">${t('tutorial.s1.tip')}</div>
      `;
    } else if (step === 1) {
      this.stepTitleEl.textContent = t('tutorial.s2.title');
      this.stepSubtitleEl.textContent = t('tutorial.s2.subtitle');
      const flatControl = this.isTouchView ? this.touchPill('◀ ↔ ▶ CARVE') : keys.carve;
      const wallControl = this.isTouchView ? this.touchPill('COMPRESS', true) : keys.compress;

      this.bodyEl.innerHTML = `
        <div class="tut-cards-grid tut-cards-2">
          <div class="tut-card">
            <div class="tut-card-head">
              <span class="tut-card-icon">〰️</span>
              <span class="tut-card-title">${t('tutorial.s2.flatTitle')}</span>
            </div>
            <div class="tut-control-row">${flatControl}</div>
            <p class="tut-card-desc">${t('tutorial.s2.flatDesc')}</p>
          </div>
          <div class="tut-card">
            <div class="tut-card-head">
              <span class="tut-card-icon">🥣</span>
              <span class="tut-card-title">${t('tutorial.s2.wallTitle')}</span>
            </div>
            <div class="tut-control-row">${wallControl}</div>
            <p class="tut-card-desc">${t('tutorial.s2.wallDesc')}</p>
          </div>
        </div>
        <div class="tut-callout tut-callout-flow">
          <div class="tut-callout-title">${t('tutorial.s2.flowTitle')}</div>
          <p class="tut-card-desc">${t('tutorial.s2.flowDesc')}</p>
        </div>
      `;
    } else if (step === 2) {
      this.stepTitleEl.textContent = t('tutorial.s3.title');
      this.stepSubtitleEl.textContent = t('tutorial.s3.subtitle');

      const trickBtn = this.touchPill('TRICK', true);
      const snapControl = this.isTouchView ? trickBtn : keys.snap;
      const bertControl = this.isTouchView ? `${this.touchPill('◀ / ▶')} + ${trickBtn}` : keys.bert;
      const laybackControl = this.isTouchView ? `${this.touchPill('◀ CARVE')} + ${trickBtn}` : keys.layback;
      const revControl = this.isTouchView ? `${this.touchPill('◀ / ▶')} + ${trickBtn}` : keys.reverse;

      const mobileNoteHtml = this.isTouchView
        ? `<div class="tut-callout tut-callout-compact">${t('tutorial.s3.mobileNote')}</div>`
        : '';

      this.bodyEl.innerHTML = `
        ${mobileNoteHtml}
        <div class="tut-cards-grid tut-cards-2">
          <div class="tut-card tut-trick-card">
            <div class="tut-trick-top">
              <span class="tut-card-title">💦 ${t('tutorial.s3.snapName')}</span>
              <span class="tut-trick-key">${snapControl}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s3.snapWhat')}</p>
            <div class="tut-when-row"><span class="tut-when-label">${t('tutorial.s3.whenLabel')}</span> ${t('tutorial.s3.snapWhen')}</div>
          </div>
          <div class="tut-card tut-trick-card">
            <div class="tut-trick-top">
              <span class="tut-card-title">🖐️ ${t('tutorial.s3.bertName')}</span>
              <span class="tut-trick-key">${bertControl}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s3.bertWhat')}</p>
            <div class="tut-when-row"><span class="tut-when-label">${t('tutorial.s3.whenLabel')}</span> ${t('tutorial.s3.bertWhen')}</div>
          </div>
          <div class="tut-card tut-trick-card">
            <div class="tut-trick-top">
              <span class="tut-card-title">🤙 ${t('tutorial.s3.laybackName')}</span>
              <span class="tut-trick-key">${laybackControl}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s3.laybackWhat')}</p>
            <div class="tut-when-row"><span class="tut-when-label">${t('tutorial.s3.whenLabel')}</span> ${t('tutorial.s3.laybackWhen')}</div>
          </div>
          <div class="tut-card tut-trick-card">
            <div class="tut-trick-top">
              <span class="tut-card-title">🌀 ${t('tutorial.s3.revName')}</span>
              <span class="tut-trick-key">${revControl}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s3.revWhat')}</p>
            <div class="tut-when-row"><span class="tut-when-label">${t('tutorial.s3.whenLabel')}</span> ${t('tutorial.s3.revWhen')}</div>
          </div>
        </div>
      `;
    } else {
      this.stepTitleEl.textContent = t('tutorial.s4.title');
      this.stepSubtitleEl.textContent = t('tutorial.s4.subtitle');
      const ollieControl = this.isTouchView ? this.touchPill('OLLIE', true) : keys.ollie;
      const indyControl = this.isTouchView ? this.touchPill('HOLD OLLIE', true) : keys.indy;

      this.bodyEl.innerHTML = `
        <div class="tut-cards-grid tut-cards-2">
          <div class="tut-card">
            <div class="tut-trick-top">
              <span class="tut-card-title">🚀 ${t('tutorial.s4.ollieTitle')}</span>
              <span class="tut-trick-key">${ollieControl}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s4.ollieDesc')}</p>
          </div>
          <div class="tut-card">
            <div class="tut-trick-top">
              <span class="tut-card-title">🦅 ${t('tutorial.s4.indyTitle')}</span>
              <span class="tut-trick-key">${indyControl}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s4.indyDesc')}</p>
          </div>
          <div class="tut-card">
            <div class="tut-card-head">
              <span class="tut-card-icon">⚡</span>
              <span class="tut-card-title">${t('tutorial.s4.comboTitle')}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s4.comboDesc')}</p>
          </div>
          <div class="tut-card tut-card-goals">
            <div class="tut-card-head">
              <span class="tut-card-icon">🥨</span>
              <span class="tut-card-title">${t('tutorial.s4.goalsTitle')}</span>
            </div>
            <p class="tut-card-desc">${t('tutorial.s4.goalsDesc')}</p>
          </div>
        </div>
      `;
    }

    this.bodyEl.scrollTop = 0;
  }
}
