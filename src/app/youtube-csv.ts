/**
 * CSV import for YouTube lessons.
 *
 * The Files view lets an admin add many lessons at once from a CSV file. This
 * module is pure (no Angular) so its rules can be checked on their own.
 *
 * Format: comma-separated, RFC-4180 quoting (`"…"`, with `""` for a literal
 * quote, and commas or newlines allowed inside quotes), LF or CRLF, and an
 * optional leading UTF-8 BOM. Columns are detected rather than fixed, so extra
 * columns (a row number, a date) are simply ignored: the link column is the one
 * whose cells are most often YouTube links, and the name is the column just to
 * its left (to its right, when the link is the first column).
 */

export interface CsvRow { name: string; link: string; yt: string }
export interface CsvReject { line: number; reason: string }

/** The video id in any usual YouTube link (watch, youtu.be, /embed, /shorts, /live), or a bare id. */
export function ytId(link: string): string | null {
  const s = String(link ?? '').trim();
  if (!s) return null;
  const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{6,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{6,}$/.test(s) ? s : null;
}

/** Split CSV text into rows of cells (RFC-4180), dropping a leading BOM. */
function splitCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } // "" is one literal quote
        else quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n') {
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Parse a CSV file into lessons.
 *
 * A header row is optional (detected by holding no YouTube link). Rows that have
 * no name, a name containing `/`, or a link that is not YouTube are reported in
 * `rejected` and skipped; every other row is returned in `rows`.
 */
export function parseYoutubeCsv(text: string): { rows: CsvRow[]; rejected: CsvReject[] } {
  const all = splitCsv(text).filter((cells) => cells.some((c) => c.trim() !== ''));
  if (!all.length) return { rows: [], rejected: [] };
  const header = !all[0].some((c) => ytId(c));
  const data = header ? all.slice(1) : all;
  if (!data.length) return { rows: [], rejected: [] };

  const width = data.reduce((n, r) => Math.max(n, r.length), 0);
  let linkCol = 0;
  let best = -1;
  for (let i = 0; i < width; i++) {
    const hits = data.reduce((n, r) => n + (r[i] && ytId(r[i]) ? 1 : 0), 0);
    if (hits > best) { best = hits; linkCol = i; }
  }
  const nameCol = linkCol > 0 ? linkCol - 1 : linkCol + 1;

  const rows: CsvRow[] = [];
  const rejected: CsvReject[] = [];
  data.forEach((cells, idx) => {
    const line = idx + (header ? 2 : 1);
    const name = (cells[nameCol] ?? '').trim();
    const link = (cells[linkCol] ?? '').trim();
    const yt = ytId(link);
    if (!name) rejected.push({ line, reason: 'no name' });
    else if (name.includes('/')) rejected.push({ line, reason: 'name contains "/"' });
    else if (!yt) rejected.push({ line, reason: 'not a YouTube link' });
    else rows.push({ name, link, yt });
  });
  return { rows, rejected };
}
