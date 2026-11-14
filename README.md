<p align="center">
  <img src="./icons/relay-256.png" width="72" height="72" alt="Relay logo" />
</p>

<h1 align="center">Relay</h1>
<p align="center">Start with a thought.</p>
<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#install">Install</a> ·
  <a href="./PRIVACY.md">Privacy</a> ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

Relay turns Chrome's new tab into a launcher for Google search, ChatGPT, Claude, Gemini, Grok, DeepSeek, and Doubao. Its English interface follows your system theme. Load it directly from the repository.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the project root containing `manifest.json`.
3. Optionally pin Relay to the toolbar for quick access.

After updating the files, click **Reload** on the extension, refresh any open provider pages, and open a new tab. If another extension replaces the new tab, disable it to use Relay.

## Use

Open a new tab or click Relay in the toolbar. Pick a service and press **Enter** when your draft is ready. Single mode uses the current tab for the search or fresh chat. An empty draft opens the selected service.

Turn on **Multiple services** to use any combination of the seven destinations. All seven are initially selected. The launcher stays open; Google gets a new background tab, and each chat service reuses a matching tab (preferring this window) or opens a new one. Each new launcher defaults to single mode and remembers the last single-service choice.

### Attachments

Click **Attach**, drop files onto the composer, or paste an image from the clipboard. Relay allows up to **5 files**, **10 MiB per file** and **20 MiB total**. Supported formats and availability depend on the selected provider. The six chat services also accept file-only drafts when their site supports it.

With files attached, Google uses [Google AI Mode](https://support.google.com/websearch/answer/16011537?co=GENIE.Platform%3DDesktop&hl=en) and requires a question. Without files, Google still uses ordinary web search. Sign in to the selected services before sending.

## Shortcuts

| Where | Shortcut | Action |
| --- | --- | --- |
| New tab | `Enter` / `Shift+Enter` | Submit / insert a newline. IME confirmation does not submit. |
| New tab | `Option+1–7` / `Alt+1–7` | Select a service; in multiple mode, toggle its selection. Order: Google, ChatGPT, Claude, Gemini, Grok, DeepSeek, Doubao. |
| New tab, outside editors | `/` | Focus the input. |
| Supported AI website | `Command+Shift+O` / `Ctrl+Shift+O` | Start a new chat. Customize at `chrome://extensions/shortcuts`. |
| Supported AI website | `Command+K` / `Ctrl+K` | Search conversations using the site's command; Gemini is mapped to this shortcut. |

Page shortcuts work after focus enters the page. Chrome may initially keep focus in the address bar.

## Delivery and recovery

Each destination runs independently. **Opened Google search** means a tab opened; **Sent to …** means the site showed evidence of submission. If Relay cannot confirm a send, check the destination before retrying. Most chat adapters retry once; Doubao and Google AI Mode click Send at most once.

A failed or interrupted task keeps a temporary draft. If a single delivery fails and the tab is still on the page Relay opened, it returns to the launcher. Restored drafts show files marked **(add again)**; reselect or remove them before retrying. A multiple-service draft that stays open keeps its selected files. **Copy prompt** copies only the text.

If a site's controls are unavailable, check your sign-in and account access, then try the site directly. For Google AI Mode, you can attach files using Google's own controls.

## Privacy

Relay uses temporary session storage for draft recovery and keeps attachment contents in memory. See [Privacy and permissions](./PRIVACY.md) for the stored fields, cleanup rules, and site access.

## Development

See the [development guide](./docs/DEVELOPMENT.md) for architecture, site adapters, tests, and release checks.

[MIT](./LICENSE) · [GitHub](https://github.com/algorirhy/one-ai-shortcut)
