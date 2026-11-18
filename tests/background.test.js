const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const sitesSource = fs.readFileSync(path.join(projectRoot, 'sites.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(projectRoot, 'background.js'), 'utf8');

function siteIdFromUrl(url) {
  const hostname = new URL(url).hostname;
  if (hostname === 'www.google.com') return 'google';
  if (hostname === 'chatgpt.com') return 'chatgpt';
  if (hostname === 'claude.ai') return 'claude';
  if (hostname === 'gemini.google.com') return 'gemini';
  if (hostname === 'grok.com') return 'grok';
  if (hostname.endsWith('deepseek.com')) return 'deepseek';
  if (hostname.endsWith('doubao.com')) return 'doubao';
  return null;
}

function matchesPattern(url, pattern) {
  return url.startsWith(pattern.replace('*', ''));
}

function createHarness(initialTabs, {
  failSubmitFor = [],
  preserveDestinationFor = [],
  submitGate = null,
  storageFails = false,
  failCreateFor = [],
  initialSession = {},
  afterSubmit = () => {},
  afterPing = () => {},
  afterNavigate = () => {},
  afterStorageRead = () => {},
  now = Date.now,
} = {}) {
  const tabs = initialTabs.map((tab) => ({ status: 'complete', ...tab }));
  const records = {
    created: [],
    updated: [],
    submitted: [],
    notifications: [],
    shortcuts: [],
  };
  let runtimeMessageListener;
  let actionClickListener;
  let commandListener;
  let tabRemovedListener;
  let nextTabId = 100;

  const session = JSON.parse(JSON.stringify(initialSession));
  const chrome = {
    storage: { session: {
      async get(key) {
        const snapshot = session[key];
        await afterStorageRead(key);
        return { [key]: snapshot };
      },
      async set(values) { if (storageFails) throw new Error('Session storage unavailable'); Object.assign(session, JSON.parse(JSON.stringify(values))); },
      async remove(key) { delete session[key]; },
    } },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: {
        addListener(listener) {
          runtimeMessageListener = listener;
        },
      },
    },
    action: {
      onClicked: { addListener(listener) { actionClickListener = listener; } },
    },
    commands: {
      onCommand: { addListener(listener) { commandListener = listener; } },
    },
    notifications: {
      async create(options) {
        records.notifications.push(options);
        return 'notification-id';
      },
    },
    tabs: {
      onRemoved: { addListener(listener) { tabRemovedListener = listener; } },
      async query(queryInfo) {
        if (!queryInfo.url) return [];
        const patterns = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url];
        return tabs.filter((tab) => patterns.some((pattern) => matchesPattern(tab.url, pattern)));
      },
      async update(tabId, updateInfo) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        Object.assign(tab, updateInfo, { status: 'complete' });
        records.updated.push({ tabId, ...updateInfo });
        if (updateInfo.url) afterNavigate(tab);
        return { ...tab };
      },
      async create(createInfo) {
        if (failCreateFor.some(prefix=>createInfo.url.startsWith(prefix))) throw new Error('Could not create this tab');
        const tab = {
          id: nextTabId++,
          windowId: createInfo.windowId ?? 1,
          index: tabs.filter((candidate) => candidate.windowId === createInfo.windowId).length,
          status: 'complete',
          url: createInfo.url,
        };
        tabs.push(tab);
        records.created.push({ ...createInfo, id: tab.id });
        afterNavigate(tab);
        return { ...tab };
      },
      async get(tabId) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error('Tab closed');
        return { ...tab };
      },
      async sendMessage(tabId, message) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (message.action === 'focus-relay' || message.action === 'new-chat') {
          records.shortcuts.push({ tabId, ...message });
        }
        if (message.action === 'ping') {
          const siteId = siteIdFromUrl(tab.url);
          afterPing(tab);
          return { ok: true, siteId };
        }
        if (message.action === 'submit-prompt') {
          if (submitGate) await submitGate;
          afterSubmit(tab);
          if (failSubmitFor.includes(siteIdFromUrl(tab.url))) {
            throw new Error('Simulated site failure');
          }
          if (preserveDestinationFor.includes(siteIdFromUrl(tab.url))) {
            return { ok: false, error: 'An existing draft was found', preserveDestination: true };
          }
          records.submitted.push({
            tabId,
            prompt: message.prompt,
            attachments: JSON.parse(JSON.stringify(message.attachments)),
          });
          return { ok: true, method: 'button' };
        }
        return { ok: true };
      },
    },
  };

  const context = vm.createContext({
    URL,
    chrome,
    console: { error() {}, log() {}, warn() {} },
    setTimeout,
    clearTimeout,
    Date: { now },
  });
  context.globalThis = context;
  context.importScripts = () => {
    vm.runInContext(sitesSource, context, { filename: 'sites.js' });
    vm.runInContext(fs.readFileSync(path.join(projectRoot, 'attachments.js'), 'utf8'), context, { filename: 'attachments.js' });
  };
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });

  function request(message, sender = {url: 'chrome-extension://test/newtab.html', tab: {id: 1, windowId: 1, url: 'chrome-extension://test/newtab.html'}}) {
    return new Promise((resolve) => {
      assert.equal(runtimeMessageListener(message, sender, resolve), true);
    });
  }
  async function waitForLauncher() {
    for (let index = 0; index < 40; index += 1) {
      await new Promise(setImmediate);
      if (session['launcher:1']?.state === 'complete') return session['launcher:1'];
    }
    assert.fail('Launcher delivery did not finish');
  }
  return { records, request, waitForLauncher, session, runtimeMessageListener, actionClickListener, commandListener, tabRemovedListener };
}

const launcherTab = {id: 1, windowId: 1, index: 0, url: 'chrome-extension://test/newtab.html'};

test('toolbar action opens Relay in the current window without changing the current tab', async () => {
  const h = createHarness([launcherTab]);
  h.actionClickListener({ id: 17, windowId: 4 });
  await new Promise(setImmediate);
  assert.deepEqual(h.records.created, [
    { windowId: 4, url: 'chrome-extension://test/newtab.html', id: 100 },
  ]);
  assert.deepEqual(h.records.updated, []);
});

test('the focus shortcut targets Relay and only identifies a genuine new tab for replacement', async () => {
  const newTab = { ...launcherTab, id: 2, url: 'chrome://newtab/' };
  const website = { ...launcherTab, id: 3, url: 'https://chatgpt.com/' };
  const h = createHarness([launcherTab, newTab, website]);
  await h.commandListener('focus-relay', newTab);
  await h.commandListener('focus-relay', launcherTab);
  await h.commandListener('focus-relay', website);
  await h.commandListener('focus-relay', { ...newTab, pendingUrl: website.url });
  await h.commandListener('new-chat', website);
  assert.deepEqual(h.records.shortcuts, [
    { tabId: 2, action: 'focus-relay', fromNewTab: true },
    { tabId: 1, action: 'focus-relay', fromNewTab: false },
    { tabId: 3, action: 'new-chat' },
  ]);
});

test('multi-service delivery reuses the first matching tab in the preferred window', async () => {
  const h = createHarness([
    launcherTab,
    { id: 10, windowId: 2, index: 0, url: 'https://chatgpt.com/c/other-window' },
    { id: 11, windowId: 1, index: 5, url: 'https://chatgpt.com/c/later' },
    { id: 12, windowId: 1, index: 0, url: 'https://chatgpt.com/c/first' },
  ]);
  await h.request({ action: 'launch-prompt', prompt: 'hello', siteIds: ['chatgpt', 'claude'], multiple: true });
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, true);
  assert.deepEqual(h.records.updated, [{ tabId: 12, url: 'https://chatgpt.com/' }]);
  assert.deepEqual(h.records.created, [{ url: 'https://claude.ai/new', active: false, windowId: 1, id: 100 }]);
  assert.equal(h.records.notifications.length, 0);
});

test('single launcher uses only the initiating tab, with a recovery draft saved before delivery', async () => {
  const h = createHarness([launcherTab, {id: 2, windowId: 1, index: 1, url: 'https://chatgpt.com/c/keep'}]);
  const ack = await h.request({action:'launch-prompt', prompt:'Exact 中文\nquestion', siteIds:['chatgpt'], multiple:false});
  assert.equal(ack.accepted, true);
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, true);
  assert.equal(job.prompt, '', 'Confirmed success removes the recovery text');
  assert.deepEqual(h.records.created, []);
  assert.deepEqual(h.records.updated, [{tabId:1, url:'https://chatgpt.com/'}]);
  assert.deepEqual(h.records.submitted, [{tabId:1, prompt:'Exact 中文\nquestion', attachments:[]}]);
});

test('single launcher failure restores this tab to the launcher and retains the exact prompt', async () => {
  const h = createHarness([launcherTab], {failSubmitFor:['claude']});
  await h.request({action:'launch-prompt', prompt:'keep this draft', siteIds:['claude']});
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, false);
  assert.equal(job.prompt, 'keep this draft');
  // The completion record is written before the recovery navigation.
  await new Promise(setImmediate);
  assert.deepEqual(h.records.updated, [{tabId:1,url:'https://claude.ai/new'}, {tabId:1,url:'chrome-extension://test/newtab.html'}]);
  assert.equal(h.records.notifications.length, 1);
});

test('an unconfirmed Doubao submission uses launcher recovery without activating another tab', async () => {
  const h = createHarness([launcherTab], { failSubmitFor: ['doubao'] });
  await h.request({ action: 'launch-prompt', prompt: 'keep my draft', siteIds: ['doubao'] });
  const job = await h.waitForLauncher();
  await new Promise(setImmediate);
  assert.equal(job.result.ok, false);
  assert.equal(job.prompt, 'keep my draft');
  assert.deepEqual(h.records.updated, [
    { tabId: 1, url: 'https://www.doubao.com/chat/' },
    { tabId: 1, url: 'chrome-extension://test/newtab.html' },
  ]);
  assert.match(h.records.notifications[0].message, /Could not confirm: Doubao/);
});

test('multi-service delivery isolates failures and leaves the launcher tab intact', async () => {
  const h = createHarness([launcherTab], {failSubmitFor:['claude']});
  await h.request({action:'launch-prompt', prompt:'compare', siteIds:['chatgpt','claude','gemini','grok','deepseek','doubao'], multiple:true});
  const job = await h.waitForLauncher();
  assert.deepEqual(Array.from(job.result.results.filter((item) => !item.ok), (item) => item.siteId), ['claude']);
  assert.equal(job.prompt, 'compare');
  assert.equal(h.records.created.length, 6);
  assert.equal(h.records.updated.some(update=>update.tabId===1), false);
});

test('launcher refuses to navigate if recovery storage fails', async () => {
  const h = createHarness([launcherTab], {storageFails:true});
  const ack = await h.request({action:'launch-prompt', prompt:'keep', siteIds:['grok']});
  assert.equal(ack.accepted, false);
  assert.match(ack.error, /Nothing was sent/);
  assert.deepEqual(h.records.updated, []);
  assert.deepEqual(h.records.created, []);
});

test('launcher validates sender and destination mode before touching tabs', async () => {
  const h = createHarness([launcherTab]);
  for (const message of [
    {siteIds:['google']}, {siteIds:['chatgpt','claude']}, {siteIds:[]}, {siteIds:['chatgpt'],prompt:' '},
  ]) {
    const ack = await h.request({action:'launch-prompt', prompt:'test', ...message});
    assert.equal(ack.accepted, false);
  }
  const ack = await h.request({action:'launch-prompt',prompt:'test',siteIds:['chatgpt']}, {url:'https://chatgpt.com/',tab:{id:1}});
  assert.equal(ack.accepted, false);
  assert.deepEqual(h.records.updated, []);
});

test('a restarted worker reports interruption and recovers text without resending', async () => {
  const h = createHarness([launcherTab], {initialSession:{'launcher:1':{id:'old',state:'pending',createdAt:Date.now(),prompt:'recover',siteIds:['chatgpt'],multiple:false}}});
  const response = await h.request({action:'launcher-job'});
  assert.equal(response.job.state, 'interrupted');
  assert.equal(response.job.prompt, 'recover');
  assert.deepEqual(h.records.submitted, []);
});

test('duplicate launcher submissions are rejected while delivery is pending', async () => {
  let release;
  const h = createHarness([launcherTab], {submitGate:new Promise(resolve=>{release=resolve;})});
  assert.equal((await h.request({action:'launch-prompt',prompt:'once',siteIds:['chatgpt']})).accepted,true);
  assert.equal((await h.request({action:'launch-prompt',prompt:'twice',siteIds:['chatgpt']})).accepted,false);
  release();
  await h.waitForLauncher();
  assert.equal(h.records.submitted.length,1);
});

test('launcher does not overwrite a tab the user navigated away from before delivery', async () => {
  const h=createHarness([{...launcherTab,url:'https://example.com/'}]);
  await h.request({action:'launch-prompt',prompt:'keep',siteIds:['chatgpt']});
  const job=await h.waitForLauncher();
  assert.equal(job.result.ok,false);
  assert.equal(job.prompt,'keep');
  assert.deepEqual(h.records.updated,[]);
});

test('single launch accepts Chrome internal new-tab URLs from an authenticated extension document', async () => {
  for (const url of ['chrome://newtab/','chrome://newtab']) {
    const h=createHarness([{...launcherTab,url}]);
    const response=await h.request({action:'launch-prompt',prompt:'true new tab',siteIds:['doubao']}, {
      url:'chrome-extension://test/newtab.html',tab:{...launcherTab,url},
    });
    assert.equal(response.accepted,true);
    const job=await h.waitForLauncher();
    assert.equal(job.result.ok,true);
    assert.deepEqual(h.records.updated,[{tabId:1,url:'https://www.doubao.com/chat/'}]);
    assert.equal(h.records.created.length,0);
  }
});

test('single launch rejects unrelated internal pages and pending navigation away from the launcher', async () => {
  for (const tab of [
    {...launcherTab,url:'chrome://settings/'},
    {...launcherTab,url:'chrome://new-tab-page/'},
    {...launcherTab,url:'chrome://newtab.evil/'},
    {...launcherTab,url:'chrome://newtab/',pendingUrl:'https://example.com/'},
  ]) {
    const h=createHarness([tab]);
    await h.request({action:'launch-prompt',prompt:'keep',siteIds:['doubao']});
    const job=await h.waitForLauncher();
    assert.equal(job.result.ok,false);
    assert.deepEqual(h.records.updated,[]);
    assert.equal(job.prompt,'keep');
  }
});


test('multiple services opens encoded Google search independently of AI delivery', async () => {
  const h=createHarness([launcherTab]);
  const prompt='中文 日本語 & # +';
  await h.request({action:'launch-prompt',prompt,siteIds:['google','chatgpt'],multiple:true});
  const job=await h.waitForLauncher();
  assert.equal(job.result.ok,true);
  const search=h.records.created.find(tab=>new URL(tab.url).hostname==='www.google.com');
  assert.equal(new URL(search.url).searchParams.get('q'),prompt);
  assert.equal(search.active,false);
  assert.equal(job.result.results.find(item=>item.siteId==='google').method,'search');
  assert.equal(h.records.submitted.length,1,'Google must not receive an AI submit message');
  assert.equal(h.records.updated.some(item=>item.tabId===1),false);
});

test('multiple services supports Google alone without invoking the AI broadcaster', async () => {
  const h=createHarness([launcherTab]);
  await h.request({action:'launch-prompt',prompt:'search only',siteIds:['google'],multiple:true});
  const job=await h.waitForLauncher();
  assert.equal(job.result.ok,true);
  assert.equal(h.records.created.length,1);
  assert.equal(h.records.submitted.length,0);
  assert.equal(job.prompt,'');
});

test('Google search-tab failure does not stop selected AI deliveries', async () => {
  const h=createHarness([launcherTab],{failCreateFor:['https://www.google.com/']});
  await h.request({action:'launch-prompt',prompt:'keep',siteIds:['google','chatgpt'],multiple:true});
  const job=await h.waitForLauncher();
  assert.deepEqual(Array.from(job.result.results, (item) => [item.siteId, item.ok]), [['google', false], ['chatgpt', true]]);
  assert.equal(h.records.submitted.length,1);
  assert.equal(job.prompt,'keep');
});

const attachment = { name: 'hello.txt', type: 'text/plain', size: 3, lastModified: 1, dataUrl: 'data:text/plain;base64,YWJj' };

test('a mixed request with files sends the same payload to Google AI Mode and chat services, then clears the draft', async () => {
  const h = createHarness([launcherTab], { submitGate: Promise.resolve() });
  const response = await h.request({
    action: 'launch-prompt', multiple: true, prompt: 'Summarize this.', siteIds: ['google', 'chatgpt'], attachments: [attachment],
  });
  assert.equal(response.accepted, true);
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, true);
  assert.deepEqual(h.records.created.map((tab) => tab.url).sort(), ['https://chatgpt.com/', 'https://www.google.com/ai']);
  assert.deepEqual(h.records.submitted.map((record) => record.attachments), [[attachment], [attachment]]);
  assert.equal(job.result.results[0].name, 'Google AI Mode');
  assert.equal(job.result.results[0].method, 'button');
  assert.deepEqual(job.files, []);
  assert.equal(job.prompt, '');
});

test('a failed attachment-only job recovers file metadata without storing bytes and preserves pending user navigation', async () => {
  const h = createHarness([launcherTab], {
    failSubmitFor: ['chatgpt'],
    afterSubmit(tab) { tab.pendingUrl = 'https://chatgpt.com/c/user-choice'; },
  });
  const response = await h.request({ action: 'launch-prompt', prompt: '', siteIds: ['chatgpt'], attachments: [attachment] });
  assert.equal(response.accepted, true);
  const job = await h.waitForLauncher();
  await new Promise(setImmediate);
  assert.equal(job.result.ok, false);
  const { dataUrl, ...metadata } = attachment;
  assert.deepEqual(job.files, [metadata]);
  assert.doesNotMatch(JSON.stringify(h.session), /YWJj/);
  assert.deepEqual(h.records.updated, [{ tabId: 1, url: 'https://chatgpt.com/' }]);
});

test('failed single delivery restores attachment bytes only on request and clears them on discard', async () => {
  const h = createHarness([launcherTab], { failSubmitFor: ['chatgpt'] });
  await h.request({ action: 'launch-prompt', prompt: 'Read this', siteIds: ['chatgpt'], attachments: [attachment] });
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, false);
  assert.equal((await h.request({ action: 'launcher-job' })).attachments.length, 0);
  const recovered = await h.request({ action: 'launcher-job', restoreDraft: true });
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.attachments)), [attachment]);
  assert.doesNotMatch(JSON.stringify(h.session), /YWJj/);
  await h.request({ action: 'clear-launcher-job', jobId: job.id });
  assert.equal((await h.request({ action: 'launcher-job', restoreDraft: true })).job, null);
  assert.equal((await h.request({ action: 'launcher-job', restoreDraft: true })).attachments.length, 0);
});

test('successful attachment delivery releases retained file bytes', async () => {
  const h = createHarness([launcherTab]);
  await h.request({ action: 'launch-prompt', prompt: 'Read this', siteIds: ['chatgpt'], attachments: [attachment] });
  assert.equal((await h.waitForLauncher()).result.ok, true);
  assert.equal((await h.request({ action: 'launcher-job', restoreDraft: true })).attachments.length, 0);
});

test('worker restart restores metadata while expired and closed drafts release retained files', async () => {
  let now = Date.now();
  const h = createHarness([launcherTab], { failSubmitFor: ['chatgpt'], now: () => now });
  await h.request({ action: 'launch-prompt', prompt: 'Keep this', siteIds: ['chatgpt'], attachments: [attachment] });
  const job = await h.waitForLauncher();
  const restarted = createHarness([launcherTab], { initialSession: h.session });
  const recovered = await restarted.request({ action: 'launcher-job', restoreDraft: true });
  assert.equal(recovered.attachments.length, 0);
  assert.deepEqual(recovered.job.files, job.files);
  now += 61 * 60 * 1000;
  const expired = await h.request({ action: 'launcher-job', restoreDraft: true });
  assert.equal(expired.job, null);
  assert.equal(expired.attachments.length, 0);

  const closed = createHarness([launcherTab], { failSubmitFor: ['chatgpt'] });
  await closed.request({ action: 'launch-prompt', prompt: 'Close this', siteIds: ['chatgpt'], attachments: [attachment] });
  await closed.waitForLauncher();
  closed.tabRemovedListener(1);
  const removed = await closed.request({ action: 'launcher-job', restoreDraft: true });
  assert.equal(removed.job, null);
  assert.equal(removed.attachments.length, 0);
});

test('an invalid attachment or a Google file request without a question never leaves the launcher', async () => {
  const h = createHarness([launcherTab]);
  for (const draft of [
    { siteIds: ['chatgpt'], prompt: '', attachments: [{ ...attachment, size: 1 }] },
    { siteIds: ['chatgpt'], prompt: '', attachments: Array(6).fill(attachment) },
    { siteIds: ['google'], prompt: ' ', attachments: [attachment] },
  ]) {
    const response = await h.request({ action: 'launch-prompt', ...draft });
    assert.equal(response.accepted, false);
  }
  assert.deepEqual(h.session, {});
  assert.deepEqual(h.records.updated, []);
});

test('delivery stops when the loaded tab switches to another conversation on the same host', async () => {
  const h = createHarness([launcherTab], {
    afterPing(tab) { tab.url = 'https://chatgpt.com/c/another-conversation'; },
  });
  await h.request({ action: 'launch-prompt', prompt: 'Keep this draft', siteIds: ['chatgpt'] });
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, false);
  assert.match(job.result.results[0].error, /page changed/);
  assert.equal(job.prompt, 'Keep this draft');
  assert.equal(h.records.submitted.length, 0);
  assert.equal(h.records.updated.length, 1, 'Relay must leave the other conversation open');
});

test('delivery never starts if the first completed page is already an existing conversation', async () => {
  for (const multiple of [false, true]) {
    const h = createHarness([launcherTab], {
      afterNavigate(tab) {
        if (tab.url === 'https://chatgpt.com/') tab.url = 'https://chatgpt.com/c/another-conversation';
      },
    });
    await h.request({ action: 'launch-prompt', prompt: 'Keep this draft', siteIds: ['chatgpt'], multiple });
    const job = await h.waitForLauncher();
    assert.equal(job.result.ok, false);
    assert.match(job.result.results[0].error, /page changed/);
    assert.equal(job.prompt, 'Keep this draft');
    assert.deepEqual(h.records.submitted, []);
    assert.equal(h.records.updated.length, multiple ? 0 : 1);
  }
});

test('delivery accepts fresh Google AI Mode and Gemini account redirects', async () => {
  const h = createHarness([launcherTab], {
    afterNavigate(tab) {
      if (tab.url === 'https://www.google.com/ai') tab.url = 'https://www.google.com/webhp?aep=11';
      if (tab.url === 'https://gemini.google.com/app') tab.url = 'https://gemini.google.com/u/0/app?hl=ja';
    },
  });
  await h.request({ action: 'launch-prompt', prompt: 'Read this', siteIds: ['google', 'gemini'], multiple: true, attachments: [attachment] });
  assert.equal((await h.waitForLauncher()).result.ok, true);
  assert.equal(h.records.submitted.length, 2);
});

test('single delivery preserves an occupied destination and keeps the Relay recovery draft', async () => {
  const h = createHarness([launcherTab], { preserveDestinationFor: ['chatgpt'] });
  await h.request({ action: 'launch-prompt', prompt: 'Keep me in Relay', siteIds: ['chatgpt'] });
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, false);
  assert.equal(job.prompt, 'Keep me in Relay');
  assert.deepEqual(h.records.updated, [{ tabId: 1, url: 'https://chatgpt.com/' }]);
});

test('delivery rejects a different Gemini account and a Google AI Mode search with an existing query', async () => {
  const h = createHarness([launcherTab, { id: 2, windowId: 1, url: 'https://gemini.google.com/u/2/app/previous' }], {
    afterNavigate(tab) {
      if (tab.url === 'https://www.google.com/ai') tab.url = 'https://www.google.com/search?udm=50&q=other';
      if (tab.url === 'https://gemini.google.com/u/2/app') tab.url = 'https://gemini.google.com/u/0/app';
    },
  });
  await h.request({ action: 'launch-prompt', prompt: 'Keep this draft', siteIds: ['google', 'gemini'], multiple: true, attachments: [attachment] });
  const job = await h.waitForLauncher();
  assert.equal(job.result.ok, false);
  assert.equal(job.result.results.every((item) => !item.ok), true);
  assert.equal(job.prompt, 'Keep this draft');
  assert.deepEqual(h.records.submitted, []);
});

test('an in-flight status read cannot overwrite the completion record', async () => {
  let finishDelivery;
  let unblockRead;
  let readStarted;
  const reading = new Promise(resolve => { readStarted = resolve; });
  const pauseRead = new Promise(resolve => { unblockRead = resolve; });
  const h = createHarness([launcherTab], {
    submitGate: new Promise(resolve => { finishDelivery = resolve; }),
    async afterStorageRead() {
      readStarted();
      await pauseRead;
    },
  });
  await h.request({ action: 'launch-prompt', prompt: 'Finish once', siteIds: ['chatgpt'] });
  const read = h.request({ action: 'launcher-job' });
  await reading;
  finishDelivery();
  await new Promise(setImmediate);
  unblockRead();
  assert.equal((await read).job.state, 'pending');
  assert.equal((await h.waitForLauncher()).result.ok, true);
});

test('a running job keeps its recovery data after the retention period', async () => {
  let now = Date.now();
  let finishDelivery;
  const h = createHarness([launcherTab], {
    now: () => now,
    submitGate: new Promise(resolve => { finishDelivery = resolve; }),
  });
  await h.request({ action: 'launch-prompt', prompt: 'Still sending', siteIds: ['chatgpt'] });
  now += 61 * 60 * 1000;
  try {
    const response = await h.request({ action: 'launcher-job' });
    assert.equal(response.job?.state, 'pending');
    assert.equal(response.job?.prompt, 'Still sending');
  } finally {
    finishDelivery();
  }
  await h.waitForLauncher();
});

test('multiple delivery leaves a matching tab alone when it is navigating elsewhere', async () => {
  const pending = {
    id: 7, windowId: 1, index: 1, url: 'https://chatgpt.com/c/current',
    pendingUrl: 'https://chatgpt.com/c/user-navigation', status: 'loading',
  };
  const h = createHarness([launcherTab, pending]);
  const response = await h.request({
    action: 'launch-prompt', siteIds: ['chatgpt'], prompt: 'Start fresh', multiple: true,
  });

  assert.equal(response.accepted, true);
  assert.equal((await h.waitForLauncher()).result.ok, true);
  assert.deepEqual(h.records.updated, []);
  assert.equal(h.records.created.length, 1);
  assert.equal(h.records.submitted[0].tabId, h.records.created[0].id);
});
