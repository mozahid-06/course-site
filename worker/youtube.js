// YouTube lessons — watch a YouTube video as a lesson without uploading anything.
//
// Add one line per lesson. The key is the lesson path (the same shape as an R2 key)
// and the value is the YouTube link:
//
//   "<Course>/<Folder>/<Video name>": "<YouTube link>"
//
//   - The FIRST segment is the course (it must match the course folder name, or it
//     creates a new course that only holds YouTube lessons).
//   - The segments in between are folders, shown joined with " / " just like the
//     folders that come from the bucket.
//   - The LAST segment is the lesson name shown in the list.
//   - A lesson directly in a course root is just "<Course>/<Video name>".
//
// The value can be any usual YouTube link — a watch link, youtu.be, /embed, /shorts,
// /live — or just the video id. It is turned into a privacy-respecting iframe player.
//
// YouTube lessons behave like any other video lesson: progress ("Mark as complete"),
// the discussion, private notes and resources all work, and admins can grant the
// course to students. Changing this file takes effect after the next deploy.
//
// Example:
//   export const YOUTUBE_LESSONS = {
//     "Physics/Week 1/Welcome": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
//     "Physics/Intro to forces": "https://youtu.be/dQw4w9WgXcQ",
//   };
export const YOUTUBE_LESSONS = {
  // Add your lessons here, one per line, for example:
  // "Physics/Week 1/Welcome": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};
