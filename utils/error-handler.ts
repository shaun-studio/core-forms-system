// ─── Response contract ────────────────────────────────────────────────────────
// All form submissions return this shape — success or failure.

export type FormResponseData = {
  name: string;
  email: string;
  phone: string;
  number?: string;
  service?: string;
};

export type FormResponse = {
  success: boolean;
  message: string;
  referenceId: string;
  data?: FormResponseData;
};

// ─── Serialisation ────────────────────────────────────────────────────────────

export function jsonResponse(body: FormResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Response builders ────────────────────────────────────────────────────────

export function successResponse(
  data: FormResponseData,
  referenceId: string,
  message = 'Message received successfully'
): Response {
  return jsonResponse({ success: true, message, referenceId, data }, 200);
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, message, referenceId: '' }, status);
}

export function serverError(err?: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Form submission error:', msg);
  return jsonResponse({ success: false, message: 'Server error', referenceId: '' }, 500);
}
