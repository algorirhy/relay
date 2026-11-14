const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

async function createHarness({ saved = null, storageFails = false, clipboardFails = false, clipboardMissing = false, submitGate = null, rejectLaunch = false, initialJob = null, navigationFails = false } = {}) {
  class Element {
    constructor(tagName = 'div') {
      this.tagName = tagName;
      this.listeners = {};
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.value = '';
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type, properties = {}) {
      const event = { target: this, key: '', preventDefault() { this.defaultPrevented = true; }, ...properties };
      for (const listener of this.listeners[type] || []) listener(event);
      return event;
    }
    replaceChildren(...elements) { this.children = elements; }
    append(...elements) { this.children.push(...elements); }
    get lastChild() { return this.children.at(-1); }
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() { document.activeElement = this; }
    select() { this.selected = true; }
    closest() { return ['textarea', 'input', 'select'].includes(this.tagName) || this.attributes.contenteditable !== undefined ? this : null; }
    requestSubmit() { this.submitCount = (this.submitCount || 0) + 1; this.emit('submit'); }
  }
  const elements = Object.fromEntries(['prompt', 'launcher-form', 'submit-button', 'submit-label', 'service-hint', 'status', 'multiple-mode', 'copy-prompt', 'composer', 'attachment-button', 'attachment-input', 'attachment-list', 'attachment-limit'].map((id) => [id, new Element(id === 'prompt' ? 'textarea' : 'div')]));
  const grid = new Element();
  const document = new Element('document');
  document.getElementById = (id) => elements[id];
  document.querySelector = () => grid;
  document.createElement = (tagName) => new Element(tagName);
  const records = { navigated: [], copied: [], stored: [], messages: [] };
  const timers = [];
  let job = initialJob;
  const context = vm.createContext({
    URL,
    document,
    FileReader: class {
      readAsDataURL(file) {
        if (file.readError) this.onerror();
        else { this.result = file.dataUrl; this.onload(); }
      }
    },
    window: { setTimeout(callback) { timers.push(callback); }, location: { assign(url) {
      if (navigationFails) throw new Error('Navigation blocked');
      records.navigated.push(url);
    } } },
    navigator: clipboardMissing ? {} : { clipboard: { async writeText(text) {
      if (clipboardFails) throw new Error('Permission denied');
      records.copied.push(text);
    } } },
    chrome: { runtime: { async sendMessage(message) {
      records.messages.push(JSON.parse(JSON.stringify(message)));
      if (message.action === 'launcher-job') return {ok:true, job};
      if (message.action === 'clear-launcher-job') {job=null; return {ok:true};}
      if (message.action === 'launch-prompt') {
        if (submitGate) await submitGate;
        if (rejectLaunch) return {accepted:false,error:'Delivery was not accepted. Nothing was sent.'};
        job={id:'test-job',state:'pending',prompt:message.prompt,siteIds:message.siteIds,multiple:message.multiple};
        return {accepted:true,jobId:job.id};
      }
    } } },
    localStorage: {
      getItem() { if (storageFails) throw new Error('Blocked'); return saved; },
      setItem(key, value) { if (storageFails) throw new Error('Blocked'); records.stored.push([key, value]); },
    },
  });
  for (const file of ['sites.js', 'attachments.js', 'newtab.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const choose = (id) => grid.children.find((button) => button.dataset.service === id).emit('click');
  const type = (text) => { elements.prompt.value = text; elements.prompt.emit('input'); };
  const toggle = (value) => {elements['multiple-mode'].checked=value; elements['multiple-mode'].emit('change');};
  const finish = async (result) => {job={...job,state:'complete',result}; timers.shift()?.(); await settle();};
  await settle();
  return { elements, grid, document, records, choose, type, settle, toggle, finish, catalog: context.RelaySites };
}

test('new tab renders Google and the six chat services, with one remembered selection', async () => {
  const h = await createHarness({ saved: 'deepseek' });
  assert.deepEqual(h.grid.children.map((button) => button.dataset.service), ['google', ...Array.from(h.catalog.sites, (site) => site.id)]);
  assert.deepEqual(h.grid.children.filter((button) => button.attributes['aria-pressed'] === 'true').map((button) => button.dataset.service), ['deepseek']);
  h.type('中文、日本語 and English\nsecond line');
  h.choose('claude');
  assert.equal(h.elements.prompt.value, '中文、日本語 and English\nsecond line');
  assert.equal(h.document.activeElement, h.elements.prompt);
  assert.deepEqual(h.records.stored.at(-1), ['launcher:selected', 'claude']);
});

test('invalid or blocked selection storage falls back to Google without breaking the page', async () => {
  for (const options of [{ saved: '__proto__' }, { saved: 'removed-service' }, { storageFails: true }]) {
    const h = await createHarness(options);
    assert.equal(h.grid.children[0].attributes['aria-pressed'], 'true');
    h.choose('grok');
    assert.match(h.elements.prompt.placeholder, /Grok/);
  }
});

test('Google submission preserves and encodes multilingual text and navigates this tab once', async () => {
  const h = await createHarness();
  const text = '  中文 日本語 English\n& # + % ? https://example.com  ';
  h.type(text);
  h.elements.prompt.emit('keydown', { key: 'Enter' });
  assert.equal(h.records.navigated.length, 1);
  const url = new URL(h.records.navigated[0]);
  assert.equal(url.origin + url.pathname, 'https://www.google.com/search');
  assert.equal(url.searchParams.get('q'), text);
  assert.deepEqual(h.records.copied, []);
});

test('each AI requests automatic delivery of the exact prompt without a clipboard step', async () => {
  const catalog = (await createHarness()).catalog;
  for (const site of catalog.sites) {
    const h = await createHarness();
    h.choose(site.id);
    h.type('  你好 / こんにちは\nExplain this & that?  ');
    assert.equal(h.elements['submit-label'].textContent, 'Send');
    h.elements['launcher-form'].emit('submit');
    await h.settle();
    const sent = h.records.messages.filter(message=>message.action==='launch-prompt');
    assert.deepEqual(sent,[{action:'launch-prompt',prompt:'  你好 / こんにちは\nExplain this & that?  ',multiple:false,siteIds:[site.id]}]);
    assert.deepEqual(h.records.copied, []);
    assert.deepEqual(h.records.navigated, [], 'The background owns AI navigation');
  }
});

test('empty input opens any of the seven homepages without clipboard access', async () => {
  const h = await createHarness({ clipboardMissing: true });
  for (const [id, home] of [['google', 'https://www.google.com/'], ...Array.from(h.catalog.sites, (site) => [site.id, site.newChatUrl])]) {
    const tab = await createHarness({ clipboardMissing: true, saved: id });
    tab.type(' \n\t ');
    tab.elements['launcher-form'].emit('submit');
    assert.deepEqual(tab.records.navigated, [home]);
    assert.deepEqual(tab.records.copied, []);
  }
});

test('a rejected background task retains text and enables explicit copy fallback', async () => {
  const h = await createHarness({rejectLaunch:true});
  h.choose('chatgpt');
  h.type('keep original');
  h.elements['launcher-form'].emit('submit');
  await h.settle();
  assert.equal(h.elements.prompt.value,'keep original');
  assert.equal(h.elements.prompt.disabled,false);
  assert.equal(h.elements['copy-prompt'].hidden,false);
  assert.match(h.elements.status.textContent,/Nothing was sent/);
  h.elements['copy-prompt'].emit('click');
  await h.settle();
  assert.deepEqual(h.records.copied,['keep original']);
});

test('copy fallback failure preserves and selects text', async () => {
  const h = await createHarness({rejectLaunch:true,clipboardFails:true});
  h.choose('chatgpt'); h.type('keep');
  h.elements['launcher-form'].emit('submit'); await h.settle();
  h.elements['copy-prompt'].emit('click'); await h.settle();
  assert.equal(h.elements.prompt.value,'keep');
  assert.equal(h.elements.prompt.selected,true);
  assert.match(h.elements.status.textContent,/Could not copy/);
});

test('pending delivery prevents double submission and destination changes', async () => {
  let release;
  const h = await createHarness({submitGate:new Promise(resolve=>{release=resolve;})});
  h.choose('gemini'); h.type('pending');
  h.elements['launcher-form'].emit('submit');
  h.choose('grok'); h.elements['launcher-form'].emit('submit');
  h.document.emit('keydown',{altKey:true,code:'Digit5',key:'∞',target:h.elements.prompt});
  assert.equal(h.elements.prompt.disabled,true);
  release(); await h.settle();
  const messages=h.records.messages.filter(message=>message.action==='launch-prompt');
  assert.equal(messages.length,1);
  assert.deepEqual(messages[0].siteIds,['gemini']);
});

test('IME confirmation and Shift+Enter do not submit; normal Enter submits afterward', async () => {
  const h = await createHarness();
  h.type('输入法');
  h.elements.prompt.emit('compositionstart');
  h.elements.prompt.emit('keydown', { key: 'Enter' });
  h.elements['launcher-form'].emit('submit');
  h.elements.prompt.emit('compositionend');
  for (const event of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
    const result = h.elements.prompt.emit('keydown', { key: 'Enter', ...event });
    assert.equal(result.defaultPrevented, undefined);
  }
  assert.deepEqual(h.records.navigated, []);
  h.elements.prompt.emit('keydown', { key: 'Enter' });
  assert.equal(h.records.navigated.length, 1);
});

test('Option+1–7 works consecutively inside input using physical keys without moving focus or changing text', async () => {
  const h = await createHarness();
  h.type('Keep this text');
  h.elements.prompt.focus();
  const symbols = ['¡', '™', '£', '¢', '∞', '§', '¶'];
  for (let index = 0; index < 7; index += 1) {
    const event = h.document.emit('keydown', {altKey: true, code: `Digit${index + 1}`, key: symbols[index], target: h.elements.prompt});
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.grid.children[index].attributes['aria-pressed'], 'true');
    assert.equal(h.document.activeElement, h.elements.prompt);
    assert.equal(h.elements.prompt.value, 'Keep this text');
  }
});

test('Option shortcuts work outside input; plain digits, IME and other modifier combinations are untouched', async () => {
  const h = await createHarness();
  h.document.emit('keydown', {altKey: true, code: 'Digit7', key: '¶'});
  assert.equal(h.grid.children[6].attributes['aria-pressed'], 'true');
  const ignored = [
    {altKey: false}, {metaKey: true}, {ctrlKey: true}, {shiftKey: true},
    {isComposing: true}, {keyCode: 229}, {code: 'Digit8'}, {code: 'KeyQ'},
  ];
  for (const properties of ignored) {
    const event = h.document.emit('keydown', {altKey: true, code: 'Digit1', key: '¡', ...properties});
    assert.equal(h.grid.children[6].attributes['aria-pressed'], 'true');
    assert.equal(event.defaultPrevented, undefined);
  }
  h.elements.prompt.emit('compositionstart');
  h.document.emit('keydown', {altKey: true, code: 'Digit1', key: '¡'});
  assert.equal(h.grid.children[6].attributes['aria-pressed'], 'true');
  h.elements.prompt.emit('compositionend');
  h.document.activeElement = null;
  assert.equal(h.document.emit('keydown', {key: '/'}).defaultPrevented, true);
  assert.equal(h.document.activeElement, h.elements.prompt);
});

test('navigation errors keep the prompt and restore controls', async () => {
  const h = await createHarness({ navigationFails: true });
  h.type('keep after navigation failure');
  h.elements['launcher-form'].emit('submit');
  assert.match(h.elements.status.textContent, /Navigation blocked/);
  assert.equal(h.elements.prompt.value, 'keep after navigation failure');
  assert.equal(h.elements.prompt.disabled, false);
});

test('multiple mode defaults off, selects seven services on enabling, and restores the single selection on disabling', async () => {
  const h=await createHarness({saved:'claude'});
  assert.equal(h.elements['multiple-mode'].checked,false);
  h.type('preserve'); h.toggle(true);
  assert.equal(h.grid.children[0].disabled,false);
  assert.equal(h.grid.children.filter(button=>button.attributes['aria-pressed']==='true').length,7);
  h.choose('grok');
  h.toggle(false);
  assert.equal(h.grid.children[2].attributes['aria-pressed'],'true');
  assert.equal(h.elements.prompt.value,'preserve');
});

test('multiple mode submits only selected services and disables empty selections', async () => {
  const h=await createHarness(); h.toggle(true); h.type('compare');
  h.choose('claude');
  h.elements['launcher-form'].emit('submit'); await h.settle();
  const sent=h.records.messages.find(message=>message.action==='launch-prompt');
  assert.equal(sent.multiple,true);
  assert.deepEqual(sent.siteIds,['google','chatgpt','gemini','grok','deepseek','doubao']);
  const empty=await createHarness(); empty.toggle(true); empty.type('test');
  for(const site of empty.catalog.launcherServices) empty.choose(site.id);
  assert.equal(empty.elements['submit-button'].disabled,true);
  empty.elements['launcher-form'].emit('submit'); await empty.settle();
  assert.equal(empty.records.messages.some(message=>message.action==='launch-prompt'),false);
});

test('failed and interrupted tasks restore the draft and mode without resending', async () => {
  for (const state of ['complete','interrupted']) {
    const job={id:'saved',state,prompt:'Recovered question',siteIds:['chatgpt','claude'],multiple:true,error:'Delivery was interrupted.',result:{ok:false,results:[{name:'ChatGPT',ok:true},{name:'Claude',ok:false,error:'Signed out'}]}};
    const h=await createHarness({initialJob:job});
    assert.equal(h.elements.prompt.value,'Recovered question');
    assert.equal(h.elements['multiple-mode'].checked,true);
    assert.equal(h.elements['copy-prompt'].hidden,false);
    assert.equal(h.records.messages.some(message=>message.action==='launch-prompt'),false);
    assert.match(h.elements.status.textContent,state==='complete'?/Could not confirm/:/interrupted/);
  }
});

test('successful multi delivery shows confirmed results and clears the recovery record', async () => {
  const h=await createHarness(); h.toggle(true); h.type('compare');
  h.elements['launcher-form'].emit('submit'); await h.settle();
  await h.finish({ok:true,results:[{name:'ChatGPT',ok:true},{name:'Claude',ok:true}]});
  assert.match(h.elements.status.textContent,/Sent to ChatGPT, Claude/);
  assert.equal(h.elements.prompt.disabled,false);
  assert.equal(h.elements['copy-prompt'].hidden,true);
  assert.ok(h.records.messages.some(message=>message.action==='clear-launcher-job'));
});


test('Google can be toggled in multiple mode and is reported as search, not an AI send', async () => {
  const h=await createHarness();h.toggle(true);h.type('compare');
  h.document.emit('keydown',{altKey:true,code:'Digit1',key:'¡',target:h.elements.prompt});
  assert.equal(h.grid.children[0].attributes['aria-pressed'],'false');
  h.choose('google');
  assert.equal(h.grid.children[0].attributes['aria-pressed'],'true');
  h.elements['launcher-form'].emit('submit');await h.settle();
  await h.finish({ok:true,results:[{name:'Google',ok:true,method:'search'},{name:'ChatGPT',ok:true,method:'button'}]});
  assert.match(h.elements.status.textContent,/Opened Google search/);
  assert.match(h.elements.status.textContent,/Sent to ChatGPT/);
  assert.doesNotMatch(h.elements.status.textContent,/Sent to Google/);
});

const sampleFile = { name: 'example.txt', type: 'text/plain', size: 3, lastModified: 1, dataUrl: 'data:text/plain;base64,YWJj' };

function pickFiles(harness, files) {
  const picker = harness.elements['attachment-input'];
  picker.files = files;
  picker.emit('change');
}

test('single Google keeps the attachment and asks for a question before using AI Mode', async () => {
  const h = await createHarness();
  pickFiles(h, [sampleFile]);
  assert.equal(h.elements['submit-button'].disabled, true);
  assert.match(h.elements['service-hint'].textContent, /Enter a question/);
  h.type('Summarize the file');
  h.elements['launcher-form'].emit('submit');
  await h.settle();
  assert.deepEqual(h.records.navigated, []);
  assert.deepEqual(h.records.messages.find((message) => message.action === 'launch-prompt').attachments, [sampleFile]);
});

test('recovered attachments must be reselected or removed before an attachment-only retry', async () => {
  const { dataUrl, ...metadata } = sampleFile;
  const h = await createHarness({ initialJob: {
    id: 'failed', state: 'interrupted', siteIds: ['claude'], prompt: '', multiple: false,
    files: [metadata], error: 'Interrupted.',
  } });
  assert.equal(h.elements['submit-button'].disabled, true);
  assert.match(h.elements['attachment-list'].children[0].children[0].textContent, /example\.txt \(add again\)/);
  h.elements['launcher-form'].emit('submit');
  assert.equal(h.records.messages.some((message) => message.action === 'launch-prompt'), false);
  pickFiles(h, [sampleFile]);
  h.elements['launcher-form'].emit('submit');
  await h.settle();
  assert.deepEqual(h.records.messages.find((message) => message.action === 'launch-prompt').attachments, [sampleFile]);
});

test('invalid file selections and read errors leave the draft editable without launching', async () => {
  const h = await createHarness({ saved: 'chatgpt' });
  h.type('Keep the draft');
  pickFiles(h, [{ ...sampleFile, size: 11 * 1024 * 1024 }]);
  assert.match(h.elements.status.textContent, /10 MiB/);
  assert.equal(h.elements['attachment-list'].children.length, 0);
  pickFiles(h, [{ ...sampleFile, readError: true }]);
  h.elements['launcher-form'].emit('submit');
  await h.settle();
  assert.match(h.elements.status.textContent, /Could not read/);
  assert.equal(h.elements.prompt.value, 'Keep the draft');
  assert.equal(h.elements.prompt.disabled, false);
  assert.equal(h.records.messages.some((message) => message.action === 'launch-prompt'), false);
});
