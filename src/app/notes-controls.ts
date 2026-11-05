import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PdfViewer } from './pdf-viewer';

/**
 * The PDF notes controls (status, full window, hide/show, delete), shared by the
 * lesson bar and the resource-PDF modal so both screens show exactly the same UI.
 * The parent owns the `PdfViewer` (as a `viewChild`) and passes it in; the viewer
 * itself no longer draws any chrome.
 */
@Component({
  selector: 'app-notes-controls',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="notes-controls">
      @if (viewer().status(); as s) { <span class="notes-status" aria-live="polite">{{ s }}</span> }
      @if (viewer().fullWindow()) {
        <button type="button" class="notes-btn" (click)="viewer().toggleExpanded()"
          [attr.aria-label]="viewer().expanded() ? 'Exit full window' : 'Full window'"
          [title]="viewer().expanded() ? 'Exit full window' : 'Full window'">
          @if (viewer().expanded()) {
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5" /></svg>
          } @else {
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" /></svg>
          }
          <span class="lbl">{{ viewer().expanded() ? 'Exit full window' : 'Full window' }}</span>
        </button>
      }
      <button type="button" class="notes-btn" (click)="viewer().toggleHidden()" [disabled]="!viewer().ready()"
        [attr.aria-label]="viewer().hidden() ? 'Show my notes' : 'Hide my notes'"
        [title]="viewer().hidden() ? 'Show my notes' : 'Hide my notes'">
        @if (viewer().hidden()) {
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        } @else {
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
            <circle cx="12" cy="12" r="2.6" />
            <path d="M3.5 3.5l17 17" />
          </svg>
        }
        <span class="lbl">{{ viewer().hidden() ? 'Show my notes' : 'Hide my notes' }}</span>
      </button>
      <button type="button" class="notes-btn reset" (click)="viewer().reset()" [disabled]="!viewer().ready()"
        aria-label="Delete my notes" title="Delete my notes">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16" />
          <path d="M9 7V4.5h6V7" />
          <path d="M6.5 7l.9 12.5h9.2L17.5 7" />
          <path d="M10 10.5v6M14 10.5v6" />
        </svg>
        <span class="lbl">Delete notes</span>
      </button>
    </div>
  `,
})
export class NotesControls {
  readonly viewer = input.required<PdfViewer>();
}
