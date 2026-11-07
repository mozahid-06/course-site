/** A file-browser row's completion mark. Folders are containers, never completable. */
export type StatusMark = 'none' | 'empty' | 'done';

export function statusMark(kind: string, done: boolean): StatusMark {
  if (kind === 'folder') return 'none';
  return done ? 'done' : 'empty';
}
