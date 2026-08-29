import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { useDexterIdentity } from './useDexterIdentity';

describe('useDexterIdentity SSR', () => {
  it('renders hydrating without exposing account data', () => {
    function Probe() {
      const { identity, relation } = useDexterIdentity({
        accountSession: {
          status: 'authenticated',
          accessToken: 'server-token',
        },
      });
      return (
        <span>
          {relation.runtime.phase}:{String(identity.hasAccountAccess)}:
          {identity.accountToken ?? 'none'}
        </span>
      );
    }

    const html = renderToString(<Probe />);
    expect(html).toContain('hydrating');
    expect(html).toContain('false');
    expect(html).toContain('none');
  });
});
