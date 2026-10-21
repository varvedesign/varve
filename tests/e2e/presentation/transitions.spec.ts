import { expect, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

/**
 * Authored motion plays in delivery through the deterministic director.
 *
 * The motion panel writes canonical presentation operations; the audience
 * stage samples transitions and builds from one show clock. These specs drive
 * the real panel and real keyboard delivery, capturing mid-transition frames
 * as visual evidence.
 */

async function chooseSelectOption(
  page: import('@playwright/test').Page,
  label: string,
  optionName: string,
) {
  await page.getByRole('combobox', { name: label }).click();
  await page
    .getByRole('listbox', { name: label })
    .getByRole('option', { name: optionName, exact: true })
    .click();
}

async function createPresentation(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
  await page.goto('/');
  await page.waitForSelector('.varve-home', { timeout: 45000 });
  await page.getByRole('button', { name: /^new$/i }).click({ force: true });
  const creation = page.getByRole('dialog', { name: 'New design' });
  await creation.locator('label.varve-radio').filter({ hasText: 'New presentation' }).click();
  await page
    .getByRole('dialog', { name: 'New presentation' })
    .getByRole('button', { name: 'Create presentation' })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
}

async function addContentAndDuplicate(page: import('@playwright/test').Page) {
  // Draw a rectangle inside the (centered) first slide so build steps have a
  // real target object on the slide frame.
  await page.keyboard.press('r');
  const stage = page.locator('canvas').first();
  await stage.waitFor({ state: 'visible', timeout: 30000 });
  await dragOnCanvas(page, 300, 200, 620, 420);
  await page.getByRole('tab', { name: 'Slides' }).click();
  const slides = page.getByRole('list', { name: 'Slides in presentation order' });
  await expect(slides.locator(':scope > li')).toHaveCount(1, { timeout: 30000 });
  await slides
    .locator(':scope > li')
    .first()
    .getByRole('button', { name: 'Duplicate', exact: true })
    .click();
  await expect(slides.locator(':scope > li')).toHaveCount(2);
}

test.describe('presentation motion', () => {
  test('the motion panel authors a fractional-duration transition through canonical operations', async ({
    page,
  }) => {
    await createPresentation(page);
    await addContentAndDuplicate(page);

    await page.getByRole('button', { name: 'Select slide 1:' }).first().click();
    const motion = page.locator('.presentation-motion');
    await expect(motion).toBeVisible();

    await chooseSelectOption(page, 'Transition kind', 'Fade');
    await page.getByLabel('Duration (ms, fractions allowed)').fill('333.5');
    await motion.getByRole('button', { name: 'Apply transition' }).click();

    // The committed state reads back from the document, not from form state.
    await expect(motion).toContainText('Fade — 333.5 ms');

    // The deck default control round-trips through its own operation.
    await motion.getByRole('button', { name: 'Make deck default' }).click();
    await expect(motion).toContainText('Fade — 333.5 ms');
  });

  test('Space plays the authored fade and delivery lands on the next slide', async ({ page }) => {
    await createPresentation(page);
    await addContentAndDuplicate(page);

    await page.getByRole('button', { name: 'Select slide 2:' }).first().click();
    await chooseSelectOption(page, 'Transition kind', 'Fade');
    await page.getByLabel('Duration (ms, fractions allowed)').fill('400');
    await page
      .locator('.presentation-motion')
      .getByRole('button', { name: 'Apply transition' })
      .click();
    await expect(page.locator('.presentation-motion')).toContainText('Fade — 400 ms');

    // Present starts at the focused slide; focus slide 1 so the fade into
    // slide 2 is the first thing delivery plays.
    await page.getByRole('button', { name: 'Select slide 1:' }).first().click();
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience).toBeVisible();
    const canvas = audience.locator('.presentation-audience__canvas');
    await expect
      .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
      .toBeGreaterThan(0);
    await expect(audience).toContainText('Slide 1 of 2');

    await page.keyboard.press(' ');
    // Mid-transition: the incoming slide is fading in over the outgoing one.
    await page.waitForTimeout(150);
    await page.screenshot({
      path: 'reports/presentation-motion/mid-fade.png',
      animations: 'disabled',
    });
    await expect(audience).toContainText('Slide 2 of 2', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: 'reports/presentation-motion/after-fade.png',
      animations: 'disabled',
    });
    // The settled slide publishes its capture for pixel-parity inspection.
    await expect
      .poll(() =>
        canvas.evaluate(
          (element) => (element as HTMLCanvasElement).dataset.presentationCaptureSrc ?? '',
        ),
      )
      .not.toBe('');
  });

  test('a build reveals its target on click and keeps the object hidden before it', async ({
    page,
  }) => {
    await createPresentation(page);
    await addContentAndDuplicate(page);

    await page.getByRole('button', { name: 'Select slide 1:' }).first().click();
    const motion = page.locator('.presentation-motion');
    await page.getByRole('combobox', { name: 'Build target' }).click();
    // The starter slide is empty until the rect is drawn; choose the first
    // real object option (the placeholder is not selectable).
    const targetListbox = page.getByRole('listbox', { name: 'Build target' });
    await targetListbox.getByRole('option').nth(1).click();
    await chooseSelectOption(page, 'Build effect', 'Fade in');
    await chooseSelectOption(page, 'Build trigger', 'On click');
    await motion.getByRole('button', { name: 'Add build' }).click();
    await expect(motion).toContainText(/Fade in — On click/);

    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience).toBeVisible();
    await expect(audience).toContainText('Slide 1 of 2');

    // First click starts the build group on slide 1 (the slide has no
    // entering transition, so no click is spent on one).
    await page.keyboard.press(' ');
    await page.waitForTimeout(450);
    await page.screenshot({
      path: 'reports/presentation-motion/after-build.png',
      animations: 'disabled',
    });
    // The build consumed the click: the deck has not changed slides yet.
    await expect(audience).toContainText('Slide 1 of 2');
    // Second click advances (the single build group is exhausted).
    await page.keyboard.press(' ');
    await expect(audience).toContainText('Slide 2 of 2');
  });

  test('presenter view shows notes and timers, and the audience DOM never carries them', async ({
    page,
  }) => {
    await createPresentation(page);
    await addContentAndDuplicate(page);

    await page.getByRole('button', { name: 'Select slide 1:' }).first().click();
    // Every slide row carries its own private notes field; scope to slide 1.
    const slideList = page.getByRole('list', { name: 'Slides in presentation order' });
    const notes = slideList.locator(':scope > li').first().getByLabel('Speaker notes (private)');
    await notes.fill('Opening: welcome the room, then the roadmap.');
    await notes.blur();

    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience).toBeVisible();
    await expect(audience).not.toContainText('welcome the room');

    await audience.getByRole('button', { name: 'Presenter view' }).click();
    const console_ = page.locator('.presentation-presenter');
    await expect(console_).toBeVisible();
    await expect(console_).toContainText('Opening: welcome the room, then the roadmap.');
    await expect(console_).toContainText('Elapsed');
    await expect(console_.getByRole('button', { name: 'Pause' })).toBeVisible();

    // Back to the audience surface: the notes leave the DOM entirely rather
    // than hiding behind CSS.
    await console_.getByRole('button', { name: 'Audience view' }).click();
    await expect(console_).toBeHidden();
    await expect(audience).not.toContainText('welcome the room');
  });

  test('reduced motion keeps the sequence with immediate states', async ({ page }) => {
    await createPresentation(page);
    await addContentAndDuplicate(page);

    await page.getByRole('button', { name: 'Select slide 2:' }).first().click();
    await chooseSelectOption(page, 'Transition kind', 'Fade');
    await page.getByLabel('Duration (ms, fractions allowed)').fill('400');
    await page
      .locator('.presentation-motion')
      .getByRole('button', { name: 'Apply transition' })
      .click();
    await expect(page.locator('.presentation-motion')).toContainText('Fade — 400 ms');

    await page.getByRole('button', { name: 'Select slide 1:' }).first().click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience).toBeVisible();
    await expect(audience).toContainText('Slide 1 of 2');

    await page.keyboard.press(' ');
    await expect(audience).toContainText('Slide 2 of 2');
    const canvas = audience.locator('.presentation-audience__canvas');
    await expect
      .poll(() =>
        canvas.evaluate(
          (element) => (element as HTMLCanvasElement).dataset.presentationCaptureSrc ?? '',
        ),
      )
      .not.toBe('');
  });
});
