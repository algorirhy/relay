// Runs in the page's MAIN world when a framework ignores isolated-world file events.

(() => {
  'use strict';

  const INSTALL_FLAG = '__relayPageMainInstalled';
  const REQUEST_SOURCE = 'relay-extension';
  const RESPONSE_SOURCE = 'relay-page';

  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function currentSiteId() {
    return RelaySites.findSiteByUrl(location.href)?.id;
  }

  function requireDestination(url) {
    if (window.location.href !== url) throw new Error('The destination page changed before sending.');
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.getClientRects().length > 0
    );
  }

  function isEnabled(element) {
    return Boolean(
      isVisible(element) &&
      !element.matches(':disabled') &&
      element.getAttribute('aria-disabled') !== 'true' &&
      element.getAttribute('data-disabled') !== 'true'
    );
  }

  function findReactHandler(element, handlerName) {
    let current = element;
    for (let depth = 0; current && depth < 6; depth += 1) {
      for (const key of Object.keys(current)) {
        if (!key.startsWith('__reactProps$') && !key.startsWith('__reactEventHandlers$')) {
          continue;
        }

        const handler = current[key]?.[handlerName];
        if (typeof handler === 'function') return { element: current, handler };
      }
      current = current.parentElement;
    }
    return null;
  }

  function normalizeFrameworkHandler(candidate) {
    const value = candidate?.value ?? candidate;
    if (typeof value === 'function') return value;
    if (Array.isArray(value) && value.some((handler) => typeof handler === 'function')) {
      return (event) => {
        for (const handler of value) {
          if (typeof handler === 'function') handler(event);
        }
      };
    }
    return null;
  }

  function findFrameworkHandler(element, handlerName, eventName) {
    const reactHandler = findReactHandler(element, handlerName);
    if (reactHandler) return reactHandler;

    let current = element;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const vueListeners = current._vei;
      const vueHandler = normalizeFrameworkHandler(
        vueListeners?.[handlerName] || vueListeners?.[eventName] || vueListeners?.[`on${eventName}`],
      );
      if (vueHandler) return { element: current, handler: vueHandler };

      for (const key of [`$$${eventName}`, `__${eventName}`, `_${eventName}`]) {
        const handler = normalizeFrameworkHandler(current[key]);
        if (handler) return { element: current, handler };
      }
      current = current.parentElement;
    }
    return null;
  }

  function createFrameworkEvent(element, overrides = {}) {
    return {
      isTrusted: true,
      target: element,
      currentTarget: element,
      nativeEvent: { isTrusted: true },
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      persist() {},
      ...overrides,
    };
  }

  function findFileInput(siteId, files) {
    const inputs = [...document.querySelectorAll('input[type="file"]')]
      .filter((input) => (
        !input.disabled && (input.multiple || files.length === 1) &&
        files.every((file) => RelayAttachments.inputAcceptsFile(input, file))
      ));

    return inputs.sort((left, right) => (
      Number(siteId === 'gemini' && right.classList.contains('hidden-file-input')) -
        Number(siteId === 'gemini' && left.classList.contains('hidden-file-input')) ||
      Number(siteId === 'doubao' && right.classList.contains('hidden')) -
        Number(siteId === 'doubao' && left.classList.contains('hidden')) ||
      Number(right.multiple) - Number(left.multiple) ||
      Number(!right.accept) - Number(!left.accept)
    ))[0] || null;
  }

  async function prepareGeminiInput(files, url) {
    const startedAt = Date.now();
    const deadline = startedAt + 20000;
    const imagesOnly = files.every((file) => file.type.startsWith('image/'));
    let lastTriggerClick = 0;

    while (Date.now() < deadline) {
      requireDestination(url);
      const compatibleInput = findFileInput('gemini', files);
      if (compatibleInput) return compatibleInput;

      const uploadMenuButton = document.querySelector('button[aria-label="Upload & tools"]');
      if (isEnabled(uploadMenuButton) && uploadMenuButton.getAttribute('aria-expanded') !== 'true') {
        uploadMenuButton.click();
      }

      if (Date.now() - lastTriggerClick > 500) {
        const trigger = document.querySelector(imagesOnly
          ? 'button[data-test-id="hidden-local-image-upload-button"], button.hidden-local-file-image-selector-button'
          : 'button[data-test-id="hidden-local-file-upload-button"], button.hidden-local-file-upload-button');
        trigger?.click();
        lastTriggerClick = Date.now();
      }

      // Gemini's current Angular uploader exposes one shared file input whose
      // `accept` list can lag behind the formats handled by its image trigger.
      // The page still performs its own validation after the change event.
      if (Date.now() - startedAt > 1500) {
        const sharedInput = [...document.querySelectorAll('input[type="file"]')].find((candidate) => (
          !candidate.disabled && candidate.multiple
        ));
        if (sharedInput) return sharedInput;
      }

      await delay(150);
    }
    return null;
  }

  async function waitForDoubaoInput(files, url, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      requireDestination(url);
      const input = findFileInput('doubao', files);
      if (input) return input;
      await delay(150);
    }
    return null;
  }

  async function setFiles(siteId, attachments, url) {
    const files = attachments.map(RelayAttachments.decode);
    const input = siteId === 'gemini'
      ? await prepareGeminiInput(files, url)
      : await waitForDoubaoInput(files, url);
    requireDestination(url);
    if (!input) throw new Error(`${siteId} file input is not available.`);

    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, transfer.files);
    else input.files = transfer.files;

    const frameworkChange = siteId === 'doubao'
      ? findFrameworkHandler(input, 'onChange', 'change')
      : null;
    if (frameworkChange) {
      frameworkChange.handler(createFrameworkEvent(frameworkChange.element, {
        type: 'change',
        target: input,
        currentTarget: frameworkChange.element,
        nativeEvent: { isTrusted: true, target: input, type: 'change' },
      }));
    } else {
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    if (input.files.length !== files.length) {
      throw new Error(`${siteId} did not retain the selected files.`);
    }

    return files.map((file) => file.name);
  }

  function findDoubaoComposer() {
    const site = RelaySites.getSite('doubao');
    let editor = null;
    for (const selector of site.inputSelectors) {
      editor = [...document.querySelectorAll(selector)].find(isEnabled);
      if (editor) break;
    }
    if (!editor) return null;

    const currentSendButton = document.querySelector('#flow-end-msg-send');
    if (isEnabled(currentSendButton)) {
      return { editor, sendButton: currentSendButton };
    }

    let container = editor;
    for (let depth = 0; container && depth < 10; depth += 1) {
      const sendButton = [...container.querySelectorAll('button')].find((button) => (
        isEnabled(button) && (
          button.className.includes('g-send-msg-btn') ||
          button.querySelector('svg.text-g-send-msg-btn-text, svg[class*="g-send-msg-btn"]')
        )
      ));
      if (sendButton) return { editor, sendButton };
      container = container.parentElement;
    }

    const sendButton = [...document.querySelectorAll('button')].find((button) => (
      isEnabled(button) &&
      button.querySelector('svg.text-g-send-msg-btn-text, svg[class*="g-send-msg-btn"]')
    ));
    return { editor, sendButton: sendButton || null };
  }

  function doubaoComposerRoot(editor) {
    return editor.closest('#input-engine-container') || editor.parentElement;
  }

  function readDoubaoPrompt(editor) {
    return editor instanceof HTMLTextAreaElement
      ? editor.value
      : (editor.innerText || editor.textContent || '');
  }

  function doubaoUploadIsBusy(root) {
    if (!root) return false;

    const explicitBusy = root.querySelector(
      '[aria-busy="true"], [role="progressbar"], [data-loading="true"], '
        + '[data-uploading="true"], [data-state="uploading"]',
    );
    if (explicitBusy && isVisible(explicitBusy)) return true;

    return [...root.querySelectorAll('[class]')].some((element) => (
      isVisible(element) && /(^|\s|[-_])(uploading|loading|progress|spinner|spinning)(\s|[-_]|$)/i
        .test(String(element.className || ''))
    ));
  }

  function doubaoUploadEvidence(root, names) {
    if (!names.length) return true;
    if (!root) return false;

    const blobImages = [...root.querySelectorAll('img[src^="blob:"]')];
    if (blobImages.length >= names.length && blobImages.every((image) => (
      image.complete && image.naturalWidth > 0
    ))) {
      return true;
    }

    const previews = root.querySelectorAll('[data-file-name], [data-filename], [class*="image-container" i]');
    const searchable = [];
    for (const element of root.querySelectorAll(
      '[title], [aria-label], [data-file-name], [data-filename], img[alt]',
    )) {
      searchable.push(
        element.getAttribute('title') || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('data-file-name') || '',
        element.getAttribute('data-filename') || '',
        element.getAttribute('alt') || '',
      );
    }
    for (const preview of previews) searchable.push(preview.textContent || '');
    const haystack = searchable.join('\n').toLocaleLowerCase();
    if (names.every((name) => haystack.includes(name.toLocaleLowerCase()))) return true;

    return previews.length >= names.length;
  }

  async function prepareDoubaoComposer(url, prompt, names, onFilled) {
    const hasFiles = names.length > 0;
    const startedAt = Date.now();
    const deadline = startedAt + (hasFiles ? 30000 : 20000);
    const stableDuration = hasFiles ? 1500 : 600;
    const text = prompt.trim();
    let filledEditor = null;
    let stable = null;

    while (Date.now() < deadline) {
      requireDestination(url);
      const composer = findDoubaoComposer();
      if (composer?.editor) {
        const { editor, sendButton } = composer;
        const value = readDoubaoPrompt(editor).trim();
        if (!filledEditor) RelayDrafts.requireAvailable(editor, '', readDoubaoPrompt);
        if (value !== text) {
          RelayDrafts.requireAvailable(editor, prompt, readDoubaoPrompt);
          if (editor === filledEditor) throw new Error('The Doubao draft changed before sending.');
          setDoubaoPrompt(editor, prompt);
          onFilled(editor);
          filledEditor = editor;
          stable = null;
          await delay(100);
          continue;
        }

        const root = doubaoComposerRoot(editor);
        const ready = isEnabled(sendButton) && !doubaoUploadIsBusy(root) &&
          (!hasFiles || (Date.now() - startedAt >= 2500 && doubaoUploadEvidence(root, names)));
        if (ready) {
          if (stable?.editor !== editor || stable.button !== sendButton) {
            stable = { editor, button: sendButton, since: Date.now() };
          } else if (Date.now() - stable.since >= stableDuration) {
            return composer;
          }
        } else {
          stable = null;
        }
      } else {
        stable = null;
      }
      await delay(100);
    }

    throw new Error(hasFiles
      ? 'Doubao did not show all attachments in a ready composer.'
      : 'Doubao message input or Send button did not become ready.');
  }

  function doubaoAttachmentCount(editor) {
    const root = doubaoComposerRoot(editor);
    if (!root) return 0;
    return root.querySelectorAll(
      'img[src^="blob:"], [data-file-name], [data-filename], [class*="image-container" i]',
    ).length;
  }

  function createDoubaoSubmissionSnapshot(composer, names) {
    return {
      initialUrl: location.href,
      initialValue: readDoubaoPrompt(composer.editor).trim(),
      names,
    };
  }

  async function waitForDoubaoSubmission(snapshot, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (location.href !== snapshot.initialUrl) return currentSiteId() === 'doubao';

      const liveComposer = findDoubaoComposer();
      const liveEditor = liveComposer?.editor;
      const liveValue = liveEditor ? readDoubaoPrompt(liveEditor).trim() : '';
      const liveAttachmentCount = liveEditor ? doubaoAttachmentCount(liveEditor) : 0;

      if (liveEditor && (snapshot.initialValue || snapshot.names.length) && !liveValue && !liveAttachmentCount &&
          (!snapshot.names.length || !doubaoUploadEvidence(doubaoComposerRoot(liveEditor), snapshot.names))) return true;

      // A missing composer can be a rerender. Wait for a live, cleared draft.
      await delay(100);
    }
    return false;
  }

  function setDoubaoPrompt(editor, prompt) {
    if (readDoubaoPrompt(editor).trim() === prompt.trim()) return;

    editor.focus();
    const isTextArea = editor instanceof HTMLTextAreaElement;
    if (isTextArea) {
      editor.select();
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    let inserted = false;
    try {
      inserted = document.execCommand(prompt ? 'insertText' : 'delete', false, prompt);
    } catch (_error) {
      inserted = false;
    }

    // ProseMirror must receive an editing operation so its document stays in
    // sync. Assigning textContent only changes the DOM.
    if (!isTextArea) {
      window.getSelection().removeAllRanges();
      if (readDoubaoPrompt(editor).trim() !== prompt.trim()) {
        throw new Error('Doubao message input did not accept the prompt.');
      }
      return;
    }

    if (!inserted || editor.value !== prompt) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(editor, prompt);
      else editor.value = prompt;
    }

    const changeHandler = findFrameworkHandler(editor, 'onChange', 'change');
    if (changeHandler) {
      try {
        changeHandler.handler(createFrameworkEvent(changeHandler.element, {
          type: 'change',
          target: editor,
          currentTarget: changeHandler.element,
          nativeEvent: { isTrusted: true, target: editor, type: 'input' },
        }));
      } catch (_error) {
        // Native input/change events below keep the editor state in sync.
      }
    }
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: prompt,
      inputType: 'insertText',
    }));
    editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function submitDoubao(url, prompt, attachments) {
    const initialEditor = findDoubaoComposer()?.editor;
    if (initialEditor) RelayDrafts.requireAvailable(initialEditor, '', readDoubaoPrompt);
    const names = attachments.length ? await setFiles('doubao', attachments, url) : [];
    let cleanup;
    return RelayDrafts.withCleanup(() => cleanup?.(), async () => {
      const composer = await prepareDoubaoComposer(url, prompt, names, (editor) => {
        cleanup?.();
        cleanup = RelayDrafts.trackInserted(editor, readDoubaoPrompt, (target) => setDoubaoPrompt(target, ''));
      });
      requireDestination(url);
      RelayDrafts.requireAvailable(composer.editor, prompt, readDoubaoPrompt);
      if (!composer.editor.isConnected || !isEnabled(composer.sendButton) ||
          readDoubaoPrompt(composer.editor).trim() !== prompt.trim() ||
          !doubaoUploadEvidence(doubaoComposerRoot(composer.editor), names)) {
        throw new Error('The Doubao draft changed before sending.');
      }
      const snapshot = createDoubaoSubmissionSnapshot(composer, names);
      composer.sendButton.click();
      if (!await waitForDoubaoSubmission(snapshot, 6000)) {
        throw new Error('Doubao did not confirm that the message was submitted.');
      }
      return { method: 'button' };
    });
  }

  function postResult(action, requestId, ok, error = '', details = {}) {
    window.postMessage({
      source: RESPONSE_SOURCE,
      action,
      requestId,
      ok,
      error,
      ...details,
    }, window.location.origin);
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== window.location.origin ||
        event.data?.source !== REQUEST_SOURCE) return;

    const { action, siteId, requestId, url, prompt, attachments = [] } = event.data;
    if (!(siteId === 'gemini' && action === 'page-attach') &&
        !(siteId === 'doubao' && action === 'page-submit')) return;
    if (siteId !== currentSiteId()) return;

    const resultAction = `${action}-result`;
    try {
      requireDestination(url);
      let result;
      if (action === 'page-attach') {
        if (!attachments.length) throw new Error('No attachments were provided.');
        await setFiles(siteId, attachments, url);
      } else {
        result = await submitDoubao(url, typeof prompt === 'string' ? prompt : '', attachments);
      }
      postResult(resultAction, requestId, true, '', result);
    } catch (error) {
      postResult(resultAction, requestId, false, error instanceof Error ? error.message : String(error), {
        preserveDestination: error?.preserveDestination === true,
      });
    }
  });
})();
