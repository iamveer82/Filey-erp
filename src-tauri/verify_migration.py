"""Behavioural check for the desktop SQLite migration in src/db.rs.

The Rust cannot be compiled in every environment (it needs the MSVC C toolchain),
but the thing that actually risks a customer's data is not whether the Rust
compiles — it is whether an *existing* database is upgraded correctly and
idempotently. That is pure SQL, and it can be checked here against real SQLite.

The migration statements are read out of db.rs rather than retyped, so this
tests what actually ships. Run:  python src-tauri/verify_migration.py
"""

import pathlib
import re
import sqlite3
import sys

DB_RS = pathlib.Path(__file__).with_name("src") / "db.rs"

# The schema an install from before the WPS/campaigns work would have.
OLD_SCHEMA = """
CREATE TABLE employees (
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
CREATE TABLE company_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT ''
);
"""

failures = []


def check(label, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else '  -> ' + detail}")
    if not ok:
        failures.append(label)


def migration_columns():
    """The add_column(...) calls in db.rs, in order: (table, column, ddl)."""
    src = DB_RS.read_text(encoding="utf-8")
    calls = re.findall(
        r'add_column\(\s*conn\s*,\s*"(\w+)"\s*,\s*"(\w+)"\s*,\s*"(\w+)"\s*\)', src
    )
    if not calls:
        sys.exit("could not find any add_column() calls in db.rs — did it move?")
    return calls


def add_column(conn, table, column, ddl):
    """Mirrors the Rust helper: ask PRAGMA first, then ALTER."""
    existing = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
    if column in existing:
        return False
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    return True


print("Desktop SQLite migration — behavioural check\n")

cols = migration_columns()
print(f"Read {len(cols)} column additions from db.rs: "
      + ", ".join(f"{t}.{c}" for t, c, _ in cols) + "\n")

# --- 1. an existing install upgrades, and keeps its data --------------------
conn = sqlite3.connect(":memory:")
conn.executescript(OLD_SCHEMA)
conn.execute(
    "INSERT INTO employees (employee_code, name, salary) VALUES ('E1', 'Asha', 5000)"
)
conn.execute("INSERT INTO company_profile (name) VALUES ('Acme Trading')")
conn.commit()

added = [add_column(conn, *c) for c in cols]
check("every column is added to an old database", all(added))

for table, column, _ in cols:
    names = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
    check(f"{table}.{column} exists after migrating", column in names, str(names))

row = conn.execute("SELECT employee_code, name, salary FROM employees").fetchone()
check("existing employee row survives untouched", row == ("E1", "Asha", 5000.0), str(row))
check(
    "company row survives untouched",
    conn.execute("SELECT name FROM company_profile").fetchone() == ("Acme Trading",),
)
check(
    "new columns default to NULL, not empty string",
    conn.execute("SELECT iban FROM employees").fetchone()[0] is None,
)

# --- 2. running it again changes nothing (every app launch calls it) --------
again = [add_column(conn, *c) for c in cols]
check("second run is a no-op — no duplicate-column error", not any(again))

# --- 3. a fresh install already has the columns ----------------------------
fresh = sqlite3.connect(":memory:")
fresh_schema = OLD_SCHEMA.replace(
    "status TEXT NOT NULL DEFAULT 'active'",
    "status TEXT NOT NULL DEFAULT 'active',\n    labour_card_no TEXT,\n    iban TEXT,\n    bank_routing_code TEXT",
).replace(
    "name TEXT NOT NULL DEFAULT ''\n);",
    "name TEXT NOT NULL DEFAULT '',\n    mol_establishment_id TEXT,\n    wps_bank_code TEXT\n);",
)
fresh.executescript(fresh_schema)
check("a fresh database needs no migration", not any(add_column(fresh, *c) for c in cols))

# --- 4. the opt-out uniqueness rule actually holds -------------------------
# Lifted from the CREATE statements in db.rs so the real index is exercised.
src = DB_RS.read_text(encoding="utf-8")
optout_ddl = re.search(
    r"CREATE TABLE IF NOT EXISTS email_optouts \(.*?\);", src, re.S
).group(0)
index_ddl = re.search(
    r"CREATE UNIQUE INDEX IF NOT EXISTS idx_email_optouts_unique.*?;", src, re.S
).group(0)
opt = sqlite3.connect(":memory:")
opt.executescript(optout_ddl + "\n" + index_ddl)
opt.execute("INSERT INTO email_optouts (email) VALUES ('sales@acme.ae')")
opt.commit()
try:
    opt.execute("INSERT INTO email_optouts (email) VALUES ('Sales@Acme.AE')")
    check("an unsubscribe cannot be re-added under different casing", False,
          "duplicate was accepted")
except sqlite3.IntegrityError:
    check("an unsubscribe cannot be re-added under different casing", True)

campaigns_ddl = re.search(r"CREATE TABLE IF NOT EXISTS campaigns \(.*?\);", src, re.S)
check("campaigns table is declared in db.rs", campaigns_ddl is not None)
if campaigns_ddl:
    c2 = sqlite3.connect(":memory:")
    c2.executescript(campaigns_ddl.group(0))
    c2.execute("INSERT INTO campaigns (name) VALUES ('August')")
    got = c2.execute("SELECT status, recipients, sent_count FROM campaigns").fetchone()
    check("campaign defaults are sane (draft / empty list / 0)",
          got == ("draft", "[]", 0), str(got))

print()
if failures:
    print(f"{len(failures)} FAILED: " + "; ".join(failures))
    sys.exit(1)
print("All migration checks passed.")
