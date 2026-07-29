// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { AllowanceChips } from './AllowanceChips';
import { render, click, type } from './testRender';

function chips(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('input[type="radio"]')) as HTMLElement[];
}
function chipByLabel(container: HTMLElement, label: string): HTMLElement {
  const option = Array.from(container.querySelectorAll('label.dx-allow__option')).find(
    (c) => (c.textContent ?? '').trim().toUpperCase() === label.toUpperCase(),
  );
  const el = option?.querySelector('input[type="radio"]');
  if (!el) throw new Error(`chip "${label}" not found`);
  return el as HTMLElement;
}

describe('AllowanceChips', () => {
  it('renders one radiogroup with $5 / $20 / $50 / Custom', async () => {
    const { container } = await render(<AllowanceChips value={null} onChange={() => {}} />);
    const group = container.querySelector('fieldset');
    expect(group).not.toBeNull();
    const labels = Array.from(container.querySelectorAll('label.dx-allow__option')).map(
      (c) => (c.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['$5', '$20', '$50', 'Custom']);
  });

  it('has NONE selected initially', async () => {
    const { container } = await render(<AllowanceChips value={null} onChange={() => {}} />);
    const checked = chips(container).filter((c) => (c as HTMLInputElement).checked);
    expect(checked).toHaveLength(0);
  });

  it('emits the number string for a preset chip and does not open Custom', async () => {
    const onChange = vi.fn();
    const { container } = await render(<AllowanceChips value={null} onChange={onChange} />);
    await click(chipByLabel(container, '$20'));
    expect(onChange).toHaveBeenCalledWith('20');
    expect(container.querySelector('input[inputmode="decimal"]')).toBeNull();

    await click(chipByLabel(container, '$5'));
    expect(onChange).toHaveBeenLastCalledWith('5');
    await click(chipByLabel(container, '$50'));
    expect(onChange).toHaveBeenLastCalledWith('50');
  });

  it('marks the native radio matching value as checked', async () => {
    const { container } = await render(<AllowanceChips value={'20'} onChange={() => {}} />);
    expect((chipByLabel(container, '$20') as HTMLInputElement).checked).toBe(true);
    expect((chipByLabel(container, '$5') as HTMLInputElement).checked).toBe(false);
  });

  it('selecting Custom reveals a decimal input and emits null when custom is empty', async () => {
    const onChange = vi.fn();
    const { container } = await render(<AllowanceChips value={null} onChange={onChange} />);
    await click(chipByLabel(container, 'Custom'));
    expect(onChange).toHaveBeenCalledWith(null);
    const input = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.getAttribute('inputmode')).toBe('decimal');
    expect(input!.getAttribute('placeholder')).toBe('$ amount');
  });

  it('typing in the custom input emits the raw string', async () => {
    const onChange = vi.fn();
    const { container } = await render(<AllowanceChips value={null} onChange={onChange} />);
    await click(chipByLabel(container, 'Custom'));
    onChange.mockClear();
    await type(container.querySelector('input[inputmode="decimal"]'), '12.50');
    expect(onChange).toHaveBeenLastCalledWith('12.50');
  });

  it('selecting a preset chip after Custom closes the custom input', async () => {
    const onChange = vi.fn();
    const { container, rerender } = await render(<AllowanceChips value={null} onChange={onChange} />);
    await click(chipByLabel(container, 'Custom'));
    await type(container.querySelector('input[inputmode="decimal"]'), '7');
    // consumer echoes value back; then user picks a preset
    await rerender(<AllowanceChips value={'7'} onChange={onChange} />);
    await click(chipByLabel(container, '$50'));
    expect(onChange).toHaveBeenLastCalledWith('50');
    await rerender(<AllowanceChips value={'50'} onChange={onChange} />);
    expect(container.querySelector('input[inputmode="decimal"]')).toBeNull();
  });

  it('uses native radio controls so browser arrow-key and focus behavior is preserved', async () => {
    const { container } = await render(<AllowanceChips value={null} onChange={() => {}} />);
    for (const input of chips(container)) {
      expect((input as HTMLInputElement).type).toBe('radio');
      expect(input.getAttribute('tabindex')).toBeNull();
    }
  });
});
