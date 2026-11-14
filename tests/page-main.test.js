const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

function createHarness({ richText = true, confirm = true, replace = false, acceptsText = true, alteredDraft = '' } = {}) {
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
  let editor = richText ? new RichEditor() : new TextArea();
  const button = new Element();
  button.id = 'flow-end-msg-send';
  button.click = () => {
    clicks += 1;
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
  const document = {
    addEventListener() {},
    querySelector(selector) { return selector === '#flow-end-msg-send' ? button : null; },
    querySelectorAll(selector) {
      if (selector === '#flow-end-msg-send') return [button];
      if (richText && selector === '#input-engine-container [contenteditable="true"]') return [editor];
      if (richText && selector === 'div[contenteditable="true"]') return [editor];
      if (!richText && selector === 'textarea') return [editor];
      if (!richText && selector === 'textarea[data-testid*="chat_input"]') return [editor];
      return [];
    },
    createRange: () => ({ selectNodeContents() {} }),
    execCommand(command, _ui, text) {
      assert.equal(command, 'insertText');
      insertions += 1;
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
    Event: class {}, InputEvent: class {}, KeyboardEvent: class {}, MouseEvent: class {},
    navigator: { platform: 'MacIntel' },
    console: { log() {}, error() {} },
    chrome: { runtime: { onMessage: { addListener(listener) { runtimeListener = listener; } } } },
    Date: { now: () => clock },
    setTimeout: timer, clearTimeout() {},
  });
  for (const file of ['sites.js', 'attachments.js', 'page-main.js', 'content.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }

  return {
    editor: () => editor,
    clicks: () => clicks,
    insertions: () => insertions,
    async submit(prompt) {
      return new Promise((resolve) => runtimeListener({ action: 'submit-prompt', prompt, attachments: [] }, {}, resolve));
    },
    async submitMain(prompt) {
      window.postMessage({ source: 'relay-extension', siteId: 'doubao', action: 'page-submit', requestId: 'test', prompt });
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
  assert.equal(response.submitted, true);
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
