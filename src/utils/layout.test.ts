import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSplitRatio,
  getDefaultSplitRatio,
  resolveEffectiveLayout,
  resolveWordWrap,
} from './layout';

test('resolves side-by-side on Full HD, desktop, and iPad Air 11-inch landscape', () => {
  assert.equal(resolveEffectiveLayout('auto', 1920, 1080), 'side-by-side');
  assert.equal(resolveEffectiveLayout('auto', 1440, 900), 'side-by-side');
  assert.equal(resolveEffectiveLayout('auto', 1180, 820), 'side-by-side');
});

test('resolves stacked split on iPad Air 11-inch 50/50 Split View and iPad portrait', () => {
  assert.equal(resolveEffectiveLayout('auto', 585, 820), 'stacked');
  assert.equal(resolveEffectiveLayout('auto', 585, 640), 'stacked');
  assert.equal(resolveEffectiveLayout('auto', 820, 1180), 'stacked');
});

test('resolves tabs on narrow iPad Slide Over and mobile viewports', () => {
  assert.equal(resolveEffectiveLayout('auto', 390, 844), 'tabs');
  assert.equal(resolveEffectiveLayout('auto', 460, 820), 'tabs');
});

test('respects all 3 explicit layout modes including tabs on wide screens', () => {
  assert.equal(resolveEffectiveLayout('stacked', 1920, 1080), 'stacked');
  assert.equal(resolveEffectiveLayout('tabs', 1920, 1080), 'tabs');
  assert.equal(resolveEffectiveLayout('tabs', 585, 820), 'tabs');
  assert.equal(resolveEffectiveLayout('side-by-side', 585, 820), 'side-by-side');
  assert.equal(resolveEffectiveLayout('side-by-side', 390, 844), 'tabs');
});

test('enables word wrap automatically at half-screen / iPad Split View and respects overrides', () => {
  assert.equal(resolveWordWrap('auto', 1920, 1100), false);
  assert.equal(resolveWordWrap('auto', 1440, 800), false);
  assert.equal(resolveWordWrap('auto', 960, 960), true); // Half of Full HD
  assert.equal(resolveWordWrap('auto', 585, 330), true); // iPad 50/50 Split View
  assert.equal(resolveWordWrap('auto', 1180, 500), true); // Narrow side-by-side editor pane
  assert.equal(resolveWordWrap('on', 1920, 1100), true);
  assert.equal(resolveWordWrap('off', 585, 330), false);
});

test('clamps split ratio within safe bounds and adapts defaults', () => {
  assert.equal(clampSplitRatio(0.1), 0.28);
  assert.equal(clampSplitRatio(0.95), 0.74);
  assert.equal(clampSplitRatio(0.5), 0.5);
  assert.equal(clampSplitRatio(Number.NaN), 0.56);
  assert.equal(getDefaultSplitRatio(1920), 0.58);
  assert.equal(getDefaultSplitRatio(1180), 0.56);
});
