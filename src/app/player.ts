import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
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
              #media
              [src]="src()"
              playsinline
              autoplay
              [attr.controls]="supported ? null : ''"
              controlslist="nodownload noremoteplayback"
              (play)="onPlay()"
              (playing)="onPlaying()"
              (timeupdate)="onTimeUpdate($event)"
              (ended)="ended.emit()"
              (contextmenu)="$event.preventDefault()"
            ></hlsjs-video>
          } @else {
            <video
              #media
              [src]="src()"
              playsinline
              autoplay
              [attr.controls]="supported ? null : ''"
              controlslist="nodownload noremoteplayback"
              (play)="onPlay()"
              (playing)="onPlaying()"
              (timeupdate)="onTimeUpdate($event)"
              (ended)="ended.emit()"
              (contextmenu)="$event.preventDefault()"
            ></video>
          }
          <!--
            Same loading cover as the YouTube player: autoplay makes the skin believe the
            lesson is already playing, so its control bar shows a pause icon while the media is
            genuinely still loading. This overlay shows a spinner until playback progresses,
            then disappears. If the browser blocks autoplay (no play event), it becomes a
            real play button so one tap starts playback with sound.
          -->
          @if (covered()) {
            @if (blocked()) {
              <button type="button" class="media-cover" aria-label="Play lesson" (click)="onCoverClick()">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </button>
            } @else {
              <div class="media-cover" role="status" aria-label="Loading lesson">
                <span class="spin" aria-hidden="true"></span>
              </div>
            }
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

  /** True until the media actually plays, so the loading cover (not a pause icon) is shown. */
  protected readonly covered = signal(true);
  /** True when autoplay was blocked (no `play` event) and the cover should offer a play button. */
  protected readonly blocked = signal(false);

  private readonly media = viewChild<ElementRef<HTMLMediaElement>>('media');
  private coverTimer: ReturnType<typeof setTimeout> | undefined;

  /** Autoplay was accepted: keep the spinner and stop the fallback timer. */
  protected onPlay(): void {
    this.blocked.set(false);
    clearTimeout(this.coverTimer);
  }

  protected onPlaying(): void {
    this.covered.set(false);
  }

  protected onTimeUpdate(event: Event): void {
    if ((event.target as HTMLMediaElement).currentTime > 0.25) this.covered.set(false);
  }

  /** Fallback when the browser blocked unmuted autoplay: the tap itself authorizes play(). */
  protected onCoverClick(): void {
    this.blocked.set(false);
    void this.media()?.nativeElement.play().catch(() => this.blocked.set(true));
  }

  protected readonly x = signal(10);
  protected readonly y = signal(10);

  constructor() {
    const timer = setInterval(() => this.moveMark(), 15000);
    this.coverTimer = setTimeout(() => {
      if (this.covered()) this.blocked.set(true);
    }, 3000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearTimeout(this.coverTimer);
    });
  }

  private moveMark(): void {
    this.x.set(5 + Math.random() * 55);
    this.y.set(8 + Math.random() * 78);
  }
}
