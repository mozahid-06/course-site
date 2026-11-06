import { Injectable, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Back/forward for the app's own history.
 *
 * The browser owns the stack, so each entry is tagged with its position in
 * `history.state`. A popstate restores the tag (we know where we are); a fresh
 * navigation has no tag, so it becomes the next position. That is just enough to
 * grey out Back at the start and Forward at the end without ever leaving the app
 * — the buttons only ever move through history, never between lessons.
 */
@Injectable({ providedIn: 'root' })
export class NavHistory {
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  /** Position of the current entry; -1 until this service has seen one. */
  private index = -1;
  /** The highest position reached this session, so Forward knows when it ends. */
  private furthest = -1;

  readonly canBack = signal(false);
  readonly canForward = signal(false);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.tag());
  }

  private tag(): void {
    const state = (history.state ?? {}) as Record<string, unknown>;
    const tagged = typeof state['__nav'] === 'number';
    // A tagged entry is a restored one; otherwise it is a fresh entry. The first one
    // we ever see is the screen the app started on, so it is position 0.
    const index = tagged ? (state['__nav'] as number) : this.index < 0 ? 0 : this.index + 1;
    if (!tagged) history.replaceState({ ...state, __nav: index }, '');
    this.index = index;
    this.furthest = Math.max(this.furthest, index);
    this.canBack.set(index > 0);
    this.canForward.set(index < this.furthest);
  }

  back(): void { this.location.back(); }
  forward(): void { this.location.forward(); }
}
