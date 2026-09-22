// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldConfig = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
};

export type ValidationSchema = Record<string, FieldConfig>;

export type ValidationResult = {
  valid: boolean;
  errors: Record<string, string>;
};

// ─── Engine ───────────────────────────────────────────────────────────────────

export function validateFields(
  data: Record<string, string>,
  schema: ValidationSchema
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const [field, config] of Object.entries(schema)) {
    const value = data[field] ?? '';

    if (config.required && !value) {
      errors[field] = `${field} is required`;
      continue;
    }

    if (value && config.minLength && value.length < config.minLength) {
      errors[field] = `${field} must be at least ${config.minLength} characters`;
    }

    if (value && config.maxLength && value.length > config.maxLength) {
      errors[field] = `${field} must be no more than ${config.maxLength} characters`;
    }

    if (value && config.pattern && !config.pattern.test(value)) {
      errors[field] = config.patternMessage ?? `${field} is invalid`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ─── Error formatting ─────────────────────────────────────────────────────────

/** Field key → the wording a visitor recognises from the form itself. */
export const FIELD_LABELS: Record<string, string> = {
  name:     'Name',
  email:    'Email address',
  phone:    'Phone number',
  service:  'Service',
  location: 'Location',
  message:  'Message',
  number:   'Number',
};

/**
 * Turns the raw errors from validateFields into one sentence a visitor can act
 * on. The messages are keyed by field name, which is also how each raw message
 * starts, so the leading token is swapped for the label.
 *
 * Replaces a blanket "Missing required fields", which was wrong whenever the
 * failure was a length or pattern violation rather than an absent value, and
 * never said which of the fields to go and fix.
 */
export function describeValidationErrors(
  errors: Record<string, string>,
  labels: Record<string, string> = FIELD_LABELS
): string {
  const sentences = Object.entries(errors).map(([field, message]) => {
    const label = labels[field] ?? field;
    // A custom patternMessage may not start with the field key. Prefixing the
    // label onto one of those produces nonsense, so it is passed through whole.
    if (!message.startsWith(field)) return message.trim().replace(/\.?$/, '.');
    const rest = message.slice(field.length).trimStart();
    return `${label} ${rest}`.trim().replace(/\.?$/, '.');
  });
  return sentences.length ? sentences.join(' ') : 'Please check the form and try again.';
}

// ─── Preset schemas ───────────────────────────────────────────────────────────

/**
 * Minimal universal schema: requires only name, email, phone.
 * Optional fields (service, message, number) are length-validated if present.
 * Use this as the default for any contact form.
 */
export const CONTACT_SCHEMA: ValidationSchema = {
  name: { required: true, maxLength: 100 },
  phone: { required: true, maxLength: 30 },
  email: {
    required: true,
    maxLength: 254,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    patternMessage: 'email is invalid',
  },
  service:  { maxLength: 100 },
  location: { maxLength: 200 },
  message:  { maxLength: 2000 },
  number:   { maxLength: 100 },
};

/**
 * Extended schema: also requires service and message.
 * Use when your form collects both fields and both are mandatory.
 */
export const CONTACT_SCHEMA_FULL: ValidationSchema = {
  ...CONTACT_SCHEMA,
  service: { required: true, maxLength: 100 },
  message: { required: true, maxLength: 2000 },
};
