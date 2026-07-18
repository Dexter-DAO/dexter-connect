// The one shared copy of the error-code reader — previously duplicated in
// relay.ts, enroll.ts, and anon-policy.ts (three drifting copies of the same
// eight lines). Behavior is byte-identical to those copies.

/** Read the server's snake_case `error` field; fall back to an http_<status> code. */
export async function readErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // non-JSON body — fall through
  }
  return `http_${res.status}`;
}
