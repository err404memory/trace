export type Format = 'csv' | 'geojson' | 'gpx' | 'kml';

/** What a column means, when Trace can tell. */
export type Role =
  | 'lat'
  | 'lon'
  | 'time'
  | 'accuracy'
  | 'altitude'
  | 'speed'
  | 'bearing'
  | 'battery'
  | 'id';

export interface Column {
  key: string;
  role?: Role;
  /** Inferred from the values: used for sorting and profiles. */
  kind: 'number' | 'text' | 'empty';
}

export interface Row {
  /** Position in the file, 0-based. */
  i: number;
  /** Line (CSV) or feature/element number in the source, 1-based, for messages. */
  line: number;
  /** Exact stored text of each cell, aligned with `Dataset.columns`. */
  values: string[];
}

export interface Issue {
  line: number;
  message: string;
}

/** Output of a parser, before roles and typed arrays are worked out. */
export interface RawTable {
  format: Format;
  source?: string;
  columns: string[];
  rows: Row[];
  issues: Issue[];
  /** Items in the file that are not rows (e.g. GeoJSON line features), counted so nothing goes missing silently. */
  skipped: { what: string; count: number }[];
}

export interface Dataset {
  name: string;
  format: Format;
  source?: string;
  columns: Column[];
  rows: Row[];
  issues: Issue[];
  skipped: { what: string; count: number }[];
  /** Typed views indexed by row index; NaN when missing or unparseable. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  acc: Float64Array;
  spd: Float64Array;
  brg: Float64Array;
  alt: Float64Array;
  bat: Float64Array;
  /** Row indices sorted by time; rows without a time come last, in file order. */
  order: Int32Array;
  /** rank[i] = position of row i in `order`. */
  rank: Int32Array;
  /** Number of rows with both a time and a valid position. */
  placed: number;
}
