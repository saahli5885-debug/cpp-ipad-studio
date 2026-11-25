import type { EffectiveLayout, LayoutPreference } from '../types/compiler';

export type WordWrapPreference = 'auto' | 'on' | 'off';

export const MIN_SPLIT_RATIO = 0.28;
export const MAX_SPLIT_RATIO = 0.74;

/**
 * Resolves the optimal workspace layout for Full HD monitors, desktops,
 * 11-inch iPad Air M2 landscape (1180x820), iPad 50/50 Split View (~585x820),
 * iPad portrait (820x1180), and narrow Slide Over / mobile (<520px).
 */
export function resolveEffectiveLayout(
  preference: LayoutPreference,
  viewportWidth: number,
  viewportHeight: number
): EffectiveLayout {
  if (preference !== 'auto') {
    if (preference === 'side-by-side' && viewportWidth < 480) {
      return 'tabs';
    }
    return preference;
  }

  // Wide screens (Full HD 1920x1080, Desktop 1440x900, iPad Air 11" full landscape 1180x820)
  if (viewportWidth >= 860) {
    return 'side-by-side';
  }

  // Medium widths (iPad Air 11" 50/50 Split View ~585x820, 2/3 Split View ~663x820, Portrait 820x1180)
  if (viewportWidth >= 520 && viewportHeight >= 520) {
    return 'stacked';
  }

  // Narrow iPad 1/3 Split View / Slide Over / mobile
  return 'tabs';
}

/**
 * Automatically enables line wrapping when the screen shrinks to half-screen
 * (<= 980px, covering half of Full HD and iPad Split View) or when the editor
 * pane itself is narrowed (<= 680px, e.g. dragging the divider left on iPad/desktop).
 */
export function resolveWordWrap(
  preference: WordWrapPreference,
  viewportWidth: number,
  editorWidth?: number
): boolean {
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  if (viewportWidth <= 980) return true;
  if (editorWidth !== undefined && editorWidth > 0 && editorWidth <= 680) return true;
  return false;
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.56;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function getDefaultSplitRatio(viewportWidth: number): number {
  if (viewportWidth >= 1600) return 0.58; // Full HD 1920x1080
  if (viewportWidth >= 1100) return 0.56; // Desktop 1440 & iPad Air 11" full screen
  return 0.54;
}
