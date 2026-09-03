/**
 * Is the server reachable? Nothing more.
 *
 * The connectivity store polls this while it believes the device is offline.
 * It is deliberately unauthenticated and returns no body: the answer must not
 * depend on a session that may itself have expired during the outage, and the
 * request must stay cheap enough to repeat every few seconds on mobile data.
 */
export const dynamic = "force-dynamic";

function pong() {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export function HEAD() {
  return pong();
}

export function GET() {
  return pong();
}
