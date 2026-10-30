// Plan morning-digest § 1. The contract every part of § 2 builds against; the reader lives in
// src/digest/read.ts and exports `readNight` with the `ReadNight` signature below.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once parsed.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night. Times keep the log's offset; never converted to UTC.
export type DigestRow = {
  job: string;
  owner: string | null; // views render null as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus;
  lastError: string | null; // error of the last line that had one
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that did not parse; counted, never thrown
};

// null: no file for that night (404). An empty file is a Night with no rows ("nothing ran").
export type ReadNight = (runsDir: string, night: string) => Night | null;
