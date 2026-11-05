import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import '@videojs/html/video/player';
import '@videojs/html/video/skin';
import '@videojs/html/media/youtube-video';
import { Api } from './api';

/** A YouTube lesson: a Video.js player with the same moving email watermark as the video player. */
@Component({
  selector: 'app-yt-player',
  changeDetection: ChangeDetectionStrategy.Eager,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="vw yt">
      @if (supported) {
        <video-player>
          <video-skin>
            <youtube-video [source]="source()" playsinline></youtube-video>
          </video-skin>
        </video-player>
      } @else {
        <iframe
          [src]="src()"
          title="YouTube video player"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      }
      <span class="wm" [style.left.%]="x()" [style.top.%]="y()">{{ email() }}</span>
    </div>
  `,
})
export class YtPlayer {
  private readonly api = inject(Api);
  private readonly sanitizer = inject(DomSanitizer);
  readonly yt = input.required<string>();

  protected readonly email = computed(() => this.api.me()?.email ?? '');
  /**
   * `iframe[src]` is a RESOURCE_URL binding, and Angular refuses a plain string there
   * (`DomSanitizer.sanitize(RESOURCE_URL, ...)` throws NG0904), so the URL must be marked
   * trusted. Without this the player renders a blank black box on every YouTube lesson.
   * Only the fallback branch below uses it.
   */
  protected readonly src = computed<SafeResourceUrl>(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube.com/embed/${this.yt()}?rel=0`),
  );

  /**
   * Video.js YouTube media. Its chrome (Share / "Watch on YouTube") is hidden by default.
   * `rel: 0` keeps the end screen from linking away; `origin` + `enablejsapi` let the skin
   * drive the IFrame API. `src` accepts a bare 11-char id or a YouTube URL.
   */
  protected readonly source = computed(() => ({
    src: this.yt(),
    engine: { youtube: { rel: 0, iv_load_policy: 3, disablekb: 1, cc_load_policy: 0, origin: location.origin, enablejsapi: 1 } },
  }));

  /**
   * Defensive fallback: if the Video.js element failed to register, the plain sanitized
   * embed still plays the lesson.
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
