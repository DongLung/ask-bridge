'use strict';

(function initializeModelSelection(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AskBridgeModelSelection = api;
})(typeof globalThis === 'object' ? globalThis : this, function createModelSelection() {
  function normalizeLabel(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '');
  }

  function parseMenuEntry(input) {
    const source = typeof input === 'string' ? { text: input } : (input || {});
    const lines = String(source.text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const selectedPrefix = /^(?:selected|已選取|已选中)\s*[:：]?\s*/i;
    const textMarksSelected = Boolean(lines[0] && selectedPrefix.test(lines[0]));
    if (textMarksSelected) {
      lines[0] = lines[0].replace(selectedPrefix, '').trim();
      if (!lines[0]) lines.shift();
    }
    const badgeText = String(source.badgeText || '').trim();
    const secondaryLines = lines.slice(1).filter((line) => line !== badgeText);
    const selectedValues = [
      source.ariaChecked,
      source.ariaSelected,
      source.dataSelected,
      source.dataState,
    ].map((value) => String(value || '').toLowerCase());

    return {
      primaryLabel: lines[0] || '',
      secondaryDescription: secondaryLines.join(' '),
      badgeText,
      selected: textMarksSelected
        || selectedValues.some((value) => ['true', 'checked', 'selected'].includes(value)),
      element: source.element,
    };
  }

  function labelsMatch(label, aliases) {
    const normalized = normalizeLabel(label);
    return Boolean(normalized) && aliases.some((alias) => normalizeLabel(alias) === normalized);
  }

  function findMatchingEntry(entries, aliases) {
    return entries.find((entry) => labelsMatch(entry.primaryLabel, aliases));
  }

  function availablePrimaryLabels(entries) {
    return [...new Set(entries.map((entry) => entry.primaryLabel).filter(Boolean))];
  }

  function selectionVerified(entry, pickerText, verificationAliases) {
    return Boolean(
      (entry && entry.selected)
      || labelsMatch(parseMenuEntry(pickerText).primaryLabel, verificationAliases),
    );
  }

  function textOf(element) {
    return element
      ? (element.innerText || element.textContent || element.getAttribute('aria-label') || '')
      : '';
  }

  function entryFromElement(element) {
    const badge = element.querySelector
      ? element.querySelector('[data-testid*="badge"], [class*="badge"]')
      : null;
    const selectedDescendant = element.querySelector
      ? element.querySelector(
        '[aria-checked="true"], [aria-selected="true"], [data-selected="true"], [data-state="checked"]',
      )
      : null;
    return parseMenuEntry({
      text: textOf(element),
      ariaChecked: element.getAttribute('aria-checked')
        || (selectedDescendant && selectedDescendant.getAttribute('aria-checked')),
      ariaSelected: element.getAttribute('aria-selected')
        || (selectedDescendant && selectedDescendant.getAttribute('aria-selected')),
      dataSelected: element.getAttribute('data-selected')
        || (selectedDescendant && selectedDescendant.getAttribute('data-selected')),
      dataState: element.getAttribute('data-state')
        || (selectedDescendant && selectedDescendant.getAttribute('data-state')),
      badgeText: textOf(badge),
      element,
    });
  }

  function visibleElements(selector) {
    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      // ChatGPT keeps inactive picker views mounted but inert.
      if (typeof element.closest === 'function' && element.closest('[inert], [aria-hidden="true"]')) {
        return false;
      }
      if (typeof element.getClientRects !== 'function') return true;
      return element.getClientRects().length > 0;
    });
  }

  function isChatGptPickerControl(element) {
    return element.getAttribute('data-model-picker-view-toggle') !== null
      || element.getAttribute('data-reasoning-slider') !== null;
  }

  function dispatchClick(element) {
    if (typeof PointerEvent === 'function') {
      const pointerOptions = {
        bubbles: true,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
      };
      element.dispatchEvent(new PointerEvent('pointerdown', pointerOptions));
      element.dispatchEvent(new PointerEvent('pointerup', pointerOptions));
    } else {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
    element.click();
  }

  function dispatchHover(element) {
    if (typeof PointerEvent === 'function') {
      const pointerOptions = {
        bubbles: true,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
      };
      element.dispatchEvent(new PointerEvent('pointerenter', pointerOptions));
      element.dispatchEvent(new PointerEvent('pointermove', pointerOptions));
    } else {
      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    }
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  function findPicker(provider) {
    if (provider === 'chatgpt') {
      return document.querySelector('button.__composer-pill')
        || document.querySelector('button[data-codex-intelligence-trigger]');
    }
    if (provider === 'gemini') {
      return visibleElements('button').find((button) => (
        /模式挑選器|model picker|mode picker/i.test([
          button.getAttribute('aria-label'),
          button.textContent,
        ].filter(Boolean).join(' '))
      ));
    }
    return undefined;
  }

  function parseSliderStatusLabel(text) {
    return String(text || '').split(/[，,。]/)[0].trim();
  }

  function readSliderLabel(slider) {
    const ids = (slider.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const status = document.getElementById(id);
      if (status && status.getAttribute('role') === 'status') {
        const label = parseSliderStatusLabel(status.textContent);
        if (label) return label;
      }
    }
    const thumb = slider.querySelector('[role="slider"]');
    return thumb ? parseSliderStatusLabel(thumb.getAttribute('aria-valuetext')) : '';
  }

  function readSliderPosition(slider) {
    const thumb = slider.querySelector('[role="slider"]');
    const now = Number(thumb && thumb.getAttribute('aria-valuenow'));
    const max = Number(thumb && thumb.getAttribute('aria-valuemax'));
    return {
      now: Number.isFinite(now) ? now : 0,
      max: Number.isFinite(max) && max > 0 ? max : 10,
    };
  }

  async function pressSliderKey(slider, key, sleep) {
    if (typeof slider.focus === 'function') slider.focus();
    slider.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
    }));
    await sleep(200);
  }

  // Walks a stepped slider from its first stop to the last, stopping at the
  // stop whose label matches the target. Restores the original stop when no
  // label matches so a failed request leaves the user's setting untouched.
  async function selectSliderOption(slider, config) {
    const { readLabel, readPosition, press } = slider;
    const available = [];
    const initialLabel = readLabel();
    if (labelsMatch(initialLabel, config.targetAliases)) {
      return { ok: true, selected: initialLabel, available: [initialLabel] };
    }

    const { now, max } = readPosition();
    for (let step = 0; step < now; step += 1) await press('ArrowLeft');

    for (let index = 0; index <= max; index += 1) {
      const label = readLabel();
      if (label && !available.includes(label)) available.push(label);
      if (labelsMatch(label, config.targetAliases)) {
        if (!labelsMatch(label, config.verificationAliases)) {
          return { ok: false, error: `selection could not be verified for ${label}`, available };
        }
        return { ok: true, selected: label, available };
      }
      if (index < max) await press('ArrowRight');
    }

    const { now: last } = readPosition();
    for (let step = last; step > now; step -= 1) await press('ArrowLeft');
    return { ok: false, error: 'option not found', available };
  }

  async function findProviderOption(config, menuSelector, available, sleep) {
    const visited = new Set();
    const maxDepth = config.provider === 'chatgpt' ? 6 : 1;

    for (let depth = 0; depth < maxDepth; depth += 1) {
      const elements = visibleElements(menuSelector);
      const entries = elements.map(entryFromElement);
      entries.forEach((entry) => available.add(entry.primaryLabel));
      const leaves = entries.filter(
        (entry) => entry.element.getAttribute('aria-haspopup') !== 'menu'
          && !isChatGptPickerControl(entry.element),
      );
      const chosen = findMatchingEntry(leaves, config.targetAliases);
      if (chosen || config.provider !== 'chatgpt') return chosen;

      // The redesigned ChatGPT picker shows the reasoning slider first and
      // reveals model choices through a view toggle instead of a submenu.
      const triggers = entries.filter(
        (entry) => entry.element.getAttribute('aria-haspopup') === 'menu'
          || entry.element.getAttribute('data-model-picker-view-toggle') !== null,
      );
      const trigger = triggers.find((entry) => {
        const key = `${normalizeLabel(entry.primaryLabel)}|${entry.element.getAttribute('aria-label') || ''}`;
        return !visited.has(key);
      });
      if (!trigger) return undefined;

      const key = `${normalizeLabel(trigger.primaryLabel)}|${trigger.element.getAttribute('aria-label') || ''}`;
      visited.add(key);
      dispatchHover(trigger.element);
      trigger.element.click();
      await sleep(750);
    }

    return undefined;
  }

  async function selectProviderOption(config) {
    const sleep = config.sleep
      || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const menuSelector = '[role="menuitem"], [role="menuitemradio"], [role="option"]';
    const available = new Set();

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      keyCode: 27,
      bubbles: true,
    }));
    await sleep(250);

    let picker;
    if (config.provider === 'chatgpt') {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        picker = findPicker(config.provider);
        if (picker) break;
        await sleep(250);
      }
    } else if (config.provider === 'gemini') {
      picker = findPicker(config.provider);
    }

    if (!picker) {
      return { ok: false, error: `${config.provider} picker not found`, available: [] };
    }

    dispatchClick(picker);
    await sleep(800);

    const slider = config.provider === 'chatgpt' && config.kind === 'reasoning'
      ? visibleElements('[data-reasoning-slider]')[0]
      : undefined;
    if (slider) {
      const result = await selectSliderOption({
        readLabel: () => readSliderLabel(slider),
        readPosition: () => readSliderPosition(slider),
        press: (key) => pressSliderKey(slider, key, sleep),
      }, config);
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true,
      }));
      return result;
    }

    const chosen = await findProviderOption(config, menuSelector, available, sleep);

    if (!chosen) {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true,
      }));
      return {
        ok: false,
        error: 'option not found',
        available: [...available].filter(Boolean),
      };
    }

    chosen.element.click();
    await sleep(600);

    picker = findPicker(config.provider) || picker;
    let currentEntry = entryFromElement(chosen.element);
    let verified = selectionVerified(
      currentEntry,
      textOf(picker),
      config.verificationAliases,
    );

    if (!verified) {
      picker = findPicker(config.provider) || picker;
      dispatchClick(picker);
      await sleep(500);
      currentEntry = await findProviderOption(config, menuSelector, available, sleep);
      verified = selectionVerified(
        currentEntry,
        textOf(picker),
        config.verificationAliases,
      );
    }

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      keyCode: 27,
      bubbles: true,
    }));

    if (!verified) {
      return {
        ok: false,
        error: `selection could not be verified for ${chosen.primaryLabel}`,
        available: [...available].filter(Boolean),
      };
    }

    return {
      ok: true,
      selected: chosen.primaryLabel,
      available: [...available].filter(Boolean),
    };
  }

  return {
    availablePrimaryLabels,
    findMatchingEntry,
    normalizeLabel,
    parseMenuEntry,
    parseSliderStatusLabel,
    selectProviderOption,
    selectSliderOption,
    selectionVerified,
  };
});
