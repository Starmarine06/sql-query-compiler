// semantic.js
// Phase 3 - Semantic Analysis.
// Validates table names, column names, arities and value types against the
// database catalog. Produces errors (block execution) and warnings (displayed).

const NUMERIC_TYPES = new Set(['INT', 'INTEGER', 'REAL', 'FLOAT', 'DECIMAL']);
const TEXT_TYPES = new Set(['TEXT', 'VARCHAR', 'CHAR', 'DATE']);

export function analyze(ast, db) {
  const errors = [];
  const warnings = [];
  const tableRef = ast.kind === 'select' ? ast.from : ast.table;
  const table = db.tables[tableRef];

  const checkColumns = (colNames, context) => {
    if (!table) return;
    for (const c of colNames) {
      if (!(c in table.columns)) {
        errors.push(`Column '${c}' does not exist in table '${tableRef}'${context ? ` (${context})` : ''}.`);
      }
    }
  };

  const walkCond = (cond) => {
    if (!cond) return;
    switch (cond.kind) {
      case 'and':
      case 'or':
        walkCond(cond.left);
        walkCond(cond.right);
        break;
      case 'not':
        walkCond(cond.operand);
        break;
      case 'cmp':
        if (cond.left.kind === 'col') checkColumns([cond.left.name], 'WHERE or SET');
        if (cond.right.kind === 'col') checkColumns([cond.right.name], 'WHERE');
        break;
      case 'in':
      case 'like':
      case 'null':
        checkColumns([cond.col], 'WHERE');
        break;
      default:
        break;
    }
  };

  switch (ast.kind) {
    case 'select': {
      const t = db.tables[ast.from];
      if (!t) {
        errors.push(`Table '${ast.from}' does not exist in the database catalog.`);
        break;
      }
      if (ast.columns[0].expr.kind === 'star') {
        // fine, all columns
      } else {
        for (const c of ast.columns) checkColumns([c.expr.name], 'SELECT list');
      }
      walkCond(ast.where);
      if (ast.orderBy.length) checkColumns(ast.orderBy.map((o) => o.col), 'ORDER BY');
      if (ast.limit !== null && ast.limit < 0) errors.push('LIMIT must be a non-negative integer.');
      break;
    }

    case 'insert': {
      if (!table) {
        errors.push(`Table '${ast.table}' does not exist in the database catalog.`);
        break;
      }
      const cols = ast.columns.length ? ast.columns : table.order;
      checkColumns(cols, 'INSERT');
      for (const row of ast.rows) {
        if (row.length !== cols.length) {
          if (ast.columns.length) {
            errors.push(`INSERT provides ${row.length} value(s) for ${cols.length} column(s).`);
          } else {
            errors.push(`INSERT provides ${row.length} value(s) but table '${ast.table}' has ${cols.length} column(s).`);
          }
          continue;
        }
        row.forEach((v, i) => {
          const col = cols[i];
          const type = table.columns[col]?.type;
          if (!type) return;
          if (v.type === 'null') return;
          if (NUMERIC_TYPES.has(type) && v.type !== 'number') {
            warnings.push(`Value '${v.raw}' for column '${col}' (${type}) may be converted; expected a number.`);
          }
          if (TEXT_TYPES.has(type) && v.type === 'number') {
            warnings.push(`Value ${v.raw} for column '${col}' (${type}) will be stored as text.`);
          }
        });
      }
      break;
    }

    case 'update': {
      if (!table) {
        errors.push(`Table '${ast.table}' does not exist in the database catalog.`);
        break;
      }
      checkColumns(ast.set.map((s) => s.col), 'SET');
      walkCond(ast.where);
      break;
    }

    case 'delete': {
      if (!table) {
        errors.push(`Table '${ast.table}' does not exist in the database catalog.`);
        break;
      }
      walkCond(ast.where);
      break;
    }

    case 'createTable': {
      if (table) {
        errors.push(`Table '${ast.table}' already exists.`);
        break;
      }
      const seen = new Set();
      for (const c of ast.columns) {
        if (seen.has(c.name)) errors.push(`Duplicate column '${c.name}' in CREATE TABLE.`);
        seen.add(c.name);
      }
      break;
    }
    default:
      errors.push('Unsupported statement type.');
  }

  return { errors, warnings };
}