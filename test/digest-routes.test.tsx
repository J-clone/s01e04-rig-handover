import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };
const night = '2026-10-28';
const temporaryDirs: string[] = [];
type JsonRows = { rows: Pick<DigestRow, 'job' | 'owner'>[] };

const entries = [
  { at: '2026-10-28T23:00:00+01:00', job: 'route-job-zulu', status: 'ok', owner: 'rook' },
  { at: '2026-10-28T23:01:00+01:00', job: 'route-job-alpha', status: 'ok', owner: null },
  { at: '2026-10-28T23:02:00+01:00', job: 'route-job-bravo', status: 'fail', owner: 'lane-07' },
];
const lines = entries.map((entry) => JSON.stringify(entry));
const expectedRows = [
  { job: 'route-job-alpha', owner: null },
  { job: 'route-job-bravo', owner: 'lane-07' },
  { job: 'route-job-zulu', owner: 'rook' },
];
const expectedJobs = expectedRows.map((row) => row.job);

function appForNight(contents?: string) {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  temporaryDirs.push(runsDir);
  if (contents !== undefined) writeFileSync(join(runsDir, `${night}.jsonl`), contents);
  return createApp({ ...config, runsDir });
}

function pageJobs(html: string): string[] {
  // Fixture names need no HTML decoding. Read text without relying on table markup.
  return html.replace(/<[^>]*>/g, ' ').match(/\broute-job-[a-z]+\b/g) ?? [];
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  describe.each([
    { scenario: 'a night with data', contents: lines.join('\n') + '\n' },
    { scenario: 'a night with a bad line', contents: [lines[0], '{broken', ...lines.slice(1)].join('\n') + '\n' },
  ])('$scenario', ({ contents }) => {
    it('returns 200 and lists the good jobs on the page in reader order', async () => {
      const res = await appForNight(contents).request(`/digest/${night}`);
      expect(res.status).toBe(200);
      expect(pageJobs(await res.text())).toEqual(expectedJobs);
    });

    it('returns 200 and JSON rows in reader order, preserving null owners', async () => {
      const res = await appForNight(contents).request(`/api/digest/${night}`);
      expect(res.status).toBe(200);
      const body: JsonRows = await res.json();
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows.map(({ job, owner }) => ({ job, owner }))).toEqual(expectedRows);
    });

    it('lists the same jobs in the same order on the page and in JSON', async () => {
      const app = appForNight(contents);
      const page = await app.request(`/digest/${night}`);
      const json = await app.request(`/api/digest/${night}`);
      expect(page.status).toBe(200);
      expect(json.status).toBe(200);
      const jobs = pageJobs(await page.text());
      const body: JsonRows = await json.json();
      expect(jobs).toEqual(expectedJobs);
      expect(body.rows.map((row) => row.job)).toEqual(jobs);
    });
  });

  it.each(['/digest', '/api/digest'])('returns 404 at %s for a night with no file', async (route) => {
    const res = await appForNight().request(`${route}/${night}`);
    expect(res.status).toBe(404);
  });

  it('returns 200 and says "nothing ran" on the page for an empty night', async () => {
    const res = await appForNight('').request(`/digest/${night}`);
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain('nothing ran');
  });

  it('returns 200 and empty JSON rows for an empty night', async () => {
    const res = await appForNight('').request(`/api/digest/${night}`);
    expect(res.status).toBe(200);
    const body: JsonRows = await res.json();
    expect(body.rows).toEqual([]);
  });
});
