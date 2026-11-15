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

Single mode uses the source tab. Multiple mode runs destinations independently under per-service locks and opens Google in a new background tab. The worker waits for the destination to load, checks that it stayed on the expected page, and then asks its content script to send. A restarted worker marks pending jobs as interrupted. After a single-mode failure, the worker restores the launcher while the tab still shows the page Relay opened and has no pending navigation.

Chrome can report `chrome://newtab/` in `tabs.get` even though the sender is the extension document. Accept that alias only for source-tab state; keep sender validation strict.

## State inventory

The launcher restores a session record, then enters editing or waits for that job. Submitting locks the draft while preparing files and waiting for an acknowledgement. An accepted job stays locked while Relay reads its status. The launcher retries two failed reads for the same job ID. If it still cannot read the status, it restores editing and asks the user to check the destination. Direct navigation leaves the launcher.

| Flow | States and owner | Invariant or follow-up |
| --- | --- | --- |
| Launcher lifecycle | `newtab.js`: restoring → editing → submitting → waiting → editing. Direct opens go from editing to navigating. | One phase controls input. Poll results must match the current job ID. |
| Destination selection | `newtab.js`: single selection or a set of multiple selections. The last single selection is stored separately. | Switching mode preserves both selections and derives whether Google needs a question. |
| Input events | `newtab.js`: normal input or IME composition. Drag hover and copy feedback are local UI states. | Composition suppresses shortcuts. Hover and copy feedback belong to the current page. |
| Attachments | `newtab.js`: selected file → reading → encoded payload. Recovery creates metadata-only entries until the user reselects or removes them. | Pending file reads lock edits. Missing files block submission. |
| Draft recovery | `background.js`: no record → pending → complete, or interrupted on read if the worker no longer owns the pending ID. Closing the source tab or expiry removes the record. | Register, read, finalize, and delete records serially per launcher tab. A live job does not expire. An interrupted record is never replayed. |
| Destination arbitration | `background.js`: waiting for the site lock → opening or reusing a tab → page load → adapter ready → sent or failed. Google web search only opens a tab. | Serial per service and concurrent across services. The readiness check binds delivery to the loaded URL. |
| Generic chat submit | `content.js`: locate editor → attach if needed → fill → wait for Send → observe confirmation. | An unchanged text-only draft can retry once. A file send cannot retry automatically. |
| Google AI Mode | `content.js`: locate editor → insert files → wait for previews → fill → submit once → confirm or fail. | Check the original URL before uploading and submitting. Attachment and confirmation signals still depend on the site UI. |
| Page bridge requests | `content.js` and `page-main.js`: install the page listener once, then wait for each request ID to resolve, reject, or time out. | Success and timeout both remove the isolated-world listener. |
| Gemini upload | `page-main.js`: find input → open upload menu if needed → use compatible or shared input → hand off to generic submit. | The DOM determines readiness. Keep this bounded wait local to Gemini. |
| Doubao upload and submit | `page-main.js`: track one pending upload → wait for ready, stable controls → send once → confirm or fail. | Upload readiness uses site signals and a timed fallback. A missing composer alone cannot confirm submission. Check real provider behavior before changing upload heuristics. |
| Provider shortcuts | `content.js` and `background.js`: dispatch the shortcut, then use a site control, keyboard event, or new-chat navigation. | These are bounded fallbacks. They do not retain separate task state. |

The catalog in `sites.js` and payload validation in `attachments.js` are stateless. A shared state-machine library would add coordination between unrelated flows. Model a separate transition explicitly when it owns persistent data or needs to reject a stale event.

## Adapter maintenance

The attachment limit uses 1,048,576 bytes per displayed MB for compatibility with existing drafts.

- Prefer updating exact hosts, new-chat URLs and ordered selectors in `sites.js`. Keep manifest matches aligned. Gemini preserves the account path when reusing a tab.
- File inputs can appear after opening upload controls. Reacquire the composer after uploading files. A retry is limited to unchanged text-only drafts, since a second click could send duplicate content or omit attachments. A detached editor or disabled Send button can be a rerender and does not confirm delivery.
- The Gemini/Doubao bridge handles uploads in the page's world without access to Chrome APIs. Doubao supports ProseMirror and older textareas, requires stable live controls, and clicks Send once. A replaced composer with unsent text does not by itself confirm delivery.
- Google AI Mode checks for attachment previews before submitting and looks for signs of delivery after one click. Changes to Google's UI and account rollout can make the adapter unavailable; do not fall back to text-only submission when files were selected.

## Validation and release

Run the following checks from the repository root, then reload the unpacked extension and refresh affected provider tabs.

```sh
node --test tests/*.test.js
for file in *.js tests/*.js; do node --check "$file" || exit 1; done
git diff --check
```

In a separate Chrome profile, exercise genuine overridden new tabs, single and multiple selection, ordinary Google search, a Google AI Mode request, file-only chat, multiple files, failure recovery, and clipboard/IME shortcuts. Block external traffic or resolve test hosts to a local HTTPS fixture: a new tab's first request can go out before interception. Mock tests verify integration and failure handling; check actual signed-in behavior separately.

For a release, update the version in `manifest.json` and add the matching numbered changelog entry. Check the READMEs, privacy disclosure, asset references, and final diff before committing.
