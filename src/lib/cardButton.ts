import type { KeyboardEvent } from 'react';

/**
 * Project cards copy Light's markup (a clickable <div>), which a keyboard or a screen reader cannot use
 * (10/29: the ラボ 新規ファイル card did not show up as a control at all). Spread this on such a card so it is a
 * focusable button that also opens on Enter and Space; keys pressed on buttons inside the card are left alone.
 */
export const cardButton = (activate: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: activate,
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    activate();
  },
});
