// A phone or an email read off a lease, on its way to `party_contact`. #235.
//
// SPEC-parties "Contacts from a lease". The lease declares a phone and an email per role, a person
// approves each one on הקריאה, and פתיחת טיוטה writes it onto the party that person became. This
// module owns which fields those are and what an approvable value looks like. It does not own the
// rule that turns a typed number into the stored one: that is `normalisePhone`, in `src/scope/`,
// which evidence may not import (SPEC.md module map). So the composition root builds
// `ContactRules` from scope's functions and hands it in, the way #206 folds a typed contact.
import { KernelError } from '../../kernel/errors.ts';
import type { Queryable } from './types.ts';

export type ContactChannel = 'PHONE' | 'EMAIL';

/** The lease's contact fields, by the name field they belong to. */
export const CONTACT_FIELDS: Readonly<
  Record<string, { channel: ContactChannel; nameKey: string }>
> = {
  main_tenant_phone: { channel: 'PHONE', nameKey: 'main_tenant_name' },
  main_tenant_email: { channel: 'EMAIL', nameKey: 'main_tenant_name' },
  second_tenant_phone: { channel: 'PHONE', nameKey: 'second_tenant_name' },
  second_tenant_email: { channel: 'EMAIL', nameKey: 'second_tenant_name' },
  guarantor_phone: { channel: 'PHONE', nameKey: 'guarantor_name' },
  guarantor_email: { channel: 'EMAIL', nameKey: 'guarantor_name' },
};

export function contactChannelOf(fieldKey: string): ContactChannel | null {
  return CONTACT_FIELDS[fieldKey]?.channel ?? null;
}

/**
 * **What evidence needs from `src/scope/`, built at the composition root.**
 *
 * `normalise` returns the stored form of a contact, or raises `invalid`: a phone is approvable only
 * as an Israeli mobile number after `normalisePhone`, an email is folded by `normaliseEmail`.
 * `holder` names the one party holding a value as an open contact on a day, or null when none or
 * more than one does.
 */
export interface ContactRules {
  normalise(channel: ContactChannel, value: string): string;
  /**
   * The value הקריאה offers for approval. A mobile number read without its leading 0 (the 14 Oct
   * read was `549797236`) comes back with it; anything else comes back as read.
   */
  offer(channel: ContactChannel, value: string): string;
  holder(
    db: Queryable,
    spec: { channel: ContactChannel; value: string; day: string },
  ): Promise<string | null>;
}

/** The refusal a phone row raises. Names the rule and never the value: an error is a log line. */
export const NOT_A_MOBILE = 'that phone is not an Israeli mobile number';

/** Why a contact row cannot be approved as offered. The screen words each one. */
export type ContactRefusal = 'not_mobile' | 'not_email' | 'unavailable';

/** One unapproved contact row on הקריאה: what is offered, and why it would be refused. */
export interface ContactRow {
  channel: ContactChannel;
  offered: string;
  refusal: ContactRefusal | null;
  zeroAdded: boolean;
}

/** Why `value` cannot be approved on `channel`, or null when it can. */
export function contactRefusal(
  rules: ContactRules | undefined,
  channel: ContactChannel,
  value: string,
): ContactRefusal | null {
  if (!rules) return 'unavailable';
  try {
    rules.normalise(channel, value);
    return null;
  } catch (error) {
    if (error instanceof KernelError && error.code === 'invalid') {
      return channel === 'PHONE' ? 'not_mobile' : 'not_email';
    }
    throw error;
  }
}
