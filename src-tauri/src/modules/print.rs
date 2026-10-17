//! Print the page with the compact system print dialog. WebView2's own print
//! preview covers the whole window; the page's print CSS decides what prints.

use tauri::WebviewWindow;

#[tauri::command]
pub async fn print_page(window: WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        window
            .with_webview(move |view| {
                let result = (|| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM,
                    };
                    use windows_core::Interface;
                    let core = view.controller().CoreWebView2().map_err(|e| e.to_string())?;
                    let core = core
                        .cast::<ICoreWebView2_16>()
                        .map_err(|_| "Update Microsoft Edge WebView2 to print.".to_string())?;
                    core.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM).map_err(|e| e.to_string())
                })();
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
        receive
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| "The print dialog did not open.".to_string())?
    }
    #[cfg(not(windows))]
    {
        window.print().map_err(|e| e.to_string())
    }
}
