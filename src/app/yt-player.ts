import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { Api } from './api';

/** A YouTube lesson: an iframe player with the same moving email watermark as the video player. */
@Component({
  selector: 'app-yt-player',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="vw yt">
      <iframe
        [src]="src()"
        title="YouTube video player"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
      ></iframe>
      <span class="wm" [style.left.%]="x()" [style.top.%]="y()">{{ email() }}</span>
    </div>
  `,
})
export class YtPlayer {
  private readonly api = inject(Api);
  readonly yt = input.required<string>();

  protected readonly email = computed(() => this.api.me()?.email ?? '');
  protected readonly src = computed(() => `https://www.youtube.com/embed/${this.yt()}?rel=0`);
  protected readonly x = signal(10);
  protected readonly y = signal(10);

  constructor() {
    const timer = setInterval(() => this.moveMark(), 15000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private moveMark(): void {
    this.x.set(5 + Math.random() * 55);
    this.y.set(8 + Math.random() * 78);
  }
}
