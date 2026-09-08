import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const surfaceMatrix = Object.freeze({
  compact: Object.freeze({ viewport: { width: 375, height: 812 }, colorScheme: 'light', reducedMotion: 'reduce', fontScale: 2 }),
  medium: Object.freeze({ viewport: { width: 768, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce', fontScale: 2 }),
  desktop: Object.freeze({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'no-preference', fontScale: 1 }),
});

export async function newSurfaceContext(browser, surface = surfaceMatrix.desktop) {
  return browser.newContext({
    viewport: surface.viewport,
    colorScheme: surface.colorScheme,
    reducedMotion: surface.reducedMotion,
  });
}

export async function applyFontScale(page, fontScale) {
  await page.evaluate((scale) => {
    document.documentElement.style.setProperty('font-size', `${scale * 100}%`);
  }, fontScale);
}

export async function focusNext(page) {
  await page.keyboard.press('Tab');
  return page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? '');
}

export async function computedToken(page, selector, property) {
  return page.locator(selector).evaluate((element, name) =>
    getComputedStyle(element).getPropertyValue(name), property);
}

export async function saveStableSurfaceScreenshot(page, name) {
  const directory = resolve('output/playwright');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' });
}
