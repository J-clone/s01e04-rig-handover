export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // The owner from the latest entry, including null.
  owner: string | null;
  // Every valid log entry counts as a run, including retries and failures.
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  // The most recent supplied error, retained after a successful run.
  lastError: string | null;
  // Earliest and latest timestamps, with their original offsets preserved.
  firstAt: string;
  lastAt: string;
};

// Counts of valid log entries, not jobs. Bad lines count in no status.
export type StatusCounts = Record<DigestStatus, number>;

export type NightDigest = {
  night: string;
  // Ascending job order, using string comparison rather than locale rules.
  rows: DigestRow[];
  counts: StatusCounts;
  badLines: number;
};

// Implemented as readNight in src/digest/index.ts.
// A missing file or invalid YYYY-MM-DD night returns null. An empty file returns
// a digest with no rows and zero counts. Other file errors propagate.
// Invalid JSON and invalid records count as bad lines. A final newline is not a line.
// Entries are ordered by timestamp. Equal timestamps retain their file order.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
