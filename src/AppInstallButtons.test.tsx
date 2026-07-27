// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppInstallButtons,
  claudeCodeInstallCommand,
  cursorInstallUrl,
  ensureAppInstallStyles,
  hermesInstallCommand,
  hermesOpenUrl,
  vscodeInstallUrl,
} from './AppInstallButtons';
import { click, flush, render } from './testRender';

const MCP_URL = 'https://open.dexter.cash/mcp';

function installButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('button.dx-appbtn');
  if (!button) throw new Error('install button not found');
  return button as HTMLButtonElement;
}

function mockClipboard(writeText: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * The install-link builders are load-bearing: each one must match the current
 * client contract exactly or the first click dead-ends.
 */
describe('AppInstallButtons — install-link builders', () => {
  it('cursor: documented deeplink with base64({url}) config', () => {
    const link = cursorInstallUrl('opendexter', MCP_URL);
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=opendexter&config=')).toBe(true);
    const b64 = decodeURIComponent(link.split('config=')[1]);
    expect(JSON.parse(atob(b64))).toEqual({ url: MCP_URL });
  });

  it('vscode: documented vscode:mcp/install with URL-encoded stringified config', () => {
    const link = vscodeInstallUrl('opendexter', MCP_URL);
    expect(link.startsWith('vscode:mcp/install?')).toBe(true);
    const json = decodeURIComponent(link.slice('vscode:mcp/install?'.length));
    expect(JSON.parse(json)).toEqual({ name: 'opendexter', type: 'http', url: MCP_URL });
  });

  it('hermes: marks the remote MCP for OAuth and keeps launch/focus separate', () => {
    expect(hermesInstallCommand('opendexter', MCP_URL)).toBe(
      `hermes mcp add opendexter --url ${MCP_URL} --auth oauth`,
    );
    expect(hermesOpenUrl('open dexter')).toBe('hermes://open/open%20dexter');
  });

  it('claude code: installs the remote HTTP MCP at user scope', () => {
    expect(claudeCodeInstallCommand('opendexter', MCP_URL)).toBe(
      `claude mcp add --scope user --transport http opendexter ${MCP_URL}`,
    );
  });
});

describe('AppInstallButtons — copy journey', () => {
  it('copies the Hermes OAuth command without navigating, then offers explicit launch/focus', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onAction = vi.fn();
    mockClipboard(writeText);
    const before = window.location.href;
    const view = await render(
      <AppInstallButtons apps={['hermes']} onAction={onAction} />,
    );

    await click(installButton(view.container));
    await flush();

    expect(writeText).toHaveBeenCalledWith(
      `hermes mcp add opendexter --url ${MCP_URL} --auth oauth`,
    );
    expect(window.location.href).toBe(before);
    expect(installButton(view.container).textContent).toContain('Copied. Run it in your terminal');
    expect(view.container.textContent).toContain('It adds the hosted MCP with OAuth.');
    const open = view.container.querySelector('a.dx-appinstall__open');
    expect(open?.textContent).toBe('Open Hermes');
    expect(open?.getAttribute('href')).toBe('hermes://open/opendexter');
    expect(view.container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Add opendexter to an agent app',
    );
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('hermes', 'copied');

    await view.unmount();
  });

  it('keeps the Hermes launch/focus action stable and keyboard reachable', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onAction = vi.fn();
    mockClipboard(writeText);
    const view = await render(
      <AppInstallButtons apps={['hermes']} onAction={onAction} />,
    );

    await click(installButton(view.container));
    await flush();

    const open = view.container.querySelector('a.dx-appinstall__open') as HTMLAnchorElement | null;
    expect(open?.tagName).toBe('A');
    expect(open?.tabIndex).toBe(0);
    open?.focus();
    expect(document.activeElement).toBe(open);

    vi.advanceTimersByTime(10_000);
    expect(view.container.querySelector('a.dx-appinstall__open')).toBe(open);
    expect(document.activeElement).toBe(open);

    await click(open);
    expect(onAction).toHaveBeenLastCalledWith('hermes', 'deeplink');

    await view.unmount();
  });

  it('disables a copy action while clipboard permission is pending', async () => {
    let finishCopy!: () => void;
    const writeText = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishCopy = resolve;
      }),
    );
    mockClipboard(writeText);
    const view = await render(<AppInstallButtons apps={['hermes']} />);
    const button = installButton(view.container);

    await click(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('Copying OAuth setup');

    finishCopy();
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');

    await view.unmount();
  });

  it('fails closed when Hermes command copying is denied and exposes a selectable command', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    const onAction = vi.fn();
    mockClipboard(writeText);
    const before = window.location.href;
    const view = await render(
      <AppInstallButtons apps={['hermes']} onAction={onAction} />,
    );

    await click(installButton(view.container));
    await flush();

    expect(window.location.href).toBe(before);
    expect(onAction).not.toHaveBeenCalled();
    expect(installButton(view.container).textContent).toContain('Try copying for Hermes');
    const alert = view.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't copy");
    const command = alert?.querySelector('input[readonly]') as HTMLInputElement | null;
    expect(command?.value).toBe(
      `hermes mcp add opendexter --url ${MCP_URL} --auth oauth`,
    );
    expect(installButton(view.container).getAttribute('aria-describedby')).toBe(alert?.id);
    expect(view.container.querySelector('a.dx-appinstall__open')).toBeNull();

    await view.unmount();
  });

  it('copies a user-scoped Claude Code command and names the native OAuth next step', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const view = await render(<AppInstallButtons apps={['claude-code']} />);

    await click(installButton(view.container));
    await flush();

    expect(writeText).toHaveBeenCalledWith(
      `claude mcp add --scope user --transport http opendexter ${MCP_URL}`,
    );
    expect(view.container.textContent).toContain("Claude Code's /mcp menu");

    await view.unmount();
  });
});

describe('AppInstallButtons — interaction styling', () => {
  it('keeps touch targets, narrow layouts, focus, and reduced motion in the shared source', () => {
    ensureAppInstallStyles();
    const css = document.getElementById('dexter-connect-appinstall-styles')?.textContent ?? '';

    expect(css).toContain('min-height:44px');
    expect(css).toContain('@media (max-width:560px)');
    expect(css).toContain('@media (hover:hover) and (pointer:fine)');
    expect(css).toContain('@media (prefers-reduced-motion:reduce)');
    expect(css).toContain('outline:2px solid var(--dx-ember,#f26c18)');
    expect(css).toMatch(/\.dx-appinstall__open\{[^}]*min-height:44px/);
    expect(css).not.toContain('transition:all');
  });
});
