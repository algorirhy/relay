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

function createHarness({ confirmOnClick = 2, acceptedFileTypes = [], editedOnClick, navigateOnUpload, google = false, leaveAiModeOnSend = false } = {}) {
  let clock = 0;
  let clickCount = 0;
  let runtimeMessageListener;
  const uploads = [];

  class FakeElement {
    constructor() {
      this.isConnected = true;
      this.className = '';
      this.classList = { contains: () => false };
    }

    getAttribute() { return null; }
    getBoundingClientRect() { return { bottom: 100 }; }
    getClientRects() { return [{}]; }
    matches() { return false; }
    closest() { return null; }
    focus() {}
    dispatchEvent() { return true; }
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
        if (navigateOnUpload) window.location.href = 'https://chatgpt.com/c/other';
      }
      return true;
    }
  }

  let editor = new FakeTextArea();
  const fileInputs = acceptedFileTypes.map((type) => new FakeInput(type));
  const sendButton = new FakeElement();
  sendButton.click = () => {
    clickCount += 1;
    if (leaveAiModeOnSend) window.location.href = 'https://www.google.com/search';
    if (editedOnClick !== undefined) {
      editor.isConnected = false;
      editor = new FakeTextArea();
      editor.value = editedOnClick;
    } else if (clickCount >= confirmOnClick) {
      editor.value = '';
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
    body: {
      get innerText() { return clickCount ? '' : uploads.flatMap(([, names]) => names).join(' '); },
    },
    querySelectorAll(selector) {
      if (selector === '#editor') return [editor];
      if (selector === '#send') return [sendButton];
      if (selector === 'input[type="file"]') return fileInputs;
      return [];
    },
    addEventListener() {},
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
    removeEventListener() {},
    postMessage() {},
    setTimeout(callback, milliseconds) {
      clock += milliseconds;
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
      clock += milliseconds;
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    queueMicrotask,
  });

  vm.runInContext(attachmentSource, context, { filename: 'attachments.js' });
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
  };
}

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
  assert.match(result.error, /draft changed/);
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
