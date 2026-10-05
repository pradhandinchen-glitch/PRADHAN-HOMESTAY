export function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  const configuredSite = Deno.env.get('SITE_URL');
  const allowed = new Set([
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    ...(configuredSite ? [new URL(configuredSite).origin] : []),
  ]);

  return allowed.has(origin) ? origin : null;
}

export function corsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request) ?? 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

export function isAllowedOrigin(request: Request): boolean {
  return request.headers.has('origin') && allowedOrigin(request) !== null;
}
