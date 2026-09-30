//! Desktop-only Telegram transport. Tokens stay in the existing OS vault;
//! callers cannot choose a host, redirects or arbitrary HTTP methods.
use crate::error::{AppError, AppResult};
use base64::Engine;
use serde_json::{json, Value};
use std::{io::Read, path::Path, time::Duration};

const MAX_FILE: u64 = 12 * 1024 * 1024;
const METHODS: &[&str] = &["getMe", "getWebhookInfo", "getUpdates", "sendMessage", "sendChatAction", "sendDocument", "downloadFile"];

fn validate(method: &str, payload: &Value) -> AppResult<()> {
    if !METHODS.contains(&method) || !payload.is_object() || payload.to_string().len() > 64_000 {
        return Err(AppError::Http("Invalid Telegram request".into()));
    }
    if ["sendMessage", "sendChatAction", "sendDocument"].contains(&method) {
        let id = payload["chat_id"].as_str().unwrap_or("");
        if id.is_empty() || id.len() > 20 || !id.chars().all(|c| c.is_ascii_digit()) || id.starts_with('0') {
            return Err(AppError::Http("Telegram replies require a paired private chat".into()));
        }
    }
    if method == "sendMessage" && payload["text"].as_str().map_or(true, |t| t.is_empty() || t.chars().count() > 4096) {
        return Err(AppError::Http("Telegram message is empty or too long".into()));
    }
    if method == "sendChatAction" && payload["action"] != "typing" {
        return Err(AppError::Http("Invalid Telegram activity".into()));
    }
    if method == "getUpdates" && payload["offset"].as_i64().map_or(true, |n| !(-1..=9_007_199_254_740_991).contains(&n)) {
        return Err(AppError::Http("Invalid Telegram message cursor".into()));
    }
    Ok(())
}

fn read_result(response: ureq::Response) -> AppResult<Value> {
    let mut body = String::new();
    response.into_reader().take(1_000_001).read_to_string(&mut body)
        .map_err(|_| AppError::Http("Could not read Telegram response".into()))?;
    if body.len() > 1_000_000 { return Err(AppError::Http("Telegram response is too large".into())); }
    let result: Value = serde_json::from_str(&body).map_err(|_| AppError::Http("Invalid Telegram response".into()))?;
    if result["ok"] != true {
        return Err(AppError::Http("Telegram rejected this request. Check the bot connection.".into()));
    }
    Ok(result["result"].clone())
}

fn confirmed_message(result: &Value, chat: &str) -> AppResult<()> {
    if result["message_id"].as_u64().unwrap_or(0) == 0 || result["chat"]["id"].as_u64().map(|n| n.to_string()).as_deref() != Some(chat) {
        return Err(AppError::Http("Telegram did not confirm delivery to the paired chat".into()));
    }
    Ok(())
}

fn call(agent: &ureq::Agent, token: &str, method: &str, body: Value) -> AppResult<Value> {
    let response = agent.post(&format!("https://api.telegram.org/bot{token}/{method}"))
        .send_json(&body).map_err(|_| AppError::Http("Telegram did not confirm this request. Check the connection before retrying a send.".into()))?;
    let result = read_result(response)?;
    if method == "sendMessage" { confirmed_message(&result, body["chat_id"].as_str().unwrap_or(""))?; }
    Ok(result)
}

fn output_path(path: &str) -> AppResult<std::path::PathBuf> {
    let path = Path::new(path).canonicalize().map_err(|_| AppError::Io("The generated file is unavailable".into()))?;
    let parent = path.parent().ok_or_else(|| AppError::Io("Invalid generated file".into()))?;
    let task = parent.file_name().and_then(|p| p.to_str()).unwrap_or("");
    let folder = parent.parent().and_then(|p| p.file_name()).and_then(|p| p.to_str()).unwrap_or("");
    if uuid::Uuid::parse_str(task).is_err() || folder != "Filey AI" || !path.is_file() {
        return Err(AppError::Io("Only files produced by this Filey agent can be attached".into()));
    }
    Ok(path)
}

#[tauri::command]
pub async fn telegram_request(scope: String, method: String, payload: Value, expected_bot_id: Option<String>) -> AppResult<Value> {
    validate(&method, &payload)?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = super::credentials::read(&scope, "telegram.bot_token")?
            .ok_or_else(|| AppError::Http("Connect Telegram in Integrations first".into()))?;
        let (id, key) = token.split_once(':').unwrap_or(("", ""));
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) || key.len() < 20 || key.len() > 128 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err(AppError::Http("Invalid Telegram bot token".into()));
        }
        if method != "getMe" && expected_bot_id.as_deref() != Some(id) {
            return Err(AppError::Http("The Telegram bot changed. Reconnect it in this workspace before requesting work.".into()));
        }
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(45)).redirects(0).build();
        if method == "downloadFile" {
            let file_id = payload["file_id"].as_str().filter(|s| !s.is_empty() && s.len() <= 512)
                .ok_or_else(|| AppError::Http("Invalid Telegram attachment".into()))?;
            let file = call(&agent, &token, "getFile", json!({"file_id":file_id}))?;
            let path = file["file_path"].as_str().unwrap_or("");
            if path.is_empty() || path.len() > 512 || path.starts_with('/') || path.contains("..") || !path.chars().all(|c| c.is_ascii_alphanumeric() || "_-/.".contains(c)) {
                return Err(AppError::Http("Invalid Telegram attachment path".into()));
            }
            if file["file_size"].as_u64().unwrap_or(MAX_FILE + 1) > MAX_FILE { return Err(AppError::Http("Send an attachment smaller than 12 MB".into())); }
            let response = agent.get(&format!("https://api.telegram.org/file/bot{token}/{path}"))
                .call().map_err(|_| AppError::Http("Could not download Telegram attachment".into()))?;
            let mut bytes = Vec::new();
            response.into_reader().take(MAX_FILE + 1).read_to_end(&mut bytes)
                .map_err(|_| AppError::Http("Could not read Telegram attachment".into()))?;
            if bytes.is_empty() || bytes.len() as u64 > MAX_FILE { return Err(AppError::Http("Send a non-empty attachment smaller than 12 MB".into())); }
            return Ok(json!({"b64":base64::engine::general_purpose::STANDARD.encode(bytes)}));
        }
        if method == "sendDocument" {
            let path = output_path(payload["path"].as_str().unwrap_or(""))?;
            let mut file = std::fs::File::open(path).map_err(|_| AppError::Io("Could not open generated file".into()))?;
            let mut bytes = Vec::new();
            file.by_ref().take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(|_| AppError::Io("Could not read generated file".into()))?;
            if bytes.is_empty() || bytes.len() as u64 > MAX_FILE { return Err(AppError::Http("Telegram agent files must be non-empty and smaller than 12 MB".into())); }
            let name = payload["filename"].as_str().unwrap_or("filey-output.pdf");
            if name.is_empty() || name.len() > 160 || name.chars().any(|c| c.is_control() || "\"\\/".contains(c)) { return Err(AppError::Io("Invalid attachment filename".into())); }
            let boundary = format!("filey-{}", uuid::Uuid::new_v4());
            let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n",payload["chat_id"].as_str().unwrap()).into_bytes();
            body.extend(bytes);
            body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
            let response = agent.post(&format!("https://api.telegram.org/bot{token}/sendDocument"))
                .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
                .send_bytes(&body).map_err(|_| AppError::Http("File delivery was not confirmed. Check Telegram before retrying.".into()))?;
            let result = read_result(response)?;
            confirmed_message(&result, payload["chat_id"].as_str().unwrap_or(""))?;
            return Ok(result);
        }
        let body = if method == "getUpdates" { json!({"offset":payload["offset"],"timeout":payload["timeout"].as_u64().unwrap_or(20).min(20),"limit":20,"allowed_updates":["message"]}) } else { payload };
        call(&agent, &token, &method, body)
    }).await.map_err(|_| AppError::Http("Telegram transport stopped".into()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn telegram_transport_restricts_methods_destinations_and_files() {
        assert!(validate("deleteWebhook", &json!({})).is_err());
        assert!(validate("sendMessage", &json!({"chat_id":"-10","text":"x"})).is_err());
        assert!(validate("sendMessage", &json!({"chat_id":"10","text":"x"})).is_ok());
        assert!(validate("sendChatAction", &json!({"chat_id":"10","action":"upload_video"})).is_err());
        assert!(validate("getUpdates", &json!({"offset":-2})).is_err());
        assert!(confirmed_message(&json!({"message_id":1,"chat":{"id":10}}), "10").is_ok());
        assert!(confirmed_message(&json!({"message_id":1.5,"chat":{"id":10}}), "10").is_err());
        assert!(confirmed_message(&json!({"message_id":1,"chat":{"id":11}}), "10").is_err());
        assert!(output_path("Cargo.toml").is_err());
    }
}
