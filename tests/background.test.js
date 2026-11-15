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
  submitGate = null,
  storageFails = false,
  failCreateFor = [],
  initialSession = {},
  afterSubmit = () => {},
  afterPing = () => {},
} = {}) {
  const tabs = initialTabs.map((tab) => ({ status: 'complete', ...tab }));
  const records = {
    created: [],
    updated: [],
    submitted: [],
    notifications: [],
  };
  let runtimeMessageListener;
  let actionClickListener;
  let nextTabId = 100;

  const session = JSON.parse(JSON.stringify(initialSession));
  const chrome = {
    storage: { session: {
      async get(key) { return { [key]: session[key] }; },
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
      onCommand: { addListener() {} },
    },
    notifications: {
      async create(options) {
        records.notifications.push(options);
        return 'notification-id';
      },
    },
    tabs: {
      async query(queryInfo) {
        if (!queryInfo.url) return [];
        const patterns = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url];
        return tabs.filter((tab) => patterns.some((pattern) => matchesPattern(tab.url, pattern)));
      },
      async update(tabId, updateInfo) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        Object.assign(tab, updateInfo, { status: 'complete' });
        records.updated.push({ tabId, ...updateInfo });
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
        return { ...tab };
      },
      async get(tabId) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error('Tab closed');
        return { ...tab };
      },
      async sendMessage(tabId, message) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
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
  return { records, request, waitForLauncher, session, runtimeMessageListener, actionClickListener };
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
