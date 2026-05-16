use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct Employee {
    pub id: i64,
    pub employee_code: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub department: Option<String>,
    pub position: Option<String>,
    pub salary: f64,
    pub hire_date: Option<String>,
    pub status: String,
}

#[derive(Deserialize)]
pub struct EmployeeInput {
    pub employee_code: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub department: Option<String>,
    pub position: Option<String>,
    pub salary: f64,
    pub hire_date: Option<String>,
}

#[derive(Serialize)]
pub struct Attendance {
    pub id: i64,
    pub employee_id: i64,
    pub employee_name: String,
    pub date: String,
    pub check_in: Option<String>,
    pub check_out: Option<String>,
    pub status: String,
}

#[derive(Serialize)]
pub struct Payroll {
    pub id: i64,
    pub employee_id: i64,
    pub employee_name: String,
    pub period: String,
    pub basic: f64,
    pub allowances: f64,
    pub deductions: f64,
    pub net_pay: f64,
    pub status: String,
}

#[derive(Serialize)]
pub struct HrSummary {
    pub headcount: i64,
    pub present_today: i64,
    pub on_leave: i64,
    pub monthly_payroll: f64,
}

#[tauri::command]
pub fn hr_list_employees(db: State<Db>) -> AppResult<Vec<Employee>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, employee_code, name, email, phone, department, position, salary, hire_date, status
         FROM employees ORDER BY name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Employee {
                id: r.get(0)?,
                employee_code: r.get(1)?,
                name: r.get(2)?,
                email: r.get(3)?,
                phone: r.get(4)?,
                department: r.get(5)?,
                position: r.get(6)?,
                salary: r.get(7)?,
                hire_date: r.get(8)?,
                status: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn hr_create_employee(db: State<Db>, input: EmployeeInput) -> AppResult<i64> {
    if input.employee_code.trim().is_empty() || input.name.trim().is_empty() {
        return Err(AppError::Validation("Code and name are required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO employees (employee_code, name, email, phone, department, position, salary, hire_date, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active')",
        rusqlite::params![
            input.employee_code, input.name, input.email, input.phone,
            input.department, input.position, input.salary, input.hire_date
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn hr_set_employee_status(db: State<Db>, employee_id: i64, status: String) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "UPDATE employees SET status = ?1 WHERE id = ?2",
        rusqlite::params![status, employee_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn hr_delete_employee(db: State<Db>, employee_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM employees WHERE id = ?1", [employee_id])?;
    Ok(())
}

#[tauri::command]
pub fn hr_list_attendance(db: State<Db>) -> AppResult<Vec<Attendance>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT a.id, a.employee_id, e.name, a.date, a.check_in, a.check_out, a.status
         FROM attendance a JOIN employees e ON e.id = a.employee_id
         ORDER BY a.date DESC, e.name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Attendance {
                id: r.get(0)?,
                employee_id: r.get(1)?,
                employee_name: r.get(2)?,
                date: r.get(3)?,
                check_in: r.get(4)?,
                check_out: r.get(5)?,
                status: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn hr_mark_attendance(
    db: State<Db>,
    employee_id: i64,
    date: String,
    status: String,
    check_in: Option<String>,
    check_out: Option<String>,
) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO attendance (employee_id, date, check_in, check_out, status)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![employee_id, date, check_in, check_out, status],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn hr_list_payroll(db: State<Db>) -> AppResult<Vec<Payroll>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.employee_id, e.name, p.period, p.basic, p.allowances, p.deductions, p.net_pay, p.status
         FROM payroll p JOIN employees e ON e.id = p.employee_id
         ORDER BY p.period DESC, e.name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Payroll {
                id: r.get(0)?,
                employee_id: r.get(1)?,
                employee_name: r.get(2)?,
                period: r.get(3)?,
                basic: r.get(4)?,
                allowances: r.get(5)?,
                deductions: r.get(6)?,
                net_pay: r.get(7)?,
                status: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn hr_run_payroll(
    db: State<Db>,
    employee_id: i64,
    period: String,
    basic: f64,
    allowances: f64,
    deductions: f64,
) -> AppResult<i64> {
    let net = basic + allowances - deductions;
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO payroll (employee_id, period, basic, allowances, deductions, net_pay, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')",
        rusqlite::params![employee_id, period, basic, allowances, deductions, net],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn hr_mark_payroll_paid(db: State<Db>, payroll_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "UPDATE payroll SET status = 'paid' WHERE id = ?1",
        [payroll_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn hr_summary(db: State<Db>) -> AppResult<HrSummary> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let headcount: i64 = conn.query_row(
        "SELECT COUNT(*) FROM employees WHERE status = 'active'",
        [],
        |r| r.get(0),
    )?;
    let present_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM attendance WHERE date = date('now') AND status = 'present'",
        [],
        |r| r.get(0),
    )?;
    let on_leave: i64 = conn.query_row(
        "SELECT COUNT(*) FROM attendance WHERE date = date('now') AND status = 'leave'",
        [],
        |r| r.get(0),
    )?;
    let monthly_payroll: f64 = conn.query_row(
        "SELECT COALESCE(SUM(salary), 0) FROM employees WHERE status = 'active'",
        [],
        |r| r.get(0),
    )?;
    Ok(HrSummary {
        headcount,
        present_today,
        on_leave,
        monthly_payroll,
    })
}
