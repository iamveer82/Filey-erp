use rusqlite::Connection;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        -- ===== ERP CORE =====
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            unit_price REAL NOT NULL DEFAULT 0,
            cost_price REAL NOT NULL DEFAULT 0,
            quantity INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT NOT NULL UNIQUE,
            customer_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            total REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id),
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT NOT NULL UNIQUE,
            order_id INTEGER REFERENCES orders(id),
            customer_name TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'unpaid',
            due_date TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ===== HR =====
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            department TEXT,
            position TEXT,
            salary REAL NOT NULL DEFAULT 0,
            hire_date TEXT,
            status TEXT NOT NULL DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            check_in TEXT,
            check_out TEXT,
            status TEXT NOT NULL DEFAULT 'present'
        );

        CREATE TABLE IF NOT EXISTS payroll (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            period TEXT NOT NULL,
            basic REAL NOT NULL DEFAULT 0,
            allowances REAL NOT NULL DEFAULT 0,
            deductions REAL NOT NULL DEFAULT 0,
            net_pay REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ===== FINANCE =====
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            account_type TEXT NOT NULL,
            balance REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            description TEXT,
            amount REAL NOT NULL DEFAULT 0,
            expense_date TEXT NOT NULL,
            account_id INTEGER REFERENCES accounts(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL REFERENCES accounts(id),
            txn_type TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            txn_date TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ===== TOOLS =====
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'staff',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            entity TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ===== CRM =====
        CREATE TABLE IF NOT EXISTS crm_leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            company TEXT,
            email TEXT,
            phone TEXT,
            source TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            est_value REAL NOT NULL DEFAULT 0,
            owner TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            company TEXT,
            email TEXT,
            phone TEXT,
            address TEXT,
            segment TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_opportunities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            stage TEXT NOT NULL DEFAULT 'qualification',
            value REAL NOT NULL DEFAULT 0,
            probability INTEGER NOT NULL DEFAULT 20,
            owner TEXT,
            expected_close TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL DEFAULT 'task',
            subject TEXT NOT NULL,
            related_to TEXT,
            due_date TEXT,
            done INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ===== BILLING / INVOICING =====
        CREATE TABLE IF NOT EXISTS company_profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL,
            address TEXT,
            trn TEXT,
            email TEXT,
            phone TEXT,
            logo TEXT,
            default_accent TEXT NOT NULL DEFAULT '#0A0A0A',
            default_template TEXT NOT NULL DEFAULT 'minimal'
        );

        CREATE TABLE IF NOT EXISTS invoice_docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            template TEXT NOT NULL DEFAULT 'minimal',
            accent TEXT NOT NULL DEFAULT '#0A0A0A',
            currency TEXT NOT NULL DEFAULT 'AED',
            seller_name TEXT NOT NULL DEFAULT '',
            seller_address TEXT,
            seller_trn TEXT,
            seller_email TEXT,
            seller_phone TEXT,
            logo TEXT,
            customer_name TEXT NOT NULL DEFAULT '',
            customer_address TEXT,
            customer_trn TEXT,
            customer_email TEXT,
            issue_date TEXT,
            due_date TEXT,
            notes TEXT,
            terms TEXT,
            tax_rate REAL NOT NULL DEFAULT 5,
            discount REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS invoice_doc_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL REFERENCES invoice_docs(id) ON DELETE CASCADE,
            description TEXT NOT NULL DEFAULT '',
            qty REAL NOT NULL DEFAULT 1,
            unit_price REAL NOT NULL DEFAULT 0,
            position INTEGER NOT NULL DEFAULT 0
        );

        -- ===== OFFLINE-FIRST CACHE / SYNC OUTBOX =====
        CREATE TABLE IF NOT EXISTS kv_cache (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            op TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )?;

    seed(conn)?;
    seed_crm(conn)?;
    seed_billing(conn)?;
    Ok(())
}

fn seed(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        INSERT OR IGNORE INTO products (sku, name, category, unit_price, cost_price, quantity, reorder_level) VALUES
            ('SKU-1001','Engine Oil 5W-30 (4L)','Lubricants', 145.00, 95.00, 240, 50),
            ('SKU-1002','Hydraulic Oil ISO 68','Lubricants', 210.00, 150.00, 80, 30),
            ('SKU-1003','Grease MP3 (18kg)','Grease', 320.00, 220.00, 35, 20),
            ('SKU-1004','Coolant Concentrate (5L)','Coolants', 90.00, 55.00, 12, 25),
            ('SKU-1005','Gear Oil EP90 (20L)','Lubricants', 480.00, 360.00, 60, 15);

        INSERT OR IGNORE INTO orders (order_number, customer_name, status, total) VALUES
            ('SO-2026-0001','Dune Lubricants LLC','confirmed', 2900.00),
            ('SO-2026-0002','Green Gold Trading','draft', 1280.00),
            ('SO-2026-0003','KSR General Trading','delivered', 9600.00);

        INSERT OR IGNORE INTO invoices (invoice_number, customer_name, amount, status, due_date) VALUES
            ('INV-2026-0001','Dune Lubricants LLC', 2900.00, 'paid', date('now','+15 days')),
            ('INV-2026-0002','KSR General Trading', 9600.00, 'unpaid', date('now','+30 days'));

        INSERT OR IGNORE INTO employees (employee_code, name, email, department, position, salary, hire_date, status) VALUES
            ('EMP-001','Aurangzeb Khan','aurangzeb@filey.io','Operations','Operations Manager', 12000, date('now','-400 days'),'active'),
            ('EMP-002','Mehmood Ali','mehmood@filey.io','Sales','Sales Executive', 7500, date('now','-220 days'),'active'),
            ('EMP-003','Virendra Singh','virendra@filey.io','Finance','Accountant', 8500, date('now','-150 days'),'active'),
            ('EMP-004','Ali Hassan','ali@filey.io','Warehouse','Storekeeper', 4500, date('now','-90 days'),'active');

        INSERT OR IGNORE INTO attendance (employee_id, date, check_in, check_out, status) VALUES
            (1, date('now'), '09:02', '18:05', 'present'),
            (2, date('now'), '09:15', '18:00', 'present'),
            (3, date('now'), NULL, NULL, 'leave'),
            (4, date('now'), '08:55', '17:50', 'present');

        INSERT OR IGNORE INTO payroll (employee_id, period, basic, allowances, deductions, net_pay, status) VALUES
            (1,'2026-04', 12000, 1500, 500, 13000, 'paid'),
            (2,'2026-04', 7500, 800, 300, 8000, 'paid'),
            (3,'2026-04', 8500, 700, 400, 8800, 'pending');

        INSERT OR IGNORE INTO accounts (code, name, account_type, balance) VALUES
            ('1000','Cash','asset', 152000),
            ('1100','Bank - Emirates NBD','asset', 488000),
            ('2000','Accounts Payable','liability', 73000),
            ('3000','Owner Equity','equity', 400000),
            ('4000','Sales Revenue','revenue', 312000),
            ('5000','Operating Expenses','expense', 96000);

        INSERT OR IGNORE INTO expenses (category, description, amount, expense_date, account_id) VALUES
            ('Rent','Warehouse rent - May', 18000, date('now','-5 days'), 6),
            ('Utilities','SEWA electricity bill', 3200, date('now','-3 days'), 6),
            ('Fuel','Delivery vehicle fuel', 1450, date('now','-1 days'), 6);

        INSERT OR IGNORE INTO transactions (account_id, txn_type, amount, description) VALUES
            (4,'credit', 9600, 'Invoice INV-2026-0002 booked'),
            (1,'debit', 18000, 'Warehouse rent payment'),
            (2,'credit', 12000, 'Supplier bill - lubricant stock');

        INSERT OR IGNORE INTO users (username, full_name, role) VALUES
            ('admin','System Administrator','admin'),
            ('aurangzeb','Aurangzeb Khan','manager'),
            ('virendra','Virendra Singh','accountant');

        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('company_name','Filey ERP FZ-LLC'),
            ('currency','AED'),
            ('trn','100123456700003'),
            ('vat_rate','0.05'),
            ('emirate','Dubai'),
            ('fiscal_year_start','01-01'),
            ('theme','light');

        INSERT OR IGNORE INTO audit_log (actor, action, entity, details) VALUES
            ('admin','create','product','Seeded initial product catalog'),
            ('admin','login','auth','Administrator signed in');
        "#,
    )?;
    Ok(())
}

fn seed_crm(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM crm_opportunities", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        INSERT OR IGNORE INTO crm_leads (name, company, email, phone, source, status, est_value, owner) VALUES
            ('Faisal Rahman','Al Madina Auto Spares','faisal@almadina.ae','+971501234567','Website','new', 18000, 'Mehmood Ali'),
            ('Sara Iqbal','Gulf Marine Services','sara@gulfmarine.ae','+971559876543','Referral','contacted', 42000, 'Mehmood Ali'),
            ('Tariq Noor','Desert Rose Trading','tariq@desertrose.ae','+971526549870','Trade Show','qualified', 76000, 'Aurangzeb Khan'),
            ('Layla Hassan','Oasis Logistics','layla@oasislog.ae','+971502223344','Cold Call','new', 9500, 'Mehmood Ali');

        INSERT OR IGNORE INTO crm_customers (name, company, email, phone, address, segment) VALUES
            ('Omar Sheikh','Dune Lubricants LLC','omar@dunelub.ae','+971501112233','Jebel Ali, Dubai','Wholesale'),
            ('Hina Aziz','KSR General Trading','hina@ksrtrading.ae','+971554445566','Sharjah Industrial Area','Distributor'),
            ('Bilal Khan','Green Gold Trading','bilal@greengold.ae','+971507778899','Al Quoz, Dubai','Retail');

        INSERT OR IGNORE INTO crm_opportunities (title, customer_name, stage, value, probability, owner, expected_close) VALUES
            ('Annual lubricant supply contract','Dune Lubricants LLC','negotiation', 240000, 70, 'Aurangzeb Khan', date('now','+20 days')),
            ('Bulk hydraulic oil — Q3','KSR General Trading','proposal', 96000, 45, 'Mehmood Ali', date('now','+35 days')),
            ('Fleet grease package','Green Gold Trading','qualification', 32000, 20, 'Mehmood Ali', date('now','+50 days')),
            ('Coolant retainer deal','Desert Rose Trading','won', 58000, 100, 'Aurangzeb Khan', date('now','-3 days')),
            ('Gear oil one-off','Oasis Logistics','lost', 14000, 0, 'Mehmood Ali', date('now','-10 days'));

        INSERT OR IGNORE INTO crm_activities (kind, subject, related_to, due_date, done) VALUES
            ('call','Follow up on contract terms','Dune Lubricants LLC', date('now','+1 days'), 0),
            ('email','Send revised proposal','KSR General Trading', date('now'), 0),
            ('meeting','Site visit & demo','Green Gold Trading', date('now','+4 days'), 0),
            ('task','Prepare quotation PDF','Desert Rose Trading', date('now','-2 days'), 1);
        "#,
    )?;
    Ok(())
}

fn seed_billing(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO company_profile
            (id, name, address, trn, email, phone, default_accent, default_template)
         VALUES (1, 'Filey ERP FZ-LLC', 'Dubai, United Arab Emirates',
                 '100123456700003', 'billing@filey.io', '+971 4 000 0000',
                 '#0A0A0A', 'minimal')",
        [],
    )?;

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM invoice_docs", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO invoice_docs
            (number, status, template, accent, currency,
             seller_name, seller_address, seller_trn, seller_email, seller_phone,
             customer_name, customer_address, customer_trn, customer_email,
             issue_date, due_date, notes, terms, tax_rate, discount)
         VALUES ('INV-2026-0001', 'issued', 'minimal', '#0A0A0A', 'AED',
             'Filey ERP FZ-LLC', 'Dubai, United Arab Emirates', '100123456700003',
             'billing@filey.io', '+971 4 000 0000',
             'Dune Lubricants LLC', 'Jebel Ali, Dubai', '100777888900003', 'omar@dunelub.ae',
             date('now'), date('now','+30 days'),
             'Thank you for your business.',
             'Payment due within 30 days. Late payments subject to 2% monthly interest.',
             5, 200)",
        [],
    )?;
    let inv_id = conn.last_insert_rowid();
    conn.execute_batch(&format!(
        "INSERT INTO invoice_doc_items (invoice_id, description, qty, unit_price, position) VALUES
            ({id}, 'Engine Oil 5W-30 (4L) — case of 6', 20, 145.00, 0),
            ({id}, 'Hydraulic Oil ISO 68 (20L)', 8, 210.00, 1),
            ({id}, 'Delivery & handling', 1, 350.00, 2);",
        id = inv_id
    ))?;
    Ok(())
}
