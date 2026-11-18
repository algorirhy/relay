// Shared site catalog used by the launcher, worker, and website adapters.

(() => {
  'use strict';

  const freezeList = (items) => Object.freeze([...items]);

  const sites = [
    {
      id: 'chatgpt',
      icon: 'icons/services/chatgpt.svg',
      name: 'ChatGPT',
      hosts: ['chatgpt.com'],
      newChatUrl: 'https://chatgpt.com/',
      newChatSelectors: [
        'a[data-testid="create-new-chat-button"]',
        'button[data-testid="create-new-chat-button"]',
        'a[href="/"][aria-label*="chat" i]',
      ],
      newChatTexts: ['New chat', 'New Chat', '新建聊天', '新しいチャット'],
      inputSelectors: [
        '#prompt-textarea',
        'textarea[data-testid="prompt-textarea"]',
        'div[data-testid="composer-text-input"][contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        'textarea[placeholder*="Message" i]',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="send" i]',
        'form button[type="submit"]',
      ],
      attachmentButtonSelectors: [
        'button[data-testid="composer-plus-btn"]',
        'button[aria-label*="attach" i]',
        'button[aria-label*="file" i]',
        'button[aria-label*="upload" i]',
        'button[aria-label*="添加" i]',
      ],
      attachmentButtonTexts: ['Attach files', 'Add photos & files', 'Upload from computer', '添加照片和文件'],
    },
    {
      id: 'claude',
      icon: 'icons/services/claude.svg',
      name: 'Claude',
      hosts: ['claude.ai'],
      newChatUrl: 'https://claude.ai/new',
      newChatSelectors: [
        'a[href="/new"]',
        'a[data-testid="new-chat"]',
        'button[aria-label*="New chat" i]',
        'a[aria-label*="New chat" i]',
      ],
      newChatTexts: ['New chat', 'Start new chat', '新しいチャット'],
      inputSelectors: [
        'div.ProseMirror[contenteditable="true"]',
        '[data-testid="chat-input"] [contenteditable="true"]',
        'div[contenteditable="true"][data-placeholder]',
        'textarea[placeholder]',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="send" i]',
        'form button[type="submit"]',
      ],
      attachmentButtonSelectors: [
        'button[data-testid*="file" i]',
        'button[aria-label*="attach" i]',
        'button[aria-label*="file" i]',
        'button[aria-label*="upload" i]',
        'button[aria-label*="添加" i]',
      ],
      attachmentButtonTexts: ['Attach files', 'Upload file', 'Add content', '添加文件'],
    },
    {
      id: 'gemini',
      icon: 'icons/services/gemini.svg',
      name: 'Gemini',
      hosts: ['gemini.google.com'],
      newChatUrl: 'https://gemini.google.com/app',
      preserveGoogleAccountPath: true,
      newChatSelectors: [
        'button[aria-label*="New chat" i]',
        'a[aria-label*="New chat" i]',
        'button[data-test-id="new-chat"]',
      ],
      newChatTexts: ['New chat', '新しいチャット'],
      inputSelectors: [
        'rich-textarea .ql-editor[contenteditable="true"]',
        'rich-textarea [contenteditable="true"]',
        '.input-area [contenteditable="true"]',
        'textarea[placeholder]',
      ],
      sendSelectors: [
        'button.send-button',
        'button[aria-label="Send message"]',
        'button[aria-label*="send" i]',
        'form button[type="submit"]',
      ],
    },
    {
      id: 'grok',
      icon: 'icons/services/grok.svg',
      name: 'Grok',
      hosts: ['grok.com'],
      newChatUrl: 'https://grok.com/',
      newChatSelectors: [
        'a[aria-label*="New chat" i]',
        'button[aria-label*="New chat" i]',
      ],
      newChatTexts: ['New chat'],
      inputSelectors: [
        'textarea[placeholder*="Ask" i]',
        'textarea[placeholder]',
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label*="submit" i]',
        'button[aria-label*="send" i]',
        'button[class*="send" i]',
        'form button[type="submit"]',
      ],
      attachmentButtonSelectors: [
        'button[aria-label*="attach" i]',
        'button[aria-label*="upload" i]',
        'button[data-testid*="upload" i]',
        'button[data-testid*="attach" i]',
      ],
      attachmentButtonTexts: ['Attach', 'Attach files', 'Upload file', '添加文件'],
    },
    {
      id: 'deepseek',
      icon: 'icons/services/deepseek.svg',
      name: 'DeepSeek',
      hosts: [
        'chat.deepseek.com',
        'www.deepseek.com',
      ],
      newChatUrl: 'https://chat.deepseek.com/',
      newChatSelectors: [
        '[data-testid="new-chat"]',
        '[class*="new-chat"]',
      ],
      newChatTexts: ['New chat', '新建对话', '新对话'],
      inputSelectors: [
        'textarea#chat-input',
        'textarea[placeholder*="Message" i]',
        'textarea[placeholder]',
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle',
        'button[data-testid="send-button"]',
        'button[aria-label*="send" i]',
        'div[role="button"][aria-label*="send" i]',
        'button[aria-label*="发送"]',
        'button[class*="send" i]',
        'div[role="button"][class*="send" i]',
        'form button[type="submit"]',
      ],
      attachmentButtonSelectors: [
        'button[aria-label*="upload" i]',
        'button[aria-label*="attach" i]',
        'div[role="button"][aria-label*="upload" i]',
        '[data-testid*="upload" i]',
      ],
      attachmentButtonTexts: ['Upload files', 'Upload file', '上传文件', '添加文件'],
    },
    {
      id: 'doubao',
      icon: 'icons/services/doubao.svg',
      name: 'Doubao',
      hosts: [
        'www.doubao.com',
        'doubao.com',
      ],
      newChatUrl: 'https://www.doubao.com/chat/',
      newChatSelectors: [
        '[data-testid="new-chat"]',
        'a[href="/chat/new"]',
        'a[href="/chat"]',
      ],
      newChatTexts: ['新对话', '新建对话'],
      inputSelectors: [
        '#input-engine-container [contenteditable="true"]',
        '[data-testid="chat_input_input"] [contenteditable="true"]',
        'textarea[data-testid*="chat_input"]',
        'textarea[placeholder]',
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        '#flow-end-msg-send',
        'button:has(svg.text-g-send-msg-btn-text)',
        'button:has(svg[class*="g-send-msg-btn"])',
        'button[data-testid="send-button"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="send" i]',
        'div[role="button"][aria-label*="发送"]',
        'button[class*="send" i]',
        'div[role="button"][class*="send" i]',
        'form button[type="submit"]',
      ],
    },
  ].map((site) => Object.freeze({
    ...site,
    hosts: freezeList(site.hosts),
    tabPatterns: Object.freeze(site.hosts.map((host) => `https://${host}/*`)),
    newChatSelectors: freezeList(site.newChatSelectors),
    newChatTexts: freezeList(site.newChatTexts),
    inputSelectors: freezeList(site.inputSelectors),
    sendSelectors: freezeList(site.sendSelectors),
    attachmentButtonSelectors: freezeList(site.attachmentButtonSelectors || []),
    attachmentButtonTexts: freezeList(site.attachmentButtonTexts || []),
  }));

  const frozenSites = Object.freeze(sites);
  const google = Object.freeze({
    id: 'google',
    name: 'Google',
    icon: 'icons/services/google.svg',
    newChatUrl: 'https://www.google.com/',
    aiModeUrl: 'https://www.google.com/ai',
    // Public entry point redirects to the AI Mode version of the Google homepage.
    inputSelectors: freezeList([
      'textarea[aria-label*="Ask" i]', 'textarea[placeholder*="Ask" i]',
      'textarea[aria-label*="質問"]', 'textarea[placeholder*="質問"]',
      '[contenteditable="true"][role="textbox"]', 'textarea[name="q"]',
    ]),
    sendSelectors: freezeList([
      'button[aria-label*="Send" i]', 'button[aria-label*="Submit" i]',
      'button[aria-label*="送信"]', 'button[aria-label*="发送"]',
    ]),
  });
  const launcherServices = Object.freeze([google, ...frozenSites]);

  function getLaunchUrl(serviceId, prompt = '') {
    if (serviceId !== 'google') return getNewChatUrl(serviceId);
    if (!prompt.trim()) return google.newChatUrl;
    const url = new URL('search', google.newChatUrl);
    url.searchParams.set('q', prompt);
    return url.href;
  }

  function getSite(siteId) {
    return frozenSites.find((site) => site.id === siteId) || null;
  }

  function findSiteByUrl(url) {
    try {
      const { protocol, hostname } = new URL(url);
      if (protocol !== 'https:') return null;
      return frozenSites.find((site) => site.hosts.includes(hostname)) || null;
    } catch (_error) {
      return null;
    }
  }

  function isGoogleAiPage(value) {
    try {
      const { protocol, hostname, pathname, searchParams } = new URL(value);
      return protocol === 'https:' && ['www.google.com', 'google.com'].includes(hostname) &&
        (/^\/(?:ai|aimode)\/?$/.test(pathname) ||
          (pathname === '/webhp' && searchParams.get('aep') === '11') ||
          (pathname === '/search' && searchParams.get('udm') === '50'));
    } catch {
      return false;
    }
  }

  function getNewChatUrl(siteId, currentUrl = '') {
    const site = getSite(siteId);
    if (!site) return null;

    if (site.preserveGoogleAccountPath) {
      try {
        const current = new URL(currentUrl);
        const accountPath = current.pathname.match(/^\/u\/\d+(?=\/|$)/)?.[0];
        if (accountPath) {
          return `https://gemini.google.com${accountPath}/app`;
        }
      } catch (_error) {
        // Use the default Gemini URL when the existing URL cannot be parsed.
      }
    }

    return site.newChatUrl;
  }

  function isFreshDestination(siteId, requestedUrl, actualUrl) {
    if (siteId === 'google') {
      return isGoogleAiPage(actualUrl) && !new URL(actualUrl).searchParams.getAll('q').some(Boolean);
    }

    const site = findSiteByUrl(actualUrl);
    if (site?.id !== siteId) return false;
    const requestedPath = new URL(requestedUrl).pathname.replace(/\/$/, '');
    const actualPath = new URL(actualUrl).pathname.replace(/\/$/, '');
    if (actualPath === requestedPath) return true;

    // A default Gemini launch can resolve to the user's default account.
    return Boolean(site.preserveGoogleAccountPath && requestedPath === '/app' &&
      /^\/u\/\d+\/app$/.test(actualPath));
  }

  globalThis.RelaySites = Object.freeze({
    sites: frozenSites,
    launcherServices,
    google,
    getLaunchUrl,
    getSite,
    findSiteByUrl,
    isGoogleAiPage,
    getNewChatUrl,
    isFreshDestination,
  });
})();
