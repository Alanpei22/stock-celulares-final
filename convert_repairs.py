"""
convert_repairs.py
Convierte el Excel de reparaciones a un JSON importable por TechPoint.

Uso:
    python convert_repairs.py "Reparaciones caseros (1).xlsx" repairs_import.json

El JSON generado se importa desde la app TechPoint → Reparaciones → Importar.
"""

import sys
import json
import math
from datetime import datetime, timedelta

try:
    import pandas as pd
except ImportError:
    print("Instalá pandas: pip install pandas openpyxl")
    sys.exit(1)

# ── Configuración ──────────────────────────────────────────
EXCEL_FILE = sys.argv[1] if len(sys.argv) > 1 else "Reparaciones caseros (1).xlsx"
OUTPUT_FILE = sys.argv[2] if len(sys.argv) > 2 else "repairs_import.json"

MARCA_MAP = {
    'sm': 'Samsung', 'samsung': 'Samsung',
    'mt': 'Motorola', 'motorola': 'Motorola',
    'ip': 'Apple / iPhone', 'iphone': 'Apple / iPhone', 'apple': 'Apple / iPhone',
    'xm': 'Xiaomi', 'xiaomi': 'Xiaomi',
    'tcl': 'TCL',
    'lg': 'LG',
    'hu': 'Huawei', 'huawei': 'Huawei',
}

STATUS_MAP = {
    'entregado': 'entregado', 'entregada': 'entregado',
    'entregado ': 'entregado',
    'entregADO': 'entregado', 'ENTREGADO': 'entregado',
    'done': 'entregado',
    'listo': 'listo', 'lISTO': 'listo', 'LISTO': 'listo',
    'ready': 'listo',
    'reparando': 'reparando',
    'progres': 'reparando', 'en progres': 'reparando',
    'return': 'cancelado',
    'not': 'cancelado',
    'ANULADA': 'cancelado',
}

def excel_date_to_iso(serial):
    """Convierte número de serie de Excel a ISO date string."""
    try:
        val = float(serial)
        if math.isnan(val):
            return None
        base = datetime(1899, 12, 30)
        dt = base + timedelta(days=val)
        return dt.isoformat() + 'Z'
    except (TypeError, ValueError):
        return None

def clean_str(val):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return ''
    return str(val).strip()

def clean_int(val):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return 0
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return 0

def clean_phone(val):
    """Limpia número de teléfono almacenado como float."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return ''
    try:
        n = int(float(val))
        s = str(n)
        # Quitar prefijo 0 inicial si tiene 11 dígitos
        if len(s) == 11 and s.startswith('0'):
            s = s[1:]
        return s if len(s) >= 8 else ''
    except (TypeError, ValueError):
        return ''

def map_marca(val):
    s = clean_str(val).lower().strip()
    return MARCA_MAP.get(s, clean_str(val).capitalize() if val else '')

def map_status(val):
    s = clean_str(val).strip()
    # Buscar coincidencia case-insensitive
    for k, v in STATUS_MAP.items():
        if k.lower() == s.lower():
            return v
    return 'entregado'  # default para datos históricos

def read_sheet(xl, sheet_name, is_garantia=False):
    """Lee una hoja del Excel y devuelve lista de dicts."""
    try:
        df = xl.parse(sheet_name, header=None)
    except Exception as e:
        print(f"  No se pudo leer '{sheet_name}': {e}")
        return []

    records = []
    for _, row in df.iterrows():
        # Columnas: B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14, P=15
        try:
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

            # Saltar filas de encabezado o vacías
            n_orden = clean_int(n_orden_raw)
            if n_orden < 1000:
                continue

            fecha_iso = excel_date_to_iso(fecha_raw)
            if not fecha_iso:
                # Intentar como número
                fecha_iso = None

            marca   = map_marca(marca_raw)
            modelo  = clean_str(modelo_raw)
            arreglo = clean_str(arreglo_raw)
            monto   = clean_int(monto_raw)
            sena    = clean_int(sena_raw)
            nombre  = clean_str(nombre_raw).title()
            tlf     = clean_phone(tlf_raw)
            dni     = clean_phone(dni_raw)
            obs     = clean_str(obs_raw)
            estado  = map_status(estado_raw)

            if not modelo and not marca:
                continue

            # Normalizar arreglo
            arreglo_norm = arreglo.lower()
            if 'modulo' in arreglo_norm or 'módulo' in arreglo_norm:
                if 'templado' in arreglo_norm:
                    arreglo = 'Módulo + Templado'
                else:
                    arreglo = 'Módulo / Pantalla'
            elif 'ficha' in arreglo_norm:
                arreglo = 'Ficha de carga'
            elif 'bateria' in arreglo_norm or 'batería' in arreglo_norm:
                arreglo = 'Batería'
            elif 'sistema' in arreglo_norm or 'software' in arreglo_norm:
                arreglo = 'Sistemas / Software'
            elif 'conector' in arreglo_norm:
                arreglo = 'Conector'
            elif arreglo_norm in ('rv', 'revision', 'revisión'):
                arreglo = 'Revisión'
            elif 'placa' in arreglo_norm:
                arreglo = 'Placa'
            elif arreglo_norm == 'pegar pantalla':
                arreglo = 'Módulo / Pantalla'

            doc_id = f"import_{n_orden}_{sheet_name.replace(' ', '_')[:10]}"

            record = {
                'id': doc_id,
                'nOrden': n_orden,
                'fechaIngreso': fecha_iso or '2025-01-01T00:00:00.000Z',
                'marca': marca,
                'modelo': modelo,
                'arreglo': arreglo,
                'monto': monto,
                'sena': sena,
                'nombre': nombre,
                'tlf': tlf,
                'dni': dni,
                'observaciones': obs,
                'condicion': '',
                'codigo': '',
                'accesorios': [],
                'fechaEstimada': '',
                'estado': estado,
                'esGarantia': is_garantia,
                'imported': True,
            }
            records.append(record)

        except Exception as e:
            continue

    return records

# ── Main ───────────────────────────────────────────────────
print(f"Leyendo: {EXCEL_FILE}")

try:
    xl = pd.ExcelFile(EXCEL_FILE)
except Exception as e:
    print(f"Error abriendo archivo: {e}")
    sys.exit(1)

print(f"Hojas encontradas: {xl.sheet_names}")

all_records = []

# Hoja 2026
for sheet in xl.sheet_names:
    is_garantia = 'garantia' in sheet.lower() or 'garantía' in sheet.lower()
    print(f"  Procesando '{sheet}' (garantía={is_garantia})...")
    records = read_sheet(xl, sheet, is_garantia=is_garantia)
    print(f"    → {len(records)} registros")
    all_records.extend(records)

# Deduplicar por nOrden (preferir el más reciente)
seen = {}
for r in all_records:
    k = r['nOrden']
    if k not in seen:
        seen[k] = r

unique = list(seen.values())
unique.sort(key=lambda x: x['nOrden'])

# Calcular próximo número de orden
max_orden = max((r['nOrden'] for r in unique), default=7000)
next_orden = max_orden + 50  # buffer

print(f"\nTotal registros únicos: {len(unique)}")
print(f"Rango de órdenes: {unique[0]['nOrden']} — {unique[-1]['nOrden']}")
print(f"Próximo N° de orden recomendado: {next_orden}")

output = {
    'records': unique,
    'meta': {
        'nextOrderNum': next_orden,
        'importedAt': datetime.utcnow().isoformat() + 'Z',
        'totalRecords': len(unique),
    }
}

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"\n✅ Guardado en: {OUTPUT_FILE}")
print(f"   Importá este archivo desde TechPoint → Reparaciones → Importar historial")
