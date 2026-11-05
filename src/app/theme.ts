import { Injectable, signal } from '@angular/core';

const KEY = 'theme';

/**
 * Two-way light/dark switch. The pre-paint script in `index.html` applies the
 * stored choice (or leaves `<html>` bare so CSS can follow the OS); this service
 * mirrors that decision and writes it back when the user flips the switch.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  readonly dark = signal<boolean>(readInitial());

  toggle(): void {
    this.set(!this.dark());
  }

  set(dark: boolean): void {
    this.dark.set(dark);
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
    try {
      localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      /* private mode: the choice simply does not outlive the page */
    }
  }
}

function readInitial(): boolean {
  const stored = document.documentElement.dataset['theme'];
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}
