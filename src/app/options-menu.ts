import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Api } from './api';
import { Shell } from './shell';
import { Theme } from './theme';

/**
 * The single options menu shared by the header, the lesson bar and the admin shell.
 * One `⋮` opens Admin panel / Back to course (admins only), the two-way theme
 * switch, and Sign out.
 */
@Component({
  selector: 'app-options-menu',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { '(document:click)': 'onDocClick($event)' },
  template: `
    <button
      #btn
      type="button"
      class="icon-btn"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="open() ? 'Close options menu' : 'Open options menu'"
      (click)="toggle()"
      (keydown.escape)="close()"
    >
      <svg class="menu-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>

    @if (open()) {
      <div class="menu" role="menu" aria-label="Options">
        @if (isAdmin()) {
          <button type="button" role="menuitem" (click)="toggleAdmin()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" /></svg>
            {{ shell.admin() ? 'Back to course' : 'Admin panel' }}
          </button>
        }
        <button type="button" role="menuitemcheckbox" [attr.aria-checked]="theme.dark()" (click)="theme.toggle()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
          Dark mode
          <span class="switch" [class.on]="theme.dark()" aria-hidden="true"></span>
        </button>
        <button type="button" role="menuitem" (click)="signOut()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v16h-6" /><path d="m10 8-4 4 4 4" /><path d="M6 12h10" /></svg>
          Sign out
        </button>
      </div>
    }
  `,
})
export class OptionsMenu {
  protected readonly shell = inject(Shell);
  protected readonly theme = inject(Theme);
  private readonly api = inject(Api);
  private readonly btn = viewChild<ElementRef<HTMLButtonElement>>('btn');

  protected readonly open = signal(false);
  protected readonly isAdmin = computed(() => !!this.api.me()?.is_admin);

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.btn()?.nativeElement.focus();
  }

  protected toggleAdmin(): void {
    this.open.set(false);
    this.shell.toggleAdmin();
  }

  protected async signOut(): Promise<void> {
    this.open.set(false);
    await this.shell.signOut();
  }

  protected onDocClick(e: MouseEvent): void {
    if (!this.open()) return;
    if (!(e.target as HTMLElement | null)?.closest('app-options-menu')) this.open.set(false);
  }
}
