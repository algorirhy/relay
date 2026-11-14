# Development guide

Relay is a Chrome Manifest V3 extension written in plain JavaScript, HTML, and CSS. Load the repository unpacked; no build or runtime dependencies are required.

| File | Responsibility |
| --- | --- |
| `manifest.json` | New-tab override, toolbar action, permissions, keyboard command, and script registration. |
| `newtab.html`, `newtab.js`, `styles.css`, `theme.css` | Composer, file picker, service selection, shortcuts, results, and draft recovery. |
| `sites.js` | Service order, supported hosts, new-chat URLs, and page selectors. Google uses a separate AI Mode route for requests with files. |
| `attachments.js` | Shared limits, metadata, payload validation, decoding, and file input matching. |
| `background.js` | Validates launcher requests, coordinates tabs and delivery, keeps session drafts, and reports failures. |
| `content.js` | Site shortcuts, editor and file input handling, and submission checks. |
| `page-main.js` | Page-context bridge for Gemini and Doubao uploads and Doubao submission. |
| `tests/` | Node regressions for manifest/catalog, composer, worker, and page adapters. |

## Delivery

An empty single-service draft opens the service directly. A text-only Google search in single mode also navigates directly. Delivery tasks go through the worker, which validates the requester and files, records the draft, then acknowledges. Attachments travel through Chrome's JSON messaging and stay in memory. Draft recovery stores the text and file metadata. See [Privacy](../PRIVACY.md).

Single mode navigates the source tab; multiple mode runs destinations independently under per-service locks. Multiple-mode Google always gets a new background tab. The worker waits for destination load and an adapter handshake before sending. It never replays a job on restart. For single-mode failure, it restores the launcher only while the tab still shows the page Relay opened and has no pending navigation.

Chrome can report `chrome://newtab/` in `tabs.get` even though the sender is the extension document. Accept that alias only for source-tab state; keep sender validation strict.

## Adapter maintenance

- Prefer updating exact hosts, new-chat URLs and ordered selectors in `sites.js`. Keep manifest matches aligned. Gemini preserves the account path when reusing a tab.
- File inputs may appear only after opening upload controls. Grok can replace its editor after upload; DeepSeek can take longer to enable Send.
- The Gemini/Doubao bridge handles uploads in the page's world without access to Chrome APIs. Doubao supports ProseMirror and older textareas, requires stable live controls, and clicks Send once. A replaced composer with unsent text does not by itself confirm delivery.
- Google AI Mode must show page-side evidence of each attachment before submission. Its adapter uses a file input or the composer paste path, then checks for evidence after one click. Changes to Google's UI and account rollout can make the adapter unavailable; do not fall back to text-only submission when files were selected.

## Validation and release

Run the following checks from the repository root, then reload the unpacked extension and refresh affected provider tabs.

```sh
node --test tests/*.test.js
for file in *.js tests/*.js; do node --check "$file" || exit 1; done
git diff --check
```

In a separate Chrome profile, exercise genuine overridden new tabs, single and multiple selection, ordinary Google search, a Google AI Mode request, file-only chat, multiple files, failure recovery, and clipboard/IME shortcuts. Block external traffic or resolve test hosts to a local HTTPS fixture: a new tab's first request can go out before interception. Mock tests verify integration and failure handling; check actual signed-in behavior separately.

For a release, update the version in `manifest.json` and add the matching numbered changelog entry. Check the READMEs, privacy disclosure, asset references, and final diff before committing.
