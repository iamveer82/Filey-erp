import os, re

path = 'src/pages/settings/CompanyDetails.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
print(f"Total lines: {len(lines)}")

import_lines = []
body_lines = []
in_imports = True
current_import = []
for i, line in enumerate(lines):
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
            print(f"Body starts at line {i}: {line[:60]}")
            in_imports = False
            body_lines.append(line)
    else:
        body_lines.append(line)

print(f"Import lines: {len(import_lines)}")
print(f"Body lines: {len(body_lines)}")
if current_import:
    print(f"Trailing current_import: {current_import}")
