use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct Account {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub account_type: String,
    pub balance: f64,
}

#[derive(Deserialize)]
pub struct AccountInput {
    pub code: String,
    pub name: String,
    pub account_type: String,
    pub balance: f64,
}

#[derive(Serialize)]
pub struct Expense {
    pub id: i64,
    pub category: String,
    pub description: Option<String>,
    pub amount: f64,
    pub expense_date: String,
    pub account_id: Option<i64>,
}

#[derive(Serialize)]
pub struct Txn {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub txn_type: String,
    pub amount: f64,
    pub description: Option<String>,
    pub txn_date: String,
}

#[derive(Serialize)]
pub struct FinanceReport {
    pub total_assets: f64,
    pub total_liabilities: f64,
    pub total_equity: f64,
    pub total_revenue: f64,
    pub total_expenses: f64,
    pub net_profit: f64,
    pub cash_position: f64,
}

#[tauri::command]
pub fn fin_list_accounts(db: State<Db>) -> AppResult<Vec<Account>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT id, code, name, account_type, balance FROM accounts ORDER BY code")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Account {
                id: r.get(0)?,
                code: r.get(1)?,
                name: r.get(2)?,
                account_type: r.get(3)?,
                balance: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn fin_create_account(db: State<Db>, input: AccountInput) -> AppResult<i64> {
    if input.code.trim().is_empty() || input.name.trim().is_empty() {
        return Err(AppError::Validation("Code and name are required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO accounts (code, name, account_type, balance) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![input.code, input.name, input.account_type, input.balance],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn fin_list_expenses(db: State<Db>) -> AppResult<Vec<Expense>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, category, description, amount, expense_date, account_id
         FROM expenses ORDER BY expense_date DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Expense {
                id: r.get(0)?,
                category: r.get(1)?,
                description: r.get(2)?,
                amount: r.get(3)?,
                expense_date: r.get(4)?,
                account_id: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn fin_create_expense(
    db: State<Db>,
    category: String,
    description: Option<String>,
    amount: f64,
    expense_date: String,
    account_id: Option<i64>,
) -> AppResult<i64> {
    if amount <= 0.0 {
        return Err(AppError::Validation("Amount must be positive".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO expenses (category, description, amount, expense_date, account_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![category, description, amount, expense_date, account_id],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn fin_delete_expense(db: State<Db>, expense_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM expenses WHERE id = ?1", [expense_id])?;
    Ok(())
}

#[tauri::command]
pub fn fin_list_transactions(db: State<Db>) -> AppResult<Vec<Txn>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.account_id, a.name, t.txn_type, t.amount, t.description, t.txn_date
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         ORDER BY t.txn_date DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Txn {
                id: r.get(0)?,
                account_id: r.get(1)?,
                account_name: r.get(2)?,
                txn_type: r.get(3)?,
                amount: r.get(4)?,
                description: r.get(5)?,
                txn_date: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn fin_post_transaction(
    db: State<Db>,
    account_id: i64,
    txn_type: String,
    amount: f64,
    description: Option<String>,
) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO transactions (account_id, txn_type, amount, description)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![account_id, txn_type, amount, description],
    )?;
    let signed = if txn_type == "debit" { -amount } else { amount };
    conn.execute(
        "UPDATE accounts SET balance = balance + ?1 WHERE id = ?2",
        rusqlite::params![signed, account_id],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn fin_report(db: State<Db>) -> AppResult<FinanceReport> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let sum_type = |t: &str| -> rusqlite::Result<f64> {
        conn.query_row(
            "SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE account_type = ?1",
            [t],
            |r| r.get(0),
        )
    };
    let total_assets = sum_type("asset")?;
    let total_liabilities = sum_type("liability")?;
    let total_equity = sum_type("equity")?;
    let total_revenue = sum_type("revenue")?;
    let total_expenses: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM expenses",
        [],
        |r| r.get(0),
    )?;
    let cash_position: f64 = conn.query_row(
        "SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE code IN ('1000','1100')",
        [],
        |r| r.get(0),
    )?;
    Ok(FinanceReport {
        total_assets,
        total_liabilities,
        total_equity,
        total_revenue,
        total_expenses,
        net_profit: total_revenue - total_expenses,
        cash_position,
    })
}
