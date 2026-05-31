import os, re

dir = 'src/pages/settings'

MASTER_IMPORTS = [
    'import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";',
    'import { useSearchParams } from "react-router-dom";',
    'import { Building2, UserCircle, Users as UsersIcon, SlidersHorizontal, CreditCard, ShieldCheck, Bell, Plug, DatabaseBackup, History, Upload, X, Plus, Lock, KeyRound, Monitor, Trash2, ChevronRight, Check, Eye, EyeOff, Pencil, LayoutGrid, Building, Download, Wifi, Mail, Send, Sparkles } from "lucide-react";',
    'import { tools, billing, erp, crm, fin, quotes, AuditEntry, CompanyProfile, org, type OrgMember, type Organization, type Invitation } from "../../lib/api";',
    'import { supabase } from "../../lib/supabase";',
    'import { useAuth } from "../../lib/auth";',
    'import { useUI } from "../../lib/ui";',
    'import { useLiveSync } from "../../lib/realtime";',
    'import { useModules } from "../../lib/modules";',
    'import { loadEmailConfig, saveEmailConfig, sendEmail, emailShell, hasDesktop, type EmailConfig } from "../../lib/email";',
    'import { fmtDate, numInput, cn } from "../../lib/format";',
    'import { PageHeader, DataTable, Badge, Modal, Field } from "../../components/ui";',
    'import { motion, AnimatePresence } from "framer-motion";',
    'import { MODULES } from "../../modules/registry";',
    'import AiSettings from "../../components/AiSettings";',
    'import { getSubscription, startCheckout, openBillingPortal, PLANS, type Subscription, type Plan } from "../../lib/subscription";',
]

symbol_line = {}
for line in MASTER_IMPORTS:
    m = re.search(r'\{([^}]+)\}', line)
    if m:
        for part in m.group(1).split(','):
            part = part.strip()
            part = part.replace('type ', '')
            if ' as ' in part:
                orig, alias = [x.strip() for x in part.split(' as ')]
                symbol_line[alias] = line
                symbol_line[orig] = line
            else:
                symbol_line[part] = line
    m = re.match(r'import\s+(\w+)\s+from', line)
    if m:
        symbol_line[m.group(1)] = line

for fname in os.listdir(dir):
    if not fname.endswith('.tsx'):
        continue
    path = os.path.join(dir, fname)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.split('\n')
    import_lines = []
    body_lines = []
    in_imports = True
    for line in lines:
        if in_imports and (line.strip().startswith('import ') or line.strip() == ''):
            if line.strip().startswith('import '):
                import_lines.append(line)
        else:
            in_imports = False
            body_lines.append(line)
    body = '\n'.join(body_lines)

    # Strip strings and comments for analysis
    code = re.sub(r'"[^"]*"', '""', body)
    code = re.sub(r"'[^']*'", "''", code)
    code = re.sub(r'`[^`]*`', '``', code)
    code = re.sub(r'//.*', '', code)
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)

    used_lines = set()
    for sym, line in symbol_line.items():
        if re.search(r'\b' + re.escape(sym) + r'\b', code):
            used_lines.add(line)

    # Rebuild lucide import
    lucide_line = MASTER_IMPORTS[2]
    lucide_icons = ['Building2','UserCircle','UsersIcon','SlidersHorizontal','CreditCard','ShieldCheck','Bell','Plug','DatabaseBackup','History','Upload','X','Plus','Lock','KeyRound','Monitor','Trash2','ChevronRight','Check','Eye','EyeOff','Pencil','LayoutGrid','Building','Download','Wifi','Mail','Send','Sparkles']
    used_icons = [icon for icon in lucide_icons if re.search(r'\b' + icon + r'\b', code)]
    if used_icons:
        icon_parts = []
        for icon in used_icons:
            if icon == 'UsersIcon':
                icon_parts.append('Users as UsersIcon')
            else:
                icon_parts.append(icon)
        new_lucide = 'import { ' + ', '.join(icon_parts) + ' } from "lucide-react";'
        used_lines.discard(lucide_line)
        used_lines.add(new_lucide)

    # Rebuild api import
    api_line = MASTER_IMPORTS[3]
    api_syms = ['tools','billing','erp','crm','fin','quotes','AuditEntry','CompanyProfile','org','OrgMember','Organization','Invitation']
    used_api = [s for s in api_syms if re.search(r'\b' + re.escape(s) + r'\b', code)]
    if used_api:
        parts = []
        for s in used_api:
            if s in ['OrgMember','Organization','Invitation']:
                parts.append('type ' + s)
            else:
                parts.append(s)
        new_api = 'import { ' + ', '.join(parts) + ' } from "../../lib/api";'
        used_lines.discard(api_line)
        used_lines.add(new_api)

    # Rebuild format import
    fmt_line = MASTER_IMPORTS[10]
    fmt_syms = ['fmtDate','numInput','cn']
    used_fmt = [s for s in fmt_syms if re.search(r'\b' + s + r'\b', code)]
    if used_fmt:
        new_fmt = 'import { ' + ', '.join(used_fmt) + ' } from "../../lib/format";'
        used_lines.discard(fmt_line)
        used_lines.add(new_fmt)

    # Rebuild ui import
    ui_line = MASTER_IMPORTS[11]
    ui_syms = ['PageHeader','DataTable','Badge','Modal','Field']
    used_ui = [s for s in ui_syms if re.search(r'\b' + s + r'\b', code)]
    if used_ui:
        new_ui = 'import { ' + ', '.join(used_ui) + ' } from "../../components/ui";'
        used_lines.discard(ui_line)
        used_lines.add(new_ui)

    # Rebuild email import
    email_line = MASTER_IMPORTS[9]
    email_syms = ['loadEmailConfig','saveEmailConfig','sendEmail','emailShell','hasDesktop','EmailConfig']
    used_email = [s for s in email_syms if re.search(r'\b' + s + r'\b', code)]
    if used_email:
        parts = []
        for s in used_email:
            if s == 'EmailConfig':
                parts.append('type ' + s)
            else:
                parts.append(s)
        new_email = 'import { ' + ', '.join(parts) + ' } from "../../lib/email";'
        used_lines.discard(email_line)
        used_lines.add(new_email)

    # Rebuild subscription import
    sub_line = MASTER_IMPORTS[15]
    sub_syms = ['getSubscription','startCheckout','openBillingPortal','PLANS','Subscription','Plan']
    used_sub = [s for s in sub_syms if re.search(r'\b' + s + r'\b', code)]
    if used_sub:
        parts = []
        for s in used_sub:
            if s in ['Subscription','Plan']:
                parts.append('type ' + s)
            else:
                parts.append(s)
        new_sub = 'import { ' + ', '.join(parts) + ' } from "../../lib/subscription";'
        used_lines.discard(sub_line)
        used_lines.add(new_sub)

    # Rebuild react import
    react_line = MASTER_IMPORTS[0]
    react_syms = ['useEffect','useMemo','useRef','useState','ReactNode']
    used_react = [s for s in react_syms if re.search(r'\b' + s + r'\b', code)]
    if used_react:
        parts = []
        for s in used_react:
            if s == 'ReactNode':
                parts.append('type ' + s)
            else:
                parts.append(s)
        new_react = 'import { ' + ', '.join(parts) + ' } from "react";'
        used_lines.discard(react_line)
        used_lines.add(new_react)

    # Order imports deterministically
    ordered = []
    for line in MASTER_IMPORTS:
        if line in used_lines:
            ordered.append(line)
    for line in used_lines:
        if line not in MASTER_IMPORTS:
            ordered.append(line)

    new_content = '\n'.join(ordered) + '\n\n' + body

    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f'{fname}: {len(ordered)} imports')
