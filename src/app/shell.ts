import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api';
import { LessonSearch } from './lesson-search';

/**
 * Cross-screen shell state that used to live in the header: which top-level panel
 * is open, whether a lesson is open, and the actions the shared options menu runs.
 * Keeping it here lets the header, the lesson bar and the admin panel reuse one menu.
 */
@Injectable({ providedIn: 'root' })
export class Shell {
  private readonly api = inject(Api);
  private readonly search = inject(LessonSearch);

  /** The admin panel is open. */
  readonly admin = signal(false);
  /** A lesson is open in the course view. */
  readonly lessonOpen = signal(false);

  /** The slim header only exists on the course list and folder browser. */
  readonly headerVisible = computed(() => !this.admin() && !this.lessonOpen());

  toggleAdmin(): void {
    this.search.reset();
    this.lessonOpen.set(false);
    const closing = this.admin();
    this.admin.update((v) => !v);
    // The admin "Course files" sub-view is kept in the hash; drop it when the panel
    // closes so returning to the course never leaves a stale #files behind.
    if (closing && location.hash === '#files') history.pushState(null, '', location.pathname + location.search);
  }

  async signOut(): Promise<void> {
    this.admin.set(false);
    this.lessonOpen.set(false);
    this.search.reset();
    await this.api.logout();
  }

  /** Same local cleanup as signOut(), but ends every session for the account. */
  async signOutEverywhere(): Promise<void> {
    this.admin.set(false);
    this.lessonOpen.set(false);
    this.search.reset();
    await this.api.logoutEverywhere();
  }
}
