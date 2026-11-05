import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { AnnotationEditorLayerRenderedEvent, NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService, pdfDefaultOptions } from 'ngx-extended-pdf-viewer';
import { Api } from './api';

// Open fast: stream the file, fetch only the pages being viewed, in larger chunks
// (default is 64 KB range requests with streaming off, which means many slow round trips).
pdfDefaultOptions.disableStream = false;
pdfDefaultOptions.disableAutoFetch = true;
pdfDefaultOptions.rangeChunkSize = 1024 * 1024;

/** Warm the browser cache with the viewer + worker scripts so the first PDF opens without waiting on them. */
let prefetched = false;
export function prefetchPdfAssets(): void {
  if (prefetched) return;
  prefetched = true;
  const worker = pdfDefaultOptions.workerSrc();
  for (const href of [worker, worker.replace('pdf.worker', 'viewer')]) {
    const l = document.createElement('link');
    l.rel = 'prefetch';
    l.as = 'script';
    l.href = href;
    document.head.appendChild(l);
  }
}

type Note = Parameters<NgxExtendedPdfViewerService['addEditorAnnotation']>[0];

@Component({
  selector: 'app-pdf-viewer',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [NgxExtendedPdfViewerModule],
  host: { '[class.expanded]': 'expanded()' },
  template: `
    <div class="notes-bar">
      <span class="notes-hint">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        </svg>
        <span class="notes-hint-txt">{{ narrow() ? 'Private to you' : 'Your notes are private. Only you can see them.' }}</span>
      </span>
      <span class="notes-status">{{ status() }}</span>
      @if (fullWindow()) {
        <button type="button" class="notes-btn" (click)="toggleExpanded()"
          [attr.aria-label]="expanded() ? 'Exit full window' : 'Full window'"
          [title]="expanded() ? 'Exit full window' : 'Full window'">
          @if (expanded()) {
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5" /></svg>
          } @else {
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" /></svg>
          }
          <span class="lbl">{{ expanded() ? 'Exit full window' : 'Full window' }}</span>
        </button>
      }
      <button type="button" class="notes-btn" (click)="toggleHidden()" [disabled]="!ready()"
        [attr.aria-label]="hidden() ? 'Show my notes' : 'Hide my notes'"
        [title]="hidden() ? 'Show my notes' : 'Hide my notes'">
        @if (hidden()) {
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
        <span class="lbl">{{ hidden() ? 'Show my notes' : 'Hide my notes' }}</span>
      </button>
      <button type="button" class="notes-btn reset" (click)="reset()" [disabled]="!ready()"
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
    <div class="viewer-wrap">
      <ngx-extended-pdf-viewer
        [src]="url()"
        [theme]="theme"
        [zoom]="narrow() ? 'page-width' : 'page-fit'"
        [showBorders]="!narrow()"
        [showToolbar]="true"
        [showSidebarButton]="true"
        [showFindButton]="true"
        [showPagingButtons]="true"
        [showZoomButtons]="true"
        [showPresentationModeButton]="true"
        [showSecondaryToolbarButton]="true"
        [showRotateButton]="true"
        [showHandToolButton]="true"
        [showScrollingButtons]="true"
        [showSpreadButton]="true"
        [showPropertiesButton]="true"
        [showEditorButtons]="true"
        [showTextEditor]="true"
        [showDrawEditor]="true"
        [showHighlightEditor]="true"
        [showStampEditor]="true"
        [showEraserEditor]="true"
        [showUndoRedoButtons]="true"
        [showCommentEditor]="false"
        [showSignatureEditor]="false"
        [supportsDownloading]="false"
        [showDownloadButton]="false"
        [disableDownloadButton]="true"
        [showPrintButton]="false"
        [enablePrint]="false"
        [showOpenFileButton]="false"
        [enableDragAndDrop]="false"
        [contextMenuAllowed]="false"
        (pagesLoaded)="onLoaded()"
        (annotationEditorLayerRendered)="onEditorLayer($event)"
        (annotationEditorEvent)="onEdit()"
      ></ngx-extended-pdf-viewer>
    </div>
  `,
})
export class PdfViewer {
  private readonly api = inject(Api);
  private readonly pdf = inject(NgxExtendedPdfViewerService);
  protected readonly theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  // Phones and small tablets: a portrait page must fill the width, so page-fit (which fits the
  // whole page into the short viewport) is replaced by page-width and the page borders are dropped.
  private readonly narrowQuery = matchMedia('(max-width: 820px)');
  protected readonly narrow = signal(this.narrowQuery.matches);
  readonly key = input.required<string>();
  readonly fullWindow = input(true);
  protected readonly url = computed(() => this.api.mediaUrl(this.key()));
  protected readonly expanded = signal(false); // fills the browser window (not the whole screen)
  protected readonly hidden = signal(false);
  protected readonly ready = signal(false);
  protected readonly status = signal('');
  private saved: object[] = []; // every note stored on the server for this PDF
  private applying = false; // true while we add/remove notes ourselves, so those events are not saved
  private loadedKey = ''; // the key whose notes are loaded; a new key resets all note state
  private notesReady = false;
  private readonly renderedPages = new Set<number>(); // pages whose annotation editor layer exists
  private readonly appliedPages = new Set<number>(); // pages whose stored notes have been added
  private readonly applyingPages = new Set<number>(); // pages being restored right now
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Downloading must never work: block the save and print shortcuts (the buttons are already off).
    const block = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key?.toLowerCase())) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.expanded()) this.toggleExpanded(); };
    const onNarrow = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    window.addEventListener('keydown', block, true);
    window.addEventListener('keydown', esc);
    this.narrowQuery.addEventListener('change', onNarrow);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('keydown', block, true);
      window.removeEventListener('keydown', esc);
      this.narrowQuery.removeEventListener('change', onNarrow);
      if (this.timer) { clearTimeout(this.timer); void this.save(); }
    });
  }

  protected toggleExpanded(): void {
    this.expanded.update((v) => !v);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50); // let the PDF re-fit to the new size
  }

  private current(): object[] {
    return (this.pdf.getSerializedAnnotations() ?? []).map((a) => {
      const c = { ...(a as object) } as Record<string, unknown>;
      delete c['id']; // temporary id, not needed
      return c;
    });
  }

  private async apply(notes: object[]): Promise<void> {
    this.applying = true;
    try { for (const n of notes) await this.pdf.addEditorAnnotation(n as Note); }
    finally { setTimeout(() => (this.applying = false), 400); }
  }

  private clear(): void {
    this.applying = true;
    this.pdf.removeEditorAnnotations(() => true);
    setTimeout(() => (this.applying = false), 400);
  }

  protected async onLoaded(): Promise<void> {
    const key = this.key();
    if (this.loadedKey === key) return;
    // A different PDF: drop everything that belonged to the previous document, including any
    // debounced save (the view is recreated per lesson id, so the old instance already flushed).
    clearTimeout(this.timer);
    this.timer = undefined;
    this.loadedKey = key;
    this.saved = [];
    this.notesReady = false;
    this.renderedPages.clear();
    this.appliedPages.clear();
    this.applyingPages.clear();
    this.hidden.set(false);
    this.status.set('');
    try {
      this.saved = (await this.api.getNotes(key)).data ?? [];
    } catch {
      if (key === this.key()) this.status.set('Could not load your notes');
    }
    if (key !== this.key()) return;
    this.notesReady = true;
    this.ready.set(true);
    await this.applyRendered();
  }

  // The editor layer is created per page, after that page has rendered. Waiting for
  // `pagesLoaded` is not enough: `addEditorAnnotation` silently skips notes whose page has no
  // editor layer yet, so each page's notes are applied when its own layer appears (and pages
  // farther down the document are restored when the reader scrolls to them).
  protected onEditorLayer(event: AnnotationEditorLayerRenderedEvent): void {
    const page = event.pageNumber - 1;
    this.renderedPages.add(page);
    if (this.notesReady) void this.applyPage(page);
  }

  private async applyRendered(): Promise<void> {
    for (const page of [...this.renderedPages]) await this.applyPage(page);
  }

  private async applyPage(page: number): Promise<void> {
    if (!this.notesReady || this.hidden()) return;
    if (this.appliedPages.has(page) || this.applyingPages.has(page)) return;
    const notes = this.saved.filter((n) => ((n as { pageIndex?: number }).pageIndex ?? 0) === page);
    if (!notes.length) { this.appliedPages.add(page); return; }
    this.applyingPages.add(page);
    try {
      await this.apply(notes);
      this.appliedPages.add(page);
    } catch {
      // Leave it unapplied: save() keeps the note in the payload rather than dropping it.
    } finally {
      this.applyingPages.delete(page);
    }
  }

  /**
   * What to send to the server. Saved notes for pages that have not rendered yet are not in
   * `current()` (PDF.js held no editor layer for them), so they are added back here. Without
   * this, any edit would delete notes on pages the reader had not scrolled to.
   */
  private payload(): object[] {
    const notes = this.current();
    const pending = this.saved.filter((n) => {
      const page = (n as { pageIndex?: number }).pageIndex ?? 0;
      return !this.appliedPages.has(page) && !this.applyingPages.has(page);
    });
    return pending.length ? [...notes, ...pending] : notes;
  }

  protected onEdit(): void {
    if (this.applying || this.hidden() || !this.ready()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 1200);
  }

  private async save(): Promise<void> {
    this.timer = undefined;
    if (this.loadedKey !== this.key()) return;
    let notes: object[];
    try { notes = this.payload(); } catch { return; }
    if (JSON.stringify(notes) === JSON.stringify(this.saved)) return;
    this.status.set('Saving…');
    try { await this.api.saveNotes(this.key(), notes); this.saved = notes; this.status.set('Saved'); }
    catch (e) { this.status.set((e as Error).message || 'Could not save'); }
  }

  protected async toggleHidden(): Promise<void> {
    if (!this.hidden()) {
      await this.save(); // keep whatever was just written
      this.hidden.set(true);
      this.clear();
    } else {
      const extra = this.current(); // anything written while the notes were hidden
      this.clear();
      this.saved = [...this.saved, ...extra];
      this.appliedPages.clear();
      this.applyingPages.clear();
      this.hidden.set(false);
      await this.applyRendered();
      await this.save();
    }
  }

  protected async reset(): Promise<void> {
    if (!confirm('Delete all your notes on this PDF and go back to the original?')) return;
    clearTimeout(this.timer);
    try {
      await this.api.clearNotes(this.key());
      this.clear();
      this.saved = [];
      this.appliedPages.clear();
      this.applyingPages.clear();
      this.hidden.set(false);
      this.status.set('Back to the original');
    } catch (e) { this.status.set((e as Error).message || 'Could not reset'); }
  }
}
