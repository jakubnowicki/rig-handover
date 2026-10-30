import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Plan morning-digest § 2d. Routes: GET /digest/:night (HTML), GET /api/digest/:night (JSON).
// runs/ is read-only: the fixture is copied into a temp runs dir, the other nights are written there.

const tmp = mkdtempSync(join(tmpdir(), 'rig-routes-'));
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tmp };
const app = createApp(config);

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
  copyFileSync('runs/2026-10-28.jsonl', join(tmp, '2026-10-28.jsonl'));
  writeFileSync(join(tmp, '2026-10-30.jsonl'), '');
  writeFileSync(
    join(tmp, '2026-10-31.jsonl'),
    [
      '{"at":"2026-10-31T02:00:00+01:00","job":"zeta/job","status":"ok","owner":"rook"}',
      'this line is not json',
      '{"at":"2026-10-31T03:00:00+01:00","job":"alpha/job","status":"ok","owner":null}',
    ].join('\n') + '\n',
  );
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// First cell of each <tbody> row: a bare <td> holding just the job name.
function pageJobs(html: string): string[] {
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  return [...tbody.matchAll(/<tr[^>]*>\s*<td>([^<]*)<\/td>/g)].map((m) => m[1]!);
}

// The <tr> markup of the row for one job.
function pageRow(html: string, job: string): string {
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  return tbody.split('</tr>').find((r) => r.includes(`<td>${job}</td>`)) ?? '';
}

describe('GET /digest/:night', () => {
  it('renders the night as one table, sorted by job, under the lane banner', async () => {
    const res = await app.request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<h1>digest · 2026-10-28</h1>');
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('TEST-MARKER');
    const jobs = pageJobs(html);
    expect(jobs).toHaveLength(5);
    expect(jobs).toEqual([...jobs].sort());
  });

  it('renders a missing owner as a dash and marks retries >= 3 and a failed last status', async () => {
    const html = await (await app.request('/digest/2026-10-28')).text();
    expect(pageRow(html, 'digest/render')).toContain('—');
    expect(pageRow(html, 'fixtures/refresh')).toContain('class="warn"');
    expect(pageRow(html, 'notes/backup')).toContain('class="warn"');
    expect(pageRow(html, 'lane/sync')).not.toContain('class="warn"');
  });

  it('says so when a night has no run log', async () => {
    const res = await app.request('/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for 2026-01-01');
  });

  it('says "nothing ran" for an empty file, without a table', async () => {
    const res = await app.request('/digest/2026-10-30');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('notes a line that did not parse and still lists the good rows', async () => {
    const res = await app.request('/digest/2026-10-31');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line did not parse');
    expect(pageJobs(html)).toEqual(['alpha/job', 'zeta/job']);
  });

  it('does not note bad lines on a clean night', async () => {
    const html = await (await app.request('/digest/2026-10-30')).text();
    expect(html).not.toContain('did not parse');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night exactly as readNight does', async () => {
    const res = await app.request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.night).toBe('2026-10-28');
    expect(night.rows).toHaveLength(5);
    expect(night.badLines).toBe(1);
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night.rows.map((r) => r.job)).toEqual(night.rows.map((r) => r.job).sort());
    expect(night.rows.find((r) => r.job === 'digest/render')).toMatchObject({ owner: null, lastError: null });
  });

  it('answers 404 with an error body for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2026-01-01' });
  });

  it('returns no rows for an empty file', async () => {
    const res = await app.request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts a bad line', async () => {
    const res = await app.request('/api/digest/2026-10-31');
    const night = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['alpha/job', 'zeta/job']);
  });
});

describe('page and JSON agree', () => {
  it.each(['2026-10-28', '2026-10-31'])('lists the same jobs in the same order for %s', async (night) => {
    const html = await (await app.request(`/digest/${night}`)).text();
    const json = (await (await app.request(`/api/digest/${night}`)).json()) as Night;
    expect(json.rows.length).toBeGreaterThan(0);
    expect(pageJobs(html)).toEqual(json.rows.map((r) => r.job));
  });
});
