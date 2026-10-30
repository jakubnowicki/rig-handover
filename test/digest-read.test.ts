import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight', () => {
  it('reads runs/2026-10-28.jsonl into one row per job', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.rows).toHaveLength(5);
    expect(night!.badLines).toBe(1);
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    const jobs = night!.rows.map((r) => r.job);
    expect(jobs).toEqual([...jobs].sort());

    const row = (job: string) => night!.rows.find((r) => r.job === job);
    expect(row('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(row('digest/render')).toMatchObject({ owner: null, lastError: null });
  });

  it('returns null for a night with no file', () => {
    expect(readNight(tmp, '2026-01-01')).toBeNull();
  });

  it('returns a night with no rows for an empty file', () => {
    writeFileSync(join(tmp, '2026-01-02.jsonl'), '');
    expect(readNight(tmp, '2026-01-02')).toEqual({ night: '2026-01-02', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts lines with the wrong shape as bad, skips blank lines', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '{"at":"2026-01-03T03:00:00+01:00","job":"a","status":"ok"}',
      '[1,2]',
    ];
    writeFileSync(join(tmp, '2026-01-03.jsonl'), lines.join('\n') + '\n');
    const night = readNight(tmp, '2026-01-03');
    expect(night!.rows).toHaveLength(1);
    expect(night!.badLines).toBe(3);
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight('runs', '../runs/2026-10-28')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
    expect(readNight('runs', '')).toBeNull();
  });
});
