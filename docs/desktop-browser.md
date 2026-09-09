# Filey Browser

The Windows desktop app can open websites in separate Filey Browser windows. Filey's main interface manages their address, back/forward history, reload, stop, focus and close controls. Up to eight windows can be open. These are real WebView2 pages, not screenshots or an iframe demo.

Sign in to Filey, open its browser controls, and enter an HTTPS address. Sign in to Instagram, WhatsApp Web or other sites yourself in that window. An account-and-company-specific browser profile retains that site's cookies locally. Filey does not import your regular browser's cookies or expose passwords, cookies or arbitrary JavaScript evaluation to the AI. Switching local/cloud mode closes open windows but retains the same account/company profile. Switching account or company uses a different profile.

Filey AI can open and manage these windows with `workspace_browser` (the UI uses the same `desktopBrowserCommand` adapter). To observe or operate a page, the user must separately enable temporary **Computer access**; `computer_use` then captures the returned native `window_id` and works against fresh screenshots. Opening a WhatsApp draft does not attach a PDF or send a message. Those steps require actual interaction and the agent's normal approval rules.

## Boundaries

- Remote website windows receive no Filey capabilities. The native custom-command dispatcher additionally refuses all callers except the main Filey webview, including remote frames that attempt to reach bundled Filey pages.
- Navigation accepts HTTPS and HTTP loopback addresses. Filey's own origins, URLs containing credentials, custom schemes, file URLs and JavaScript URLs are rejected. Encoded URLs are capped at 65,536 bytes to accommodate existing multilingual invoice captions.
- Browser profiles live under the app's local-data directory in `browser-profiles/<SHA-256 of account/company scope>`. No ERP records are read or changed by browser management. Profiles stay on this device and are separate from the main Filey webview.
- Workspace changes, sign-out and unloading the main app close browser windows. Cancellation revokes in-flight window reservations and rejects their late results. Closing tabs retains site logins; sign out on a site when you want to remove its active session.
- URL metadata returned to the UI/model omits known credential, token and OAuth query fields and all fragments. The actual address loaded by the browser is unchanged. No page-content or credential extraction is implemented.
- Popups are blocked and shown as a requested link in Filey's controls. Downloads are blocked; use the regular browser when you need a save-location prompt. No file is silently saved.

## Compatibility and verification

This implementation currently supports Windows desktop only. Some sites restrict embedded browsers or require an OAuth popup/opener flow that these isolated windows do not support. Filey reports blocked popups and cannot guarantee that every site's login or feature works in WebView2. No anti-bot or authentication restrictions are bypassed.

Verification includes mocked adapter tests for URL validation, account/company profile isolation, storage-mode persistence, cancellation and long invoice captions; native unit tests for URL/profile validation and credential-safe state; and a native compile/link. Live social login, publishing, sending and desktop page interaction are not exercised by these tests. An installed-app acceptance pass with a disposable window is still required.

Implementation references: Tauri's [WebviewWindowBuilder API](https://docs.rs/tauri/2.11.1/tauri/webview/struct.WebviewWindowBuilder.html) provides isolated data directories and navigation/popup hooks; its [capabilities documentation](https://v2.tauri.app/security/capabilities/) describes the remote-content permission boundary. Native history controls use the existing WebView2 handle rather than page scripts.
