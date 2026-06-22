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

#[derive(Serialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub fn ai_proxy(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> AppResult<ProxyResponse> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(180))
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
