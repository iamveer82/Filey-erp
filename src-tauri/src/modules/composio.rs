//! Composio calls use an OS credential scoped to the signed-in account/org.
use crate::db::Db;
use crate::error::{AppError, AppResult};
use super::credentials;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;

const BASE: &str = "https://backend.composio.dev/api/v3";
fn api_key(scope: &str) -> AppResult<String> {
    credentials::read(scope, "composio")?.filter(|key| !key.trim().is_empty())
        .ok_or_else(|| AppError::Composio("Add your Composio key in Integrations.".into()))
}
fn entity_id(scope: &str) -> String { format!("filey-{:x}", Sha256::digest(scope)) }
fn slug(value: &str) -> AppResult<&str> {
    if value.is_empty() || value.len() > 256 || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err(AppError::Composio("Invalid integration identifier".into()));
    }
    Ok(value)
}
fn query_url(path: &str, params: &[(&str, String)]) -> AppResult<String> {
    let mut url = tauri::Url::parse(&format!("{BASE}/{path}")).map_err(|e| AppError::Composio(e.to_string()))?;
    url.query_pairs_mut().extend_pairs(params.iter().map(|(k,v)| (*k,v.as_str())));
    Ok(url.into())
}
fn public_account(account: &Value, uid: &str) -> AppResult<Value> {
    if account.get("user_id").and_then(Value::as_str) != Some(uid) {
        return Err(AppError::Composio("This connection belongs to a different workspace.".into()));
    }
    Ok(json!({ "id": account.get("id"), "status": account.get("status"), "toolkit": { "slug": account.pointer("/toolkit/slug") } }))
}

// Preserve unscoped legacy keys in a recovery vault; never assign them to
// whichever account signs in next. Business records are untouched.
#[tauri::command]
pub async fn composio_has_key(db: State<'_, Db>, scope: String) -> AppResult<bool> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let legacy: Option<String> = conn.query_row("SELECT value FROM kv_cache WHERE key='composio_api_key'", [], |row| row.get(0)).optional()?;
    if let Some(value) = legacy.filter(|v| !v.is_empty()) {
        credentials::quarantine("composio_api_key", &value)?;
        conn.execute("UPDATE kv_cache SET value='' WHERE key='composio_api_key' AND value=?1", [&value])?;
    }
    Ok(credentials::read(&scope,"composio")?.is_some_and(|v| !v.trim().is_empty()))
}

/// One Composio HTTP call. Returns the parsed JSON body on success AND on HTTP
/// error statuses (Composio returns a structured `{error:{…}}` body we want to
/// surface to the agent/UI). Only transport failures become an AppError.
fn call(key: &str, method: &str, url: &str, body: Option<Value>) -> AppResult<Value> {
    let req = match method {
        "POST" => ureq::post(url),
        _ => ureq::get(url),
    }
    .set("x-api-key", key)
    .set("content-type", "application/json");

    let result = match body {
        Some(b) => req.send_json(b),
        None => req.call(),
    };

    match result {
        Ok(resp) => resp
            .into_json::<Value>()
            .map_err(|e| AppError::Composio(format!("bad response: {e}"))),
        // HTTP 4xx/5xx — Composio still returns a JSON error body; surface it.
        Err(ureq::Error::Status(code, _)) => Err(AppError::Composio(format!("Integration request failed (HTTP {code}). Check your key and connection."))),
        Err(e) => Err(AppError::Composio(e.to_string())),
    }
}

/// Start connecting a toolkit (e.g. "gmail", "slack"): ensures a Composio-managed
/// auth config exists, then returns an OAuth `redirect_url` for the user to
/// authorize, plus the `connected_account_id` to poll for status.
#[tauri::command]
pub async fn composio_connect(
    scope: String,
    toolkit: String,
) -> AppResult<Value> {
    let key = api_key(&scope)?;
    let uid = entity_id(&scope);

    slug(&toolkit)?;
    // Reuse an existing managed auth config for this toolkit, else create one.
    let existing = call(
        &key,
        "GET",
        &format!("{BASE}/auth_configs?toolkit_slug={toolkit}&limit=1"),
        None,
    )?;
    let ac_id = existing
        .get("items")
        .and_then(|i| i.get(0))
        .and_then(|a| a.get("id"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let ac_id = match ac_id {
        Some(id) => id,
        None => {
            let created = call(
                &key,
                "POST",
                &format!("{BASE}/auth_configs"),
                Some(json!({
                    "toolkit": { "slug": toolkit },
                    "auth_config": { "type": "use_composio_managed_auth" }
                })),
            )?;
            created
                .get("auth_config")
                .and_then(|a| a.get("id"))
                .and_then(|v| v.as_str())
                .map(String::from)
                .ok_or_else(|| AppError::Composio(format!("could not create auth config: {created}")))?
        }
    };

    // Managed-OAuth connections are created via the /link endpoint.
    call(
        &key,
        "POST",
        &format!("{BASE}/connected_accounts/link"),
        Some(json!({ "auth_config_id": ac_id, "user_id": uid })),
    )
}

/// Poll a connection's status (e.g. INITIATED → ACTIVE after the user authorizes).
#[tauri::command]
pub async fn composio_connection_status(
    scope: String,
    connected_account_id: String,
) -> AppResult<Value> {
    let key = api_key(&scope)?;
    slug(&connected_account_id)?;
    let account = call(&key, "GET", &format!("{BASE}/connected_accounts/{connected_account_id}"), None)?;
    public_account(&account, &entity_id(&scope))
}

/// Read only this workspace's accounts and return no OAuth credential fields.
#[tauri::command]
pub async fn composio_list_connections(scope: String, cursor: Option<String>) -> AppResult<Value> {
    let key = api_key(&scope)?;
    let uid = entity_id(&scope);
    let mut query = vec![("limit", "100".into()), ("user_ids", uid.clone())];
    if let Some(cursor) = cursor.filter(|value| !value.is_empty()) { query.push(("cursor", cursor)); }
    let response = call(&key, "GET", &query_url("connected_accounts", &query)?, None)?;
    let items = response.get("items").and_then(Value::as_array).ok_or_else(|| AppError::Composio("Invalid connection list".into()))?;
    let accounts = items.iter().map(|item| public_account(item, &uid)).collect::<AppResult<Vec<_>>>()?;
    Ok(json!({ "items": accounts, "next_cursor": response.get("next_cursor") }))
}

/// Search the whole app catalogue. The shortlist on screen is a starting point,
/// not the limit of what a customer may connect.
#[tauri::command]
pub async fn composio_search_toolkits(
    scope: String,
    query: Option<String>,
    limit: Option<u32>,
) -> AppResult<Value> {
    let key = api_key(&scope)?;
    let n = limit.unwrap_or(20).min(50);
    let url = match query.as_deref().filter(|s| !s.is_empty()) {
        Some(q) => query_url("toolkits", &[("limit", n.to_string()), ("search", q.into())])?,
        None => format!("{BASE}/toolkits?limit={n}"),
    };
    call(&key, "GET", &url, None)
}

/// The actions available on the connected apps, so the agent can discover what
/// it may do instead of being shipped a fixed list that goes stale.
#[tauri::command]
pub async fn composio_list_tools(
    scope: String,
    toolkits: Option<String>,
    limit: Option<u32>,
) -> AppResult<Value> {
    let key = api_key(&scope)?;
    let n = limit.unwrap_or(40).min(100);
    let url = match toolkits.as_deref().filter(|s| !s.is_empty()) {
        Some(slugs) => query_url("tools", &[("limit", n.to_string()), ("toolkit_slug", slugs.into())])?,
        None => format!("{BASE}/tools?limit={n}"),
    };
    call(&key, "GET", &url, None)
}

/// Execute a Composio tool (e.g. GMAIL_SEND_EMAIL) for a user's connected account.
#[tauri::command]
pub async fn composio_execute(
    scope: String,
    tool_slug: String,
    arguments: Value,
) -> AppResult<Value> {
    let key = api_key(&scope)?;
    let uid = entity_id(&scope);
    slug(&tool_slug)?;
    call(
        &key,
        "POST",
        &format!("{BASE}/tools/execute/{tool_slug}"),
        Some(json!({ "arguments": arguments, "user_id": uid })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_scope_and_safe_connection_projection() {
        let first = entity_id("org:a:user:one");
        assert_ne!(first, entity_id("org:a:user:two"));
        assert_ne!(first, entity_id("org:b:user:one"));
        let account = json!({"id":"ca_test","user_id":first,"status":"ACTIVE","toolkit":{"slug":"gmail"},"state":{"access_token":"fixture-secret"}});
        let visible = public_account(&account, &first).unwrap();
        assert_eq!(visible["id"], "ca_test");
        assert!(!visible.to_string().contains("fixture-secret"));
        assert!(public_account(&account,"other").is_err());
        assert!(slug("gmail?user_ids=other").is_err());
        let query = query_url("toolkits", &[("search","gmail&user_ids=other".into())]).unwrap();
        assert!(query.contains("gmail%26user_ids%3Dother"));
    }
}
