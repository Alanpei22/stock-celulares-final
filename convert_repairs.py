"""
convert_repairs.py
Converts the repairs Excel to a JSON file importable by TechPoint.
"""

import sys
import json
import math
import os
from datetime import datetime, timedelta

try:
    import pandas as pd
except ImportError:
    print("Install pandas: pip install pandas openpyxl")
    sys.exit(1)

EXCEL_FILE = r"C:\Users\alan1\Downloads\Reparaciones caseros (1).xlsx"
OUTPUT_FILE = r"C:\Users\alan1\Documents\techpoint22\repairs_import.json"

BASE_DATE = datetime(1899, 12, 30)

MARCA_MAP = {
    'sm': 'Samsung',
    'mt': 'Motorola',
    'ip': 'Apple / iPhone',
    'xm': 'Xiaomi',
    'tcl': 'TCL',
    'lg': 'LG',
}


def excel_date_to_iso(serial):
    """Convert Excel serial date (float or datetime) to ISO string like 2025-01-15T00:00:00.000Z"""
    if serial is None:
        return ""
    # Handle Python datetime objects (openpyxl already parsed the cell)
    if isinstance(serial, datetime):
        return serial.strftime("%Y-%m-%dT00:00:00.000Z")
    try:
        if isinstance(serial, float) and math.isnan(serial):
            return ""
        if pd.isna(serial):
            return ""
        val = float(serial)
        if math.isnan(val):
            return ""
        dt = BASE_DATE + timedelta(days=val)
        return dt.strftime("%Y-%m-%dT00:00:00.000Z")
    except (TypeError, ValueError):
        return ""


def clean_str(val):
    if val is None:
        return ''
    if isinstance(val, float) and math.isnan(val):
        return ''
    if pd.isna(val):
        return ''
    return str(val).strip()


def clean_int(val, default=0):
    if val is None:
        return default
    try:
        if isinstance(val, float) and math.isnan(val):
            return default
        if pd.isna(val):
            return default
        return int(float(val))
    except (TypeError, ValueError):
        return default


def clean_phone(val):
    """Convert float like 1167588761.0 to string '1167588761'. Empty string if NaN."""
    if val is None:
        return ''
    try:
        if isinstance(val, float) and math.isnan(val):
            return ''
        if pd.isna(val):
            return ''
        return str(int(float(val)))
    except (TypeError, ValueError):
        s = str(val).strip()
        return s if s else ''


def map_marca(val):
    s = clean_str(val).lower().strip()
    return MARCA_MAP.get(s, clean_str(val))


def normalize_arreglo(val):
    s = clean_str(val)
    if not s:
        return ''
    sl = s.lower()
    if 'modulo y templado' in sl or 'módulo y templado' in sl or \
       ('modulo' in sl and 'templado' in sl) or ('módulo' in sl and 'templado' in sl):
        return 'Módulo + Templado'
    if 'modulo' in sl or 'módulo' in sl or 'pegar pantalla' in sl:
        return 'Módulo / Pantalla'
    if 'ficha' in sl:
        return 'Ficha de carga'
    if 'bateria' in sl or 'batería' in sl:
        return 'Batería'
    if 'sistema' in sl or 'software' in sl:
        return 'Sistemas / Software'
    if 'conector' in sl:
        return 'Conector'
    if sl in ('rv', 'revision', 'revisión') or sl.startswith('revision') or sl.startswith('revisión'):
        return 'Revisión'
    if 'placa' in sl:
        return 'Placa'
    # Otherwise title case
    return s.title()


def map_estado(val):
    s = clean_str(val).strip()
    sl = s.lower()
    if sl in ('entregado', 'entregada', 'done') or 'entreg' in sl:
        return 'entregado'
    if sl in ('listo', 'lista', 'ready'):
        return 'listo'
    if sl in ('reparando', 'progres', 'progress') or 'repar' in sl or 'progres' in sl:
        return 'reparando'
    if sl in ('return', 'not', 'anulada', 'anulado', 'cancelado', 'cancelada') or 'anul' in sl or 'cancel' in sl:
        return 'cancelado'
    return sl


def read_sheet(xl, sheet_name, es_garantia=False):
    """Read a sheet and return list of record dicts."""
    try:
        df = xl.parse(sheet_name, header=None, dtype=object)
    except Exception as e:
        print(f"  Could not read '{sheet_name}': {e}")
        return []

    records = []
    for _, row in df.iterrows():
        try:
            # Columns: A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14, P=15
            n_orden_raw = row.iloc[2] if len(row) > 2 else None
            fecha_raw   = row.iloc[3] if len(row) > 3 else None
            marca_raw   = row.iloc[4] if len(row) > 4 else None
            modelo_raw  = row.iloc[5] if len(row) > 5 else None
            arreglo_raw = row.iloc[6] if len(row) > 6 else None
            monto_raw   = row.iloc[7] if len(row) > 7 else None
            sena_raw    = row.iloc[8] if len(row) > 8 else None
            nombre_raw  = row.iloc[11] if len(row) > 11 else None
            tlf_raw     = row.iloc[12] if len(row) > 12 else None
            dni_raw     = row.iloc[13] if len(row) > 13 else None
            obs_raw     = row.iloc[14] if len(row) > 14 else None
            estado_raw  = row.iloc[15] if len(row) > 15 else None

            # Skip header/empty rows
            n_orden = clean_int(n_orden_raw, -1)
            if n_orden < 1000:
                continue

            marca  = map_marca(marca_raw)
            modelo = clean_str(modelo_raw)

            # Skip if both marca and modelo are empty
            if not marca and not modelo:
                continue

            fecha_ingreso = excel_date_to_iso(fecha_raw)
            arreglo  = normalize_arreglo(arreglo_raw)
            monto    = clean_int(monto_raw, 0)
            sena     = clean_int(sena_raw, 0)
            nombre   = clean_str(nombre_raw).title()
            tlf      = clean_phone(tlf_raw)
            dni      = clean_phone(dni_raw)
            obs      = clean_str(obs_raw)
            estado   = map_estado(estado_raw)

            record = {
                'id': f'import_{n_orden}',
                'nOrden': n_orden,
                'fechaIngreso': fecha_ingreso,
                'marca': marca,
                'modelo': modelo,
                'arreglo': arreglo,
                'monto': monto,
                'sena': sena,
                'nombre': nombre,
                'tlf': tlf,
                'dni': dni,
                'observaciones': obs,
                'estado': estado,
                'condicion': '',
                'codigo': '',
                'accesorios': [],
                'fechaEstimada': '',
                'esGarantia': es_garantia,
                'ordenOriginal': None,
                'imported': True,
            }
            records.append(record)

        except Exception as e:
            continue

    return records


# ── Main ───────────────────────────────────────────────────────────────────────
print(f"Reading: {EXCEL_FILE}")

try:
    xl = pd.ExcelFile(EXCEL_FILE)
except Exception as e:
    print(f"Error opening file: {e}")
    sys.exit(1)

print(f"Sheets found: {xl.sheet_names}")

# Identify sheets
garantia_sheet = None
sheet_2025 = None
sheet_2026 = None

for s in xl.sheet_names:
    sl = s.lower().strip()
    if 'garantia' in sl or 'garantía' in sl:
        garantia_sheet = s
    elif '2025' in sl:
        sheet_2025 = s
    elif '2026' in sl:
        sheet_2026 = s

print(f"  2026 sheet: {sheet_2026}")
print(f"  2025 sheet: {sheet_2025}")
print(f"  Garantia sheet: {garantia_sheet}")

# Process in lowest-to-highest priority order so higher priority overwrites
# Priority: 2026 > Reparaciones 2025 > Garantia
seen = {}  # nOrden -> record

for sheet_name, es_garantia in [
    (garantia_sheet, True),
    (sheet_2025, False),
    (sheet_2026, False),
]:
    if sheet_name is None:
        continue
    print(f"\nProcessing '{sheet_name}' (esGarantia={es_garantia})...")
    records = read_sheet(xl, sheet_name, es_garantia=es_garantia)
    print(f"  -> {len(records)} valid records")
    for rec in records:
        seen[rec['nOrden']] = rec  # higher priority overwrites lower

# Sort by nOrden ascending
unique = sorted(seen.values(), key=lambda r: r['nOrden'])

total = len(unique)
if total == 0:
    print("WARNING: No records found!")
    max_orden = 1000
    min_orden = 1000
else:
    max_orden = unique[-1]['nOrden']
    min_orden = unique[0]['nOrden']

next_order_num = max_orden + 50

output = {
    'records': unique,
    'meta': {
        'nextOrderNum': next_order_num,
        'totalRecords': total,
    }
}

os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"\n=== SUMMARY ===")
print(f"Total records: {total}")
if total > 0:
    print(f"Order range: {min_orden} - {max_orden}")
print(f"nextOrderNum: {next_order_num}")
print(f"Output written to: {OUTPUT_FILE}")
