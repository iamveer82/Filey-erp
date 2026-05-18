use crate::error::{AppError, AppResult};
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct EmailConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_name: String,
    pub from_email: String,
}

#[derive(Deserialize)]
pub struct EmailMessage {
    pub to: String,
    pub subject: String,
    pub html: String,
}

/// Send a single HTML email over SMTP (Gmail: smtp.gmail.com:587 with
/// an App Password). Runs in the desktop shell only.
#[tauri::command]
pub fn send_email(config: EmailConfig, message: EmailMessage) -> AppResult<()> {
    let from = format!("{} <{}>", config.from_name, config.from_email);
    let email = Message::builder()
        .from(
            from.parse()
                .map_err(|e| AppError::Email(format!("invalid from: {e}")))?,
        )
        .to(message
            .to
            .parse()
            .map_err(|e| AppError::Email(format!("invalid recipient: {e}")))?)
        .subject(message.subject)
        .header(ContentType::TEXT_HTML)
        .body(message.html)
        .map_err(|e| AppError::Email(e.to_string()))?;

    let creds = Credentials::new(config.username.clone(), config.password.clone());

    let mailer = SmtpTransport::starttls_relay(&config.host)
        .map_err(|e| AppError::Email(e.to_string()))?
        .port(config.port)
        .credentials(creds)
        .build();

    mailer
        .send(&email)
        .map_err(|e| AppError::Email(e.to_string()))?;
    Ok(())
}
