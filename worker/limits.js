// Small pure helpers for the per-student limits. They live in their own module so the
// Worker entry stays readable and the rules can be unit-tested without a D1/R2 environment.

/**
 * The lesson a media request belongs to. HLS parts (`.m3u8`, `.ts`, `.vtt`) are one lesson,
 * named by their folder, so a student opening a single HLS video counts once even though the
 * browser fetches many segments.
 */
export const lessonOf = (key) =>
  /\.(m3u8|ts|vtt)$/i.test(key) ? key.slice(0, key.lastIndexOf('/')) : key;

/** The hour bucket (UTC) used for the distinct-lessons-per-hour limit. */
export const hourBucket = (ms) => Math.floor(ms / 36e5);

/**
 * The lesson shape sent to students. It deliberately never carries the YouTube video id:
 * ids are fetched one at a time from `/api/lesson/<id>/yt`, so a single `/api/course`
 * response cannot be scraped for every YouTube id at once. `subtitles` is kept for HLS.
 */
export const publicLesson = (lesson, done) => {
  const out = { id: lesson.id, title: lesson.title, kind: lesson.kind, done: !!done };
  if (lesson.subtitles) out.subtitles = lesson.subtitles;
  return out;
};
