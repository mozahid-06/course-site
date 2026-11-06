import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavHistory } from './nav-history';

/**
 * The browser-style back/forward pair. The same control is reused by the desktop
 * header, the phone header and the lesson bar.
 */
@Component({
  selector: 'app-nav-buttons',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'nav-btns' },
  template: `
    <button type="button" class="icon-btn" aria-label="Back" title="Back"
      [disabled]="!nav.canBack()" (click)="nav.back()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
    </button>
    <button type="button" class="icon-btn" aria-label="Forward" title="Forward"
      [disabled]="!nav.canForward()" (click)="nav.forward()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </button>
  `,
})
export class NavButtons {
  protected readonly nav = inject(NavHistory);
}
