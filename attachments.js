// Shared limits and wire format for files sent through Chrome's JSON messaging.
(() => {
  'use strict';

  const MiB = 1024 * 1024;
  const limits = Object.freeze({ count: 5, file: 10 * MiB, total: 20 * MiB });
  const limitLabel = `${limits.count} files · ${limits.file / MiB} MiB each · ${limits.total / MiB} MiB total`;
  const dataUrlPattern = /^data:([^,]*);base64,([A-Za-z0-9+/]*={0,2})$/;

  function validateSizes(files) {
    if (files.length > limits.count) throw new Error(`You can attach up to ${limits.count} files.`);
    let total = 0;
    for (const { name, size } of files) {
      if (!Number.isInteger(size) || size < 0 || size > limits.file) {
        throw new Error(`${name} exceeds the ${limits.file / MiB} MiB limit per file.`);
      }
      total += size;
    }
    if (total > limits.total) throw new Error(`Attachments can total up to ${limits.total / MiB} MiB.`);
  }

  function metadata({ name, type, size, lastModified }) {
    return { name, type, size, lastModified };
  }

  function validatePayload(files = []) {
    if (!Array.isArray(files) || files.some((file) => !file || typeof file !== 'object')) {
      throw new Error('Invalid attachment list.');
    }
    validateSizes(files);
    return files.map((file) => {
      const { name, type, size, lastModified } = metadata(file);
      const dataUrl = file.dataUrl;
      const match = typeof dataUrl === 'string' && dataUrl.match(dataUrlPattern);
      const encoded = match?.[2];
      const padding = encoded?.endsWith('==') ? 2 : encoded?.endsWith('=') ? 1 : 0;
      if (!name || typeof name !== 'string' || typeof type !== 'string' ||
          !Number.isFinite(lastModified) || !match || encoded.length % 4 !== 0 ||
          encoded.length / 4 * 3 - padding !== size) {
        throw new Error('An attachment could not be read. Remove it and add it again.');
      }
      return { name, type, size, lastModified, dataUrl };
    });
  }

  function decode({ name, type, lastModified, dataUrl }) {
    const match = dataUrl.match(dataUrlPattern);
    if (!match) throw new Error('An attachment could not be decoded.');
    const binary = atob(match[2]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new File([bytes], name.replace(/[\\/\0]/g, '_'), { type: type || match[1], lastModified });
  }

  function inputAcceptsFile(input, file) {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    const rules = input.accept.toLowerCase().split(',').map((rule) => rule.trim()).filter(Boolean);
    return !rules.length || rules.some((rule) => (
      rule === '*/*' || rule === type ||
      (rule.endsWith('/*') && type.startsWith(rule.slice(0, -1))) ||
      (!rule.includes('/') && name.endsWith(rule.startsWith('.') ? rule : `.${rule}`))
    ));
  }

  globalThis.RelayAttachments = Object.freeze({ limitLabel, validateSizes, metadata, validatePayload, decode, inputAcceptsFile });
})();
