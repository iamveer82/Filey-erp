//! Composio bridge — managed third-party integrations (Gmail, Slack, Telegram…).
//!
//! The Composio API key is a master credential for every connected account, so
//! it lives ONLY in the encrypted desktop store (kv_cache) and is read here in
//! the Rust backend — never handed to the WebView. All Composio HTTP happens in
//! this process; the frontend calls these commands and never sees the key.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use tauri::State;

const BASE: &str = "https://backend.composio.dev/api/v3";
const KEY_NAME: &str = "composio_api_key";
const USER_NAME: &str = "composio_user_id";

/// Read the stored Composio API key from the encrypted kv_cache. This is the
/// PLATFORM key (one key serves every connected entity) — not a per-end-user key.
fn api_key(db: &State<Db>) -> AppResult<String> {
    let conn = db.inner().0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.query_row(
        "SELECT value FROM kv_cache WHERE key = ?1",
        [KEY_NAME],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .filter(|k| !k.trim().is_empty())
    .ok_or_else(|| {
        AppError::Composio("Composio API key not set (Settings → Integrations).".into())
    })
}

/// Stable per-install Composio entity id. One platform key serves many of these
/// — this is the seam for "Composio as a service": each customer becomes their
/// own `user_id` under the same key, so connections stay isolated. Generated
/// once and persisted; an explicit `user_id` from the app overrides it (e.g.
/// later, the signed-in customer's account id).
fn entity_id(db: &State<Db>) -> AppResult<String> {
    let conn = db.inner().0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let existing: Option<String> = conn
        .query_row("SELECT value FROM kv_cache WHERE key = ?1", [USER_NAME], |r| {
            r.get(0)
        })
        .ok()
        .filter(|v: &String| !v.trim().is_empty());
    if let Some(v) = existing {
        return Ok(v);
    }
    let id = format!("filey-{}", uuid::Uuid::new_v4());
    conn.execute(
        "INSERT INTO kv_cache (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        [USER_NAME, id.as_str()],
    )?;
    Ok(id)
}

/// Use the caller-supplied entity if given, else the stable per-install one.
fn resolve_user(db: &State<Db>, user_id: Option<String>) -> AppResult<String> {
    match user_id {
        Some(u) if !u.trim().is_empty() => Ok(u),
        _ => entity_id(db),
    }
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
        Err(ureq::Error::Status(_code, resp)) => resp
            .into_json::<Value>()
            .map_err(|e| AppError::Composio(format!("bad error response: {e}"))),
        Err(e) => Err(AppError::Composio(e.to_string())),
    }
}

/// Start connecting a toolkit (e.g. "gmail", "slack"): ensures a Composio-managed
/// auth config exists, then returns an OAuth `redirect_url` for the user to
/// authorize, plus the `connected_account_id` to poll for status.
#[tauri::command]
pub fn composio_connect(
    db: State<Db>,
    toolkit: String,
    user_id: Option<String>,
) -> AppResult<Value> {
    let key = api_key(&db)?;
    let uid = resolve_user(&db, user_id)?;

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
pub fn composio_connection_status(
    db: State<Db>,
    connected_account_id: String,
) -> AppResult<Value> {
    let key = api_key(&db)?;
    call(
        &key,
        "GET",
        &format!("{BASE}/connected_accounts/{connected_account_id}"),
        None,
    )
}

/// List all connected accounts (for the integrations status view).
#[tauri::command]
pub fn composio_list_connections(db: State<Db>) -> AppResult<Value> {
    let key = api_key(&db)?;
    call(&key, "GET", &format!("{BASE}/connected_accounts?limit=50"), None)
}

/// Search the whole app catalogue. The shortlist on screen is a starting point,
/// not the limit of what a customer may connect.
#[tauri::command]
pub fn composio_search_toolkits(
    db: State<Db>,
    query: Option<String>,
    limit: Option<u32>,
) -> AppResult<Value> {
    let key = api_key(&db)?;
    let n = limit.unwrap_or(20).min(50);
    let url = match query.as_deref().filter(|s| !s.is_empty()) {
        Some(q) => format!("{BASE}/toolkits?limit={n}&search={q}"),
        None => format!("{BASE}/toolkits?limit={n}"),
    };
    call(&key, "GET", &url, None)
}

/// The actions available on the connected apps, so the agent can discover what
/// it may do instead of being shipped a fixed list that goes stale.
#[tauri::command]
pub fn composio_list_tools(
    db: State<Db>,
    toolkits: Option<String>,
    limit: Option<u32>,
) -> AppResult<Value> {
    let key = api_key(&db)?;
    let n = limit.unwrap_or(40).min(100);
    let url = match toolkits.as_deref().filter(|s| !s.is_empty()) {
        Some(slugs) => format!("{BASE}/tools?limit={n}&toolkit_slug={slugs}"),
        None => format!("{BASE}/tools?limit={n}"),
    };
    call(&key, "GET", &url, None)
}

/// Execute a Composio tool (e.g. GMAIL_SEND_EMAIL) for a user's connected account.
#[tauri::command]
pub fn composio_execute(
    db: State<Db>,
    tool_slug: String,
    arguments: Value,
    user_id: Option<String>,
) -> AppResult<Value> {
    let key = api_key(&db)?;
    let uid = resolve_user(&db, user_id)?;
    call(
        &key,
        "POST",
        &format!("{BASE}/tools/execute/{tool_slug}"),
        Some(json!({ "arguments": arguments, "user_id": uid })),
    )
}
