# Changelog

## Unreleased

- Focus the prompt when Chrome returns keyboard focus to the launcher and no control is selected.
- Add shortcuts to open Relay with its input focused or to focus the input in a fresh Relay new tab. Show the assigned focus shortcut in the launcher.
- Focus the input after choosing services with Alt / Option + 1–7.
- Fix a submission-check crash while waiting for Google AI Mode or text-only chat Send controls to become enabled.
- Wait for upload progress and stable Send controls, and allow up to two minutes for attachment submission confirmation.
- Restore failed-task attachments from background memory so a recovered single-service draft can be edited and resent without selecting the files again. Release retained files with the recovery record.
- Preserve paragraph and hard line breaks when verifying Grok and other ProseMirror drafts, so multiline prompts are not rejected because of rendered paragraph spacing.
- Tie uploads, prompt entry, and submission to the destination page selected for the job. Leave tabs with active navigation alone when choosing a tab to reuse.
- Handle Doubao uploads and submission in one request. Wait for attachment previews and stable controls, then click Send once. Keep the draft available if delivery cannot be confirmed.
- Distinguish a lost acknowledgement from a rejected request. Clear the composer after all destinations succeed so a second Enter cannot repeat the delivery.
- Document the launcher, recovery, and provider state transitions in the [development guide](docs/DEVELOPMENT.md).

## 2.0.0 — 2026-11-14

- Relay replaces the legacy popup with a Chrome new-tab launcher for Google and six AI chat services. Choose one service or send to several at once.
- Attach files with the picker, drag and drop, or paste an image. Google opens ordinary search when there are no files and uses AI Mode for questions with files.
- Review delivery results per service. Confirm sends using page signals and avoid repeating requests with files. Failed or interrupted jobs preserve the prompt and file names so you can reopen the draft and reselect the files.
- Add a system theme and keyboard shortcuts for destination selection. Update the setup, privacy, and development guides and add a screenshot of the default launcher.

## 1.x

- Added shared chat shortcuts, multi-service sending, and support for images and files in the toolbar popup.
- Improved delivery confirmation, failure notifications, and compatibility with Gemini, DeepSeek, and Doubao.
