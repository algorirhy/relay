const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const contentSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'content.js'),
  'utf8',
);
const attachmentSource = fs.readFileSync(path.resolve(__dirname, '..', 'attachments.js'), 'utf8');
const draftsSource = fs.readFileSync(path.resolve(__dirname, '..', 'drafts.js'), 'utf8');

function createHarness({ confirmOnClick = 2, acceptedFileTypes = [], initialPrompt = '', changedOnClick, editedOnClick, navigateOnUpload, google = false, leaveAiModeOnSend = false, richText = false, execCommandWorks = true, uploadDuration = 0, confirmationDelay = 0, navigateWhileUploading = false, sendReadyAfter = 0 } = {}) {
  let clock = 0;
  let clickCount = 0;
  let runtimeMessageListener;
  const uploads = [];
  const sentPrompts = [];
  let selectedEditor;
  let uploadReadyAt = 0;
  let confirmationAt = Infinity;
  let messageCount = 0;
  const clickTimes = [];

  function advanceClock(milliseconds) {
    clock += milliseconds;
    if (navigateWhileUploading && uploads.length && clock < uploadReadyAt) {
      window.location.href = 'https://chatgpt.com/c/user-navigation';
    }
    if (clock >= confirmationAt) {
      editor.value = '';
      messageCount += 1;
      confirmationAt = Infinity;
    }
  }

  class FakeElement {
    constructor() {
      this.isConnected = true;
      this.className = '';
      this.classList = { contains: () => false };
      this.listeners = new Map();
    }

    getAttribute() { return null; }
    getBoundingClientRect() { return { bottom: 100 }; }
    getClientRects() { return [{}]; }
    matches() { return false; }
    closest(selector) { return selector === 'form' ? composer : null; }
    focus() {}
    addEventListener(event, listener) { this.listeners.set(event, listener); }
    removeEventListener(event) { this.listeners.delete(event); }
    dispatchEvent(event) { this.listeners.get(event.type)?.(event); return true; }
  }

  class FakeTextArea extends FakeElement {
    constructor() {
      super();
      this._value = '';
    }

    get value() { return this._value; }
    set value(value) { this._value = String(value); }
    select() {}
  }

  class FakeInput extends FakeElement {
    constructor(accept) {
      super();
      this.accept = accept;
      this.multiple = true;
    }

    dispatchEvent(event) {
      if (event.type === 'change') {
        uploads.push([this.accept, Array.from(this.files, (file) => file.name)]);
        uploadReadyAt = clock + uploadDuration;
        if (navigateOnUpload) window.location.href = 'https://chatgpt.com/c/other';
      }
      return true;
    }
  }

  class RichNode extends FakeElement {
    constructor(nodeName, text = '', children = [], trailingBreak = false) {
      super();
      this.nodeName = nodeName;
      this.nodeType = nodeName === '#text' ? 3 : 1;
      this.childNodes = children;
      this._text = text;
      this.classList = { contains: (name) => trailingBreak && name === 'ProseMirror-trailingBreak' };
    }

    get firstChild() { return this.childNodes[0]; }
    get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map((node) => node.textContent).join(''); }
    set textContent(text) { this.childNodes = [new RichNode('#text', text)]; }
    append(node) { this.childNodes.push(node); }
  }

  class RichEditor extends RichNode {
    constructor() {
      super('DIV');
      this.isContentEditable = true;
      this.value = '';
    }

    matches(selector) { return selector === '.ProseMirror'; }
    focus() { selectedEditor = this; }
    replaceChildren(fragment) { this.childNodes = fragment.childNodes; }
    get innerText() {
      // Chromium adds paragraph separators to the text exposed by Grok's editor.
      return this.childNodes.map((node) => node.textContent || '\n').join('\n\n');
    }
    get value() { return this.childNodes.map((node) => node.textContent).join('\n'); }
    set value(text) {
      this.childNodes = text ? text.split('\n').map((line) => new RichNode('P', '', [
        line ? new RichNode('#text', line) : new RichNode('BR', '', [], true),
      ])) : [];
    }
  }

  const createEditor = () => richText ? new RichEditor() : new FakeTextArea();
  let editor = createEditor();
  editor.value = initialPrompt;
  const fileInputs = acceptedFileTypes.map((type) => new FakeInput(type));
  const sendButton = new FakeElement();
  sendButton.matches = (selector) => selector === ':disabled' && clock < sendReadyAfter;
  const uploadProgress = new FakeElement();
  const composer = {
    querySelector: () => null,
    querySelectorAll: () => clock < uploadReadyAt ? [uploadProgress] : [],
  };
  sendButton.click = () => {
    clickCount += 1;
    clickTimes.push(clock);
    sentPrompts.push(editor.value);
    if (leaveAiModeOnSend) window.location.href = 'https://www.google.com/search';
    if (changedOnClick !== undefined) {
      editor.value = changedOnClick;
      editor.dispatchEvent({ type: 'input' });
    }
    if (editedOnClick !== undefined) {
      editor.isConnected = false;
      editor = createEditor();
      editor.value = editedOnClick;
    } else if (clickCount >= confirmOnClick) {
      if (confirmationDelay) confirmationAt = clock + confirmationDelay;
      else {
        editor.value = '';
        messageCount += 1;
      }
    }
  };

  const site = {
    id: google ? 'google' : 'chatgpt',
    name: google ? 'Google AI Mode' : 'ChatGPT',
    inputSelectors: ['#editor'],
    sendSelectors: ['#send'],
    attachmentButtonSelectors: [],
    attachmentButtonTexts: [],
  };

  const document = {
    hasFocus: () => false,
    body: {
      get innerText() { return clickCount ? '' : uploads.flatMap(([, names]) => names).join(' '); },
    },
    querySelectorAll(selector) {
      if (selector === '#editor') return [editor];
      if (selector === '#send') return [sendButton];
      if (selector === 'input[type="file"]') return fileInputs;
      if (selector === '[data-message-author-role="user"]') return Array.from({ length: messageCount }, () => ({}));
      return [];
    },
    addEventListener() {},
    createDocumentFragment: () => new RichNode('#fragment'),
    createElement: (tag) => new RichNode(tag.toUpperCase()),
    createRange: () => ({ selectNodeContents() {} }),
    execCommand(_command, _ui, text) {
      if (!execCommandWorks) return false;
      selectedEditor.value = text;
      return true;
    },
  };

  const window = {
    location: {
      href: google ? 'https://www.google.com/ai' : 'https://chatgpt.com/',
      origin: 'https://chatgpt.com',
    },
    getComputedStyle() {
      return {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        pointerEvents: 'auto',
      };
    },
    addEventListener() {},
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    removeEventListener() {},
    postMessage() {},
    setTimeout(callback, milliseconds) {
      advanceClock(milliseconds);
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
  };

  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeMessageListener = listener;
        },
      },
    },
  };

  const context = vm.createContext({
    RelaySites: {
      google: site,
      findSiteByUrl: () => google ? null : site,
      isGoogleAiPage: (url) => url === 'https://www.google.com/ai',
    },
    chrome,
    console: { error() {}, log() {}, warn() {} },
    document,
    window,
    navigator: { platform: 'MacIntel' },
    HTMLTextAreaElement: FakeTextArea,
    HTMLInputElement: FakeInput,
    File,
    atob,
    DataTransfer: class {
      files = [];
      items = { add: (file) => this.files.push(file) };
    },
    InputEvent: class {},
    Event: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class {},
    Date: { now: () => clock },
    setTimeout(callback, milliseconds) {
      advanceClock(milliseconds);
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    queueMicrotask,
  });

  vm.runInContext(attachmentSource, context, { filename: 'attachments.js' });
  vm.runInContext(draftsSource, context, { filename: 'drafts.js' });
  vm.runInContext(contentSource, context, { filename: 'content.js' });

  async function submit(prompt, attachments = []) {
    return new Promise((resolve) => {
      const keepChannelOpen = runtimeMessageListener(
        { action: 'submit-prompt', prompt, attachments },
        {},
        resolve,
      );
      assert.equal(keepChannelOpen, true);
    });
  }

  return {
    submit,
    clickCount: () => clickCount,
    prompt: () => editor.value,
    uploads,
    sentPrompts,
    clickTimes,
  };
}

test('rich-text delivery preserves links and blank lines across consecutive sends', async () => {
  const harness = createHarness({ richText: true, confirmOnClick: 1 });
  const prompts = ['First message', 'https://example.com/one\nhttps://example.com/two\n\nAnki发生了什么？'];
  for (const prompt of prompts) assert.equal((await harness.submit(prompt)).ok, true);
  assert.deepEqual(harness.sentPrompts, prompts);
  assert.equal(harness.clickCount(), 2);
});

test('rich-text fallback preserves multiple consecutive blank paragraphs', async () => {
  const harness = createHarness({ richText: true, confirmOnClick: 1, execCommandWorks: false });
  const prompt = 'First\n\n\nLast';
  assert.equal((await harness.submit(prompt)).ok, true);
  assert.deepEqual(harness.sentPrompts, [prompt]);
});

test('rich-text delivery rejects changed line breaks before retrying', async () => {
  const harness = createHarness({ richText: true, editedOnClick: 'First\nLast' });
  const result = await harness.submit('First\n\nLast');
  assert.equal(result.ok, false);
  assert.match(result.error, /another draft/);
  assert.equal(harness.clickCount(), 1);
  assert.equal(harness.prompt(), 'First\nLast');
});

test('content delivery retries once when the first click has no submission evidence', async () => {
  const harness = createHarness({ confirmOnClick: 2 });
  const response = await harness.submit('retry me');

  assert.equal(response.ok, true);
  assert.equal(response.method, 'button');
  assert.equal(harness.clickCount(), 2);
});

test('content delivery reports failure after two clicks without submission evidence', async () => {
  const harness = createHarness({ confirmOnClick: Infinity });
  const response = await harness.submit('fail clearly');

  assert.equal(response.ok, false);
  assert.match(response.error, /did not confirm/);
  assert.equal(harness.clickCount(), 2);
  assert.equal(harness.prompt(), '');
});

test('a prompt already in the destination blocks text and file delivery without changing the draft', async () => {
  const file = { name: 'notes.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' };
  for (const google of [false, true]) {
    const harness = createHarness({ initialPrompt: 'Existing notes', google, acceptedFileTypes: ['.txt'] });
    const response = await harness.submit('A new prompt', [file]);
    assert.equal(response.ok, false);
    assert.equal(response.preserveDestination, true);
    assert.match(response.error, /another draft/);
    assert.deepEqual(harness.uploads, []);
    assert.equal(harness.clickCount(), 0);
    assert.equal(harness.prompt(), 'Existing notes');
  }
});

test('a prompt edited on the same destination after Relay fills it is preserved on failure', async () => {
  const harness = createHarness({ confirmOnClick: Infinity, changedOnClick: 'A manual edit' });
  const response = await harness.submit('A Relay prompt');
  assert.equal(response.ok, false);
  assert.equal(response.preserveDestination, true);
  assert.equal(harness.clickCount(), 1);
  assert.equal(harness.prompt(), 'A manual edit');
});

test('mixed formats use their matching upload controls or stop before Send', async () => {
  const attachments = ['image/png', 'application/pdf'].map((type, index) => ({
    name: ['example.png', 'example.pdf'][index],
    type,
    lastModified: 0,
    dataUrl: `data:${type};base64,YQ==`,
  }));

  const supported = createHarness({ confirmOnClick: 1, acceptedFileTypes: ['image/*', '.pdf'] });
  assert.equal((await supported.submit('Here are two files', attachments)).ok, true);
  assert.deepEqual(supported.uploads, [['image/*', ['example.png']], ['.pdf', ['example.pdf']]]);

  const unsupported = createHarness({ acceptedFileTypes: ['image/*'] });
  const response = await unsupported.submit('Here are two files', attachments);
  assert.equal(response.ok, false);
  assert.match(response.error, /example\.pdf/);
  assert.equal(unsupported.clickCount(), 0);
});

test('a replaced composer containing a changed draft is neither confirmed nor overwritten', async () => {
  const harness = createHarness({ editedOnClick: 'An unsent edit' });
  const result = await harness.submit('My first draft');
  assert.equal(result.ok, false);
  assert.match(result.error, /another draft/);
  assert.equal(harness.clickCount(), 1);
});

test('a send with files is not repeated when the page gives no confirmation', async () => {
  const harness = createHarness({ confirmOnClick: Infinity, acceptedFileTypes: ['.txt'] });
  const result = await harness.submit('Read this', [{
    name: 'notes.txt', type: 'text/plain', lastModified: 0, dataUrl: 'data:text/plain;base64,YQ==',
  }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /did not confirm/);
  assert.equal(harness.clickCount(), 1);
});

test('three slow attachments wait for upload progress and delayed submission confirmation', async () => {
  const harness = createHarness({
    acceptedFileTypes: ['.pdf'], confirmOnClick: 1, uploadDuration: 75000, confirmationDelay: 30000,
  });
  const attachments = ['first.pdf', 'second.pdf', 'third.pdf'].map((name) => ({
    name, type: 'application/pdf', lastModified: 0, dataUrl: 'data:application/pdf;base64,YQ==',
  }));
  const response = await harness.submit('Read all three papers', attachments);
  assert.equal(response.ok, true);
  assert.deepEqual(harness.uploads, [['.pdf', attachments.map((file) => file.name)]]);
  assert.equal(harness.clickCount(), 1);
  assert.ok(harness.clickTimes[0] >= 75000, 'An enabled Send button must still wait for upload progress');
});

test('an attachment-only send can confirm a delayed user message without editor text', async () => {
  const harness = createHarness({ acceptedFileTypes: ['.txt'], confirmOnClick: 1, confirmationDelay: 30000 });
  const result = await harness.submit('', [{
    name: 'notes.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==',
  }]);
  assert.equal(result.ok, true);
  assert.equal(harness.clickCount(), 1);
});

test('an upload deadline stops the send and clears the text Relay inserted', async () => {
  const harness = createHarness({ acceptedFileTypes: ['.txt'], uploadDuration: 180000 });
  const result = await harness.submit('Keep this draft', [{
    name: 'notes.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==',
  }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /ready.*two minutes/);
  assert.equal(harness.clickCount(), 0);
  assert.equal(harness.prompt(), '');
});

test('user navigation while waiting for upload readiness stops before Send', async () => {
  const harness = createHarness({ acceptedFileTypes: ['.txt'], uploadDuration: 75000, navigateWhileUploading: true });
  const result = await harness.submit('Keep this draft', [{
    name: 'notes.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==',
  }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /destination page changed/);
  assert.equal(harness.clickCount(), 0);
});

test('leaving the original conversation after one upload prevents further files and prompt entry', async () => {
  const harness = createHarness({ acceptedFileTypes: ['.txt', '.pdf'], navigateOnUpload: true });
  const result = await harness.submit('Read these', [
    { name: 'first.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' },
    { name: 'second.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,YQ==' },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /destination page changed/);
  assert.deepEqual(harness.uploads, [['.txt', ['first.txt']]]);
  assert.equal(harness.prompt(), '');
  assert.equal(harness.clickCount(), 0);
});

test('Google AI Mode confirms a cleared draft only while still on an AI Mode page', async () => {
  const attachment = { name: 'notes.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' };
  for (const leaveAiModeOnSend of [false, true]) {
    const harness = createHarness({
      google: true, leaveAiModeOnSend, confirmOnClick: 1, acceptedFileTypes: ['.txt'],
    });
    const result = await harness.submit('Summarize this file', [attachment]);
    assert.equal(result.ok, !leaveAiModeOnSend);
    assert.equal(harness.clickCount(), 1);
  }
});

test('Google AI Mode waits for Send to enable after accepting an image', async () => {
  const harness = createHarness({
    google: true, confirmOnClick: 1, acceptedFileTypes: ['.png'], sendReadyAfter: 1500,
  });
  const image = { name: 'example.png', type: 'image/png', dataUrl: 'data:image/png;base64,YQ==' };
  const result = await harness.submit('What is in this image?', [image]);
  assert.equal(result.ok, true);
  assert.equal(harness.clickCount(), 1);
  assert.ok(harness.clickTimes[0] >= 1500);
});

test('Google AI Mode reports unavailable Send and clears only the inserted text', async () => {
  const harness = createHarness({ google: true, acceptedFileTypes: ['.png'], sendReadyAfter: Infinity });
  const image = { name: 'example.png', type: 'image/png', dataUrl: 'data:image/png;base64,YQ==' };
  const result = await harness.submit('What is in this image?', [image]);
  assert.equal(result.ok, false);
  assert.match(result.error, /did not expose an enabled Send button/);
  assert.equal(harness.clickCount(), 0);
  assert.equal(harness.prompt(), '');
  assert.deepEqual(harness.uploads, [['.png', ['example.png']]]);
});

test('text-only chat waits for a temporarily disabled Send button', async () => {
  const harness = createHarness({ confirmOnClick: 1, sendReadyAfter: 1500 });
  const result = await harness.submit('Wait for the composer');
  assert.equal(result.ok, true);
  assert.equal(harness.clickCount(), 1);
  assert.ok(harness.clickTimes[0] >= 1500);
});

test('text-only chat falls back when Send stays unavailable', async () => {
  const harness = createHarness({ sendReadyAfter: Infinity });
  const result = await harness.submit('Keep this draft');
  assert.equal(result.ok, false);
  assert.match(result.error, /did not confirm that the message was submitted/);
  assert.equal(harness.clickCount(), 0);
  assert.equal(harness.prompt(), '');
});
