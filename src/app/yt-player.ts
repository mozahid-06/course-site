import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
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
            <youtube-video
              #media
              [source]="source()"
              playsinline
              autoplay
              (playing)="onPlaying()"
              (timeupdate)="onTimeUpdate($event)"
            ></youtube-video>
            <!--
              Opaque cover for the load window. The skin's own poster hides as soon as the
              media reports "started" — which autoplay sets before the first frame is painted
              — so relying on it lets the YouTube thumbnail/title/red button show while
              buffering. This cover stays until playback actually progresses, showing a
              spinner while it loads.

              It is also the fallback play button: some browsers block unmuted autoplay (no
              play event arrives). After a short grace period the spinner becomes a real
              button, and a tap is a user gesture, so play() then succeeds with sound. Being a
              <button> also means the skin's tap-to-toggle gesture ignores the click.
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
    this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube.com/embed/${this.yt()}?rel=0&autoplay=1`),
  );

  /**
   * Video.js YouTube media. Its chrome (Share / "Watch on YouTube") is hidden by default.
   * `rel: 0` keeps the end screen from linking away; `origin` + `enablejsapi` let the skin
   * drive the IFrame API. `src` accepts a bare 11-char id or a YouTube URL.
   * `cc_load_policy: 1` makes YouTube turn its own captions on. With `0`, YouTube still
   * reports a current track (often the auto-generated one) to the adapter, so the skin looks
   * as if captions are on, but the iframe paints nothing — and for auto-generated tracks the
   * adapter's track is not servable, so selecting it via the API cannot recover. YouTube
   * alone can paint these captions; leaving the policy on is the only reliable switch.
   * The element's `autoplay` attribute starts the lesson immediately, with sound. Browsers can
   * block unmuted autoplay, but the click that opens a lesson normally grants permission; if a
   * browser blocks it, the cover stays and students tap play.
   */
  protected readonly source = computed(() => ({
    src: this.yt(),
    engine: { youtube: { rel: 0, iv_load_policy: 3, disablekb: 1, cc_load_policy: 1, origin: location.origin, enablejsapi: 1 } },
  }));

  /**
   * Defensive fallback: if the Video.js element failed to register, the plain sanitized
   * embed still plays the lesson.
   */
  protected readonly supported = typeof customElements !== 'undefined' && !!customElements.get('video-player');

  /**
   * True until the video actually plays, so the YouTube embed's own chrome stays hidden.
   * The adapter fires `play` (and reports `paused:false`) while the embed is still buffering,
   * so only genuine progress (`playing`, or `timeupdate` past 0) hides the cover.
   */
  protected readonly covered = signal(true);
  /** True when the lesson has not progressed after a grace period and the cover offers play. */
  protected readonly blocked = signal(false);

  private readonly media = viewChild<ElementRef<HTMLMediaElement>>('media');
  private coverTimer: ReturnType<typeof setTimeout> | undefined;

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
    }, 4000);
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
