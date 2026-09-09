# Filey AI computer access

Filey AI can observe and operate Windows desktop apps through a temporary session that the signed-in desktop user enables. It can list visible windows, capture a selected window, click, type, scroll and send a limited set of keys. Filey's existing ERP tools remain the preferred way to work with business records.

## Enable and stop

1. Open **Filey AI** in the Windows desktop app and configure a model that supports both tool calling and images.
2. Expand **Computer access**, read the screenshot disclosure, then choose **Enable for 5 minutes**. The **Computer use** capability must also be enabled in **Access**.
3. Ask Filey to work in a specific app. It lists windows, captures the chosen window, performs one action against that screenshot, then captures again to verify. Filey may bring the selected window forward. Input coordinates refer to the returned screenshot, not the full monitor.
4. Use **Stop computer access** or the assistant's **Stop** control to revoke the session. Holding Escape during a native action also aborts it and revokes access. Access ends on expiry, workspace/account change, page unload or closing Filey. Revocation stops the running helper; it cannot undo input already delivered to another app.

The ordinary agent approval mode still applies. A temporary computer grant does not remove tool confirmation rules. It is not saved for future launches, and the model cannot grant access to itself.

The existing `ownerOnly` tool flag distinguishes a trusted signed-in interactive user from incoming customer requests. It is **not** an organization administrator role: each signed-in desktop user can grant access to their own Windows session. Remote customers cannot use this tool. Filey organization permissions and database access rules are unchanged.

## Data and execution boundaries

- Native commands use the local Tauri IPC channel; there is no HTTP server or unauthenticated listening port. Grants use random tokens held only in memory and accept a duration of 60–900 seconds.
- Only the local Filey main window can request a grant. The frontend binds it to the current account, organization and storage mode.
- The Windows helper is a fixed embedded PowerShell/.NET program. It accepts structured, allowlisted actions; it does not accept scripts, commands, executable paths or working directories. No additional driver, API key or service subscription is required for computer control itself.
- A capture is bound to a listed window and its process. Input requires a screenshot ID less than two minutes old; each ID allows one input action. Bounds, process identity and foreground window are checked before input. A moved, resized or replaced window requires another capture.
- Screenshots are PNG images of at most 1,600 pixels on the longest edge and 4 MiB. The helper captures the visible part of the selected window; overlays in front of it may appear in the image. Screenshot bytes are not written to My Files, chat history or diagnostics. They are sent to the configured model as transient image input, so the provider's own data policies still apply. Local inference avoids a hosted image request when the chosen model runs locally.
- The native snapshot cache retains coordinates and window metadata, not image bytes. Typed text is masked in tool diagnostics; text that the user or model writes in the conversation can still be part of that conversation.

## Current limits

Windows desktop only. Browser builds, macOS and Linux do not provide this native execution path. The separate browser WebBridge integration is unchanged and requires its own setup.

Windows PowerShell and .NET must be available. Windows may refuse foreground activation or input to elevated/protected applications; Filey reports the failure instead of claiming success. UAC, sign-in/lock screens, permission dialogs and privileged applications require the user to take over. The tool has no general shell-launch shortcut, drag operation or clipboard-reading API. Screenshots cannot guarantee visibility through protected/black capture surfaces.

## Verification for this change

- Six mocked adapter tests cover explicit grants, argument filtering, workspace revocation, cancellation, Escape, expiry and invalid images.
- A Rust unit test checks target validation, screenshot-coordinate mapping, expiry, allowlisted keys and single-use action tokens without executing desktop input.
- The native Rust library builds with the installed Visual Studio cross-host x64 toolchain. Windows PowerShell 5.1 parses the helper and compiles its C# interop type.
- No live window enumeration, capture, clicks or typing were performed on the user's applications. An installed-build acceptance pass in a disposable test window is still needed before describing native app control as live-verified.
