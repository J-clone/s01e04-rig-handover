import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight, StatusCounts } from './types.js';

type RunEntry = {
  at: string;
  time: number;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function validNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const time = Date.parse(`${night}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === night;
}

function parseEntry(line: string): RunEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string') return null;
  if (!('job' in value) || typeof value.job !== 'string' || !value.job.trim()) return null;
  if (!('status' in value) ||
      (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;

  // Require an explicit offset so the server's timezone cannot change the ordering.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at) ||
      !validNight(value.at.slice(0, 10))) return null;
  const time = Date.parse(value.at);
  if (!Number.isFinite(time)) return null;

  return {
    at: value.at,
    time,
    job: value.job,
    status: value.status,
    owner: value.owner,
    error,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validNight(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  if (contents.endsWith('\n')) lines.pop();
  const entries: RunEntry[] = [];
  let badLines = 0;
  for (const line of lines) {
    const entry = parseEntry(line);
    if (entry) entries.push(entry);
    else badLines += 1;
  }
  entries.sort((a, b) => a.time - b.time);

  const rows = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  for (const entry of entries) {
    counts[entry.status] += 1;
    const row = rows.get(entry.job);
    if (row) {
      row.runs += 1;
      row.retries += Number(entry.status === 'retry');
      row.owner = entry.owner;
      row.lastStatus = entry.status;
      row.lastError = entry.error ?? row.lastError;
      row.lastAt = entry.at;
    } else {
      rows.set(entry.job, {
        job: entry.job,
        owner: entry.owner,
        runs: 1,
        retries: Number(entry.status === 'retry'),
        lastStatus: entry.status,
        lastError: entry.error ?? null,
        firstAt: entry.at,
        lastAt: entry.at,
      });
    }
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
    counts,
    badLines,
  };
};
