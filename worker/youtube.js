// YouTube lessons — an optional first-run seed.
//
// Lessons are normally added and removed from the site itself: sign in as an admin,
// open Admin panel → YouTube, and fill in the form. That path stores the lessons in
// D1 (table `youtube_lessons`) and needs no deploy.
//
// This file exists only as a seed. On the first deploy that creates the table, whatever
// is listed below is copied into D1 once; after that this file is ignored, so deleting a
// lesson in the panel sticks even if it is still written here. You never need to edit it.
//
// The shape, if you do want to seed a batch:
//
//   "<Course>/<Folder>/<Video name>": "<YouTube link>"
//
//   - The FIRST segment is the course (it must match a course folder name, or it creates
//     a course that only holds YouTube lessons).
//   - The segments in between are folders, shown joined with " / ".
//   - The LAST segment is the lesson name shown in the list.
//   - A lesson directly in a course root is just "<Course>/<Video name>".
//   - The value can be any usual YouTube link (watch, youtu.be, /embed, /shorts, /live)
//     or just the video id.
export const YOUTUBE_LESSONS = {
  // "Physics/Week 1/Welcome": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};
