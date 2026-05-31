import os, re

path = 'src/pages/settings/CompanyDetails.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
import_lines = []
body_lines = []
in_imports = True
current_import = []
for line in lines:
    if in_imports:
        if line.strip().startswith('import ') or current_import:
            current_import.append(line)
            if line.strip().endswith(';'):
                import_lines.extend(current_import)
                current_import = []
        elif line.strip() == '':
            if current_import:
                current_import.append(line)
            else:
                pass
        else:
            in_imports = False
            body_lines.append(line)
    else:
        body_lines.append(line)

body = '\n'.join(body_lines)
code = re.sub(r'"[^"]*"', '""', body)
code = re.sub(r"'[^']*'", "''", code)
code = re.sub(r'`[^`]*`', '``', code)
code = re.sub(r'//.*', '', code)
code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)

print(f"Body length: {len(body)}")
print(f"Code length after stripping: {len(code)}")
print(f"First 200 chars of code: {code[:200]}")

# Check a few symbols
for sym in ['useState', 'useEffect', 'Building2', 'PageHeader', 'billing']:
    found = bool(re.search(r'\b' + re.escape(sym) + r'\b', code))
    print(f"{sym}: {found}")
