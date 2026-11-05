import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Api, YoutubeLesson } from './api';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Admin panel → YouTube: add, edit and delete YouTube lessons. Nothing is uploaded. */
@Component({
  selector: 'app-admin-youtube',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <section class="files" aria-label="YouTube lessons">
      <div class="adm-card">
        <div class="adm-form">
          <label class="field">
            <span>Course</span>
            <input
              list="yt-courses"
              placeholder="Physics (pick one or type a new name)"
              [value]="course()"
              (input)="course.set($any($event.target).value)"
            />
            <datalist id="yt-courses">
              @for (c of courses(); track c) {
                <option [value]="c"></option>
              }
            </datalist>
          </label>
          <label class="field">
            <span>Folder <em>· optional; use / to nest</em></span>
            <input placeholder="Week 1" [value]="folder()" (input)="folder.set($any($event.target).value)" />
          </label>
          <label class="field">
            <span>Lesson name</span>
            <input placeholder="Welcome" [value]="lesson()" (input)="lesson.set($any($event.target).value)" />
          </label>
          <label class="field">
            <span>YouTube link</span>
            <input
              placeholder="https://youtu.be/... or the video id"
              [value]="link()"
              (input)="link.set($any($event.target).value)"
            />
          </label>

          @if (editing()) {
            <p class="adm-muted sm">Editing <b>{{ editing() }}</b>. Change the link, or Cancel.</p>
          }
          @if (error()) {
            <p class="adm-muted" role="status">{{ error() }}</p>
          } @else if (notice()) {
            <p class="adm-muted sm" role="status">{{ notice() }}</p>
          }

          <div class="adm-dialog-foot">
            @if (editing()) {
              <button type="button" (click)="reset()">Cancel</button>
            }
            <button type="button" class="p" [disabled]="busy()" (click)="save()">
              {{ busy() ? 'Saving...' : editing() ? 'Save changes' : 'Add lesson' }}
            </button>
          </div>
        </div>
      </div>

      <div class="adm-card">
        @if (loading()) {
          <p class="adm-empty">Loading...</p>
        } @else if (!lessons().length) {
          <p class="adm-empty">No YouTube lessons yet. Add one above.</p>
        } @else {
          <ul class="yt-list">
            @for (l of lessons(); track l.id) {
              <li class="yt-row">
                <div class="yt-path">
                  <b>{{ l.course }}{{ l.folder ? ' / ' + l.folder : '' }} / {{ l.lesson }}</b>
                  <span class="adm-muted sm">{{ l.yt }}</span>
                </div>
                <div class="yt-actions">
                  <button type="button" (click)="edit(l)">Edit</button>
                  <button type="button" (click)="remove(l)">Delete</button>
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </section>
  `,
})
export class AdminYoutube implements OnInit {
  protected readonly api = inject(Api);

  protected readonly lessons = signal<YoutubeLesson[]>([]);
  protected readonly courses = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  /** The id being edited, or null when adding a new one. */
  protected readonly editing = signal<string | null>(null);

  protected readonly course = signal('');
  protected readonly folder = signal('');
  protected readonly lesson = signal('');
  protected readonly link = signal('');

  async ngOnInit(): Promise<void> {
    try {
      const [lessons, courses] = await Promise.all([this.api.listYoutubeLessons(), this.api.adminCourses()]);
      this.lessons.set(lessons);
      this.courses.set(courses);
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected edit(l: YoutubeLesson): void {
    this.editing.set(l.id);
    this.course.set(l.course);
    this.folder.set(l.folder);
    this.lesson.set(l.lesson);
    this.link.set(l.yt);
    this.error.set('');
    this.notice.set('');
  }

  protected reset(): void {
    this.editing.set(null);
    this.course.set('');
    this.folder.set('');
    this.lesson.set('');
    this.link.set('');
    this.error.set('');
    this.notice.set('');
  }

  protected async save(): Promise<void> {
    this.error.set('');
    this.notice.set('');
    if (!this.course().trim() || !this.lesson().trim()) {
      this.error.set('Course and lesson name are required.');
      return;
    }
    if (!this.link().trim()) {
      this.error.set('Paste a YouTube link.');
      return;
    }
    this.busy.set(true);
    try {
      const r = await this.api.addYoutubeLesson(this.course().trim(), this.folder().trim(), this.lesson().trim(), this.link().trim());
      this.notice.set(r.shadowed ? 'Saved, but a file already uses that path, so it will not show.' : 'Saved.');
      this.reset();
      this.lessons.set(await this.api.listYoutubeLessons());
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(l: YoutubeLesson): Promise<void> {
    if (!confirm(`Delete the YouTube lesson "${l.id}"?`)) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.api.deleteYoutubeLesson(l.id);
      if (this.editing() === l.id) this.reset();
      this.lessons.set(await this.api.listYoutubeLessons());
      this.notice.set('Deleted.');
    } catch (e) {
      this.error.set(message(e));
    } finally {
      this.busy.set(false);
    }
  }
}
