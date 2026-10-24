//! Documents the agent saved, and the letterhead image for a letter, read from the user's own
//! folders so Filey's Office work opens them. Nothing here starts another program for Office files.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

// The formats Office work's Word takes for insert.picture.
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp"];
// Office work's formats (officeWord.ts OFFICE_APPS) plus plain files the chat may hand back.
const OPEN_EXT: &[&str] = &[
    "doc", "docx", "odt", "rtf", "pdf", "xls", "xlsx", "xlsm", "xlsb", "ods", "csv", "tsv", "ppt", "pptx", "potx", "ppsx",
    "deckcraft", "designcraft", "idml", "figcraft", "fig", "vectorcraft", "svg", "ai", "eps", "png", "jpg", "jpeg", "webp", "txt",
];

pub fn name_matches(file_name: &str, query: &str) -> bool {
    let stem = file_name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file_name).to_lowercase();
    let mut tokens: Vec<String> = query.split_whitespace().map(|part| part.to_lowercase()).filter(|part| part.len() >= 2).collect();
    if tokens.is_empty() { tokens.push("letterhead".into()); }
    tokens.iter().all(|token| stem.contains(token))
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_lowercase()
}

fn user_profile() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE").map(PathBuf::from).filter(|path| path.is_dir()).ok_or_else(|| "This computer has no user folder.".into())
}

fn system_path(path: &Path) -> bool {
    let text = path.to_string_lossy().to_lowercase();
    text.contains("\\windows\\") || text.contains("\\program files")
}

/// canonicalize() on Windows returns a `\\?\C:\...` path: compare and hand it on without that
/// prefix, or no file ever starts with the plain profile path and Word cannot open it.
fn canonical(path: &Path) -> Option<PathBuf> {
    let full = path.canonicalize().ok()?;
    let plain = full.to_string_lossy().strip_prefix(r"\\?\").filter(|rest| !rest.starts_with("UNC\\")).map(PathBuf::from);
    Some(plain.unwrap_or(full))
}

fn allowed_file(path: &Path, extensions: &[&str]) -> Result<PathBuf, String> {
    let canonical_path = canonical(path).ok_or("Could not open this file.")?;
    if !canonical_path.is_file() || system_path(&canonical_path) { return Err("Could not open this file.".into()); }
    let ext = extension(&canonical_path);
    if !extensions.contains(&ext.as_str()) { return Err("This file type cannot be opened from here.".into()); }
    let profile = canonical(&user_profile()?).ok_or("This computer has no user folder.")?;
    if !canonical_path.starts_with(&profile) { return Err("That file is outside this user account.".into()); }
    Ok(canonical_path)
}

fn search_roots() -> Vec<PathBuf> {
    let Ok(profile) = user_profile() else { return Vec::new() };
    let mut roots = Vec::new();
    for name in ["Desktop", "Documents", "Pictures", "Downloads"] {
        roots.push(profile.join(name));
        roots.push(profile.join("OneDrive").join(name));
    }
    roots.into_iter().filter(|path| path.is_dir()).collect()
}

fn walk(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
    if depth == 0 || out.len() >= 4000 { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name == "node_modules" || name == "appdata" { continue; }
        if path.is_dir() { walk(&path, depth - 1, out); }
        else if IMAGE_EXT.contains(&extension(&path).as_str()) { out.push(path); }
    }
}

pub fn find_letterhead(query: &str) -> Result<Value, String> {
    let mut found = Vec::new();
    for root in search_roots() { walk(&root, 4, &mut found); }
    let mut matches: Vec<PathBuf> = found.into_iter().filter(|path| name_matches(&path.file_name().unwrap_or_default().to_string_lossy(), query)).collect();
    matches.sort_by_key(|path| path.components().count());
    if matches.is_empty() {
        return Err(format!("No image named like \"{}\" was found in Desktop, Documents, Pictures or Downloads.", if query.trim().is_empty() { "letterhead" } else { query.trim() }));
    }
    let chosen = matches[0].to_string_lossy().to_string();
    let others: Vec<String> = matches.iter().skip(1).take(7).map(|path| path.to_string_lossy().to_string()).collect();
    Ok(json!({ "path": chosen, "name": matches[0].file_name().unwrap_or_default().to_string_lossy(), "others": others }))
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn shell_open(path: &Path) -> Result<(), String> {
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(hwnd: isize, operation: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
    }
    let operation = wide("open");
    let file = wide(&path.to_string_lossy());
    // SAFETY: the wide strings outlive the call and are null-terminated.
    let result = unsafe { ShellExecuteW(0, operation.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
    if result > 32 { Ok(()) } else { Err("Could not open this file.".into()) }
}

#[cfg(not(windows))]
fn shell_open(_path: &Path) -> Result<(), String> { Err("Opening this file requires the Windows desktop app.".into()) }

#[tauri::command]
pub fn open_user_document(path: String) -> Result<(), String> {
    let file = allowed_file(Path::new(&path), OPEN_EXT)?;
    shell_open(&file)
}

/// A saved document's bytes, so Filey opens it in its own Office work rather than in
/// whatever program Windows has registered for the extension (WPS Office, here).
#[tauri::command]
pub fn read_user_document(path: String) -> Result<tauri::ipc::Response, String> {
    let file = allowed_file(Path::new(&path), OPEN_EXT)?;
    std::fs::read(&file).map(tauri::ipc::Response::new).map_err(|_| "Could not open this file.".into())
}

/// The letterhead/signature/stamp image from the user's folders, for Filey's own Word to insert.
/// `kind` defaults to "letterhead"; `query` defaults to the kind name.
#[tauri::command]
pub async fn office_image(kind: Option<String>, query: Option<String>) -> Result<Value, String> {
   use base64::Engine;
   tauri::async_runtime::spawn_blocking(move || {
       let kind = kind.as_deref().unwrap_or("letterhead");
       let default_query = match kind {
           "signature" => "signature",
           "stamp" => "stamp",
           _ => "letterhead",
       };
       let found = find_letterhead(query.as_deref().unwrap_or(default_query))?;
       let path = found["path"].as_str().ok_or("No image was found.")?;
       let bytes = std::fs::read(allowed_file(Path::new(path), IMAGE_EXT)?).map_err(|_| "Could not read the image.".to_string())?;
       if bytes.len() > 8 * 1024 * 1024 {
           return Err("The image is over 8 MB. Save a smaller copy and try again.".into());
       }
       Ok(json!({ "name": found["name"], "kind": kind, "data": base64::engine::general_purpose::STANDARD.encode(bytes), "others": found["others"] }))
   })
   .await
   .map_err(|error| error.to_string())?
}

/// The letterhead image from the user's folders, for Filey's own Word to insert. Driving
/// Microsoft Word over COM opened WPS Office instead wherever WPS owns that COM name.
#[tauri::command]
pub async fn letterhead_image(query: Option<String>) -> Result<Value, String> {
   office_image(Some("letterhead".to_string()), query).await
}

#[cfg(test)]
mod tests {
    use super::name_matches;

    #[test]
    fn matches_a_named_letterhead_and_ignores_other_files() {
        assert!(name_matches("Dune Letterhead.png", "dune letterhead"));
        assert!(name_matches("company-letterhead.jpg", ""));
        assert!(!name_matches("Visa Cancellation.docx", "letterhead"));
        assert!(!name_matches("dune-logo.png", "dune letterhead"));
    }

    #[cfg(windows)]
    #[test]
    fn accepts_a_file_inside_the_user_folder() {
        // The temp folder sits under the user profile on Windows.
        let file = std::env::temp_dir().join(format!("filey-word-{}.docx", std::process::id()));
        std::fs::write(&file, b"x").unwrap();
        let allowed = super::allowed_file(&file, &["docx"]);
        let _ = std::fs::remove_file(&file);
        assert!(!allowed.unwrap().to_string_lossy().starts_with(r"\\?\"));
    }
}
