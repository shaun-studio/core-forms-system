export type ApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
};

export function jsonResponse(data: ApiResponse, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function successResponse(message = 'Message received successfully'): Response {
  return jsonResponse({ ok: true, message }, 200);
}

export function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ ok: false, error }, status);
}

export function serverError(err?: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Form submission error:', msg);
  return jsonResponse({ ok: false, error: 'Server error' }, 500);
}
