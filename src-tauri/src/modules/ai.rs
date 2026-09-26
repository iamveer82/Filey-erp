// Native HTTP proxy for AI provider calls.
//
// The webview's `fetch` is subject to CORS, so providers that don't send CORS
// headers (Ollama Cloud, Groq, Mistral, xAI, Together, …) fail with "Failed to
// fetch". Routing the request through native code sidesteps CORS entirely, so
// any OpenAI-compatible / Anthropic endpoint works on the desktop app.
//
// Returns the status + raw body for ANY response (including 4xx/5xx) so the
// frontend can read provider error messages just like a real fetch. Only
// transport failures become an error.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use std::io::Read;
use base64::Engine;

#[derive(Serialize)]
pub struct MediaResponse {
    pub data: String,
    pub mime: String,
}

/// Binary images cannot pass through the text-only ai_proxy response.
/// No authorization, cookies or redirects are forwarded to media hosts.
#[tauri::command]
pub async fn ai_download_media(url: String) -> AppResult<MediaResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = tauri::Url::parse(&url).map_err(|_| AppError::Http("Invalid media URL".into()))?;
        let host = parsed.host_str().unwrap_or("");
        if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some()
            || parsed.port().is_some() || !host.contains('.') || host.parse::<std::net::IpAddr>().is_ok()
            || ["localhost", "local", "internal"].iter().any(|s| host == *s || host.ends_with(&format!(".{s}"))) {
            return Err(AppError::Http("Invalid media URL".into()));
        }
        let response = ureq::AgentBuilder::new().timeout(Duration::from_secs(60)).redirects(0).build()
            .get(&url).call().map_err(|_| AppError::Http("Could not download media".into()))?;
        let mime = response.header("content-type").unwrap_or("application/octet-stream").to_string();
        let mut bytes = Vec::new();
        response.into_reader().take(20_000_001).read_to_end(&mut bytes)
            .map_err(|_| AppError::Http("Could not read media".into()))?;
        if bytes.is_empty() || bytes.len() > 20_000_000 { return Err(AppError::Http("Image exceeds 20 MB or is empty".into())); }
        Ok(MediaResponse { data: base64::engine::general_purpose::STANDARD.encode(bytes), mime })
    }).await.map_err(|e| AppError::Http(e.to_string()))?
}

#[derive(Serialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub body: String,
}

// A synchronous #[tauri::command] runs on the MAIN thread, and ureq blocks for
// as long as the provider takes — up to the 180s timeout below. That froze the
// entire window for the length of every model call, and one agent turn is many
// calls back to back, so "Filey is thinking" meant "the app is dead". Async +
// spawn_blocking puts the wait on a worker thread; the UI keeps painting.
#[tauri::command]
pub async fn ai_proxy(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> AppResult<ProxyResponse> {
    tauri::async_runtime::spawn_blocking(move || ai_proxy_blocking(method, url, headers, body))
        .await
        .map_err(|e| AppError::Http(e.to_string()))?
}

fn ai_proxy_blocking(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> AppResult<ProxyResponse> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(180))
        .redirects(0)
        .build();

    let mut req = match method.to_uppercase().as_str() {
        "POST" => agent.post(&url),
        "GET" => agent.get(&url),
        other => agent.request(other, &url),
    };
    for (k, v) in &headers {
        req = req.set(k, v);
    }

    let result = match body {
        Some(b) => req.send_string(&b),
        None => req.call(),
    };

    match result {
        Ok(resp) => Ok(ProxyResponse {
            status: resp.status(),
            body: resp.into_string().map_err(|e| AppError::Http(e.to_string()))?,
        }),
        // HTTP error statuses still carry a body the caller wants to read.
        Err(ureq::Error::Status(status, resp)) => Ok(ProxyResponse {
            status,
            body: resp.into_string().unwrap_or_default(),
        }),
        Err(e) => Err(AppError::Http(e.to_string())),
    }
}
