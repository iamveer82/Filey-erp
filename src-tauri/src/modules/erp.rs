use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct Product {
    pub id: i64,
    pub sku: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub unit_price: f64,
    pub cost_price: f64,
    pub quantity: i64,
    pub reorder_level: i64,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct ProductInput {
    pub sku: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub unit_price: f64,
    pub cost_price: f64,
    pub quantity: i64,
    pub reorder_level: i64,
}

#[derive(Serialize)]
pub struct Order {
    pub id: i64,
    pub order_number: String,
    pub customer_name: String,
    pub status: String,
    pub total: f64,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct Invoice {
    pub id: i64,
    pub invoice_number: String,
    pub customer_name: String,
    pub amount: f64,
    pub status: String,
    pub due_date: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct ErpSummary {
    pub total_products: i64,
    pub low_stock: i64,
    pub inventory_value: f64,
    pub open_orders: i64,
    pub unpaid_invoices: f64,
}

#[tauri::command]
pub fn erp_list_products(db: State<Db>) -> AppResult<Vec<Product>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, sku, name, description, category, unit_price, cost_price, quantity, reorder_level, created_at
         FROM products ORDER BY name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Product {
                id: r.get(0)?,
                sku: r.get(1)?,
                name: r.get(2)?,
                description: r.get(3)?,
                category: r.get(4)?,
                unit_price: r.get(5)?,
                cost_price: r.get(6)?,
                quantity: r.get(7)?,
                reorder_level: r.get(8)?,
                created_at: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn erp_create_product(db: State<Db>, input: ProductInput) -> AppResult<i64> {
    if input.sku.trim().is_empty() || input.name.trim().is_empty() {
        return Err(AppError::Validation("SKU and name are required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO products (sku, name, description, category, unit_price, cost_price, quantity, reorder_level)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            input.sku, input.name, input.description, input.category,
            input.unit_price, input.cost_price, input.quantity, input.reorder_level
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn erp_update_stock(db: State<Db>, product_id: i64, delta: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE products SET quantity = quantity + ?1 WHERE id = ?2",
        rusqlite::params![delta, product_id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("product {product_id}")));
    }
    Ok(())
}

#[tauri::command]
pub fn erp_delete_product(db: State<Db>, product_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM products WHERE id = ?1", [product_id])?;
    Ok(())
}

#[tauri::command]
pub fn erp_list_orders(db: State<Db>) -> AppResult<Vec<Order>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, order_number, customer_name, status, total, created_at FROM orders ORDER BY id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Order {
                id: r.get(0)?,
                order_number: r.get(1)?,
                customer_name: r.get(2)?,
                status: r.get(3)?,
                total: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn erp_create_order(
    db: State<Db>,
    order_number: String,
    customer_name: String,
    total: f64,
) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO orders (order_number, customer_name, status, total) VALUES (?1, ?2, 'draft', ?3)",
        rusqlite::params![order_number, customer_name, total],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn erp_set_order_status(db: State<Db>, order_id: i64, status: String) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "UPDATE orders SET status = ?1 WHERE id = ?2",
        rusqlite::params![status, order_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn erp_list_invoices(db: State<Db>) -> AppResult<Vec<Invoice>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, invoice_number, customer_name, amount, status, due_date, created_at
         FROM invoices ORDER BY id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Invoice {
                id: r.get(0)?,
                invoice_number: r.get(1)?,
                customer_name: r.get(2)?,
                amount: r.get(3)?,
                status: r.get(4)?,
                due_date: r.get(5)?,
                created_at: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn erp_create_invoice(
    db: State<Db>,
    invoice_number: String,
    customer_name: String,
    amount: f64,
    due_date: Option<String>,
) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO invoices (invoice_number, customer_name, amount, status, due_date)
         VALUES (?1, ?2, ?3, 'unpaid', ?4)",
        rusqlite::params![invoice_number, customer_name, amount, due_date],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn erp_mark_invoice_paid(db: State<Db>, invoice_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "UPDATE invoices SET status = 'paid' WHERE id = ?1",
        [invoice_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn erp_summary(db: State<Db>) -> AppResult<ErpSummary> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let total_products: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?;
    let low_stock: i64 = conn.query_row(
        "SELECT COUNT(*) FROM products WHERE quantity <= reorder_level",
        [],
        |r| r.get(0),
    )?;
    let inventory_value: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantity * cost_price), 0) FROM products",
        [],
        |r| r.get(0),
    )?;
    let open_orders: i64 = conn.query_row(
        "SELECT COUNT(*) FROM orders WHERE status IN ('draft','confirmed')",
        [],
        |r| r.get(0),
    )?;
    let unpaid_invoices: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE status = 'unpaid'",
        [],
        |r| r.get(0),
    )?;
    Ok(ErpSummary {
        total_products,
        low_stock,
        inventory_value,
        open_orders,
        unpaid_invoices,
    })
}
