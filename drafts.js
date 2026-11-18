// Protect existing site drafts and clean up text inserted by the current job.
(() => {
  'use strict';

  function requireAvailable(editor, prompt, readText) {
    const current = readText(editor).trim();
    if (current && current !== prompt.trim()) {
      const error = new Error('The destination already contains another draft. Check it before retrying.');
      error.preserveDestination = true;
      throw error;
    }
  }

  function trackInserted(editor, readText, clearText) {
    const url = window.location.href;
    const inserted = readText(editor);
    const events = ['beforeinput', 'input', 'compositionstart'];
    let edited = false;
    const markEdited = () => { edited = true; };
    for (const event of events) editor.addEventListener(event, markEdited);

    return () => {
      for (const event of events) editor.removeEventListener(event, markEdited);
      if (!editor.isConnected || window.location.href !== url) return false;
      const current = readText(editor);
      if (edited || current !== inserted || (document.hasFocus() && document.activeElement !== editor)) {
        return Boolean(current.trim());
      }
      try {
        clearText(editor);
      } catch (error) {
        console.warn('[Relay] Could not clear the prompt from the destination:', error);
      }
      return Boolean(readText(editor).trim());
    };
  }

  async function withCleanup(cleanup, send) {
    let failure;
    try {
      return await send();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      throw failure;
    } finally {
      if (cleanup?.() && failure) failure.preserveDestination = true;
    }
  }

  globalThis.RelayDrafts = Object.freeze({ requireAvailable, trackInserted, withCleanup });
})();
