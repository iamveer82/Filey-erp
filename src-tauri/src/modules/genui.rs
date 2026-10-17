//! Origin for Filey AI's interactive cards (the `show_ui` agent tool). The app's
//! CSP allows no inline script, and sandboxed srcdoc/data:/blob: frames inherit
//! it, so card code needs a document of its own: `fileyui://localhost` (served
//! as http://fileyui.localhost on Windows) answers every request with one
//! bootstrap page under its own policy. Cards are framed without
//! allow-same-origin, load code only from public library CDNs and pictures only
//! from Wikimedia (attributed photos) or as embedded data; no fetches, so a card
//! can't carry data anywhere.

use std::borrow::Cow;
use tauri::http::{header, Response};

const PAGE: &str = include_str!("genui.html");
const CSP: &str = "default-src 'none'; \
    script-src 'unsafe-inline' 'unsafe-eval' https://esm.sh https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; \
    style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com; \
    font-src data: https://fonts.gstatic.com; \
    img-src data: blob: https://upload.wikimedia.org https://thumb.wikimedia.org; media-src data: blob:; \
    worker-src blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

pub fn page() -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header("Content-Security-Policy", CSP)
        .body(Cow::Borrowed(PAGE.as_bytes()))
        .expect("static response")
}
