// executor.js
// Simulates the command against a COPY of the database (dry-run) so the UI can
// show "the change that would occur if this command is run".
// Also applies the command for real (mutating the live DB) when the user chooses.

import { cloneDb } from './database.js';
import { compare, evalCond } from './eval.js';

function tagRows(rows) {
  return rows.map((r, i) => ({ ...r, _rid: i }));
}

function sortRows(rows, orderBy) {
  const copy = [...rows];
  copy.sort((a, b) => {
    for (const ob of orderBy) {
      const c = compare(a[ob.col], b[ob.col]);
      if (c !== 0) return ob.dir === 'DESC' ? -c : c;
    }
    return 0;
  });
  return copy;
}

// --- SELECT simulation ---

export function runSelect(db, ast) {
  const table = db.tables[ast.from];
  const outCols =
    ast.columns[0].expr.kind === 'star' ? table.order : ast.columns.map((c) => c.expr.name);
  const totalRows = table.rows.length;

  let rows = tagRows(table.rows);
  let matched = rows.length;

  if (ast.where) {
    rows = rows.filter((r) => evalCond(ast.where, r));
    matched = rows.length;
  }
  if (ast.orderBy.length) rows = sortRows(rows, ast.orderBy);
  if (ast.limit !== null) rows = rows.slice(0, ast.limit);

  let projected = rows.map((r) => {
    const out = { _rid: r._rid };
    for (const c of outCols) out[c] = r[c];
    return out;
  });

  if (ast.distinct) {
    const seen = new Set();
    projected = projected.filter((r) => {
      const key = JSON.stringify(outCols.map((c) => r[c]));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return {
    kind: 'select',
    from: ast.from,
    outCols,
    rows: projected.map((r) => {
      const { _rid, ...rest } = r;
      return rest;
    }),
    totalRows,
    matched,
    resultCount: projected.length,
  };
}

// --- DML simulation (dry-run) ---

export function simulate(db, ast) {
  if (ast.kind === 'select') {
    const res = runSelect(db, ast);
    return res;
  }

  const table = db.tables[ast.table];

  if (ast.kind === 'insert') {
    const cols = ast.columns.length ? ast.columns : table.order;
    const before = tagRows(table.rows);
    const added = ast.rows.map((vals, k) => {
      const obj = { _rid: 'A' + k };
      cols.forEach((c, i) => (obj[c] = vals[i].value));
      return obj;
    });
    return {
      kind: 'insert',
      table: ast.table,
      columns: table.order,
      before,
      after: [...before, ...added],
      changedByRid: {},
      deletedRids: new Set(),
      addedRids: new Set(added.map((a) => a._rid)),
      affectedRows: added.length,
      matched: added.length,
      totalRows: table.rows.length,
    };
  }

  if (ast.kind === 'update') {
    const before = tagRows(table.rows);
    const after = [];
    const changedByRid = {};
    let affected = 0;
    let actualChanges = 0;

    for (const r of before) {
      if (ast.where && !evalCond(ast.where, r)) {
        after.push(r);
        continue;
      }
      affected++;
      const cell = {};
      let rowChanged = false;
      for (const s of ast.set) {
        const v = s.value.value;
        if (compare(r[s.col], v) !== 0) {
          cell[s.col] = v;
          rowChanged = true;
        }
      }
      if (rowChanged) {
        actualChanges++;
        changedByRid[r._rid] = cell;
      }
      after.push({ ...r, ...cell });
    }

    return {
      kind: 'update',
      table: ast.table,
      columns: table.order,
      before,
      after,
      changedByRid,
      deletedRids: new Set(),
      addedRids: new Set(),
      affectedRows: affected,
      rowsChanged: actualChanges,
      matched: affected,
      totalRows: table.rows.length,
    };
  }

  if (ast.kind === 'delete') {
    const before = tagRows(table.rows);
    const deletedRids = new Set();
    const after = [];
    let matched = 0;
    for (const r of before) {
      if (!ast.where || evalCond(ast.where, r)) {
        deletedRids.add(r._rid);
        matched++;
      } else {
        after.push(r);
      }
    }
    return {
      kind: 'delete',
      table: ast.table,
      columns: table.order,
      before,
      after,
      changedByRid: {},
      deletedRids,
      addedRids: new Set(),
      affectedRows: matched,
      matched,
      totalRows: table.rows.length,
    };
  }

  if (ast.kind === 'createTable') {
    const cols = ast.columns.map((c) => c.name);
    const tableDef = {
      name: ast.table,
      order: cols,
      columns: Object.fromEntries(cols.map((c, i) => [c, { type: ast.columns[i].type }])),
      rows: [],
    };
    return {
      kind: 'createTable',
      table: ast.table,
      columns: cols,
      before: [],
      after: [],
      newTable: tableDef,
      affectedRows: 0,
      totalRows: 0,
    };
  }

  return null;
}

// --- Apply for real (mutates the live DB) ---

export function apply(db, ast) {
  if (ast.kind === 'select') return { message: 'SELECT does not modify the database.' };

  if (ast.kind === 'insert') {
    const table = db.tables[ast.table];
    const cols = ast.columns.length ? ast.columns : table.order;
    for (const vals of ast.rows) {
      const obj = {};
      cols.forEach((c, i) => (obj[c] = vals[i].value));
      table.rows.push(obj);
    }
    return { message: `Applied: inserted ${ast.rows.length} row(s) into '${ast.table}'.` };
  }

  if (ast.kind === 'update') {
    const table = db.tables[ast.table];
    let matched = 0;
    for (const r of table.rows) {
      if (ast.where && !evalCond(ast.where, r)) continue;
      matched++;
      for (const s of ast.set) r[s.col] = s.value.value;
    }
    return { message: `Applied: updated ${matched} row(s) in '${ast.table}'.` };
  }

  if (ast.kind === 'delete') {
    const table = db.tables[ast.table];
    const beforeCount = table.rows.length;
    table.rows = table.rows.filter((r) => !ast.where || !evalCond(ast.where, r));
    const removed = beforeCount - table.rows.length;
    return { message: `Applied: deleted ${removed} row(s) from '${ast.table}'.` };
  }

  if (ast.kind === 'createTable') {
    const cols = ast.columns.map((c) => c.name);
    db.tables[ast.table] = {
      name: ast.table,
      order: cols,
      columns: Object.fromEntries(cols.map((c, i) => [c, { type: ast.columns[i].type }])),
      rows: [],
    };
    return { message: `Applied: created table '${ast.table}'.` };
  }

  return { message: 'Nothing to apply.' };
}