export type TurnstileResult = {
  success: boolean;
  errorCodes?: string[];
};

export async function verifyTurnstile(
  secretKey: string,
  token: string,
  clientIp?: string
): Promise<TurnstileResult> {
  const body: Record<string, string> = {
    secret:   secretKey,
    response: token,
  };
  if (clientIp) body['remoteip'] = clientIp;

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };

  return {
    success:    data.success,
    errorCodes: data['error-codes'],
  };
}
