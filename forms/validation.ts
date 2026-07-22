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
