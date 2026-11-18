# Development guide

Relay is a Chrome Manifest V3 extension written in plain JavaScript, HTML, and CSS. Load the repository unpacked; no build or runtime dependencies are required.

| File | Responsibility |
| --- | --- |
| `manifest.json` | New-tab override, toolbar action, permissions, keyboard commands, and script registration. |
| `newtab.html`, `newtab.js`, `styles.css`, `theme.css` | Composer, file picker, service selection, shortcuts, results, and draft recovery. |
| `sites.js` | Service order, supported hosts, new-chat URLs, and page selectors. Google uses a separate AI Mode route for requests with files. |
| `attachments.js` | Shared limits, metadata, payload validation, decoding, and file input matching. |
| `drafts.js` | Protects existing website drafts and tracks text inserted by the current job. |
| `background.js` | Validates launcher requests, coordinates tabs and delivery, keeps session drafts, and reports failures. |
| `content.js` | Site shortcuts, editor and file input handling, and submission checks. |
| `page-main.js` | Page-context bridge for Gemini and Doubao uploads and Doubao submission. |
| `tests/` | Node regressions for manifest/catalog, composer, worker, and page adapters. |

## State inventory

The launcher, worker, and provider adapters own their respective transitions. Draft mode, file availability and composition are independent of the launcher phase. Keep state local to the code that can validate its next transition.

| Flow | Owner and transitions | Guard or remaining dependency |
| --- | --- | --- |
| Launcher | `newtab.js`: restoring → editing → submitting → waiting → editing. Empty single drafts and single Google searches go directly from editing to navigating. | One phase locks the composer. Each poll checks the current job ID. Two retries cover failed status reads. A lost acknowledgement leaves delivery uncertain. |
| Destinations | `newtab.js`: single selection ↔ multiple selection. Both selections survive mode changes. | Store only the last single preference. In multiple mode, a nonempty selection and draft are required. |
| Launcher focus | `newtab.js` focuses the prompt when Chrome returns focus to the page or a service is selected. The focus command can replace the empty new-tab page in the same tab. | Preserve a focused control on page entry and keep existing drafts in place. |
| Keyboard and dragging | `newtab.js`: IME composition starts and ends independently. File drag feedback is active until leaving the composer or dropping files. | Suppress submit and service shortcuts during composition. Accept file changes while editing. |
| Files | `newtab.js`: selected → validated → reading → encoded payload. Restore files from the running worker's memory after launcher navigation. | A restarted worker has only metadata, so missing files block submission until reselected or removed. The composer stays locked during file reads. |
| Results and copy | `newtab.js`: pending, confirmed, failed or interrupted; an explicit copy can succeed or fail. | All-success consumes the draft. Partial results keep it for review. Clipboard feedback applies to the draft that initiated the copy. |
| Recovery record | `background.js`: absent → pending → complete. A pending record with no owning worker job reads as interrupted. | Serialize registration, reads, completion and removal per tab. Save text and file metadata before acknowledging. Keep attachment bytes in worker memory and return them only for page restoration. Release them on success, discard, tab close or inactive-record expiry. Recovery never replays a job. See [Privacy](../PRIVACY.md). |
| Destination routing | `background.js`: wait for service lock → open or reuse a tab → verify the fresh page → wait for the adapter → dispatch → record result. | One delivery at a time per service. Dispatch only on the verified URL. A failed single delivery can restore the launcher while the destination URL is unchanged, with no pending navigation or site draft to preserve. |
| Google web search | `newtab.js` navigates the current tab in single mode. `background.js` opens a background tab in multiple mode. | Success measures tab creation, so the result is reported as opened search. |
| Generic chat | `content.js`: wait for live editor → upload if needed → fill → wait for Send → look for confirmation. | Recheck the URL across asynchronous uploads and before filling or sending. File sends wait up to two minutes for visible upload progress to finish and Send to remain enabled for 750 ms, then up to two minutes for submission evidence. An unchanged text-only draft can retry once. File sends click once and depend on the site's upload controls. |
| Google AI Mode | `content.js`: locate editor → upload or paste files → observe all previews → fill → click Send → confirm or fail. | One submission. A route outside AI Mode ends confirmation. Availability and preview detection depend on account access and Google's UI. |
| Page bridge | `content.js` and `page-main.js`: install one page listener, send a request, resolve, reject or time out. | Pair responses by origin, action and request ID. Remove the isolated-world listener after closing the request. The bridge checks the URL before page mutations. |
| Gemini upload | `page-main.js`: find input → open upload menu if needed → use a compatible input or the shared multi-file input. | Gemini validates the files in its own uploader. The generic adapter handles submission. |
| Doubao delivery | `page-main.js`: upload if needed → fill the live composer → wait for stable controls and attachment evidence → click once → confirm or fail. | One request owns files and draft. Time alone cannot establish upload readiness. A missing composer cannot confirm submission. |
| Provider shortcuts | `content.js` and `background.js`: dispatch a command, then try a site control, keyboard event or navigation. | Each invocation ends at its first matching action. The browser and provider own subsequent navigation. |

Chrome can expose a genuine overridden new tab as `chrome://newtab/` in `tabs.get`. The worker accepts that alias for the source tab and authenticates the sender against the extension document URL. The service catalog and attachment validators are stateless.

Page adapters check for existing text before uploading or filling a draft. They clear inserted text only while the original editor remains on the same URL, still contains that text, and has received no further edit events.

## Adapter maintenance

- Update exact hosts, new-chat URLs and ordered selectors in `sites.js` alongside manifest matches. Gemini preserves the account path when reusing a tab.
- Reacquire the composer after uploads and verify the original URL before modifying the draft. A removed editor or disabled Send button can be a rerender. Provider DOM signals are evidence of submission, with no server acknowledgement.
- Keep Gemini upload and Doubao delivery in the page's world for framework handlers. Test Doubao's rich-text and legacy editors and verify attachment previews on both.
- Keep attachment limits consistent with existing drafts. Each displayed MB is 1,048,576 bytes.

## Validation and release

Run the following checks from the repository root, then reload the unpacked extension and refresh affected provider tabs.

```sh
node --test tests/*.test.js
for file in *.js tests/*.js; do node --check "$file" || exit 1; done
git diff --check
```

In a separate Chrome profile, exercise genuine overridden new tabs, single and multiple selection, ordinary Google search, a Google AI Mode request, file-only chat, multiple files, failure recovery, and clipboard/IME shortcuts. Block external traffic or resolve test hosts to a local HTTPS fixture: a new tab's first request can go out before interception. Mock tests verify integration and failure handling; check actual signed-in behavior separately.

For a release, move the unreleased notes under a dated version heading and match that version in `manifest.json`. Check the READMEs, privacy disclosure, asset references and final diff before tagging the verified commit.
