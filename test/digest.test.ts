import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/index.js';

const fixtures = fileURLToPath(new URL('../runs/', import.meta.url));
const night = '2026-10-28';
const temporaryDirs: string[] = [];

function temporaryRuns(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  temporaryDirs.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, `${night}.jsonl`), contents);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('returns the exact rows and line counts for the real 2026-10-28 night', () => {
    expect(readNight(fixtures, night)).toEqual({
      night,
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
      counts: { ok: 10, retry: 4, fail: 1 },
      badLines: 1,
    });
  });

  it('counts log entries rather than jobs for the other real night', () => {
    const digest = readNight(fixtures, '2026-10-27');
    expect(digest?.rows).toHaveLength(4);
    expect(digest?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(digest?.badLines).toBe(0);
  });

  it('distinguishes a missing night from an empty night', () => {
    const dir = temporaryRuns('');
    expect(readNight(dir, '2026-10-27')).toBeNull();
    expect(readNight(join(dir, 'missing'), night)).toBeNull();
    expect(readNight(dir, night)).toEqual({
      night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0,
    });
  });

  it('counts malformed JSON and invalid records without losing valid entries', () => {
    const entry = { at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: null };
    const lines = [
      '{broken', 'null', '[]', '42', '"text"', '{}', '', '   ',
      JSON.stringify({ ...entry, at: 'not a time' }),
      JSON.stringify({ ...entry, at: '2026-02-30T01:00:00+01:00' }),
      JSON.stringify({ ...entry, at: '2026-10-29T01:00:00' }),
      JSON.stringify({ ...entry, job: 7 }),
      JSON.stringify({ ...entry, job: ' ' }),
      JSON.stringify({ ...entry, status: 'pending' }),
      JSON.stringify({ ...entry, owner: false }),
      JSON.stringify({ ...entry, owner: undefined }),
      JSON.stringify({ ...entry, error: null }),
      JSON.stringify(entry),
    ];
    const digest = readNight(temporaryRuns(lines.join('\r\n') + '\r\n'), night);
    expect(digest?.badLines).toBe(17);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows).toEqual([{
      job: 'job', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
      firstAt: entry.at, lastAt: entry.at,
    }]);
  });

  it('orders by actual time, preserves offsets, and retains the latest error after recovery', () => {
    const entries = [
      { at: '2026-10-29T02:00:00+01:00', job: 'z', status: 'ok', owner: null },
      { at: '2026-10-29T02:30:00+02:00', job: 'z', status: 'fail', owner: 'second', error: 'latest' },
      { at: '2026-10-29T00:00:00Z', job: 'z', status: 'retry', owner: 'first', error: 'earlier' },
      { at: '2026-10-29T00:00:00Z', job: 'a', status: 'ok', owner: 'a' },
    ];
    const digest = readNight(temporaryRuns(entries.map((entry) => JSON.stringify(entry)).join('\n')), night);
    expect(digest?.rows.map((row) => row.job)).toEqual(['a', 'z']);
    expect(digest?.rows[1]).toEqual({
      job: 'z', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest',
      firstAt: '2026-10-29T00:00:00Z', lastAt: '2026-10-29T02:00:00+01:00',
    });
    expect(digest?.counts).toEqual({ ok: 2, retry: 1, fail: 1 });
    expect(digest?.badLines).toBe(0);
  });

  it('uses file order for entries at the same instant', () => {
    const entries = [
      { at: '2026-10-29T01:00:00+01:00', job: '__proto__', status: 'retry', owner: 'first', error: 'first' },
      { at: '2026-10-29T00:00:00Z', job: '__proto__', status: 'fail', owner: null, error: 'last' },
    ];
    const digest = readNight(temporaryRuns(entries.map((entry) => JSON.stringify(entry)).join('\n')), night);
    expect(digest?.rows).toEqual([{
      job: '__proto__', owner: null, runs: 2, retries: 1, lastStatus: 'fail', lastError: 'last',
      firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T00:00:00Z',
    }]);
  });

  it('returns a digest when every line is bad, without counting a final newline', () => {
    expect(readNight(temporaryRuns('{broken\n\n'), night)).toEqual({
      night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 2,
    });
  });

  it('rejects invalid nights and paths outside the runs directory', () => {
    const dir = temporaryRuns();
    for (const invalid of ['../2026-10-28', '/2026-10-28', '2026-02-30', '2026-13-01', '2026-1-01', '']) {
      expect(readNight(dir, invalid)).toBeNull();
    }
  });

  it('does not disguise other file errors as a missing night', () => {
    const dir = temporaryRuns();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
