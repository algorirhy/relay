const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

function createHarness({ richText = true, confirm = true, replace = false, acceptsText = true, initialDraft = '', alteredDraft = '', disappear = false, navigateAt = Infinity, preview = false, sendAfterTyping = false } = {}) {
  let clock = 1;
  let insertions = 0;
  let clicks = 0;
  let selectedEditor;
  let runtimeListener;
  const listeners = new Set();
  const results = [];

  class Element {
    isConnected = true;
    className = '';
    classList = { contains: () => false };
    getAttribute() { return null; }
    getClientRects() { return [{}]; }
    getBoundingClientRect() { return { bottom: 100, left: 0, top: 0, width: 30, height: 30 }; }
    matches() { return false; }
    closest(selector) { return selector === '#input-engine-container' ? root : null; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    focus() { selectedEditor = this; }
    dispatchEvent() { return true; }
    addEventListener() {}
    removeEventListener() {}
  }

  class TextArea extends Element {
    _value = '';
    placeholder = '发消息...';
    get value() { return this._value; }
    set value(value) { this._value = value; }
    select() { selectedEditor = this; }
  }

  class RichEditor extends Element {
    isContentEditable = true;
    innerText = '';
  }

  const root = new Element();
  const upload = new Element();
  upload.accept = '';
  upload.multiple = true;
  let hasPreview = false;
  let uploads = 0;
  upload.dispatchEvent = (event) => {
    if (event.type === 'change') {
      uploads += 1;
      hasPreview = preview;
    }
  };
  root.querySelectorAll = (selector) => hasPreview && selector.includes('[data-file-name]') ? [
    { getAttribute: (name) => name === 'data-file-name' ? 'notes.txt' : null },
  ] : [];
  let editor = richText ? new RichEditor() : new TextArea();
  if (richText) editor.innerText = initialDraft;
  else editor.value = initialDraft;
  const button = new Element();
  button.id = 'flow-end-msg-send';
  button.click = () => {
    clicks += 1;
    if (confirm) hasPreview = false;
    if (disappear) {
      editor.isConnected = false;
      editor = null;
      return;
    }
    if (replace) {
      const replacement = richText ? new RichEditor() : new TextArea();
      if (richText) replacement.innerText = editor.innerText;
      else replacement.value = editor.value;
      editor.isConnected = false;
      editor = replacement;
    }
    if (confirm) {
      if (richText) editor.innerText = '';
      else editor.value = '';
    } else if (alteredDraft) {
      editor.innerText = alteredDraft;
    }
  };

  const location = { hostname: 'www.doubao.com', href: 'https://www.doubao.com/chat/', origin: 'https://www.doubao.com' };
  const style = () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' });
  const timer = (callback, milliseconds) => {
    // Long timers are bridge watchdogs; only advance the polling clock here.
    if (milliseconds < 1000) {
      clock += milliseconds;
      if (clock >= navigateAt) location.href = 'https://www.doubao.com/chat/another';
      queueMicrotask(callback);
    }
    return 1;
  };
  const window = {
    location,
    setTimeout: timer,
    clearTimeout() {},
    getComputedStyle: style,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
    postMessage(data) {
      if (data.source === 'relay-page') results.push(data);
      for (const listener of [...listeners]) {
        queueMicrotask(() => listener({ source: window, origin: location.origin, data }));
      }
    },
  };
  const readyButton = () => !sendAfterTyping || Boolean(editor?.innerText || editor?.value);
  const document = {
    hasFocus: () => false,
    addEventListener() {},
    querySelector(selector) { return selector === '#flow-end-msg-send' && readyButton() ? button : null; },
    querySelectorAll(selector) {
      if (selector === '#flow-end-msg-send') return readyButton() ? [button] : [];
      if (selector === 'input[type="file"]') return [upload];
      if (!editor) return [];
      if (richText && selector === '#input-engine-container [contenteditable="true"]') return [editor];
      if (richText && selector === 'div[contenteditable="true"]') return [editor];
      if (!richText && selector === 'textarea') return [editor];
      if (!richText && selector === 'textarea[data-testid*="chat_input"]') return [editor];
      return [];
    },
    createRange: () => ({ selectNodeContents() {} }),
    execCommand(command, _ui, text) {
      assert.ok(command === 'insertText' || command === 'delete');
      if (command === 'insertText') insertions += 1;
      if (!acceptsText) return false;
      if (richText) selectedEditor.innerText = text;
      else selectedEditor.value = text;
      return true;
    },
  };
  const context = vm.createContext({
    window, document, location, URL,
    getComputedStyle: style,
    HTMLTextAreaElement: TextArea,
    HTMLInputElement: class extends Element {},
    File, atob,
    DataTransfer: class {
      files = [];
      items = { add: (file) => this.files.push(file) };
    },
    Event: class { constructor(type) { this.type = type; } }, InputEvent: class {}, KeyboardEvent: class {}, MouseEvent: class {},
    navigator: { platform: 'MacIntel' },
    console: { log() {}, error() {} },
    chrome: { runtime: { onMessage: { addListener(listener) { runtimeListener = listener; } } } },
    Date: { now: () => clock },
    setTimeout: timer, clearTimeout() {},
  });
  for (const file of ['sites.js', 'attachments.js', 'drafts.js', 'page-main.js', 'content.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }

  return {
    editor: () => editor,
    clicks: () => clicks,
    uploads: () => uploads,
    insertions: () => insertions,
    async submit(prompt, attachments = []) {
      return new Promise((resolve) => runtimeListener({ action: 'submit-prompt', prompt, attachments }, {}, resolve));
    },
    async submitMain(prompt) {
      window.postMessage({ source: 'relay-extension', siteId: 'doubao', action: 'page-submit', requestId: 'test', url: location.href, prompt });
      for (let index = 0; index < 2000 && !results.length; index += 1) await new Promise(queueMicrotask);
      assert.equal(results.length, 1, 'bridge must return one result');
      return results[0];
    },
  };
}

test('Doubao delivery fills and submits the current rich editor through the main-world bridge', async () => {
  const harness = createHarness();
  const response = await harness.submit('第一行\nSecond line');
  assert.equal(response.ok, true);
  assert.equal(response.method, 'button');
  assert.equal(harness.editor().innerText, '');
  assert.equal(harness.clicks(), 1);
  assert.equal(harness.insertions(), 1, 'main world must preserve the already-filled framework document');
});

test('Doubao cleans up its unchanged prompt when submission cannot be confirmed', async () => {
  const harness = createHarness({ confirm: false });
  const result = await harness.submit('Relay draft');
  assert.equal(result.ok, false);
  assert.equal(harness.clicks(), 1);
  assert.equal(harness.editor().innerText, '');
});

test('Doubao preserves an existing draft and skips the upload', async () => {
  const harness = createHarness({ initialDraft: 'Existing draft', preview: true });
  const file = { name: 'notes.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' };
  const result = await harness.submit('Relay draft', [file]);
  assert.equal(result.ok, false);
  assert.equal(result.preserveDestination, true);
  assert.equal(harness.uploads(), 0);
  assert.equal(harness.clicks(), 0);
  assert.equal(harness.editor().innerText, 'Existing draft');
});

test('a replaced Doubao composer with different unsent text does not confirm delivery', async () => {
  const harness = createHarness({ confirm: false, replace: true, alteredDraft: 'different draft' });
  const response = await harness.submit('original question');
  assert.equal(response.ok, false);
  assert.equal(harness.clicks(), 1);
  assert.equal(harness.editor().innerText, 'different draft');
});

test('Doubao main-world entry can insert text into a contenteditable without textarea APIs', async () => {
  const harness = createHarness();
  const response = await harness.submitMain('rich text');
  assert.equal(response.ok, true);
  assert.equal(response.method, 'button');
  assert.equal(harness.insertions(), 1);
});

test('Doubao still submits legacy textareas', async () => {
  const harness = createHarness({ richText: false });
  const response = await harness.submit('legacy text');
  assert.equal(response.ok, true);
  assert.equal(response.method, 'button');
  assert.equal(harness.editor().value, '');
});

test('Doubao reports unconfirmed delivery without a second click when the draft is unchanged', async () => {
  const harness = createHarness({ confirm: false, replace: true });
  const response = await harness.submit('keep this draft');
  assert.equal(response.ok, false);
  assert.match(response.error, /did not confirm/);
  assert.equal(harness.clicks(), 1);
  assert.equal(harness.editor().innerText, 'keep this draft');
});

test('Doubao main world reports a rejected rich-text editing operation', async () => {
  const harness = createHarness({ acceptsText: false });
  const response = await harness.submitMain('rejected');
  assert.equal(response.ok, false);
  assert.match(response.error, /did not accept/);
  assert.equal(harness.clicks(), 0);
});

test('Doubao does not confirm a send merely because the editor disappears', async () => {
  const harness = createHarness({ disappear: true });
  const response = await harness.submit('Keep the recovery draft');
  assert.equal(response.ok, false);
  assert.match(response.error, /did not confirm/);
  assert.equal(harness.clicks(), 1);
});

const note = { name: 'notes.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' };

test('Doubao fills a text draft before looking for an enabled Send button', async () => {
  const harness = createHarness({ sendAfterTyping: true });
  const response = await harness.submit('Unlock Send');
  assert.equal(response.ok, true);
  assert.equal(harness.clicks(), 1);
});

test('Doubao stops before clicking Send if the conversation changes during readiness checks', async () => {
  const harness = createHarness({ navigateAt: 300 });
  const response = await harness.submit('Stay in the fresh chat');
  assert.equal(response.ok, false);
  assert.match(response.error, /destination page changed/);
  assert.equal(harness.clicks(), 0);
});

test('Doubao submits a file-only draft once its uploaded file appears and confirms when it clears', async () => {
  const harness = createHarness({ preview: true });
  const response = await harness.submit('', [note]);
  assert.equal(response.ok, true);
  assert.equal(response.attachmentCount, 1);
  assert.equal(harness.uploads(), 1);
  assert.equal(harness.clicks(), 1);
});

test('Doubao does not send a draft whose uploaded file never appears', async () => {
  const harness = createHarness();
  const response = await harness.submit('Read notes.txt', [note]);
  assert.equal(response.ok, false);
  assert.match(response.error, /did not show all attachments/);
  assert.equal(harness.uploads(), 1);
  assert.equal(harness.clicks(), 0);
});
