// Content script for supported AI chatbot pages.
// Handles unified shortcuts and site-specific prompt entry/submission.

(() => {
  'use strict';

  const LOG_PREFIX = '[Relay]';
  const IS_MAC = navigator.platform.toUpperCase().includes('MAC');
  const USER_MESSAGE_SELECTORS = [
    '[data-message-author-role="user"]',
    '[data-testid="user-message"]',
    '[data-testid*="user-message" i]',
    'user-query',
    '.user-query',
    '[class*="user-message" i]',
    '[class*="userMessage"]',
  ];

  function currentSite() {
    return RelaySites.findSiteByUrl(window.location.href);
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.getClientRects().length > 0
    );
  }

  function isEnabled(element) {
    if (!element || !isVisible(element)) return false;
    if (element.matches(':disabled')) return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    if (element.getAttribute('data-disabled') === 'true') return false;
    if (element.classList.contains('ds-button--disabled')) return false;
    return window.getComputedStyle(element).pointerEvents !== 'none';
  }

  function findVisibleElement(selectors, predicate = isVisible) {
    for (const selector of selectors) {
      try {
        const matches = [...document.querySelectorAll(selector)]
          .filter(predicate)
          .sort((left, right) => (
            right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
          ));
        if (matches.length) return matches[0];
      } catch (_error) {
        // Ignore a selector if a site update makes it invalid.
      }
    }
    return null;
  }

  function tryClickSelectors(selectors) {
    const element = findVisibleElement(selectors);
    if (!element) return false;
    element.click();
    return true;
  }

  function tryClickByText(texts) {
    const selectors = ['a', 'button', '[role="button"]', '[role="menuitem"]', 'label'];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = (element.textContent || '').trim();
        const matches = texts.some((candidate) => (
          text.toLocaleLowerCase() === candidate.toLocaleLowerCase() ||
          text.toLocaleLowerCase().startsWith(candidate.toLocaleLowerCase())
        ));
        if (matches && isVisible(element)) {
          element.click();
          return true;
        }
      }
    }
    return false;
  }

  function isPrimaryModifierPressed(event) {
    return IS_MAC ? event.metaKey : event.ctrlKey;
  }

  function matchesShortcut(event, key, { shiftKey = false } = {}) {
    return (
      isPrimaryModifierPressed(event) &&
      event.key.toLowerCase() === key &&
      event.shiftKey === shiftKey &&
      !event.altKey &&
      !event.repeat
    );
  }

  function navigateToNewChat(site) {
    const url = RelaySites.getNewChatUrl(site.id, window.location.href);
    if (url) window.location.href = url;
  }

  function handleNewChat() {
    const site = currentSite();
    if (!site) return false;

    if (tryClickSelectors(site.newChatSelectors)) return true;
    if (tryClickByText(site.newChatTexts)) return true;

    navigateToNewChat(site);
    return true;
  }

  function openGeminiSearchChats() {
    const searchSelectors = [
      'button[aria-label*="Search" i]',
      'a[aria-label*="Search" i]',
      '[data-test-id="search"]',
    ];

    if (tryClickSelectors(searchSelectors)) return true;
    if (tryClickByText(['Search chats', 'Search'])) return true;

    const eventInit = {
      key: 'K',
      code: 'KeyK',
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: true,
      metaKey: IS_MAC,
      ctrlKey: !IS_MAC,
    };

    document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    document.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    return true;
  }

  function handleNewChatShortcut(event) {
    if (!currentSite() || !matchesShortcut(event, 'o', { shiftKey: true })) return;
    event.preventDefault();
    event.stopPropagation();
    handleNewChat();
  }

  function handleGeminiSearchShortcut(event) {
    if (currentSite()?.id !== 'gemini' || !matchesShortcut(event, 'k')) return;
    event.preventDefault();
    event.stopPropagation();
    openGeminiSearchChats();
  }

  function isPromptEditor(element) {
    if (!isEnabled(element)) return false;
    return (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement ||
      element.isContentEditable ||
      element.getAttribute('contenteditable') === 'true'
    );
  }

  async function waitForPromptEditor(site, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const editor = findVisibleElement(site.inputSelectors, isPromptEditor);
      if (editor) return editor;
      await delay(250);
    }
    throw new Error(`Could not find the ${site.name} message input.`);
  }

  function dispatchInputEvents(element, text) {
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: text,
        inputType: 'insertText',
      }));
    } catch (_error) {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setNativeInputValue(element, text) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    element.focus();
    if (setter) setter.call(element, text);
    else element.value = text;
    dispatchInputEvents(element, text);
  }

  function replaceContentEditableValue(element, text) {
    const fragment = document.createDocumentFragment();
    for (const line of text.split('\n')) {
      const paragraph = document.createElement('p');
      if (line) paragraph.textContent = line;
      else paragraph.append(document.createElement('br'));
      fragment.append(paragraph);
    }
    element.replaceChildren(fragment);
  }

  function setContentEditableValue(element, text) {
    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (_error) {
      inserted = false;
    }

    selection.removeAllRanges();
    if (!inserted || readEditorText(element).trim() !== text.trim()) {
      replaceContentEditableValue(element, text);
    }
    dispatchInputEvents(element, text);
  }

  function readEditorText(element) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element.value;
    }
    return element.innerText || element.textContent || '';
  }

  async function fillPrompt(editor, prompt) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      setNativeInputValue(editor, prompt);
    } else {
      setContentEditableValue(editor, prompt);
    }

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (readEditorText(editor).trim() === prompt.trim()) return;
      await delay(100);
    }

    throw new Error('The message input did not accept the prompt.');
  }

  async function waitForSendButton(site, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const button = findVisibleElement(site.sendSelectors, isEnabled);
      if (button) return button;
      await delay(150);
    }
    return null;
  }

  function findFileInput(files) {
    return [...document.querySelectorAll('input[type="file"]')]
      .filter((element) => !element.disabled && files.every((file) => RelayAttachments.inputAcceptsFile(element, file)))
      .sort((left, right) => (
        Number(right.multiple) - Number(left.multiple) ||
        Number(!right.accept) - Number(!left.accept)
      ))[0] || null;
  }

  function matchesAnySelector(element, selectors) {
    return selectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch (_error) {
        return false;
      }
    });
  }

  function tryClickNearbyAttachmentButton(editor, site) {
    const editorRect = editor.getBoundingClientRect();
    let container = editor.parentElement;
    const candidates = [];

    for (let depth = 0; container && depth < 7; depth += 1) {
      for (const element of container.querySelectorAll('button, [role="button"]')) {
        if (!isEnabled(element) || matchesAnySelector(element, site.sendSelectors)) continue;

        const label = [
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.getAttribute('data-testid'),
          element.className,
          element.textContent,
        ].filter((value) => typeof value === 'string').join(' ').toLowerCase();
        if (/send|submit|发送|停止|stop/.test(label)) continue;

        const rect = element.getBoundingClientRect();
        let score = 0;
        if (/attach|upload|file|image|photo|add|plus|附件|上传|文件|图片|照片/.test(label)) score += 8;
        if (element.getAttribute('aria-haspopup')) score += 2;
        if (rect.left < editorRect.left + Math.min(120, editorRect.width * 0.35)) score += 3;
        if (rect.bottom >= editorRect.top - 24 && rect.top <= editorRect.bottom + 48) score += 2;
        if (!(element.textContent || '').trim()) score += 1;
        candidates.push({ element, score, depth });
      }
      container = container.parentElement;
    }

    const candidate = candidates.sort((left, right) => (
      right.score - left.score || left.depth - right.depth
    ))[0];
    if (!candidate || candidate.score < 5) return false;
    candidate.element.click();
    return true;
  }

  async function waitForFileInput(site, files, editor, timeoutMs = 6000) {
    let input = findFileInput(files);
    if (input) return input;

    const clickedKnownControl = tryClickSelectors(site.attachmentButtonSelectors);
    if (!clickedKnownControl) tryClickNearbyAttachmentButton(editor, site);
    await delay(350);
    input = findFileInput(files);
    if (input) return input;

    tryClickByText(site.attachmentButtonTexts);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      input = findFileInput(files);
      if (input) return input;
      await delay(150);
    }

    return null;
  }

  function setInputFiles(input, files) {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, transfer.files);
    else input.files = transfer.files;

    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function attachFiles(site, attachments, editor) {
    if (!attachments.length) return 0;

    // Gemini and Doubao bind their upload controls in the page's MAIN world.
    // Let the bridge discover and drive those controls directly; requiring an
    // isolated-world input first made valid, dynamically-created inputs look
    // unavailable.
    if (site.id === 'doubao' || site.id === 'gemini') {
      await requestPageMainWorld(site.id, 'page-attach', attachments, 30000);
      await delay(site.id === 'gemini' ? 1800 : 300);
      return attachments.length;
    }

    const files = attachments.map(RelayAttachments.decode);
    // Prefer one upload when a control accepts the whole batch.
    const input = await waitForFileInput(site, files, editor);
    if (input && (input.multiple || files.length === 1)) {
      setInputFiles(input, files);
      await delay(500);
      return files.length;
    }
    if (files.length === 1) {
      throw new Error(`${site.name} did not expose a compatible upload control for ${files[0].name}.`);
    }

    for (const file of files) {
      const singleInput = await waitForFileInput(site, [file], editor);
      if (!singleInput) {
        throw new Error(`${site.name} did not expose a compatible upload control for ${file.name}.`);
      }
      setInputFiles(singleInput, [file]);
      await delay(500);
    }
    return files.length;
  }

  function submitWithEnter(editor) {
    const eventInit = {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      keyCode: 13,
      which: 13,
      charCode: 13,
    };

    editor.focus();
    editor.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    editor.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    editor.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  function requestPageMainWorld(siteId, action, attachments = [], timeoutMs = 10000, prompt = '') {
    const requestId = `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const resultAction = `${action}-result`;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', handleResult);
        reject(new Error(`${siteId} did not confirm the ${action === 'page-attach' ? 'attachments' : 'submission'}.`));
      }, timeoutMs);

      function handleResult(event) {
        if (
          event.source !== window ||
          event.origin !== window.location.origin ||
          event.data?.source !== 'relay-page' ||
          event.data?.action !== resultAction ||
          event.data?.requestId !== requestId
        ) {
          return;
        }

        window.clearTimeout(timeout);
        window.removeEventListener('message', handleResult);
        if (event.data.ok) resolve(event.data);
        else reject(new Error(event.data.error || `${siteId} rejected the request.`));
      }

      window.addEventListener('message', handleResult);
      window.postMessage({
        source: 'relay-extension',
        action,
        siteId,
        requestId,
        attachments,
        prompt,
      }, window.location.origin);
    });
  }

  function userMessageCount() {
    const messages = new Set();
    for (const selector of USER_MESSAGE_SELECTORS) {
      try {
        for (const element of document.querySelectorAll(selector)) messages.add(element);
      } catch (_error) {
        // Ignore selectors that become invalid after a site update.
      }
    }
    return messages.size;
  }

  async function submitGoogleAiMode(prompt, attachments) {
    const site = RelaySites.google;
    const url = window.location.href;
    if (!prompt.trim() || !attachments.length) throw new Error('Google AI Mode needs a question with the files.');

    const editor = await waitForPromptEditor(site, 6000).catch(() => {
      throw new Error('Google AI Mode input is unavailable. Check that AI Mode is enabled for your account.');
    });
    if (window.location.href !== url) throw new Error('The destination page changed before uploading.');
    const files = attachments.map(RelayAttachments.decode);
    const previewCount = () => {
      const labels = files.filter(({ name }) => document.body.innerText.includes(name)).length;
      const thumbnails = document.querySelectorAll('img[src^="blob:"], img[src^="data:image/"]').length;
      const controls = document.querySelectorAll(
        'button[aria-label*="Remove" i], button[aria-label*="削除"], button[aria-label*="移除"]',
      ).length;
      // One file can have both a thumbnail and a remove control.
      return Math.max(labels, thumbnails, controls);
    };
    const initialPreviews = previewCount();
    const upload = findFileInput(files);
    if (upload && (upload.multiple || files.length === 1)) {
      setInputFiles(upload, files);
    } else {
      // AI Mode's composer also accepts pasted files. Dispatch only once; an
      // upload that is slow to show a preview must not be duplicated.
      const clipboardData = new DataTransfer();
      for (const file of files) clipboardData.items.add(file);
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && previewCount() - initialPreviews < files.length) await delay(200);
    if (previewCount() - initialPreviews < files.length) {
      throw new Error('Google AI Mode did not show all files. Add them directly in Google AI Mode.');
    }
    const liveEditor = await waitForPromptEditor(site, 6000);
    if (window.location.href !== url) throw new Error('The destination page changed before sending.');
    await fillPrompt(liveEditor, prompt);
    const send = await waitForSendButton(site, 10000);
    if (!send) throw new Error('Google AI Mode did not expose an enabled Send button.');
    if (window.location.href !== url || !liveEditor.isConnected ||
        readEditorText(liveEditor).trim() !== prompt.trim() ||
        previewCount() - initialPreviews < files.length) {
      throw new Error('The Google AI Mode draft changed before sending.');
    }
    const initialMessages = userMessageCount();
    send.click();
    const submissionDeadline = Date.now() + 6000;
    while (Date.now() < submissionDeadline) {
      const current = findVisibleElement(site.inputSelectors, isPromptEditor);
      if ((window.location.href !== url && RelaySites.isGoogleAiPage(window.location.href)) ||
          userMessageCount() > initialMessages ||
          (current && !readEditorText(current).trim() && previewCount() <= initialPreviews)) {
        return { ok: true, method: 'button' };
      }
      await delay(100);
    }
    throw new Error('Google AI Mode did not confirm that the files and question were submitted.');
  }

  function hasSubmissionEvidence(site, snapshot) {
    const url = window.location.href;
    if (url !== snapshot.url) return currentSite()?.id === site.id;
    if (userMessageCount() > snapshot.userMessageCount) return true;

    // Replacing the composer or disabling Send can happen during a rerender.
    return Boolean(snapshot.text && snapshot.editor.isConnected && !readEditorText(snapshot.editor).trim());
  }

  async function waitForSubmissionEvidence(site, snapshot, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (hasSubmissionEvidence(site, snapshot)) return true;
      await delay(100);
    }
    return false;
  }

  async function performSubmissionAttempt(site, draft, hasAttachments) {
    const sendButton = await waitForSendButton(site, hasAttachments ? 60000 : 6000);

    // Before a repeat attempt, check whether the first one finished meanwhile.
    if (draft.previousAttempt && hasSubmissionEvidence(site, draft.previousAttempt)) {
      return { confirmed: true, method: draft.previousAttempt.method };
    }
    const editor = findVisibleElement(site.inputSelectors, isPromptEditor);
    if (window.location.href !== draft.url || !editor || readEditorText(editor).trim() !== draft.text) {
      throw new Error('The draft changed before sending.');
    }
    if (hasAttachments && !sendButton) {
      throw new Error(`${site.name} did not enable Send for the attachments.`);
    }

    const snapshot = { url: draft.url, editor, text: draft.text, userMessageCount: userMessageCount() };
    let method;
    if (sendButton) {
      sendButton.click();
      method = 'button';
    } else {
      const form = editor.closest('form');
      if (form?.requestSubmit) {
        form.requestSubmit();
        method = 'form';
      } else {
        submitWithEnter(editor);
        method = 'enter';
      }
    }

    return {
      confirmed: await waitForSubmissionEvidence(site, snapshot, hasAttachments ? 8000 : 6000),
      snapshot: { ...snapshot, method },
      method,
    };
  }

  async function sendPrompt(site, draft, attachmentCount) {
    if (site.id === 'doubao') {
      const sendButton = await waitForSendButton(site, attachmentCount ? 60000 : 6000);
      if (!sendButton) throw new Error('Doubao did not expose an enabled send control.');

      if (window.location.href !== draft.url) throw new Error('The destination page changed before sending.');
      const result = await requestPageMainWorld('doubao', 'page-submit', [], 70000, draft.prompt);
      if (!result.submitted) throw new Error('Doubao did not confirm that the message was submitted.');
      return result.method;
    }

    const first = await performSubmissionAttempt(site, draft, attachmentCount > 0);
    if (first.confirmed) return first.method;
    if (!attachmentCount) {
      const second = await performSubmissionAttempt(site, { ...draft, previousAttempt: first.snapshot }, false);
      if (second.confirmed) return second.method;
    }

    throw new Error(`${site.name} did not confirm that the message was submitted.`);
  }

  async function submitPrompt({ prompt, attachments: serializedAttachments = [], expectedUrl }) {
    if (expectedUrl && window.location.href !== expectedUrl) {
      throw new Error('The destination page changed before sending.');
    }
    const normalizedPrompt = typeof prompt === 'string' ? prompt : '';
    const attachments = Array.isArray(serializedAttachments) ? serializedAttachments : [];
    if (RelaySites.isGoogleAiPage(window.location.href)) return submitGoogleAiMode(normalizedPrompt, attachments);
    const site = currentSite();
    if (!site) throw new Error('This page is not a supported AI chatbot.');
    if (!normalizedPrompt.trim() && !attachments.length) {
      throw new Error('The message and attachment list are empty.');
    }

    const draft = { url: window.location.href, prompt: normalizedPrompt, text: normalizedPrompt.trim() };
    let editor = await waitForPromptEditor(site);
    const attachmentCount = await attachFiles(site, attachments, editor);
    if (attachmentCount) {
      // Upload widgets on sites such as Grok can replace the composer node.
      // Always reacquire the live editor before inserting the prompt.
      editor = await waitForPromptEditor(site);
    }
    if (normalizedPrompt.trim()) {
      await fillPrompt(editor, normalizedPrompt);
    }
    await delay(150);
    const method = await sendPrompt(site, draft, attachmentCount);
    console.log(`${LOG_PREFIX} Submitted a message for ${site.name} using ${method}.`);
    return { ok: true, siteId: site.id, method, attachmentCount };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === 'ping') {
      const site = currentSite();
      const siteId = site?.id || (RelaySites.isGoogleAiPage(window.location.href) ? 'google' : null);
      sendResponse({ ok: Boolean(siteId), siteId });
      return false;
    }

    if (message?.action === 'new-chat') {
      sendResponse({ ok: handleNewChat() });
      return false;
    }

    if (message?.action === 'submit-prompt') {
      submitPrompt(message)
        .then(sendResponse)
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }

    return false;
  });

  document.addEventListener('keydown', handleNewChatShortcut, true);
  document.addEventListener('keydown', handleGeminiSearchShortcut, true);
})();
