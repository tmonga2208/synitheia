import { describe, expect, it, vi } from 'vitest';
import { goBackOrHome } from './goBackOrHome.js';

function fakeRouter(canGoBack: boolean) {
  return { canGoBack: () => canGoBack, back: vi.fn(), replace: vi.fn() };
}

describe('goBackOrHome', () => {
  it('goes back when there is a screen to go back to', () => {
    const router = fakeRouter(true);

    goBackOrHome(router);

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('goes to Today when this is the only screen there is', () => {
    // Opened from Health Connect's "privacy policy" link while the app was not in memory.
    const router = fakeRouter(false);

    goBackOrHome(router);

    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
  });
});
