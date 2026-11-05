import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Api, Lesson, ResourceItem } from './api';
import { PdfViewer } from './pdf-viewer';
import { NotesControls } from './notes-controls';

/** Links and PDFs an admin attached to a lesson; students only ever see the list. */
@Component({
  selector: 'app-lesson-resources',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [PdfViewer, NotesControls],
  template: `
    <div class="lr">
      @if (isAdmin()) {
        <form class="lr-form" (submit)="$event.preventDefault(); mode() === 'pdf' ? upload() : add()">
          <div class="seg lr-mode" role="group" aria-label="Resource type">
            <button type="button" [class.on]="mode() === 'link'" [attr.aria-pressed]="mode() === 'link'" (click)="setMode('link')">Link</button>
            <button type="button" [class.on]="mode() === 'pdf'" [attr.aria-pressed]="mode() === 'pdf'" (click)="setMode('pdf')">PDF</button>
          </div>
          <input
            type="text"
            placeholder="Title (e.g. Slides)"
            aria-label="Resource title"
            maxlength="120"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
          />
          @if (mode() === 'link') {
            <input
              type="url"
              placeholder="https://..."
              aria-label="Resource link"
              maxlength="800"
              [value]="url()"
              (input)="url.set($any($event.target).value)"
            />
          } @else {
            <input #fileInput type="file" accept="application/pdf,.pdf" aria-label="PDF file" (change)="pick($event)" />
          }
          <input
            type="text"
            placeholder="Optional note"
            aria-label="Resource note"
            maxlength="300"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
          />
          <button class="p" type="submit" [disabled]="saving()">
            {{ saving() ? (mode() === 'pdf' ? 'Uploading...' : 'Adding...') : (mode() === 'pdf' ? 'Upload PDF' : 'Add resource') }}
          </button>
        </form>
      }

      @if (error()) { <p class="lr-error" role="alert">{{ error() }}</p> }

      @if (state() === 'loading') {
        <p class="lr-muted">Loading resources...</p>
      } @else if (state() === 'error') {
        <p class="lr-muted">Could not load resources. <button type="button" class="lr-link" (click)="reload()">Retry</button></p>
      } @else if (!rows().length) {
        <p class="lr-muted">No resources for this lesson yet.</p>
      } @else {
        <ul class="lr-list">
          @for (r of rows(); track r.id) {
            <li class="lr-item">
              <span class="lr-icon" aria-hidden="true">
                @if (r.kind === 'pdf') {
                  <svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /><path d="M9.5 12.5h5M9.5 16h5" /></svg>
                } @else {
                  <svg viewBox="0 0 24 24"><path d="M9.5 14.5 14.5 9.5" /><path d="M11 7l1.8-1.8a4 4 0 0 1 5.6 5.6L16.6 12.6" /><path d="M13 17l-1.8 1.8a4 4 0 0 1-5.6-5.6L7.4 11.4" /></svg>
                }
              </span>
              <div class="lr-body">
                @if (r.kind === 'pdf') {
                  <button type="button" class="lr-title lr-open" (click)="open(r)">{{ r.title }}</button>
                  <span class="lr-host">PDF</span>
                } @else {
                  <a class="lr-title" [href]="r.url" target="_blank" rel="noopener noreferrer">{{ r.title }}</a>
                  <span class="lr-host">{{ host(r.url) }}</span>
                }
                @if (r.note) { <p class="lr-note">{{ r.note }}</p> }
              </div>
              @if (isAdmin()) {
                <button type="button" class="lr-del" aria-label="Delete resource" title="Delete resource" (click)="remove(r)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                </button>
              }
            </li>
          }
        </ul>
      }

      @if (opened(); as r) {
        @defer (on immediate) {
          <div class="lr-viewer" role="dialog" aria-modal="true" [attr.aria-label]="r.title">
            <header class="lr-viewer-top">
              <span class="lr-viewer-title">{{ r.title }}</span>
              @if (pdfViewer(); as pv) { <app-notes-controls [viewer]="pv" /> }
              <button #closeBtn type="button" class="lr-viewer-close" aria-label="Close PDF" (click)="close()">Close</button>
            </header>
            <app-pdf-viewer [key]="r.url" [fullWindow]="false" />
          </div>
        } @placeholder {
          <div class="lr-viewer lr-viewer-loading" aria-live="polite">Loading PDF...</div>
        } @error {
          <div class="lr-viewer lr-viewer-loading" role="alert">
            Could not load the PDF. <button type="button" class="lr-link" (click)="close()">Close</button>
          </div>
        }
      }
    </div>
  `,
})
export class LessonResources {
  private readonly api = inject(Api);
  readonly lesson = input.required<Lesson>();
  readonly count = output<number>();

  protected readonly rows = signal<ResourceItem[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly title = signal('');
  protected readonly url = signal('');
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly isAdmin = computed(() => this.api.me()?.is_admin === 1);
  protected readonly mode = signal<'link' | 'pdf'>('link');
  protected readonly file = signal<File | null>(null);
  protected readonly opened = signal<ResourceItem | null>(null);
  /** The viewer inside the modal, so its header can render the shared notes controls. */
  protected readonly pdfViewer = viewChild(PdfViewer);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private readonly destroyRef = inject(DestroyRef);
  private lastFocus: HTMLElement | null = null;
  private currentId = '';
  private seq = 0;

  constructor() {
    effect(() => {
      const lesson = this.lesson();
      if (lesson.id === this.currentId) return; // progress toggles hand over a new object
      this.currentId = lesson.id;
      untracked(() => {
        this.title.set('');
        this.url.set('');
        this.note.set('');
        this.file.set(null);
        this.mode.set('link');
        this.error.set('');
        this.opened.set(null);
        document.body.style.overflow = '';
        const input = this.fileInput()?.nativeElement;
        if (input) input.value = '';
        void this.load(lesson.id);
      });
    });

    // Focus the close button when the deferred modal has rendered.
    effect(() => {
      if (this.opened() && this.closeBtn()) this.closeBtn()!.nativeElement.focus();
    });

    // Escape closes the modal; the viewer's own Escape handler only acts when expanded.
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.opened()) { e.preventDefault(); e.stopPropagation(); this.close(); }
    };
    document.addEventListener('keydown', esc);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    });
  }

  protected host(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  protected reload(): void { void this.load(this.lesson().id); }

  protected setMode(mode: 'link' | 'pdf'): void {
    this.mode.set(mode);
    this.error.set('');
  }

  protected pick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.file.set(file);
    if (file && !this.title().trim()) this.title.set(file.name.replace(/\.pdf$/i, '').slice(0, 120));
  }

  protected open(r: ResourceItem): void {
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.opened.set(r);
    document.body.style.overflow = 'hidden';
  }

  protected close(): void {
    this.opened.set(null);
    document.body.style.overflow = '';
    this.lastFocus?.focus();
    this.lastFocus = null;
  }

  protected async load(key = this.lesson().id): Promise<void> {
    const seq = ++this.seq;
    this.state.set('loading');
    try {
      const r = await this.api.resources(key);
      if (seq !== this.seq || key !== this.lesson().id) return;
      this.rows.set(r.resources);
      this.state.set('ready');
      this.count.emit(r.resources.length);
    } catch {
      if (seq !== this.seq || key !== this.lesson().id) return;
      this.state.set('error');
    }
  }

  protected async add(): Promise<void> {
    if (this.saving()) return;
    this.error.set('');
    this.saving.set(true);
    try {
      await this.api.addResource(this.lesson().id, {
        title: this.title().trim(),
        url: this.url().trim(),
        note: this.note().trim() || undefined,
      });
      this.title.set('');
      this.url.set('');
      this.note.set('');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not add that resource.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async upload(): Promise<void> {
    if (this.saving()) return;
    const file = this.file();
    this.error.set('');
    if (!file) { this.error.set('Choose a PDF file.'); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { this.error.set('Choose a PDF file.'); return; }
    if (file.size > 25 * 1024 * 1024) { this.error.set('PDFs must be 25 MB or smaller.'); return; }
    this.saving.set(true);
    try {
      await this.api.uploadResourcePdf(this.lesson().id, file, this.title().trim() || undefined, this.note().trim() || undefined);
      this.title.set('');
      this.note.set('');
      this.file.set(null);
      const input = this.fileInput()?.nativeElement;
      if (input) input.value = '';
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not upload that PDF.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(r: ResourceItem): Promise<void> {
    if (!confirm(`Remove “${r.title}” from this lesson?`)) return;
    try {
      await this.api.deleteResource(r.id);
      await this.load();
    } catch {
      this.error.set('Could not remove that resource.');
    }
  }
}
