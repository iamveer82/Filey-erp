use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct InvoiceItem {
    pub id: i64,
    pub description: String,
    pub qty: f64,
    pub unit_price: f64,
}

#[derive(Deserialize)]
pub struct ItemInput {
    pub description: String,
    pub qty: f64,
    pub unit_price: f64,
}

#[derive(Serialize)]
pub struct InvoiceDoc {
    pub id: i64,
    pub number: String,
    pub status: String,
    pub template: String,
    pub accent: String,
    pub currency: String,
    pub seller_name: String,
    pub seller_address: Option<String>,
    pub seller_trn: Option<String>,
    pub seller_email: Option<String>,
    pub seller_phone: Option<String>,
    pub logo: Option<String>,
    pub customer_name: String,
    pub customer_address: Option<String>,
    pub customer_trn: Option<String>,
    pub customer_email: Option<String>,
    pub issue_date: Option<String>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub terms: Option<String>,
    pub tax_rate: f64,
    pub discount: f64,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<InvoiceItem>,
}

#[derive(Serialize)]
pub struct InvoiceDocSummary {
    pub id: i64,
    pub number: String,
    pub customer_name: String,
    pub status: String,
    pub template: String,
    pub total: f64,
    pub issue_date: Option<String>,
    pub updated_at: String,
}

#[derive(Deserialize)]
pub struct InvoiceDocInput {
    pub id: Option<i64>,
    pub number: String,
    pub status: String,
    pub template: String,
    pub accent: String,
    pub currency: String,
    pub seller_name: String,
    pub seller_address: Option<String>,
    pub seller_trn: Option<String>,
    pub seller_email: Option<String>,
    pub seller_phone: Option<String>,
    pub logo: Option<String>,
    pub customer_name: String,
    pub customer_address: Option<String>,
    pub customer_trn: Option<String>,
    pub customer_email: Option<String>,
    pub issue_date: Option<String>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub terms: Option<String>,
    pub tax_rate: f64,
    pub discount: f64,
    pub items: Vec<ItemInput>,
}

#[derive(Serialize, Deserialize)]
pub struct CompanyProfile {
    pub name: String,
    pub address: Option<String>,
    pub trn: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub logo: Option<String>,
    pub default_accent: String,
    pub default_template: String,
}

fn read_doc_row(r: &rusqlite::Row) -> rusqlite::Result<InvoiceDoc> {
    Ok(InvoiceDoc {
        id: r.get(0)?,
        number: r.get(1)?,
        status: r.get(2)?,
        template: r.get(3)?,
        accent: r.get(4)?,
        currency: r.get(5)?,
        seller_name: r.get(6)?,
        seller_address: r.get(7)?,
        seller_trn: r.get(8)?,
        seller_email: r.get(9)?,
        seller_phone: r.get(10)?,
        logo: r.get(11)?,
        customer_name: r.get(12)?,
        customer_address: r.get(13)?,
        customer_trn: r.get(14)?,
        customer_email: r.get(15)?,
        issue_date: r.get(16)?,
        due_date: r.get(17)?,
        notes: r.get(18)?,
        terms: r.get(19)?,
        tax_rate: r.get(20)?,
        discount: r.get(21)?,
        created_at: r.get(22)?,
        updated_at: r.get(23)?,
        items: Vec::new(),
    })
}

const DOC_COLS: &str = "id, number, status, template, accent, currency,
    seller_name, seller_address, seller_trn, seller_email, seller_phone, logo,
    customer_name, customer_address, customer_trn, customer_email,
    issue_date, due_date, notes, terms, tax_rate, discount, created_at, updated_at";

#[tauri::command]
pub fn billing_list_docs(db: State<Db>) -> AppResult<Vec<InvoiceDocSummary>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT d.id, d.number, d.customer_name, d.status, d.template,
            ( (COALESCE((SELECT SUM(qty * unit_price) FROM invoice_doc_items WHERE invoice_id = d.id), 0) - d.discount)
              * (1 + d.tax_rate / 100.0) ) AS total,
            d.issue_date, d.updated_at
         FROM invoice_docs d
         ORDER BY d.updated_at DESC, d.id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(InvoiceDocSummary {
                id: r.get(0)?,
                number: r.get(1)?,
                customer_name: r.get(2)?,
                status: r.get(3)?,
                template: r.get(4)?,
                total: r.get(5)?,
                issue_date: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn billing_get_doc(db: State<Db>, doc_id: i64) -> AppResult<InvoiceDoc> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut doc = conn
        .query_row(
            &format!("SELECT {DOC_COLS} FROM invoice_docs WHERE id = ?1"),
            [doc_id],
            read_doc_row,
        )
        .map_err(|_| AppError::NotFound(format!("invoice {doc_id}")))?;

    let mut stmt = conn.prepare(
        "SELECT id, description, qty, unit_price FROM invoice_doc_items
         WHERE invoice_id = ?1 ORDER BY position, id",
    )?;
    let items = stmt
        .query_map([doc_id], |r| {
            Ok(InvoiceItem {
                id: r.get(0)?,
                description: r.get(1)?,
                qty: r.get(2)?,
                unit_price: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    doc.items = items;
    Ok(doc)
}

#[tauri::command]
pub fn billing_save_doc(db: State<Db>, input: InvoiceDocInput) -> AppResult<i64> {
    if input.number.trim().is_empty() {
        return Err(AppError::Validation("Invoice number is required".into()));
    }
    if input.customer_name.trim().is_empty() {
        return Err(AppError::Validation("Customer name is required".into()));
    }
    let mut guard = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let tx = guard.transaction()?;

    let id = match input.id.filter(|v| *v > 0) {
        Some(did) => {
            let changed = tx.execute(
                "UPDATE invoice_docs SET
                    number=?2, status=?3, template=?4, accent=?5, currency=?6,
                    seller_name=?7, seller_address=?8, seller_trn=?9, seller_email=?10, seller_phone=?11, logo=?12,
                    customer_name=?13, customer_address=?14, customer_trn=?15, customer_email=?16,
                    issue_date=?17, due_date=?18, notes=?19, terms=?20, tax_rate=?21, discount=?22,
                    updated_at=datetime('now')
                 WHERE id=?1",
                rusqlite::params![
                    did, input.number, input.status, input.template, input.accent, input.currency,
                    input.seller_name, input.seller_address, input.seller_trn, input.seller_email, input.seller_phone, input.logo,
                    input.customer_name, input.customer_address, input.customer_trn, input.customer_email,
                    input.issue_date, input.due_date, input.notes, input.terms, input.tax_rate, input.discount
                ],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("invoice {did}")));
            }
            tx.execute("DELETE FROM invoice_doc_items WHERE invoice_id=?1", [did])?;
            did
        }
        None => {
            tx.execute(
                "INSERT INTO invoice_docs
                    (number, status, template, accent, currency,
                     seller_name, seller_address, seller_trn, seller_email, seller_phone, logo,
                     customer_name, customer_address, customer_trn, customer_email,
                     issue_date, due_date, notes, terms, tax_rate, discount)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
                rusqlite::params![
                    input.number, input.status, input.template, input.accent, input.currency,
                    input.seller_name, input.seller_address, input.seller_trn, input.seller_email, input.seller_phone, input.logo,
                    input.customer_name, input.customer_address, input.customer_trn, input.customer_email,
                    input.issue_date, input.due_date, input.notes, input.terms, input.tax_rate, input.discount
                ],
            )?;
            tx.last_insert_rowid()
        }
    };

    for (i, it) in input.items.iter().enumerate() {
        tx.execute(
            "INSERT INTO invoice_doc_items (invoice_id, description, qty, unit_price, position)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, it.description, it.qty, it.unit_price, i as i64],
        )?;
    }

    tx.commit()?;
    Ok(id)
}

#[tauri::command]
pub fn billing_delete_doc(db: State<Db>, doc_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM invoice_docs WHERE id = ?1", [doc_id])?;
    Ok(())
}

#[tauri::command]
pub fn billing_set_status(db: State<Db>, doc_id: i64, status: String) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE invoice_docs SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![status, doc_id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("invoice {doc_id}")));
    }
    Ok(())
}

#[tauri::command]
pub fn billing_get_company(db: State<Db>) -> AppResult<CompanyProfile> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let found = conn.query_row(
        "SELECT name, address, trn, email, phone, logo, default_accent, default_template
         FROM company_profile WHERE id = 1",
        [],
        |r| {
            Ok(CompanyProfile {
                name: r.get(0)?,
                address: r.get(1)?,
                trn: r.get(2)?,
                email: r.get(3)?,
                phone: r.get(4)?,
                logo: r.get(5)?,
                default_accent: r.get(6)?,
                default_template: r.get(7)?,
            })
        },
    );
    match found {
        Ok(c) => Ok(c),
        Err(_) => {
            let def = CompanyProfile {
                name: "Filey ERP FZ-LLC".into(),
                address: Some("Dubai, United Arab Emirates".into()),
                trn: Some("100123456700003".into()),
                email: Some("billing@filey.io".into()),
                phone: Some("+971 4 000 0000".into()),
                logo: None,
                default_accent: "#0A0A0A".into(),
                default_template: "minimal".into(),
            };
            conn.execute(
                "INSERT OR REPLACE INTO company_profile
                    (id, name, address, trn, email, phone, logo, default_accent, default_template)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    def.name, def.address, def.trn, def.email, def.phone,
                    def.logo, def.default_accent, def.default_template
                ],
            )?;
            Ok(def)
        }
    }
}

#[tauri::command]
pub fn billing_save_company(db: State<Db>, input: CompanyProfile) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("Company name is required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT OR REPLACE INTO company_profile
            (id, name, address, trn, email, phone, logo, default_accent, default_template)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            input.name, input.address, input.trn, input.email, input.phone,
            input.logo, input.default_accent, input.default_template
        ],
    )?;
    Ok(())
}
