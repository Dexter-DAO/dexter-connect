import { describe, it, expect } from 'vitest';
import { readErrorCode } from './httpError';

// The single shared copy of the helper previously duplicated in relay.ts,
// enroll.ts, and anon-policy.ts — behavior must match those byte-for-byte.
describe('readErrorCode', () => {
  it('returns the server snake_case error field when present', async () => {
    const res = { status: 400, json: async () => ({ error: 'credential_not_found' }) } as Response;
    await expect(readErrorCode(res)).resolves.toBe('credential_not_found');
  });

  it('falls back to http_<status> when the body has no error field', async () => {
    const res = { status: 502, json: async () => ({ detail: 'boom' }) } as Response;
    await expect(readErrorCode(res)).resolves.toBe('http_502');
  });

  it('falls back to http_<status> when the body is not JSON', async () => {
    const res = { status: 500, json: async () => { throw new SyntaxError('not json'); } } as unknown as Response;
    await expect(readErrorCode(res)).resolves.toBe('http_500');
  });
});
