import type { RawTable, Row } from '../types';

/**
 * RFC 4180 CSV parser that keeps every cell's text exactly as stored
 * (quotes removed, doubled quotes unescaped, nothing trimmed or converted).
 */
export function parseCsv(text: string): RawTable {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = sniffDelimiter(text);
  const records = splitRecords(text, delimiter);
  const issues: RawTable['issues'] = [];

  // Skip leading blank lines to find the header.
  let h = 0;
  while (h < records.length && isBlank(records[h].cells)) h++;
  if (h >= records.length) {
    return { format: 'csv', columns: [], rows: [], issues: [{ line: 1, message: 'The file is empty.' }], skipped: [] };
  }
  const columns = dedupe(records[h].cells);

  const rows: Row[] = [];
  for (let r = h + 1; r < records.length; r++) {
    const rec = records[r];
    if (isBlank(rec.cells)) continue;
    const values = rec.cells.slice(0, columns.length);
    if (rec.cells.length !== columns.length) {
      issues.push({
        line: rec.line,
        message: `Has ${rec.cells.length} cells; the header has ${columns.length}.` +
          (rec.cells.length > columns.length ? ' Extra cells are kept in the last column.' : ' Missing cells are left empty.'),
      });
      if (rec.cells.length > columns.length) {
        values[columns.length - 1] = rec.cells.slice(columns.length - 1).join(delimiter);
      }
      while (values.length < columns.length) values.push('');
    }
    rows.push({ i: rows.length, line: rec.line, values });
  }

  const source = isColota(columns) ? 'Colota' : undefined;
  return { format: 'csv', source, columns, rows, issues, skipped: [] };
}

const COLOTA = 'id,timestamp,iso_time,latitude,longitude,accuracy,altitude,speed,bearing,battery,battery_status,note';

export function isColota(columns: string[]): boolean {
  return columns.map((c) => c.trim().toLowerCase()).join(',').startsWith(COLOTA);
}

function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const counts: [string, number][] = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function splitRecords(text: string, d: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === d) {
      cells.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      cells.push(cell); cell = '';
      out.push({ line: startLine, cells });
      cells = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      line++;
      startLine = line;
    } else {
      cell += c;
    }
  }
  if (cell !== '' || cells.length) {
    cells.push(cell);
    out.push({ line: startLine, cells });
  }
  return out;
}

function isBlank(cells: string[]): boolean {
  return cells.length === 0 || (cells.length === 1 && cells[0].trim() === '');
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw, idx) => {
    const name = raw.trim() === '' ? `column_${idx + 1}` : raw.trim();
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name}_${n + 1}`;
  });
}
