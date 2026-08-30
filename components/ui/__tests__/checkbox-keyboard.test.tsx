import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockCheckboxRootProps = {
  children?: unknown;
  onKeyDown?: (event: {
    key: string;
    preventBaseUIHandler: () => void;
  }) => void;
};

const { capturedRootProps } = vi.hoisted(() => ({
  capturedRootProps: {
    current: null as MockCheckboxRootProps | null,
  },
}));

vi.mock('@base-ui/react/checkbox', async () => {
  const { createElement } = await import('react');
  return {
    Checkbox: {
      Root: (props: MockCheckboxRootProps) => {
        capturedRootProps.current = props;
        return createElement(
          'span',
          { 'data-slot': 'mock-checkbox-root' },
          props.children as ReactNode,
        );
      },
      Indicator: (props: Record<string, unknown>) => {
        const indicatorProps = { ...props };
        delete indicatorProps.keepMounted;
        return createElement('span', indicatorProps);
      },
    },
  };
});

import { Checkbox } from '@/components/ui/checkbox';

describe('Checkbox keyboard contract', () => {
  beforeEach(() => {
    capturedRootProps.current = null;
  });

  it('prevents Base UI Enter handling while leaving Space untouched', () => {
    const consumerOnKeyDown = vi.fn();

    renderToStaticMarkup(
      <Checkbox aria-label="急单" onKeyDown={consumerOnKeyDown} />,
    );

    expect(capturedRootProps.current?.onKeyDown).toBeTypeOf('function');

    const enterEvent = {
      key: 'Enter',
      preventBaseUIHandler: vi.fn(),
    };
    capturedRootProps.current?.onKeyDown?.(enterEvent);
    expect(consumerOnKeyDown).toHaveBeenCalledWith(enterEvent);
    expect(enterEvent.preventBaseUIHandler).toHaveBeenCalledTimes(1);

    const spaceEvent = {
      key: ' ',
      preventBaseUIHandler: vi.fn(),
    };
    capturedRootProps.current?.onKeyDown?.(spaceEvent);
    expect(consumerOnKeyDown).toHaveBeenCalledWith(spaceEvent);
    expect(spaceEvent.preventBaseUIHandler).not.toHaveBeenCalled();
  });
});
