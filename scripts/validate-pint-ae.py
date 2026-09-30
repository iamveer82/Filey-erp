"""Run the official PINT-AE 1.0.4 Schematrons locally (Java 11+ and Saxon-HE).

Usage: python scripts/validate-pint-ae.py --saxon /path/Saxon-HE-10.9.jar invoice.xml ...
No network access and no invoice data leaves the computer.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--saxon", required=True, type=Path)
parser.add_argument("--ubl-xsd", type=Path, help="Optional official UBL 2.1 xsd directory; requires lxml")
parser.add_argument("invoices", nargs="+", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
failures = 0
for invoice in args.invoices:
    data = invoice.read_bytes()
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise SystemExit("Documents containing XML entities or DTDs are not accepted.")
    tag = ET.fromstring(data).tag
    kind = {"{urn:oasis:names:specification:ubl:schema:xsd:Invoice-2}Invoice": "invoice",
            "{urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2}CreditNote": "creditnote"}.get(tag)
    if not kind:
        raise SystemExit(f"Unsupported document: {invoice.name}")
    if args.ubl_xsd:
        from lxml import etree
        schema = args.ubl_xsd / "maindoc" / f"UBL-{'Invoice' if kind == 'invoice' else 'CreditNote'}-2.1.xsd"
        document = etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True))
        etree.XMLSchema(etree.parse(str(schema))).assertValid(document)
    count = 0
    with tempfile.TemporaryDirectory() as temp:
        for name in ("PINT-UBL-validation-preprocessed.xslt", "PINT-jurisdiction-aligned-rules.xslt"):
            rules = root / f"docs/pint-ae/trn-{kind}/schematron" / name
            result = Path(temp) / "report.xml"
            subprocess.run(["java", "-jar", str(args.saxon.resolve()), "-dtd:off",
                            f"-s:{invoice.resolve()}", f"-xsl:{rules}", f"-o:{result}"],
                           check=True, capture_output=True, timeout=60)
            for assertion in ET.parse(result).iter("{http://purl.oclc.org/dsdl/svrl}failed-assert"):
                if assertion.get("flag") != "warning":
                    count += 1
                    print(invoice.name, assertion.get("id"), " ".join("".join(assertion.itertext()).split()))
    failures += count
    print(f"{invoice.name}: {count} failed rules")
raise SystemExit(1 if failures else 0)
