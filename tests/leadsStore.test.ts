import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendLead, listLeads } from '@/lib/leadsStore';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'leads-'));
  file = path.join(dir, 'nested', 'leads.json');
  process.env.LEADS_FILE = file;
});

afterEach(async () => {
  delete process.env.LEADS_FILE;
  await rm(dir, { recursive: true, force: true });
});

describe('leadsStore', () => {
  it('returns [] when the file is missing', async () => {
    expect(await listLeads()).toEqual([]);
  });

  it('appends a lead with id, createdAt and source', async () => {
    const lead = await appendLead({ name: 'Jane', email: 'j@x.com', zip: '10001' });
    expect(lead.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lead.source).toBe('chat_ad');
    expect(new Date(lead.createdAt).toString()).not.toBe('Invalid Date');
    expect(await listLeads()).toEqual([lead]);
  });

  it('handles 20 concurrent appends', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => appendLead({ name: `User ${i}`, email: `u${i}@x.com`, zip: '10001' })),
    );
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    expect(parsed).toHaveLength(20);
    expect(new Set(parsed.map((l: { id: string }) => l.id)).size).toBe(20);
    expect(new Set(results.map((l) => l.id)).size).toBe(20);
    expect(await listLeads()).toHaveLength(20);
    // no tmp files left behind
    expect(await readdir(path.dirname(file))).toEqual(['leads.json']);
  });
});
