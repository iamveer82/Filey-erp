mod db;
mod error;
mod modules;

use db::Db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = Connection::open(dir.join("filey-erp.db")).expect("open db");
            db::init(&conn).expect("init db");
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // CRM
            modules::crm::crm_list_leads,
            modules::crm::crm_create_lead,
            modules::crm::crm_set_lead_status,
            modules::crm::crm_delete_lead,
            modules::crm::crm_convert_lead,
            modules::crm::crm_list_customers,
            modules::crm::crm_create_customer,
            modules::crm::crm_delete_customer,
            modules::crm::crm_list_opportunities,
            modules::crm::crm_create_opportunity,
            modules::crm::crm_set_opp_stage,
            modules::crm::crm_delete_opportunity,
            modules::crm::crm_list_activities,
            modules::crm::crm_create_activity,
            modules::crm::crm_toggle_activity,
            modules::crm::crm_summary,
            // Offline cache / sync outbox
            modules::sync::cache_get,
            modules::sync::cache_set,
            modules::sync::outbox_add,
            modules::sync::outbox_list,
            modules::sync::outbox_remove,
            modules::sync::outbox_clear,
            // Billing / Invoicing
            modules::billing::billing_list_docs,
            modules::billing::billing_get_doc,
            modules::billing::billing_save_doc,
            modules::billing::billing_delete_doc,
            modules::billing::billing_set_status,
            modules::billing::billing_get_company,
            modules::billing::billing_save_company,
            // ERP Core
            modules::erp::erp_list_products,
            modules::erp::erp_create_product,
            modules::erp::erp_update_stock,
            modules::erp::erp_delete_product,
            modules::erp::erp_list_orders,
            modules::erp::erp_create_order,
            modules::erp::erp_set_order_status,
            modules::erp::erp_list_invoices,
            modules::erp::erp_create_invoice,
            modules::erp::erp_mark_invoice_paid,
            modules::erp::erp_summary,
            // HR
            modules::hr::hr_list_employees,
            modules::hr::hr_create_employee,
            modules::hr::hr_set_employee_status,
            modules::hr::hr_delete_employee,
            modules::hr::hr_list_attendance,
            modules::hr::hr_mark_attendance,
            modules::hr::hr_list_payroll,
            modules::hr::hr_run_payroll,
            modules::hr::hr_mark_payroll_paid,
            modules::hr::hr_summary,
            // Finance
            modules::finance::fin_list_accounts,
            modules::finance::fin_create_account,
            modules::finance::fin_list_expenses,
            modules::finance::fin_create_expense,
            modules::finance::fin_delete_expense,
            modules::finance::fin_list_transactions,
            modules::finance::fin_post_transaction,
            modules::finance::fin_report,
            // Tools
            modules::tools::tools_list_users,
            modules::tools::tools_create_user,
            modules::tools::tools_toggle_user,
            modules::tools::tools_list_settings,
            modules::tools::tools_set_setting,
            modules::tools::tools_audit_log,
            modules::tools::tools_log_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
