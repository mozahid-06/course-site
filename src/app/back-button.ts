import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavHistory } from './nav-history';

/**
 * The single Back control for the lesson bar (shared by video, YouTube and PDF).
 * It only ever moves through the app's own history — never between lessons — and
 * greys out at the start of that history. On phones only the arrow is shown.
 */
@Component({
  selector: 'app-back-button',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'back-btn-wrap' },
  template: `
    <button type="button" class="back-btn" aria-label="Back" title="Back"
      [disabled]="!nav.canBack()" (click)="nav.back()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
      <span class="lbl">Back</span>
    </button>
  `,
})
export class BackButton {
  protected readonly nav = inject(NavHistory);
}
