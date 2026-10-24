//! Filey as an MCP server, so the owner's other agents (their own Hermes, Claude Desktop, any
//! MCP client) can use the Filey app.
//!
//! Off until the owner turns it on (Settings → Integrations). It listens on 127.0.0.1 only,
//! speaks MCP's Streamable HTTP with plain JSON replies on `POST /mcp`, and every request needs
//! the bearer token from `<app data>/mcp-token.txt`. Requests that carry a browser `Origin`, or
//! a `Host` other than this machine, are refused, so a web page cannot reach it.
//! `tools/list` and `tools/call` are handed to the app (src/lib/fileyMcp.ts), which runs them
//! through the same runTool, permissions and approval cards as Filey's own agent.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Webview};

pub const PORT: u16 = 47615;
const MAX_BODY: usize = 4 * 1024 * 1024;

static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(1);
static TOKEN: Mutex<String> = Mutex::new(String::new());
static PENDING: LazyLock<Mutex<HashMap<u64, mpsc::Sender<Value>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn token_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mcp-token.txt"))
}

fn new_token() -> String {
    rand::random::<[u8; 32]>().iter().map(|b| format!("{b:02x}")).collect()
}

fn load_token(app: &AppHandle, rotate: bool) -> Result<String, String> {
    let path = token_file(app)?;
    if !rotate {
        if let Ok(saved) = std::fs::read_to_string(&path) {
            let saved = saved.trim().to_string();
            if saved.len() >= 32 {
                return Ok(saved);
            }
        }
    }
    let token = new_token();
    std::fs::write(&path, &token).map_err(|e| format!("could not save the MCP token: {e}"))?;
    Ok(token)
}

#[derive(serde::Serialize)]
pub struct McpStatus {
    enabled: bool,
    url: String,
    token: String,
}

fn status(enabled: bool, token: String) -> McpStatus {
    McpStatus { enabled, url: format!("http://127.0.0.1:{PORT}/mcp"), token }
}

/// Turn the MCP server on or off. Returns the address and token to give the other agent.
#[tauri::command]
pub fn filey_mcp_configure(window: Webview, app: AppHandle, enabled: bool) -> Result<McpStatus, String> {
    super::computer_use::check_window(&window)?;
    let token = load_token(&app, false)?;
    *TOKEN.lock().map_err(|e| e.to_string())? = token.clone();
    if !enabled {
        STOP.store(true, Ordering::SeqCst);
        return Ok(status(false, token));
    }
    STOP.store(false, Ordering::SeqCst);
    if !RUNNING.swap(true, Ordering::SeqCst) {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => listener,
            Err(e) => {
                RUNNING.store(false, Ordering::SeqCst);
                return Err(format!("Port {PORT} is in use on this computer, so Filey cannot accept agents ({e})."));
            }
        };
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        std::thread::Builder::new()
            .name("filey-mcp".into())
            .spawn(move || {
                while !STOP.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let app = app.clone();
                            std::thread::spawn(move || serve(stream, &app));
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
                        Err(_) => std::thread::sleep(Duration::from_millis(500)),
                    }
                }
                RUNNING.store(false, Ordering::SeqCst);
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(status(true, token))
}

/// Make a new token; agents using the old one stop working.
#[tauri::command]
pub fn filey_mcp_rotate_token(window: Webview, app: AppHandle) -> Result<McpStatus, String> {
    super::computer_use::check_window(&window)?;
    let token = load_token(&app, true)?;
    *TOKEN.lock().map_err(|e| e.to_string())? = token.clone();
    Ok(status(RUNNING.load(Ordering::SeqCst) && !STOP.load(Ordering::SeqCst), token))
}

/// The app's answer to one forwarded request.
#[tauri::command]
pub fn filey_mcp_respond(window: Webview, id: u64, response: Value) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    if let Some(waiter) = PENDING.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = waiter.send(response);
    }
    Ok(())
}

fn reply(stream: &mut TcpStream, code: &str, body: Option<&Value>) {
    let body = body.map(|b| b.to_string()).unwrap_or_default();
    let head = format!(
        "HTTP/1.1 {code}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body.as_bytes()));
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Same length and every byte compared: the token check takes the same time either way.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn serve(mut stream: TcpStream, app: &AppHandle) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let (mut length, mut auth, mut origin, mut host) = (0usize, String::new(), false, String::new());
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = value.parse().unwrap_or(0),
            "authorization" => auth = value.to_string(),
            "origin" => origin = !value.is_empty() && value != "null",
            "host" => host = value.to_ascii_lowercase(),
            _ => {}
        }
    }
    // A web page can only reach this through the browser, which always sends Origin; and a
    // rebinding page arrives with its own host name. Neither is an agent on this computer.
    let local_host = host == format!("127.0.0.1:{PORT}") || host == format!("localhost:{PORT}");
    if origin || !local_host {
        return reply(&mut stream, "403 Forbidden", None);
    }
    if path.split('?').next() != Some("/mcp") {
        return reply(&mut stream, "404 Not Found", None);
    }
    if method != "POST" {
        return reply(&mut stream, "405 Method Not Allowed", None);
    }
    let token = TOKEN.lock().map(|t| t.clone()).unwrap_or_default();
    let offered = auth.strip_prefix("Bearer ").unwrap_or("").trim();
    if token.is_empty() || !same(offered, &token) {
        return reply(&mut stream, "401 Unauthorized", None);
    }
    if length == 0 || length > MAX_BODY {
        return reply(&mut stream, "413 Payload Too Large", None);
    }
    let mut body = vec![0u8; length];
    if reader.read_exact(&mut body).is_err() {
        return;
    }
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        return reply(&mut stream, "400 Bad Request", Some(&rpc_error(&Value::Null, -32700, "parse error")));
    };
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let rpc = message.get("method").and_then(|m| m.as_str()).unwrap_or("");
    if id.is_null() {
        return reply(&mut stream, "202 Accepted", None); // a notification (e.g. notifications/initialized)
    }
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let answer = match rpc {
        "initialize" => json!({ "jsonrpc": "2.0", "id": id, "result": {
            "protocolVersion": params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or("2025-06-18"),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "filey", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Filey ERP running on this computer: invoices, quotes, purchase orders, payments, customers, suppliers, products and stock, accounting, payroll, CRM, letters and documents. Find an action with filey_tools, then run it with filey_run. Sending and paying wait for the owner's approval in Filey.",
        }}),
        "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
        "tools/list" | "tools/call" => {
            let ticket = NEXT.fetch_add(1, Ordering::SeqCst);
            let (tx, rx) = mpsc::channel();
            if let Ok(mut pending) = PENDING.lock() {
                pending.insert(ticket, tx);
            }
            let _ = app.emit_to("main", "filey-mcp-request", json!({ "id": ticket, "method": rpc, "params": params }));
            // A call may wait on the owner's approval card; a listing never should.
            let wait = if rpc == "tools/list" { Duration::from_secs(20) } else { Duration::from_secs(15 * 60) };
            let outcome = rx.recv_timeout(wait);
            if let Ok(mut pending) = PENDING.lock() {
                pending.remove(&ticket);
            }
            match outcome {
                Ok(response) => match (response.get("result"), response.get("error")) {
                    (Some(result), _) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                    (_, Some(error)) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
                    _ => rpc_error(&id, -32603, "Filey returned no answer."),
                },
                Err(_) => rpc_error(&id, -32001, "Filey did not answer. Open the Filey app and sign in, then try again."),
            }
        }
        _ => rpc_error(&id, -32601, &format!("{rpc} is not supported by Filey")),
    };
    reply(&mut stream, "200 OK", Some(&answer));
}

#[cfg(test)]
mod tests {
    #[test]
    fn token_check_needs_the_whole_token() {
        assert!(super::same("abc123", "abc123"));
        assert!(!super::same("abc12", "abc123"));
        assert!(!super::same("abc124", "abc123"));
        assert!(!super::same("", "abc123"));
    }
}
