export type TurnstileResult = {
  success: boolean;
  errorCodes?: string[];
  /** Raw siteverify fields — relayed to Leads Hub as the site-verified
   *  verdict so the hub never re-spends the single-use token. */
  hostname?: string;
  challengeTs?: string;
  action?: string;
  cdata?: string;
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

  const data = (await res.json()) as {
    success: boolean;
    'error-codes'?: string[];
    hostname?: string;
    challenge_ts?: string;
    action?: string;
    cdata?: string;
  };

  return {
    success:     data.success,
    errorCodes:  data['error-codes'],
    hostname:    data.hostname,
    challengeTs: data.challenge_ts,
    action:      data.action,
    cdata:       data.cdata,
  };
}
