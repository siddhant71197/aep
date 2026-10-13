import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Lead, LeadInput } from './types';

function leadsFile(): string {
  return path.resolve(process.cwd(), process.env.LEADS_FILE || 'data/leads.json');
}

let chain: Promise<unknown> = Promise.resolve();

/** Serialize all store operations through a module-level promise chain. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function readAll(file: string): Promise<Lead[]> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Lead[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(file: string, leads: Lead[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(leads, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

export function appendLead(input: LeadInput): Promise<Lead> {
  return withLock(async () => {
    const file = leadsFile();
    const leads = await readAll(file);
    const lead: Lead = {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
      zip: input.zip,
      createdAt: new Date().toISOString(),
      source: 'chat_ad',
    };
    leads.push(lead);
    await writeAll(file, leads);
    return lead;
  });
}

export function listLeads(): Promise<Lead[]> {
  return withLock(() => readAll(leadsFile()));
}
