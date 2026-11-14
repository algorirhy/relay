const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function loadSiteCatalog() {
  const context = vm.createContext({ URL });
  context.globalThis = context;
  vm.runInContext(read('sites.js'), context, { filename: 'sites.js' });
  return context.RelaySites;
}

test('site catalog has the required six chatbots in display order', () => {
  const catalog = loadSiteCatalog();
  assert.deepEqual(
    Array.from(catalog.sites, (site) => site.name),
    ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'DeepSeek', 'Doubao'],
  );

});

test('site catalog recognizes supported URLs and rejects unsupported URLs', () => {
  const catalog = loadSiteCatalog();
  assert.equal(catalog.findSiteByUrl('https://chatgpt.com/c/123').id, 'chatgpt');
  assert.equal(catalog.findSiteByUrl('https://chat.deepseek.com/a/chat/123').id, 'deepseek');
  assert.equal(catalog.findSiteByUrl('https://www.doubao.com/chat/123').id, 'doubao');
  assert.equal(catalog.findSiteByUrl('https://example.com/'), null);
  assert.equal(
    catalog.sites.find((site) => site.id === 'deepseek').sendSelectors[0],
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle',
  );
  assert.equal(catalog.sites.find((site) => site.id === 'doubao').sendSelectors[0], '#flow-end-msg-send');
});

test('Gemini new-chat URL preserves the existing Google account path', () => {
  const catalog = loadSiteCatalog();
  assert.equal(
    catalog.getNewChatUrl('gemini', 'https://gemini.google.com/u/2/app/abc'),
    'https://gemini.google.com/u/2/app',
  );
  assert.equal(
    catalog.getNewChatUrl('gemini'),
    'https://gemini.google.com/app',
  );
});

test('manifest loads shared config before the content script', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, 'Relay');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.chrome_url_overrides, { newtab: 'newtab.html' });
  assert.deepEqual(manifest.permissions, ['tabs', 'notifications', 'storage']);
  assert.deepEqual(manifest.icons, {
    16: 'icons/relay-16.png',
    32: 'icons/relay-32.png',
    48: 'icons/relay-48.png',
    128: 'icons/relay-128.png',
  });
  assert.equal(manifest.action.default_popup, undefined);
  assert.deepEqual(manifest.action.default_icon, {
    16: manifest.icons[16],
    32: manifest.icons[32],
  });
  for (const iconPath of Object.values(manifest.icons)) {
    assert.equal(fs.existsSync(path.join(projectRoot, iconPath)), true, `${iconPath} is missing`);
  }
  assert.deepEqual(manifest.content_scripts[0], {
    matches: [
      'https://gemini.google.com/*',
      'https://www.doubao.com/*',
      'https://doubao.com/*',
    ],
    js: ['sites.js', 'attachments.js', 'page-main.js'],
    run_at: 'document_start',
    world: 'MAIN',
  });
  const catalog = loadSiteCatalog();
  assert.deepEqual(manifest.content_scripts[2].matches, Array.from(catalog.sites).flatMap((site) => [...site.tabPatterns]));
  for (const entry of manifest.content_scripts.slice(1)) {
    assert.deepEqual(entry.js, ['sites.js', 'attachments.js', 'content.js']);
  }
});

test('Google attachment handling recognizes AI Mode redirects but not organic search or lookalike hosts', () => {
  const catalog = loadSiteCatalog();
  for (const url of [
    catalog.google.aiModeUrl,
    'https://www.google.com/search?udm=50&aep=11&sei=abc',
    'https://www.google.com/webhp?hl=en&aep=11',
  ]) assert.equal(catalog.isGoogleAiPage(url), true);
  for (const url of [
    'https://www.google.com/search?q=udm%3D50',
    'https://www.google.com/search?udm=50fake',
    'https://www.google.com/',
    'https://google.com.evil.test/ai',
    'http://www.google.com/ai',
  ]) assert.equal(catalog.isGoogleAiPage(url), false);
});

test('new tab loads the shared catalog and local scripts with no embedded websites', () => {
  const html = read('newtab.html');
  assert.ok(html.indexOf('src="sites.js"') < html.indexOf('src="newtab.js"'));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  for (const resource of [...html.matchAll(/(?:src|href)="([^"]+)"/g)]) {
    assert.ok(fs.existsSync(path.join(projectRoot, resource[1])), resource[1]);
  }
});

test('the launcher uses an English interface and shared theme resources', () => {
  const html = read('newtab.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /href="theme\.css"/);
  assert.doesNotMatch(html, /<style>|[\u3400-\u9fff]/);
  assert.doesNotMatch(read('newtab.js'), /[\u3400-\u9fff]/);
});

test('release documentation matches the manifest version', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const latest = read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+) —/m);
  assert.equal(latest?.[1], manifest.version);
});

test('product branding stays consistent across customer-facing surfaces', () => {
  const customerCopy = [
    read('README.md'),
    read('README.zh-CN.md'),
    read('PRIVACY.md'),
    read('newtab.html'),
  ].join('\n');

  assert.doesNotMatch(customerCopy, /One Shortcut for AI Chat/);
  const tagline = 'Start with a thought.';
  assert.ok(read('newtab.html').includes(tagline));
  assert.ok(read('README.md').includes(tagline));
  assert.match(read('README.zh-CN.md'), /从一个想法开始。/);
});


test('launcher catalog includes Google alongside the six chat services', () => {
  const catalog=loadSiteCatalog();
  assert.equal(catalog.sites.length,6);
  assert.equal(catalog.getSite('google'),null);
  assert.deepEqual(Array.from(catalog.launcherServices,site=>site.id),['google',...Array.from(catalog.sites,site=>site.id)]);
  const query='  中文 & 日本語 + #  ';
  assert.equal(new URL(catalog.getLaunchUrl('google',query)).searchParams.get('q'),query);
  assert.equal(catalog.getLaunchUrl('google',' '),'https://www.google.com/');
});

test('every service packages a distinct local SVG without executable or remote content', () => {
  const catalog = loadSiteCatalog();
  const paths = Array.from(catalog.launcherServices, (service) => service.icon);
  assert.equal(new Set(paths).size, 7);
  for (const iconPath of paths) {
    assert.match(iconPath, /^icons\/services\/[a-z]+\.svg$/);
    const svg = read(iconPath);
    assert.match(svg, /<svg\b/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\bonload\s*=|(?:href|src)=["'](?:https?:|javascript:)/i);
  }
});
