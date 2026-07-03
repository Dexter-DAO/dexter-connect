// @vitest-environment happy-dom
// Minimal React test-render helper for the SDK's component tests. Uses the
// already-present react-dom/client + React 19's act() — no @testing-library, so
// the only new devDep is happy-dom (per-file `@vitest-environment` pragma above,
// mirrored in every *.test.tsx). Not shipped (excluded from the tsup entries).

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React's act() insists on this flag in a test environment; without it every
// render logs a warning. Set once at import.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderHandle {
  container: HTMLElement;
  rerender: (ui: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
}

export async function render(ui: ReactElement): Promise<RenderHandle> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Click a DOM node inside an act() batch so state updates flush. */
export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('click: element not found');
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

/** Fire a keydown (with a real KeyboardEvent so preventDefault is observable). */
export async function keydown(el: Element | null | undefined, key: string): Promise<boolean> {
  if (!el) throw new Error('keydown: element not found');
  const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    (el as HTMLElement).dispatchEvent(ev);
  });
  return ev.defaultPrevented;
}

/** Set an <input> value and fire the React change (input event). */
export async function type(el: Element | null | undefined, value: string): Promise<void> {
  if (!el) throw new Error('type: element not found');
  const input = el as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

/** Flush microtasks/promises inside act (for async ceremony callbacks). */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
