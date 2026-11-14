// Runs in the page's MAIN world when a framework ignores isolated-world file events.

(() => {
  'use strict';

  const INSTALL_FLAG = '__relayPageMainInstalled';
  const REQUEST_SOURCE = 'relay-extension';
  const RESPONSE_SOURCE = 'relay-page';
  let pendingDoubaoUpload = null;

  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function currentSiteId() {
    return RelaySites.findSiteByUrl(location.href)?.id;
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
        !input.disabled && files.every((file) => RelayAttachments.inputAcceptsFile(input, file))
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

  async function prepareGeminiInput(files) {
    const startedAt = Date.now();
    const deadline = startedAt + 20000;
    const imagesOnly = files.every((file) => file.type.startsWith('image/'));
    let lastTriggerClick = 0;

    while (Date.now() < deadline) {
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

  async function waitForDoubaoInput(files, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const input = findFileInput('doubao', files);
      if (input) return input;
      await delay(150);
    }
    return null;
  }

  async function setFiles(siteId, attachments) {
    const files = attachments.map(RelayAttachments.decode);
    const input = siteId === 'gemini'
      ? await prepareGeminiInput(files)
      : await waitForDoubaoInput(files);
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

    if (siteId === 'doubao') {
      pendingDoubaoUpload = {
        names: files.map((file) => file.name),
        startedAt: Date.now(),
        input,
      };
    }
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

  function doubaoUploadEvidence(root, upload) {
    if (!upload?.names?.length) return true;
    if (!root) return false;

    // Retaining File objects only proves that the input accepted them. Doubao can
    // still be rendering or uploading the preview, during which a send click is
    // frequently ignored. Prefer visible, fully decoded previews or file names.
    if (upload.input?.files?.length < upload.names.length) return false;

    const blobImages = [...root.querySelectorAll('img[src^="blob:"]')];
    if (blobImages.length >= upload.names.length && blobImages.every((image) => (
      image.complete && image.naturalWidth > 0
    ))) {
      return true;
    }

    const searchable = [root.textContent || ''];
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
    const haystack = searchable.join('\n').toLocaleLowerCase();
    if (upload.names.every((name) => haystack.includes(name.toLocaleLowerCase()))) return true;

    const previewCount = root.querySelectorAll(
      '[class*="image-container" i], [data-file-name], [data-filename]',
    ).length;
    return previewCount >= upload.names.length;
  }

  function doubaoReadyFingerprint(composer, upload) {
    const root = doubaoComposerRoot(composer.editor);
    return JSON.stringify({
      busy: doubaoUploadIsBusy(root),
      evidence: doubaoUploadEvidence(root, upload),
      fileNodes: root?.querySelectorAll(
        'img, [data-file-name], [data-filename], [class*="attachment" i], [class*="upload" i]',
      ).length || 0,
      prompt: readDoubaoPrompt(composer.editor),
      sendButton: composer.sendButton?.id || composer.sendButton?.className || '',
    });
  }

  async function waitForDoubaoReady(timeoutMs = 30000) {
    const upload = pendingDoubaoUpload;
    const deadline = Date.now() + timeoutMs;
    const minimumReadyAt = upload ? upload.startedAt + 2500 : Date.now();
    const stableDuration = upload ? 1500 : 350;
    let lastFingerprint = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
      const composer = findDoubaoComposer();
      if (composer?.editor && composer.sendButton) {
        const root = doubaoComposerRoot(composer.editor);
        const busy = doubaoUploadIsBusy(root);
        const hasEvidence = doubaoUploadEvidence(root, upload);
        const enoughTimePassed = Date.now() >= minimumReadyAt;
        const canUseTimeFallback = upload && Date.now() >= upload.startedAt + 8000;
        const fingerprint = doubaoReadyFingerprint(composer, upload);

        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          stableSince = Date.now();
        }

        if (
          !busy &&
          enoughTimePassed &&
          (hasEvidence || canUseTimeFallback) &&
          Date.now() - stableSince >= stableDuration
        ) {
          return composer;
        }
      }
      await delay(150);
    }

    throw new Error('Doubao attachments did not become ready in time.');
  }

  async function waitForStableDoubaoComposer(timeoutMs = 5000, stableDuration = 600) {
    const deadline = Date.now() + timeoutMs;
    let stableEditor = null;
    let stableButton = null;
    let stableValue = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
      const composer = findDoubaoComposer();
      const root = composer?.editor ? doubaoComposerRoot(composer.editor) : null;
      const usable = Boolean(
        composer?.editor &&
        isEnabled(composer.sendButton) &&
        !doubaoUploadIsBusy(root)
      );
      const value = composer?.editor ? readDoubaoPrompt(composer.editor) : '';

      if (
        usable &&
        composer.editor === stableEditor &&
        composer.sendButton === stableButton &&
        value === stableValue
      ) {
        if (Date.now() - stableSince >= stableDuration) return composer;
      } else {
        stableEditor = usable ? composer.editor : null;
        stableButton = usable ? composer.sendButton : null;
        stableValue = usable ? value : '';
        stableSince = Date.now();
      }
      await delay(100);
    }

    return null;
  }

  async function prepareStableDoubaoComposer(prompt, timeoutMs = 5000, stableDuration = 600) {
    let composer = await waitForStableDoubaoComposer(timeoutMs, stableDuration);
    if (!composer) return null;

    if (prompt.trim() && readDoubaoPrompt(composer.editor).trim() !== prompt.trim()) {
      setDoubaoPrompt(composer.editor, prompt);
      composer = await waitForStableDoubaoComposer(timeoutMs, stableDuration);
    }
    return composer;
  }

  function doubaoAttachmentCount(editor) {
    const root = doubaoComposerRoot(editor);
    if (!root) return 0;
    return root.querySelectorAll(
      'img[src^="blob:"], [data-file-name], [data-filename], [class*="image-container" i]',
    ).length;
  }

  function createDoubaoSubmissionSnapshot(composer) {
    return {
      editor: composer.editor,
      sendButton: composer.sendButton,
      initialUrl: location.href,
      initialValue: readDoubaoPrompt(composer.editor).trim(),
      attachmentCount: doubaoAttachmentCount(composer.editor),
    };
  }

  async function waitForDoubaoSubmission(snapshot, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let missingSince = 0;
    while (Date.now() < deadline) {
      if (location.href !== snapshot.initialUrl) return true;

      const liveComposer = findDoubaoComposer();
      const liveEditor = liveComposer?.editor;
      const liveValue = liveEditor ? readDoubaoPrompt(liveEditor).trim() : '';
      const liveAttachmentCount = liveEditor ? doubaoAttachmentCount(liveEditor) : 0;

      if (liveEditor && (snapshot.initialValue || snapshot.attachmentCount) &&
          !liveValue && !liveAttachmentCount) return true;

      // A replaced composer is only evidence when its state also changed. Upload
      // completion itself can replace the nodes without submitting the message.
      if (!snapshot.editor.isConnected || !snapshot.sendButton?.isConnected) {
        if (!liveEditor) {
          if (!missingSince) missingSince = Date.now();
          if (Date.now() - missingSince >= 500) return true;
        } else {
          missingSince = 0;
        }
      } else {
        missingSince = 0;
      }

      await delay(100);
    }
    return false;
  }

  function setDoubaoPrompt(editor, prompt) {
    if (!prompt.trim() || readDoubaoPrompt(editor).trim() === prompt.trim()) return;

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
      inserted = document.execCommand('insertText', false, prompt);
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

  async function submitDoubao(prompt = '') {
    const initialComposer = findDoubaoComposer();
    if (!initialComposer?.editor) throw new Error('Doubao message input is not available.');

    setDoubaoPrompt(initialComposer.editor, prompt);
    await waitForDoubaoReady();
    const composer = await prepareStableDoubaoComposer(prompt);
    if (!composer?.editor?.isConnected || !isEnabled(composer.sendButton)) {
      throw new Error('Doubao message input disappeared before submission.');
    }
    if (readDoubaoPrompt(composer.editor).trim() !== prompt.trim()) {
      throw new Error('Doubao did not retain the requested prompt.');
    }
    const snapshot = createDoubaoSubmissionSnapshot(composer);
    composer.sendButton.click();
    if (!await waitForDoubaoSubmission(snapshot, 6000)) {
      throw new Error('Doubao did not confirm that the message was submitted.');
    }

    pendingDoubaoUpload = null;
    return { submitted: true, method: 'button' };
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
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.source !== REQUEST_SOURCE ||
      !['page-submit', 'page-attach'].includes(event.data?.action)
    ) {
      return;
    }

    const siteId = currentSiteId();
    if (!siteId || event.data.siteId !== siteId) return;

    if (event.data.action === 'page-attach') {
      try {
        const attachments = Array.isArray(event.data.attachments) ? event.data.attachments : [];
        if (!attachments.length) throw new Error('No attachments were provided.');
        await setFiles(siteId, attachments);
        window.setTimeout(() => postResult('page-attach-result', event.data.requestId, true), 50);
      } catch (error) {
        postResult(
          'page-attach-result',
          event.data.requestId,
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }

    if (siteId !== 'doubao') return;
    try {
      const result = await submitDoubao(
        typeof event.data.prompt === 'string' ? event.data.prompt : '',
      );
      postResult('page-submit-result', event.data.requestId, true, '', result);
    } catch (error) {
      pendingDoubaoUpload = null;
      postResult(
        'page-submit-result',
        event.data.requestId,
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  });
})();
