(() => {
  'use strict';

  const services = RelaySites.launcherServices;
  const input = document.getElementById('prompt');
  const form = document.getElementById('launcher-form');
  const submitButton = document.getElementById('submit-button');
  const submitLabel = document.getElementById('submit-label');
  const hint = document.getElementById('service-hint');
  const status = document.getElementById('status');
  const grid = document.querySelector('.service-grid');
  const modeSwitch = document.getElementById('multiple-mode');
  const copyButton = document.getElementById('copy-prompt');
  const composer = document.getElementById('composer');
  const attachButton = document.getElementById('attachment-button');
  const fileInput = document.getElementById('attachment-input');
  const fileList = document.getElementById('attachment-list');
  const focusShortcut = document.getElementById('focus-shortcut');
  document.getElementById('attachment-limit').textContent = RelayAttachments.limitLabel;
  const buttons = [];
  // A worker restart can leave metadata for files that need to be selected again.
  let attachments = [];
  let selected = services[0];
  // The launcher phase controls input. Draft mode and IME composition are independent.
  let phase = 'restoring';
  let composing = false;
  let multiple = false;
  let currentJobId = null;
  const selectedServiceIds = new Set(services.map((site) => site.id));

  function destinations() {
    return multiple ? [...selectedServiceIds] : [selected.id];
  }

  function editDraft() {
    if (phase !== 'editing') return;
    discardRecovery();
    status.textContent = '';
    updateControls();
  }

  function renderFiles() {
    fileList.hidden = !attachments.length;
    fileList.replaceChildren(...attachments.map((entry) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = entry.file ? entry.name : `${entry.name} (add again)`;
      name.title = name.textContent;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${entry.name}`);
      remove.addEventListener('click', () => {
        attachments = attachments.filter((attachment) => attachment !== entry);
        renderFiles();
        editDraft();
        attachButton.focus();
      });
      item.append(name, remove);
      return item;
    }));
  }

  function addFiles(files) {
    if (phase !== 'editing' || !files?.length) return;
    const next = [...attachments];
    for (const file of files) {
      const metadata = RelayAttachments.metadata(file);
      const index = next.findIndex((entry) => (
        entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified
      ));
      if (index === -1) next.push({ ...metadata, file });
      else if (!next[index].file) next[index] = { ...metadata, file };
    }
    try {
      RelayAttachments.validateSizes(next);
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = 'error';
      return;
    }
    attachments = next;
    renderFiles();
    editDraft();
  }

  function readAttachment({ file, ...metadata }) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ ...metadata, dataUrl: reader.result });
      reader.onerror = reader.onabort = () => reject(new Error(`Could not read ${file.name}. Add the file again.`));
      reader.readAsDataURL(file);
    });
  }

  function draftState() {
    const hasText = Boolean(input.value.trim());
    const hasFiles = attachments.length > 0;
    const missingFiles = attachments.some((entry) => !entry.file);
    const hasContent = hasText || hasFiles;
    const googleSelected = destinations().includes('google');
    const needsGoogleQuestion = googleSelected && hasFiles && !hasText;
    const canSubmit = !missingFiles && !needsGoogleQuestion && (!multiple || (hasContent && selectedServiceIds.size > 0));
    return { hasText, hasFiles, missingFiles, hasContent, googleSelected, needsGoogleQuestion, canSubmit };
  }

  function updateControls() {
    const { hasText, hasFiles, missingFiles, hasContent, googleSelected, needsGoogleQuestion, canSubmit } = draftState();
    const locked = phase !== 'editing';
    const action = multiple
      ? `Send to ${selectedServiceIds.size} service${selectedServiceIds.size === 1 ? '' : 's'}`
      : !hasContent ? 'Open' : googleSelected && !hasFiles ? 'Search' : 'Send';
    if (phase === 'submitting' || phase === 'waiting') submitLabel.textContent = 'Sending…';
    else if (phase === 'navigating') submitLabel.textContent = 'Opening…';
    else submitLabel.textContent = action;
    submitButton.setAttribute('aria-label', multiple ? action : `${action} ${googleSelected && hasFiles ? 'Google AI Mode' : selected.name}`);
    if (missingFiles) {
      hint.textContent = 'Add the listed files again or remove them before submitting.';
    } else if (needsGoogleQuestion) {
      hint.textContent = 'Enter a question to use the files in Google AI Mode.';
    } else if (hasFiles && googleSelected) {
      hint.textContent = 'Google uses AI Mode when you attach files.';
    } else if (multiple) {
      const aiCount = selectedServiceIds.size - (googleSelected ? 1 : 0);
      if (!selectedServiceIds.size) {
        hint.textContent = 'Select at least one service.';
      } else if (!hasContent) {
        hint.textContent = 'Enter text or attach files to continue.';
      } else if (googleSelected) {
        hint.textContent = aiCount
          ? 'Opens Google results and sends your message to the selected chat services.'
          : 'Opens Google results in a new tab.';
      } else {
        hint.textContent = hasFiles ? 'Sends your files in fresh chats.' : 'Sends your message in fresh chats.';
      }
    } else if (selected.id === 'google') {
      hint.textContent = hasText
        ? 'Opens Google results in this tab.'
        : 'Type to search, or open Google.';
    } else {
      if (hasFiles) hint.textContent = 'Opens a fresh chat in this tab and sends your files.';
      else if (hasText) hint.textContent = 'Opens a fresh chat in this tab and sends your message.';
      else hint.textContent = 'Type to start a chat, or open the site.';
    }
    submitButton.disabled = locked || !canSubmit;
    input.disabled = locked;
    modeSwitch.disabled = locked;
    modeSwitch.checked = multiple;
    grid.setAttribute('data-multiple', String(multiple));
    grid.setAttribute('aria-label', multiple ? 'Choose services' : 'Choose a service');
    input.placeholder = multiple ? 'Search or ask the selected services…'
      : googleSelected ? (hasFiles ? 'Ask Google AI Mode…' : 'Search Google…') : `Ask ${selected.name}…`;
    for (const button of buttons) {
      const id = button.dataset.service;
      button.disabled = locked;
      button.setAttribute('aria-pressed', String(multiple ? selectedServiceIds.has(id) : selected.id === id));
    }
    attachButton.disabled = locked;
    for (const item of fileList.children) item.lastChild.disabled = locked;
  }

  function discardRecovery() {
    if (currentJobId) {
      void chrome.runtime.sendMessage({ action: 'clear-launcher-job', jobId: currentJobId }).catch(() => {});
      currentJobId = null;
    }
    hideCopyButton();
  }

  function hideCopyButton() {
    copyButton.hidden = true;
    copyButton.textContent = 'Copy prompt';
  }

  function selectService(id) {
    if (phase !== 'editing') return;
    const service = services.find((candidate) => candidate.id === id);
    if (!service) return;
    if (multiple) {
      if (selectedServiceIds.has(id)) selectedServiceIds.delete(id);
      else selectedServiceIds.add(id);
    } else {
      selected = service;
      try { localStorage.setItem('launcher:selected', id); } catch { /* Preference storage is optional. */ }
    }
    editDraft();
    input.focus();
  }

  function fail(message) {
    phase = 'editing';
    status.textContent = message;
    status.dataset.state = 'error';
    copyButton.hidden = !input.value.trim();
    updateControls();
  }

  function showJob(job, restoreDraft = false, restoredAttachments = []) {
    currentJobId = job.id;
    if (restoreDraft) {
      input.value = job.prompt || '';
      attachments = (job.files || []).map((metadata, index) => {
        const payload = restoredAttachments[index];
        return payload ? { ...metadata, file: RelayAttachments.decode(payload) } : metadata;
      });
      renderFiles();
      multiple = job.multiple;
      if (multiple) {
        selectedServiceIds.clear();
        for (const id of job.siteIds) selectedServiceIds.add(id);
      } else selected = services.find((service) => service.id === job.siteIds[0]) || selected;
    }
    phase = job.state === 'pending' ? 'waiting' : 'editing';
    if (phase === 'waiting') {
      status.textContent = 'Opening fresh chats and sending…';
      status.dataset.state = 'pending';
    } else if (job.state === 'interrupted') {
      fail(job.error);
    } else {
      const result = job.result;
      const parts = [];
      const searchOpened = result.results.some((item) => item.ok && item.method === 'search');
      const sent = result.results.filter((item) => item.ok && item.method !== 'search').map((item) => item.name);
      const failed = result.results.filter((item) => !item.ok);
      if (searchOpened) parts.push('Opened Google search.');
      if (sent.length) parts.push(`Sent to ${sent.join(', ')}.`);
      if (failed.length) parts.push(`Could not confirm delivery: ${failed.map((item) => `${item.name} (${item.error})`).join('; ')}. Check for a reply before retrying.`);
      status.textContent = parts.join('\n');
      status.dataset.state = result.ok ? 'success' : 'error';
      copyButton.hidden = result.ok || !input.value.trim();
      if (result.ok) {
        input.value = '';
        attachments = [];
        renderFiles();
        discardRecovery();
      }
    }
    updateControls();
    if (phase === 'waiting') window.setTimeout(() => { void pollJob(job.id); }, 800);
  }

  async function pollJob(jobId, failedReads = 0) {
    const isCurrent = () => phase === 'waiting' && currentJobId === jobId;
    if (!isCurrent()) return;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'launcher-job' });
      if (!isCurrent()) return;
      if (!response?.ok || response.job?.id !== jobId) throw new Error('Delivery status is unavailable.');
      showJob(response.job);
    } catch {
      if (!isCurrent()) return;
      // Retry status reads, never the accepted delivery itself.
      if (failedReads < 2) {
        status.textContent = 'Checking delivery status…';
        window.setTimeout(() => { void pollJob(jobId, failedReads + 1); }, 800);
      } else {
        fail('Delivery status is unavailable. Check the service before retrying.');
      }
    }
  }

  async function submit() {
    if (phase !== 'editing' || composing || !draftState().canSubmit) return;
    const text = input.value;
    const hasFiles = attachments.length > 0;
    const directLaunch = !hasFiles && !multiple && (!text.trim() || selected.id === 'google');
    hideCopyButton();
    phase = directLaunch ? 'navigating' : 'submitting';
    status.textContent = '';
    status.dataset.state = 'pending';
    updateControls();
    try {
      if (directLaunch) {
        window.location.assign(RelaySites.getLaunchUrl(selected.id, text));
        discardRecovery();
        return;
      }
      if (hasFiles) status.textContent = 'Reading files…';
      const files = hasFiles ? await Promise.all(attachments.map(readAttachment)) : [];
      const response = await chrome.runtime.sendMessage({
        action: 'launch-prompt', prompt: text, multiple,
        siteIds: destinations(),
        ...(files.length ? { attachments: files } : {}),
      }).catch(() => null);
      if (!response || (response.accepted && !response.jobId)) {
        throw new Error('Could not confirm whether delivery started. Check the destination before retrying.');
      }
      if (!response.accepted) throw new Error(response.error || 'The delivery task was not accepted.');
      currentJobId = response.jobId;
      phase = 'waiting';
      status.textContent = 'Opening fresh chats and sending…';
      void pollJob(currentJobId);
    } catch (error) {
      fail(error.message || String(error));
    }
  }

  for (const [index, service] of services.entries()) {
    const button = document.createElement('button');
    button.className = 'service service-option';
    button.type = 'button';
    button.dataset.service = service.id;
    button.title = `Option+${index + 1}`;
    button.setAttribute('aria-keyshortcuts', `Alt+${index + 1}`);
    button.setAttribute('aria-pressed', 'false');
    const icon = document.createElement('img');
    icon.className = 'service-icon';
    icon.src = service.icon;
    icon.alt = '';
    icon.width = 28;
    icon.height = 28;
    icon.draggable = false;
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'service-name';
    name.textContent = service.name;
    const indicator = document.createElement('span');
    indicator.className = 'service-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    button.append(icon, name, indicator);
    button.addEventListener('click', () => selectService(service.id));
    buttons.push(button);
    grid.append(button);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  input.addEventListener('input', () => {
    copyButton.textContent = 'Copy prompt';
    editDraft();
  });
  attachButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  composer.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = phase === 'editing' ? 'copy' : 'none';
    if (phase === 'editing') composer.classList.add('dragover');
  });
  composer.addEventListener('dragleave', (event) => {
    if (!composer.contains(event.relatedTarget)) composer.classList.remove('dragover');
  });
  composer.addEventListener('drop', (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    composer.classList.remove('dragover');
    addFiles(event.dataTransfer.files);
  });
  input.addEventListener('paste', (event) => {
    if (!event.clipboardData.files.length) return;
    // Let mixed clipboard content insert its text as usual.
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    addFiles(event.clipboardData.files);
  });
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    form.requestSubmit();
  });
  document.addEventListener('keydown', (event) => {
    if (phase !== 'editing' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.isComposing || composing || event.keyCode === 229) return;
    // On macOS Option changes event.key (e.g. Option+1 becomes ¡). Physical
    // Digit codes keep the shortcut consistent and prevent symbol insertion.
    if (event.altKey && !event.shiftKey && /^Digit[1-7]$/.test(event.code)) {
      event.preventDefault();
      selectService(services[Number(event.code.slice(-1)) - 1].id);
      return;
    }
    if (event.altKey || event.target.closest('textarea, input, select, [contenteditable]')) return;
    if (event.key === '/') {
      event.preventDefault();
      input.focus();
    }
  });

  modeSwitch.addEventListener('change', () => {
    if (phase !== 'editing') return;
    multiple = modeSwitch.checked;
    editDraft();
  });
  copyButton.addEventListener('click', async () => {
    const text = input.value;
    const stillCurrent = () => phase === 'editing' && !copyButton.hidden && input.value === text;
    try {
      await navigator.clipboard.writeText(text);
      if (stillCurrent()) copyButton.textContent = 'Copied';
    } catch {
      if (!stillCurrent()) return;
      status.textContent = 'Could not copy. Your text is selected for manual copying.';
      input.focus();
      input.select();
    }
  });

  function focusPromptOnPageEntry() {
    if (phase === 'editing' && document.hasFocus() && document.activeElement === document.body) {
      input.focus({ preventScroll: true });
    }
  }

  window.addEventListener('focus', focusPromptOnPageEntry);

  let savedSelection;
  try { savedSelection = localStorage.getItem('launcher:selected'); } catch { /* Storage may be unavailable. */ }
  selected = services.find((service) => service.id === savedSelection) || services[0];
  updateControls();
  const restored = (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'launcher-job', restoreDraft: true });
      if (!response?.ok) throw new Error(response?.error || 'Reload the extension to enable automatic sending.');
      if (response.job) showJob(response.job, true, response.attachments);
    } catch (error) {
      status.textContent = error.message || String(error);
    } finally {
      if (phase === 'restoring') phase = 'editing';
      updateControls();
      focusPromptOnPageEntry();
    }
  })();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== 'focus-relay') return false;
    void restored.then(() => {
      sendResponse();
      if (phase !== 'editing' || document.hidden) return;
      if (document.hasFocus()) {
        input.focus({ preventScroll: true });
      } else if (message.fromNewTab && !input.value && !attachments.length && !multiple &&
        selectedServiceIds.size === services.length && !currentJobId && !status.textContent) {
        // Chrome focuses the contents when a replacement NTP navigates away from
        // its override URL. Replace this empty page with the same Relay UI.
        phase = 'navigating';
        window.location.replace(chrome.runtime.getURL('newtab.html?focus=prompt'));
      }
    });
    return true;
  });

  void chrome.commands.getAll().then((commands) => {
    const shortcut = commands.find((command) => command.name === 'focus-relay')?.shortcut;
    if (!shortcut) return;
    focusShortcut.querySelector('kbd').textContent = shortcut;
    focusShortcut.hidden = false;
  }).catch(() => {});
})();
