use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::State;

// ===== Leads =====
#[derive(Serialize)]
pub struct Lead {
    pub id: i64,
    pub name: String,
    pub company: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub source: Option<String>,
    pub status: String,
    pub est_value: f64,
    pub owner: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct LeadInput {
    pub name: String,
    pub company: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub source: Option<String>,
    pub est_value: f64,
    pub owner: Option<String>,
}

// ===== Customers =====
#[derive(Serialize)]
pub struct Customer {
    pub id: i64,
    pub name: String,
    pub company: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub segment: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct CustomerInput {
    pub name: String,
    pub company: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub segment: Option<String>,
}

// ===== Opportunities (pipeline) =====
#[derive(Serialize)]
pub struct Opportunity {
    pub id: i64,
    pub title: String,
    pub customer_name: String,
    pub stage: String,
    pub value: f64,
    pub probability: i64,
    pub owner: Option<String>,
    pub expected_close: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct OpportunityInput {
    pub title: String,
    pub customer_name: String,
    pub stage: String,
    pub value: f64,
    pub probability: i64,
    pub owner: Option<String>,
    pub expected_close: Option<String>,
}

// ===== Activities =====
#[derive(Serialize)]
pub struct Activity {
    pub id: i64,
    pub kind: String,
    pub subject: String,
    pub related_to: Option<String>,
    pub due_date: Option<String>,
    pub done: bool,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct ActivityInput {
    pub kind: String,
    pub subject: String,
    pub related_to: Option<String>,
    pub due_date: Option<String>,
}

#[derive(Serialize)]
pub struct CrmSummary {
    pub open_leads: i64,
    pub pipeline_value: f64,
    pub won_value: f64,
    pub conversion_rate: f64,
    pub activities_due: i64,
}

// ---------- Leads ----------
#[tauri::command]
pub fn crm_list_leads(db: State<Db>) -> AppResult<Vec<Lead>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, company, email, phone, source, status, est_value, owner, created_at
         FROM crm_leads ORDER BY id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Lead {
                id: r.get(0)?,
                name: r.get(1)?,
                company: r.get(2)?,
                email: r.get(3)?,
                phone: r.get(4)?,
                source: r.get(5)?,
                status: r.get(6)?,
                est_value: r.get(7)?,
                owner: r.get(8)?,
                created_at: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn crm_create_lead(db: State<Db>, input: LeadInput) -> AppResult<i64> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("Lead name is required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO crm_leads (name, company, email, phone, source, status, est_value, owner)
         VALUES (?1, ?2, ?3, ?4, ?5, 'new', ?6, ?7)",
        rusqlite::params![
            input.name,
            input.company,
            input.email,
            input.phone,
            input.source,
            input.est_value,
            input.owner
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn crm_set_lead_status(db: State<Db>, lead_id: i64, status: String) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE crm_leads SET status = ?1 WHERE id = ?2",
        rusqlite::params![status, lead_id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("lead {lead_id}")));
    }
    Ok(())
}

#[tauri::command]
pub fn crm_delete_lead(db: State<Db>, lead_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM crm_leads WHERE id = ?1", [lead_id])?;
    Ok(())
}

/// Convert a lead into a customer + an opportunity, mark the lead as converted.
#[tauri::command]
pub fn crm_convert_lead(db: State<Db>, lead_id: i64) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let (name, company, email, phone, est_value, owner): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        f64,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT name, company, email, phone, est_value, owner FROM crm_leads WHERE id = ?1",
            [lead_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|_| AppError::NotFound(format!("lead {lead_id}")))?;

    let display = company.clone().unwrap_or_else(|| name.clone());
    conn.execute(
        "INSERT INTO crm_customers (name, company, email, phone, segment)
         VALUES (?1, ?2, ?3, ?4, 'Converted lead')",
        rusqlite::params![name, company, email, phone],
    )?;
    conn.execute(
        "INSERT INTO crm_opportunities
         (title, customer_name, stage, value, probability, owner)
         VALUES (?1, ?2, 'qualification', ?3, 20, ?4)",
        rusqlite::params![
            format!("{display} — new opportunity"),
            display,
            est_value,
            owner
        ],
    )?;
    let opp_id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE crm_leads SET status = 'converted' WHERE id = ?1",
        [lead_id],
    )?;
    Ok(opp_id)
}

// ---------- Customers ----------
#[tauri::command]
pub fn crm_list_customers(db: State<Db>) -> AppResult<Vec<Customer>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, company, email, phone, address, segment, created_at
         FROM crm_customers ORDER BY name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Customer {
                id: r.get(0)?,
                name: r.get(1)?,
                company: r.get(2)?,
                email: r.get(3)?,
                phone: r.get(4)?,
                address: r.get(5)?,
                segment: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn crm_create_customer(db: State<Db>, input: CustomerInput) -> AppResult<i64> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("Customer name is required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO crm_customers (name, company, email, phone, address, segment)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            input.name,
            input.company,
            input.email,
            input.phone,
            input.address,
            input.segment
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn crm_delete_customer(db: State<Db>, customer_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM crm_customers WHERE id = ?1", [customer_id])?;
    Ok(())
}

// ---------- Opportunities ----------
#[tauri::command]
pub fn crm_list_opportunities(db: State<Db>) -> AppResult<Vec<Opportunity>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, title, customer_name, stage, value, probability, owner, expected_close, created_at
         FROM crm_opportunities ORDER BY id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Opportunity {
                id: r.get(0)?,
                title: r.get(1)?,
                customer_name: r.get(2)?,
                stage: r.get(3)?,
                value: r.get(4)?,
                probability: r.get(5)?,
                owner: r.get(6)?,
                expected_close: r.get(7)?,
                created_at: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn crm_create_opportunity(db: State<Db>, input: OpportunityInput) -> AppResult<i64> {
    if input.title.trim().is_empty() {
        return Err(AppError::Validation("Opportunity title is required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO crm_opportunities
         (title, customer_name, stage, value, probability, owner, expected_close)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            input.title,
            input.customer_name,
            input.stage,
            input.value,
            input.probability,
            input.owner,
            input.expected_close
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn crm_set_opp_stage(db: State<Db>, opp_id: i64, stage: String) -> AppResult<()> {
    let prob = match stage.as_str() {
        "qualification" => 20,
        "proposal" => 45,
        "negotiation" => 70,
        "won" => 100,
        "lost" => 0,
        _ => 30,
    };
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE crm_opportunities SET stage = ?1, probability = ?2 WHERE id = ?3",
        rusqlite::params![stage, prob, opp_id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("opportunity {opp_id}")));
    }
    Ok(())
}

#[tauri::command]
pub fn crm_delete_opportunity(db: State<Db>, opp_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM crm_opportunities WHERE id = ?1", [opp_id])?;
    Ok(())
}

// ---------- Activities ----------
#[tauri::command]
pub fn crm_list_activities(db: State<Db>) -> AppResult<Vec<Activity>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, kind, subject, related_to, due_date, done, created_at
         FROM crm_activities ORDER BY done ASC, due_date ASC, id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let done: i64 = r.get(5)?;
            Ok(Activity {
                id: r.get(0)?,
                kind: r.get(1)?,
                subject: r.get(2)?,
                related_to: r.get(3)?,
                due_date: r.get(4)?,
                done: done != 0,
                created_at: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn crm_create_activity(db: State<Db>, input: ActivityInput) -> AppResult<i64> {
    if input.subject.trim().is_empty() {
        return Err(AppError::Validation("Activity subject is required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO crm_activities (kind, subject, related_to, due_date, done)
         VALUES (?1, ?2, ?3, ?4, 0)",
        rusqlite::params![input.kind, input.subject, input.related_to, input.due_date],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn crm_toggle_activity(db: State<Db>, activity_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE crm_activities SET done = 1 - done WHERE id = ?1",
        [activity_id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("activity {activity_id}")));
    }
    Ok(())
}

#[tauri::command]
pub fn crm_summary(db: State<Db>) -> AppResult<CrmSummary> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let open_leads: i64 = conn.query_row(
        "SELECT COUNT(*) FROM crm_leads WHERE status NOT IN ('converted','lost')",
        [],
        |r| r.get(0),
    )?;
    let pipeline_value: f64 = conn.query_row(
        "SELECT COALESCE(SUM(value), 0) FROM crm_opportunities WHERE stage NOT IN ('won','lost')",
        [],
        |r| r.get(0),
    )?;
    let won_value: f64 = conn.query_row(
        "SELECT COALESCE(SUM(value), 0) FROM crm_opportunities WHERE stage = 'won'",
        [],
        |r| r.get(0),
    )?;
    let total_leads: i64 = conn.query_row("SELECT COUNT(*) FROM crm_leads", [], |r| r.get(0))?;
    let converted: i64 = conn.query_row(
        "SELECT COUNT(*) FROM crm_leads WHERE status = 'converted'",
        [],
        |r| r.get(0),
    )?;
    let conversion_rate = if total_leads > 0 {
        (converted as f64 / total_leads as f64) * 100.0
    } else {
        0.0
    };
    let activities_due: i64 = conn.query_row(
        "SELECT COUNT(*) FROM crm_activities WHERE done = 0",
        [],
        |r| r.get(0),
    )?;
    Ok(CrmSummary {
        open_leads,
        pipeline_value,
        won_value,
        conversion_rate,
        activities_due,
    })
}
