# Filey Browser

The Windows desktop app can open websites in a collapsible browser panel beside the workspace. Filey's main interface manages their address, back/forward history, reload, stop, focus and close controls. Up to eight tabs can be open; collapsing the panel preserves them. These are real WebView2 pages, not screenshots or an iframe demo.

Sign in to Filey, open its browser controls, and enter an HTTPS address. Sign in to Instagram, WhatsApp Web or other sites yourself in that panel. An account-and-company-specific browser profile retains that site's cookies locally. Filey does not import your regular browser's cookies or expose passwords, cookies or arbitrary JavaScript evaluation to the AI. Switching local/cloud mode closes open tabs but retains the same account/company profile. Switching account or company uses a different profile.

Filey AI can open and manage these tabs with `workspace_browser` (the UI uses the same `desktopBrowserCommand` adapter). To observe or operate a page, an in-app task starts task-scoped computer access automatically after its approval checks; `computer_use` then captures the returned native `window_id` and works against fresh screenshots. Opening a WhatsApp draft does not attach a PDF or send a message. Those steps require actual interaction and the agent's normal approval rules.

The invoice dialog also has **Send with Filey AI**. Clicking it authorizes the reviewed PDF/message and a temporary computer session restricted to that task's WhatsApp window and file picker. It uses the same screenshot/input controls, stops for login, and verifies the attachment before its single Send click. It does not require the separate WhatsApp QR bridge. See [invoice-messaging.md](invoice-messaging.md).

## Boundaries

- Remote child webviews receive no Filey capabilities. Capabilities target only the main webview, not every webview in the main window. The native custom-command dispatcher additionally refuses all callers except the main Filey webview, including remote frames that attempt to reach bundled Filey pages.
- Navigation accepts HTTPS and HTTP loopback addresses. Filey's own origins, URLs containing credentials, custom schemes, file URLs and JavaScript URLs are rejected. Encoded URLs are capped at 65,536 bytes to accommodate existing multilingual invoice captions.
- Browser profiles live under the app's local-data directory in `browser-profiles/<SHA-256 of account/company scope>`. No ERP records are read or changed by browser management. Profiles stay on this device and are separate from the main Filey webview.
- Workspace changes, sign-out and unloading the main app close browser tabs. Cancellation revokes in-flight window reservations and rejects their late results. Closing tabs retains site logins; sign out on a site when you want to remove its active session.
- URL metadata returned to the UI/model omits known credential, token and OAuth query fields and all fragments. The actual address loaded by the browser is unchanged. No page-content or credential extraction is implemented.
- Popups are blocked and shown as a requested link in Filey's controls. Downloads are blocked; use the regular browser when you need a save-location prompt. No file is silently saved.

The panel serializes native layout updates and hides website content while an app dialog or menu is open. A browser-bound computer task can type only when focus remains inside that child view or its file picker.

## Compatibility and verification

This implementation currently supports Windows desktop only. Some sites restrict embedded browsers or require an OAuth popup/opener flow that these isolated tabs do not support. Filey reports blocked popups and cannot guarantee that every site's login or feature works in WebView2. No anti-bot or authentication restrictions are bypassed.

Verification includes mocked adapter tests for URL validation, account/company profile isolation, storage-mode persistence, cancellation and long invoice captions; native unit tests for URL/profile validation and credential-safe state; and a native compile/link. On September 19, 2026, an isolated Windows development build also opened an external HTTPS page inside the main window, collapsed it, restored the same tab and closed it successfully. This QA host did not load a customer workspace. All 15 native module tests and nine browser-adapter tests passed. Live social login, publishing and sending remain untested; an installed-app acceptance pass for those workflows is still required.

Implementation references: Tauri's [WebviewBuilder API](https://docs.rs/tauri/2.11.1/tauri/webview/struct.WebviewBuilder.html) provides isolated data directories and navigation/popup hooks; its [capabilities documentation](https://v2.tauri.app/security/capabilities/) describes the remote-content permission boundary. Native history controls use the existing WebView2 handle rather than page scripts.
