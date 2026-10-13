// Client-safe: no node imports.
import type { LeadInput, ValidationErrors } from './types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const ZIP_RE = /^\d{5}$/;

export type LeadValidationResult =
  | { ok: true; value: LeadInput }
  | { ok: false; errors: ValidationErrors };

export function validateLead(input: unknown): LeadValidationResult {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: ValidationErrors = {};

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) errors.name = 'Please enter your name.';
  else if (name.length < 2) errors.name = 'Name must be at least 2 characters.';
  else if (name.length > 100) errors.name = 'Name must be 100 characters or fewer.';

  const email = typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : '';
  if (!email) errors.email = 'Please enter your email address.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';

  const zip = typeof obj.zip === 'string' ? obj.zip.trim() : typeof obj.zip === 'number' ? String(obj.zip) : '';
  if (!zip) errors.zip = 'Please enter your ZIP code.';
  else if (!ZIP_RE.test(zip)) errors.zip = 'ZIP code must be 5 digits.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, email, zip } };
}
