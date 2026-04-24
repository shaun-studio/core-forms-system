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

export const DEFAULT_CONTACT_SCHEMA: ValidationSchema = {
  name:    { required: true, maxLength: 100 },
  phone:   { required: true, maxLength: 30 },
  email: {
    required: true,
    maxLength: 254,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    patternMessage: 'email is invalid',
  },
  service: { required: true, maxLength: 100 },
  message: { required: true, maxLength: 2000 },
};
