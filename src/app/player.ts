import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import '@videojs/html/video/player';
import '@videojs/html/video/skin';
import '@videojs/html/media/hlsjs-video';
import { Api } from './api';

/** A self-hosted lesson (HLS or MP4): a Video.js player with the moving email watermark. */
@Component({
  selector: 'app-player',
  changeDetection: ChangeDetectionStrategy.Eager,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="vw">
      <video-player>
        <video-skin>
          @if (isHls()) {
            <hlsjs-video
              [src]="src()"
              playsinline
              autoplay
              disablepictureinpicture
              [attr.controls]="supported ? null : ''"
              controlslist="nodownload noremoteplayback"
              (ended)="ended.emit()"
              (contextmenu)="$event.preventDefault()"
            ></hlsjs-video>
          } @else {
            <video
              [src]="src()"
              playsinline
              autoplay
              disablepictureinpicture
              [attr.controls]="supported ? null : ''"
              controlslist="nodownload noremoteplayback"
              (ended)="ended.emit()"
              (contextmenu)="$event.preventDefault()"
            ></video>
          }
        </video-skin>
      </video-player>
      <span class="wm" [style.left.%]="x()" [style.top.%]="y()">{{ email() }}</span>
    </div>
  `,
})
export class Player {
  private readonly api = inject(Api);
  readonly key = input.required<string>();
  readonly ended = output<void>();

  protected readonly email = computed(() => this.api.me()?.email ?? '');
  /** Same-origin media route; hls.js and the native element both issue range requests. */
  protected readonly src = computed(() => this.api.mediaUrl(this.key()));
  protected readonly isHls = computed(() => this.key().endsWith('.m3u8'));
  /**
   * Fallback for the unlikely case the player element failed to register: the native
   * `<video>` branch then carries the browser's own controls. HLS cannot fall back to
   * native playback outside Safari, so a missing HLS element surfaces as the `@defer`
   * `@error` block in `course.ts` instead.
   */
  protected readonly supported = typeof customElements !== 'undefined' && !!customElements.get('video-player');

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
