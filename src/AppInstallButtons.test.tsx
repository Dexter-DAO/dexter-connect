import { describe, it, expect } from 'vitest';

import {
  cursorInstallUrl,
  vscodeInstallUrl,
  hermesInstallCommand,
  claudeCodeInstallCommand,
} from './AppInstallButtons';

/**
 * The install-link builders are the load-bearing part: each one must match the
 * app vendor's documented format exactly, or the click dead-ends.
 */
describe('AppInstallButtons — install-link builders', () => {
  const url = 'https://open.dexter.cash/mcp';

  it('cursor: documented deeplink with base64({url}) config', () => {
    const link = cursorInstallUrl('opendexter', url);
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=opendexter&config=')).toBe(true);
    const b64 = decodeURIComponent(link.split('config=')[1]);
    expect(JSON.parse(Buffer.from(b64, 'base64').toString())).toEqual({ url });
  });

  it('vscode: documented vscode:mcp/install with URL-encoded stringified config', () => {
    const link = vscodeInstallUrl('opendexter', url);
    expect(link.startsWith('vscode:mcp/install?')).toBe(true);
    const json = decodeURIComponent(link.slice('vscode:mcp/install?'.length));
    expect(JSON.parse(json)).toEqual({ name: 'opendexter', type: 'http', url });
  });

  it('hermes: the CLI add command with oauth on first connect', () => {
    expect(hermesInstallCommand('opendexter', url)).toBe(
      `hermes mcp add opendexter --url ${url} --auth oauth`,
    );
  });

  it('claude code: http-transport add command', () => {
    expect(claudeCodeInstallCommand('opendexter', url)).toBe(
      `claude mcp add --transport http opendexter ${url}`,
    );
  });
});
