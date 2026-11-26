import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button.js';
import { Field, Input } from './field.js';
import { Badge, KpiTile } from './surfaces.js';

describe('Field', () => {
  it('links the label, and announces the error instead of the hint', () => {
    const { rerender } = render(
      <Field label="Mobile number" hint="For example 712 345 678">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Mobile number');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'For example 712 345 678',
    );

    rerender(
      <Field label="Mobile number" hint="For example 712 345 678" error="Enter a valid number">
        <Input />
      </Field>,
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid number');
    expect(screen.queryByText('For example 712 345 678')).toBeNull();
  });
});

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('can style a link instead of rendering a button', () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Go' }).className).toContain('rounded-lg');
  });
});

describe('KpiTile', () => {
  it('shows an explicit "no data" state instead of a fake zero', () => {
    render(<KpiTile label="Stock on hand" value={null} unit="kg" />);
    expect(screen.getByLabelText('No data yet')).toBeTruthy();
    expect(screen.queryByText('kg')).toBeNull();
  });
});

describe('Badge', () => {
  it('marks provenance with a shape as well as colour', () => {
    const { container } = render(<Badge tone="forecast">Forecast</Badge>);
    expect(container.querySelector('[aria-hidden]')?.className).toContain('border-dashed');
  });
});
