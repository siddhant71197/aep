'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { validateLead } from '@/lib/validation';
import type { LeadInput, ValidationErrors } from '@/lib/types';
import { markLeadSubmitted } from './InsuranceAdBanner';

interface LeadFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
  defaultZip?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function LeadFormModal(props: LeadFormModalProps) {
  if (!props.open) return null;
  // Mounting fresh on each open resets form state and focus handling.
  return <LeadDialog {...props} />;
}

type Field = keyof LeadInput;
const FIELDS: Field[] = ['name', 'email', 'zip'];

function LeadDialog({ onClose, onSubmitted, defaultZip }: LeadFormModalProps) {
  const titleId = useId();
  const descId = useId();
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const doneRef = useRef<HTMLButtonElement>(null);

  const [values, setValues] = useState<LeadInput>({
    name: '',
    email: '',
    zip: defaultZip && /^\d{5}$/.test(defaultZip) ? defaultZip : '',
  });
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [formError, setFormError] = useState<string | null>(null);

  // Focus first field on open; restore focus to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    fieldRefs.current.name?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (status === 'success') doneRef.current?.focus();
  }, [status]);

  const fieldError = (field: Field, v: LeadInput): string | undefined => {
    const r = validateLead(v);
    return r.ok ? undefined : r.errors[field];
  };

  const onBlur = (field: Field) => {
    // Don't nag about untouched empty fields on blur, only on submit.
    if (!values[field].trim()) return;
    setErrors((prev) => ({ ...prev, [field]: fieldError(field, values) }));
  };

  const onChange = (field: Field, raw: string) => {
    const value = field === 'zip' ? raw.replace(/\D/g, '').slice(0, 5) : raw;
    const next = { ...values, [field]: value };
    setValues(next);
    // Clear an existing error as soon as the field becomes valid.
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: fieldError(field, next) }));
  };

  const focusFirstError = (errs: ValidationErrors) => {
    const first = FIELDS.find((f) => errs[f]);
    if (first) fieldRefs.current[first]?.focus();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;
    setFormError(null);

    const result = validateLead(values);
    if (!result.ok) {
      setErrors(result.errors);
      focusFirstError(result.errors);
      return;
    }
    setErrors({});
    setStatus('submitting');

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.value),
      });
      if (res.status === 201 || res.ok) {
        markLeadSubmitted();
        setStatus('success');
        onSubmitted?.();
        return;
      }
      if (res.status === 400) {
        const data = (await res.json().catch(() => null)) as { errors?: ValidationErrors } | null;
        const errs = data?.errors ?? {};
        setErrors(errs);
        if (Object.keys(errs).length === 0) setFormError('Please check your details and try again.');
        focusFirstError(errs);
      } else {
        setFormError('Something went wrong. Please try again in a moment.');
      }
    } catch {
      setFormError("We couldn't reach the server. Please check your connection and try again.");
    }
    setStatus('idle');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const input = (
    field: Field,
    label: string,
    extra: InputHTMLAttributes<HTMLInputElement>,
  ) => {
    const id = `${baseId}-${field}`;
    const errId = `${id}-error`;
    const err = errors[field];
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        <input
          id={id}
          ref={(el) => {
            fieldRefs.current[field] = el;
          }}
          name={field}
          value={values[field]}
          onChange={(e) => onChange(field, e.target.value)}
          onBlur={() => onBlur(field)}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? errId : undefined}
          className={`h-11 rounded-lg border bg-surface px-3 text-[15px] text-fg outline-none transition placeholder:text-muted focus:ring-2 ${
            err
              ? 'border-danger focus:ring-danger/25'
              : 'border-border focus:border-accent focus:ring-accent/25'
          }`}
          {...extra}
        />
        {err && (
          <p id={errId} className="text-xs text-danger">
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={onBackdrop}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        className="fade-in shadow-card relative max-h-[100dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <span aria-hidden="true">×</span>
        </button>

        {status === 'success' ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-2xl text-success"
            >
              ✓
            </span>
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              You&apos;re all set{values.name.trim() ? `, ${values.name.trim().split(/\s+/)[0]}` : ''}!
            </h2>
            <p id={descId} className="text-sm text-muted">
              A licensed agent will reach out soon to help you compare 2027 plans. There&apos;s no
              cost and no obligation.
            </p>
            <button
              ref={doneRef}
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-strong"
            >
              Back to chat
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <div className="pr-8">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Sponsored
              </p>
              <h2 id={titleId} className="text-lg font-semibold text-fg">
                Get a free Medicare quote
              </h2>
              <p id={descId} className="mt-1 text-sm text-muted">
                Compare 2027 plans with a licensed agent — free, no obligation.
              </p>
            </div>

            {input('name', 'Full name', { autoComplete: 'name', placeholder: 'Jane Doe' })}
            {input('email', 'Email', {
              type: 'email',
              autoComplete: 'email',
              inputMode: 'email',
              placeholder: 'jane@example.com',
            })}
            {input('zip', 'ZIP code', {
              inputMode: 'numeric',
              maxLength: 5,
              autoComplete: 'postal-code',
              pattern: '[0-9]*',
              placeholder: '10001',
            })}

            {formError && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="h-11 rounded-lg bg-accent text-[15px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:cursor-wait disabled:opacity-60"
            >
              {status === 'submitting' ? 'Submitting…' : 'Get my free quote'}
            </button>

            <p className="text-[11px] leading-snug text-muted">
              By submitting, you agree to be contacted by a licensed insurance agent about Medicare
              plans. This is a solicitation for insurance.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
