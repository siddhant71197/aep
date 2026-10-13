import { describe, expect, it } from 'vitest';
import { validateLead } from '@/lib/validation';

describe('validateLead', () => {
  it('accepts and normalizes valid input', () => {
    const r = validateLead({ name: '  Jane Doe ', email: ' Jane@Example.COM ', zip: '10001' });
    expect(r).toEqual({ ok: true, value: { name: 'Jane Doe', email: 'jane@example.com', zip: '10001' } });
  });

  it('rejects missing fields with friendly messages', () => {
    const r = validateLead({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(['email', 'name', 'zip']);
      expect(r.errors.name).toMatch(/name/i);
    }
  });

  it('handles non-object input', () => {
    expect(validateLead(null).ok).toBe(false);
    expect(validateLead('x').ok).toBe(false);
  });

  it('validates name length', () => {
    expect(validateLead({ name: 'J', email: 'a@b.co', zip: '12345' }).ok).toBe(false);
    expect(validateLead({ name: 'x'.repeat(101), email: 'a@b.co', zip: '12345' }).ok).toBe(false);
    expect(validateLead({ name: 'x'.repeat(100), email: 'a@b.co', zip: '12345' }).ok).toBe(true);
  });

  it('validates email', () => {
    for (const email of ['nope', 'a@b', 'a@b.c', 'a b@c.com', `${'a'.repeat(250)}@b.com`]) {
      const r = validateLead({ name: 'Jo', email, zip: '12345' });
      expect(r.ok, email).toBe(false);
    }
  });

  it('validates zip', () => {
    for (const zip of ['1234', '123456', 'abcde', '12345-6789']) {
      expect(validateLead({ name: 'Jo', email: 'a@b.co', zip }).ok, zip).toBe(false);
    }
  });
});
