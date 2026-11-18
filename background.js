// Background service worker.
// Coordinates keyboard shortcuts and prompt delivery across supported AI sites.

importScripts('sites.js', 'attachments.js');

const LOG_PREFIX = '[Relay]';
const siteLocks = new Map();
const launcherRecordQueue = new Map();
const activeLauncherJobs = new Map();
// Retain failed-job files across launcher navigation without writing bytes to storage.
const launcherAttachments = new Map();
let nextLauncherJobId = 1;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function notifyDeliveryError(error) {
  if (!chrome.notifications?.create) return;

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/relay-128.png',
      title: 'Delivery could not be confirmed',
      message: errorMessage(error),
      priority: 1,
    });
  } catch (notificationError) {
    console.error(`${LOG_PREFIX} Failed to show a notification:`, notificationError);
  }
}

function sortTabs(tabs, preferredWindowId) {
  return [...tabs].sort((left, right) => {
    const leftPreferred = left.windowId === preferredWindowId ? 0 : 1;
    const rightPreferred = right.windowId === preferredWindowId ? 0 : 1;

    return (
      leftPreferred - rightPreferred ||
      (left.windowId ?? 0) - (right.windowId ?? 0) ||
      (left.index ?? 0) - (right.index ?? 0) ||
      (left.id ?? 0) - (right.id ?? 0)
    );
  });
}

async function findFirstSiteTab(site, preferredWindowId) {
  const tabs = await chrome.tabs.query({ url: site.tabPatterns });
  return sortTabs(
    tabs.filter((tab) => Number.isInteger(tab.id) && tab.status === 'complete' && !tab.pendingUrl),
    preferredWindowId,
  )[0] || null;
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && !tab.pendingUrl) return tab;
    await delay(250);
  }

  throw new Error('Timed out while waiting for the page to load.');
}

async function waitForContentScript(tabId, siteId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (response?.ok && response.siteId === siteId) return;
    } catch (_error) {
      // The content script is not ready yet.
    }

    await delay(400);
  }

  throw new Error('The page loaded, but its automation script did not become ready.');
}

async function createBackgroundTab(url, preferredWindowId) {
  const createOptions = {
    url,
    active: false,
  };

  if (Number.isInteger(preferredWindowId)) {
    createOptions.windowId = preferredWindowId;
  }

  try {
    return await chrome.tabs.create(createOptions);
  } catch (error) {
    if (!('windowId' in createOptions)) throw error;
    delete createOptions.windowId;
    return chrome.tabs.create(createOptions);
  }
}

function isLauncherUrl(value) {
  try {
    const url = new URL(value);
    const launcher = new URL(chrome.runtime.getURL('newtab.html'));
    return url.protocol === launcher.protocol && url.host === launcher.host && url.pathname === launcher.pathname;
  } catch { return false; }
}

function isLauncherTab(tab) {
  // Chrome exposes a real overridden new tab as chrome://newtab/ in tabs,
  // while its authenticated message sender URL is the extension document.
  // Keep sender validation strict; only this tab-state check accepts the alias.
  const isLauncherAddress = (url) => isLauncherUrl(url) || url === 'chrome://newtab/' || url === 'chrome://newtab';
  return isLauncherAddress(tab.url) && (!tab.pendingUrl || isLauncherAddress(tab.pendingUrl));
}

async function prepareNewChat(site, job) {
  if (!job.multiple) {
    const current = await chrome.tabs.get(job.tabId);
    if (!isLauncherTab(current)) throw new Error('The launcher tab was changed before sending.');
  }
  let existing = job.multiple
    ? (site.id === 'google' ? null : await findFirstSiteTab(site, job.windowId))
    : { id: job.tabId };
  if (job.multiple && existing) {
    const current = await chrome.tabs.get(existing.id).catch(() => null);
    if (!current || current.url !== existing.url || current.status !== 'complete' || current.pendingUrl) existing = null;
  }
  const url = site.aiModeUrl || RelaySites.getNewChatUrl(site.id, existing?.url);
  const tab = await (existing ? chrome.tabs.update(existing.id, { url }) : createBackgroundTab(url, job.windowId));
  return { tabId: tab?.id, url };
}

function runSerially(queue, key, task) {
  const previous = queue.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  queue.set(key, current);

  return current.finally(() => {
    if (queue.get(key) === current) queue.delete(key);
  });
}

async function notifyResults(results) {
  const failures = results.filter((result) => !result.ok);
  if (!failures.length) return;
  if (!chrome.notifications?.create) return;

  const successCount = results.filter((result) => result.ok && result.method !== 'search').length;
  const aiTotal = results.filter((result) => result.method !== 'search').length;
  const failedNames = failures.map((result) => result.name).join(', ');
  const title = results.some((result) => result.method === 'search')
    ? 'Some requests did not finish'
    : 'Some messages were not confirmed';
  let message = successCount
    ? `Sent to ${successCount} of ${aiTotal}. Could not confirm: ${failedNames}.`
    : `Could not confirm: ${failedNames}.`;

  if (results.some((result) => result.ok && result.method === 'search')) message = `Google search opened. ${message}`;

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/relay-128.png',
      title,
      message,
      priority: 1,
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to show a notification:`, error);
  }
}

function deliverToChatService(site, job, attachments, navigation) {
  return runSerially(siteLocks, site.id, async () => {
    try {
      const { tabId, url } = await prepareNewChat(site, job);
      if (!Number.isInteger(tabId)) throw new Error('Chrome did not return a usable tab.');
      if (!job.multiple) navigation.url = url;
      const initialPage = await waitForTabComplete(tabId);
      if (!RelaySites.isFreshDestination(site.id, url, initialPage.url)) {
        throw new Error('The destination page changed before sending.');
      }
      if (!job.multiple) navigation.url = initialPage.url;
      await waitForContentScript(tabId, site.id);
      const loaded = await chrome.tabs.get(tabId);
      if (loaded.pendingUrl || loaded.url !== initialPage.url) {
        throw new Error('The destination page changed before sending.');
      }
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'submit-prompt',
        expectedUrl: loaded.url,
        prompt: job.prompt,
        attachments,
      });
      if (!response?.ok) {
        if (!job.multiple && response?.preserveDestination) delete navigation.url;
        throw new Error(response?.error || 'The site did not confirm submission.');
      }
      return { siteId: site.id, name: site.name, ok: true, method: response.method };
    } catch (error) {
      console.error(`${LOG_PREFIX} ${site.name}:`, error);
      return { siteId: site.id, name: site.name, ok: false, error: errorMessage(error) };
    }
  });
}

// One session-only recovery record per launcher tab; no permanent prompt log.
const launcherKey = (tabId) => `launcher:${tabId}`;

function launcherTab(sender) {
  if (!Number.isInteger(sender?.tab?.id) || !isLauncherUrl(sender.url || sender.tab.url)) {
    throw new Error('This action is only available from the new-tab launcher.');
  }
  return sender.tab;
}

async function readLauncherJob(tabId) {
  const key = launcherKey(tabId);
  const job = (await chrome.storage.session.get(key))[key];
  if (!job) {
    launcherAttachments.delete(tabId);
    return null;
  }
  if (activeLauncherJobs.get(tabId) === job.id) return job;
  if (Date.now() - (job.finishedAt ?? job.createdAt) > 60 * 60 * 1000) {
    await chrome.storage.session.remove(key);
    launcherAttachments.delete(tabId);
    return null;
  }
  if (job.state === 'pending') {
    // Only this worker's in-memory records can own a running delivery.
    return { ...job, state: 'interrupted', error: 'Delivery was interrupted. Check the service before retrying.' };
  }
  return job;
}

async function openGoogleSearch(job) {
  const result = { siteId: 'google', name: RelaySites.google.name, method: 'search' };
  try {
    const tab = await createBackgroundTab(RelaySites.getLaunchUrl('google', job.prompt), job.windowId);
    if (!Number.isInteger(tab?.id)) throw new Error('Chrome did not return a usable search tab.');
    return { ...result, ok: true };
  } catch (error) {
    return { ...result, ok: false, error: errorMessage(error) };
  }
}

async function runLauncherJob(job, attachments) {
  try {
    const navigation = {};
    const results = await Promise.all(RelaySites.launcherServices
      .filter((site) => job.siteIds.includes(site.id))
      .map((site) => {
        if (site.id !== 'google') return deliverToChatService(site, job, attachments, navigation);
        if (!attachments.length) return openGoogleSearch(job);
        return deliverToChatService({ ...site, name: 'Google AI Mode' }, job, attachments, navigation);
      }));
    const result = { ok: results.every((item) => item.ok), results };
    await runSerially(launcherRecordQueue, job.tabId, async () => {
      try {
        // Do not recreate a recovery record after the source tab has been closed.
        try { await chrome.tabs.get(job.tabId); } catch {
          await chrome.storage.session.remove(launcherKey(job.tabId));
          launcherAttachments.delete(job.tabId);
          return;
        }
        await chrome.storage.session.set({ [launcherKey(job.tabId)]: {
          ...job, state: 'complete', finishedAt: Date.now(), result,
          prompt: result.ok ? '' : job.prompt,
          files: result.ok ? [] : job.files,
        } });
        if (result.ok) launcherAttachments.delete(job.tabId);
        if (!job.multiple && !result.ok && navigation.url) {
          const tab = await chrome.tabs.get(job.tabId);
          // A login redirect or user navigation must not be overwritten.
          if (!tab.pendingUrl && tab.url === navigation.url) {
            await chrome.tabs.update(job.tabId, { url: chrome.runtime.getURL('newtab.html') });
          }
        }
      } finally {
        activeLauncherJobs.delete(job.tabId);
      }
    });
    void notifyResults(results);
  } catch (error) {
    console.error(`${LOG_PREFIX} Launcher delivery:`, error);
    if (activeLauncherJobs.get(job.tabId) === job.id) activeLauncherJobs.delete(job.tabId);
    void notifyDeliveryError(error);
  }
}

async function startLauncherJob(message, sender, sendResponse) {
  const tab = launcherTab(sender);
  const multiple = message.multiple === true;
  const ids = [...new Set(Array.isArray(message.siteIds) ? message.siteIds : [])];
  const attachments = RelayAttachments.validatePayload(message.attachments);
  if (!ids.length || (!multiple && ids.length !== 1) ||
      ids.some((id) => id === 'google' ? !multiple && !attachments.length : !RelaySites.getSite(id))) {
    throw new Error('Select valid destinations before sending.');
  }
  if (typeof message.prompt !== 'string' || (!message.prompt.trim() && !attachments.length)) {
    throw new Error('Enter a message or add a file before sending.');
  }
  if (ids.includes('google') && attachments.length && !message.prompt.trim()) {
    throw new Error('Enter a question to use the files in Google AI Mode.');
  }
  const job = {
    id: `launcher-${Date.now()}-${nextLauncherJobId++}`, tabId: tab.id, windowId: tab.windowId,
    createdAt: Date.now(), prompt: message.prompt, siteIds: ids, multiple, state: 'pending',
    files: attachments.map(RelayAttachments.metadata),
  };
  await runSerially(launcherRecordQueue, tab.id, async () => {
    if (activeLauncherJobs.has(tab.id)) throw new Error('This tab already has a delivery in progress.');
    // Save text and file metadata before navigation; bytes stay in memory only.
    try {
      await chrome.storage.session.set({ [launcherKey(tab.id)]: job });
    } catch (error) {
      throw new Error(`Could not keep a recovery draft. Nothing was sent. ${errorMessage(error)}`);
    }
    activeLauncherJobs.set(tab.id, job.id);
    launcherAttachments.set(tab.id, { jobId: job.id, files: attachments });
  });
  sendResponse({ accepted: true, jobId: job.id });
  void runLauncherJob(job, attachments);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['launch-prompt', 'launcher-job', 'clear-launcher-job'].includes(message?.action)) return false;
  void (async () => {
    if (message.action === 'launch-prompt') {
      await startLauncherJob(message, sender, sendResponse);
      return;
    }
    const tab = launcherTab(sender);
    const response = await runSerially(launcherRecordQueue, tab.id, async () => {
      const job = await readLauncherJob(tab.id);
      if (message.action === 'launcher-job') {
        const retained = launcherAttachments.get(tab.id);
        // Polls need only status. Transfer file bytes once when restoring the page.
        const attachments = message.restoreDraft && job && retained?.jobId === job.id ? retained.files : [];
        return { ok: true, job, attachments };
      }
      if (job && job.id === message.jobId && !activeLauncherJobs.has(tab.id)) {
        await chrome.storage.session.remove(launcherKey(tab.id));
        launcherAttachments.delete(tab.id);
      }
      return { ok: true };
    });
    sendResponse(response);
  })().catch((error) => sendResponse({ accepted: false, error: errorMessage(error) }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ windowId: tab.windowId, url: chrome.runtime.getURL('newtab.html') })
    .catch((error) => console.error(`${LOG_PREFIX} Could not open Relay:`, error));
});

chrome.tabs.onRemoved?.addListener((tabId) => {
  launcherAttachments.delete(tabId);
  runSerially(launcherRecordQueue, tabId, () => chrome.storage.session.remove(launcherKey(tabId)))
    .catch(console.error);
});

chrome.commands.onCommand.addListener(async (command, sourceTab) => {
  if (command !== 'new-chat' && command !== 'focus-relay') return;

  try {
    const tab = sourceTab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!Number.isInteger(tab?.id)) return;
    const message = { action: command };
    if (command === 'focus-relay') {
      if (!isLauncherTab(tab)) return;
      message.fromNewTab = !isLauncherUrl(tab.url);
    }
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    console.error(`${LOG_PREFIX} Could not run the ${command} shortcut:`, error);
  }
});
