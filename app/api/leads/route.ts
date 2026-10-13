import { connection } from 'next/server';
import { appendLead, listLeads } from '@/lib/leadsStore';
import { validateLead } from '@/lib/validation';


export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ errors: { name: 'Invalid request.' } }, { status: 400 });
  }
  const result = validateLead(body);
  if (!result.ok) return Response.json({ errors: result.errors }, { status: 400 });
  try {
    const lead = await appendLead(result.value);
    return Response.json({ lead }, { status: 201 });
  } catch (err) {
    console.error('[leads] append failed', err);
    return Response.json({ error: 'Could not save your details. Please try again.' }, { status: 500 });
  }
}

export async function GET() {
  await connection();
  const leads = await listLeads();
  return Response.json({ leads });
}
