import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('digest page', () => {
  let runsDir: string;
  const night = '2026-10-28';
  const at = '2026-10-29T01:00:00+01:00';
  const app = () => createApp({ adapter: 'shim', installed: at, beatEverySeconds: 60, runsDir });

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-page-'));
    vi.stubEnv('LANE_MARKER', 'digest-test-marker');
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('renders every field, warnings, missing values and bad lines with the lane banner', async () => {
    const entries = [
      { at, job: 'z-job', owner: 'rook', status: 'retry', error: '<quota>' },
      { at, job: 'z-job', owner: 'rook', status: 'retry' },
      { at, job: 'z-job', owner: 'rook', status: 'retry' },
      { at, job: 'z-job', owner: 'rook', status: 'fail' },
      { at, job: 'a-job', owner: null, status: 'ok' },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n{bad\n');

    const response = await app().request(`/digest/${night}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('digest-test-marker');
    expect(html).toContain('bad lines: 1');
    expect(html.indexOf('a-job')).toBeLessThan(html.indexOf('z-job'));
    expect(html).toContain(`<tr><td>a-job</td><td>—</td><td>1</td><td>0</td><td>ok</td><td>—</td><td>${at}</td><td>${at}</td></tr>`);
    expect(html).toContain(`<tr><td>z-job</td><td>rook</td><td>4</td><td class="warn">3</td><td class="warn">fail</td><td>&lt;quota&gt;</td><td>${at}</td><td>${at}</td></tr>`);
    expect(html).not.toContain('<script');
  });

  it('distinguishes a missing night from an empty file', async () => {
    expect((await app().request(`/digest/${night}`)).status).toBe(404);
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    const response = await app().request(`/digest/${night}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).toContain('digest-test-marker');
    expect(html).not.toContain('bad lines:');
  });
});
