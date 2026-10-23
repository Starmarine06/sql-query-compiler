// database.js
// Sample in-memory database used by the semantic analyzer and the change preview.

export const SAMPLE_DB = {
  tables: {
    employees: {
      name: 'employees',
      order: ['id', 'name', 'department', 'salary', 'city'],
      columns: {
        id: { type: 'INT' },
        name: { type: 'TEXT' },
        department: { type: 'TEXT' },
        salary: { type: 'INT' },
        city: { type: 'TEXT' },
      },
      rows: [
        { id: 1, name: 'Alice', department: 'Engineering', salary: 120000, city: 'Bangalore' },
        { id: 2, name: 'Bob', department: 'Engineering', salary: 95000, city: 'Chennai' },
        { id: 3, name: 'Carol', department: 'Marketing', salary: 88000, city: 'Mumbai' },
        { id: 4, name: 'Dave', department: 'Sales', salary: 72000, city: 'Delhi' },
        { id: 5, name: 'Eve', department: 'Marketing', salary: 108000, city: 'Bangalore' },
        { id: 6, name: 'Frank', department: 'Sales', salary: 64000, city: 'Pune' },
        { id: 7, name: 'Grace', department: 'Engineering', salary: 145000, city: 'Hyderabad' },
        { id: 8, name: 'Hank', department: 'HR', salary: 68000, city: 'Bangalore' },
        { id: 9, name: 'Ivy', department: 'HR', salary: 54500, city: 'Chennai' },
        { id: 10, name: 'Jake', department: 'Sales', salary: 90000, city: 'Mumbai' },
      ],
    },
    departments: {
      name: 'departments',
      order: ['id', 'name', 'budget'],
      columns: {
        id: { type: 'INT' },
        name: { type: 'TEXT' },
        budget: { type: 'INT' },
      },
      rows: [
        { id: 1, name: 'Engineering', budget: 1500000 },
        { id: 2, name: 'Marketing', budget: 800000 },
        { id: 3, name: 'Sales', budget: 600000 },
        { id: 4, name: 'HR', budget: 300000 },
      ],
    },
  },
};

export function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

export function tableColumnNames(table) {
  return table ? table.order : [];
}

export function tableRowCount(table) {
  return table ? table.rows.length : 0;
}

// ---------- CSV Parsing and Serialization ----------

/**
 * RFC-4180 compliant CSV line/grid parser.
 * Handles quoted fields with embedded commas, quotes (""), and newlines.
 */
export function parseCSVRows(csvText) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentVal += '"';
          i += 2;
          continue;
        } else {
          // End quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentVal += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentVal.trim());
        currentVal = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(currentVal.trim());
        if (currentRow.some((field) => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentVal.trim());
        if (currentRow.some((field) => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = '';
        i++;
        continue;
      } else {
        currentVal += char;
        i++;
        continue;
      }
    }
  }

  // Final value and row
  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((field) => field.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Sanitizes table or column names to be clean SQL identifiers.
 */
export function sanitizeIdentifier(str, fallback = 'col') {
  if (!str || typeof str !== 'string') return fallback;
  let clean = str.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  if (!clean) clean = fallback;
  if (/^[0-9]/.test(clean)) clean = 'col_' + clean;
  return clean.toLowerCase();
}

/**
 * Infer data type for an array of raw string values in a column.
 * Returns 'INT', 'REAL', 'BOOLEAN', 'DATE', or 'TEXT'.
 */
export function inferType(rawValues) {
  const nonNullValues = rawValues.filter(
    (v) => v !== null && v !== undefined && v !== '' && v.toUpperCase() !== 'NULL' && v.toUpperCase() !== 'N/A'
  );

  if (nonNullValues.length === 0) return 'TEXT';

  let isInt = true;
  let isReal = true;
  let isBool = true;
  let isDate = true;

  const intRegex = /^[-+]?\d+$/;
  const realRegex = /^[-+]?(\d+\.\d+|\.\d+|\d+\.)$/;
  const boolRegex = /^(true|false|t|f|1|0)$/i;
  const dateRegex = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;

  for (const val of nonNullValues) {
    if (!intRegex.test(val)) isInt = false;
    if (!isInt && !realRegex.test(val)) isReal = false;
    if (!boolRegex.test(val)) isBool = false;
    if (!dateRegex.test(val)) isDate = false;
  }

  if (isInt) return 'INT';
  if (isReal) return 'REAL';
  if (isBool) return 'BOOLEAN';
  if (isDate) return 'DATE';
  return 'TEXT';
}

/**
 * Convert a raw string value according to inferred type.
 */
export function parseTypedValue(valStr, type) {
  if (valStr === null || valStr === undefined || valStr === '' || valStr.toUpperCase() === 'NULL') {
    return null;
  }
  if (type === 'INT') {
    const num = parseInt(valStr, 10);
    return isNaN(num) ? valStr : num;
  }
  if (type === 'REAL') {
    const num = parseFloat(valStr);
    return isNaN(num) ? valStr : num;
  }
  if (type === 'BOOLEAN') {
    const lower = valStr.toLowerCase();
    if (lower === 'true' || lower === 't' || lower === '1') return true;
    if (lower === 'false' || lower === 'f' || lower === '0') return false;
  }
  return valStr;
}

/**
 * Parses raw CSV text into a table schema object.
 */
export function parseCSV(csvText, rawTableName = 'custom_table') {
  const grid = parseCSVRows(csvText);
  if (grid.length === 0) {
    throw new Error('CSV content is empty.');
  }

  const tableName = sanitizeIdentifier(rawTableName, 'custom_table');

  // Header processing
  const rawHeaders = grid[0];
  const order = [];
  const colCounts = {};

  rawHeaders.forEach((h, idx) => {
    let clean = sanitizeIdentifier(h, `col_${idx + 1}`);
    if (colCounts[clean]) {
      colCounts[clean]++;
      clean = `${clean}_${colCounts[clean]}`;
    } else {
      colCounts[clean] = 1;
    }
    order.push(clean);
  });

  const dataRows = grid.slice(1);
  const columnRawValues = {};
  order.forEach((col) => (columnRawValues[col] = []));

  dataRows.forEach((row) => {
    order.forEach((col, idx) => {
      columnRawValues[col].push(row[idx] ?? '');
    });
  });

  const columns = {};
  order.forEach((col) => {
    const type = inferType(columnRawValues[col]);
    columns[col] = { type };
  });

  const rows = dataRows.map((row) => {
    const rowObj = {};
    order.forEach((col, idx) => {
      const type = columns[col].type;
      const rawVal = row[idx] ?? '';
      rowObj[col] = parseTypedValue(rawVal, type);
    });
    return rowObj;
  });

  return {
    name: tableName,
    order,
    columns,
    rows,
  };
}

/**
 * Adds or updates a table in the database from CSV text.
 */
export function addTableFromCSV(db, csvText, rawTableName) {
  const table = parseCSV(csvText, rawTableName);
  db.tables[table.name] = table;
  return table;
}

/**
 * Serializes a database table to CSV text string.
 */
export function exportTableToCSV(table) {
  if (!table || !table.order) return '';
  const lines = [];

  // Header line
  lines.push(table.order.map(formatCSVField).join(','));

  // Data lines
  for (const row of table.rows) {
    const line = table.order
      .map((col) => formatCSVField(row[col]))
      .join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

function formatCSVField(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
