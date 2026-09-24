// optimizer.js
// Phase 5 + 6 - IR Generation & Query Optimization.
// Builds a relational algebra tree for the query (the intermediate
// representation) and a second, optimized tree using:
//   * Predicate pushdown   (σ applied directly at the scan - filter rows early)
//   * Projection pushdown  (π split so only needed columns flow up)

import { evalCond } from './eval.js';

function scanNode(table, db) {
  const t = db.tables[table];
  return {
    sym: 'T',
    label: table,
    note: `${t.order.length} col(s) · ${t.rows.length} row(s)`,
    cls: 'scan',
    children: [],
  };
}

function projectNode(cols, totalCols, rows, noteSuffix = '') {
  return {
    sym: 'π',
    label: cols.join(', '),
    note: `${cols.length} of ${totalCols} col(s) · ${rows} row(s)${noteSuffix}`,
    cls: 'project',
    children: [],
  };
}

function filterNode(condText, matched, total) {
  return {
    sym: 'σ',
    label: condText,
    note: `keeps ${matched} of ${total} row(s)`,
    cls: 'filter',
    children: [],
  };
}

function sortNode(orderBy, rows) {
  return {
    sym: 'τ',
    label: orderBy.map((o) => `${o.col} ${o.dir}`).join(', '),
    note: `sorts ${rows} row(s)`,
    cls: 'sort',
    children: [],
  };
}

function emptyPlan(ast, db) {
  if (ast.kind === 'createTable') {
    return {
      sym: '∂',
      label: `CREATE TABLE ${ast.table} (${ast.columns.map((c) => c.name + ' ' + c.type).join(', ')})`,
      note: '0 rows · creates a new empty relation',
      cls: 'create',
      children: [],
    };
  }

  // INSERT - a simple append; no scan to filter or project
  return {
    sym: 'δ',
    label: `INSERT ${ast.rows.length} row(s) → ${ast.table}`,
    note: `appends ${ast.rows.length} row(s) · total becomes ${db.tables[ast.table] ? db.tables[ast.table].rows.length + ast.rows.length : '?'}`,
    cls: 'modify',
    children: [],
  };
}

export function buildPlans(ast, db, execRes) {
  if (ast.kind === 'select') {
    const t = db.tables[ast.from];
    const total = t.rows.length;

    const outCols = ast.columns[0].expr.kind === 'star'
      ? t.order
      : ast.columns.map((c) => c.expr.name);

    const needed = new Set(outCols);
    (ast.orderBy || []).forEach((o) => needed.add(o.col));
    const collectCols = (cond) => {
      if (!cond) return;
      const add = (n) => {
        if (!n) return;
        if (n.kind === 'col') needed.add(n.name);
      };
      switch (cond.kind) {
        case 'and':
        case 'or':
          collectCols(cond.left);
          collectCols(cond.right);
          break;
        case 'not':
          collectCols(cond.operand);
          break;
        case 'cmp':
          add(cond.left);
          add(cond.right);
          break;
        case 'in':
        case 'like':
        case 'null':
          needed.add(cond.col);
          break;
        default:
          break;
      }
    };
    collectCols(ast.where);
    const neededCols = t.order.filter((c) => needed.has(c));

    // real row counts (from the simulation, already computed)
    const matched = execRes && typeof execRes.matched === 'number' ? execRes.matched : total;
    const resultRows = execRes ? execRes.resultCount : matched;

    const condText = ast.where ? conditionText(ast.where) : null;
    const sortTxt = ast.orderBy;

    // ---- ORIGINAL (naive) plan: filter and sort happen as late as possible,
    //      carrying every column of the table. ----
    let original = null;
    if (condText) {
      original = projectNode(outCols, t.order.length, resultRows);
      const f = filterNode(condText, matched, total);
      if (sortTxt.length) {
        const s = sortNode(sortTxt, matched);
        f.children.push(s);
        original.children.push(f);
      } else {
        original.children.push(f);
      }
      original.children[original.children.length - 1].children.push(scanNode(ast.from, db));
    } else {
      original = projectNode(outCols, t.order.length, resultRows);
      let top = original;
      if (sortTxt.length) {
        const s = sortNode(sortTxt, total);
        top.children.push(s);
        top = s;
      }
      top.children.push(scanNode(ast.from, db));
    }

    // ---- OPTIMIZED plan: ----
    // predicate pushdown: σ goes directly on the scan
    // projection pushdown: a lower π discards every column that is not needed
    const applied = [];
    const notes = [];

    let optimized = projectNode(outCols, t.order.length, resultRows);
    let top = optimized;

    if (sortTxt.length) {
      const s = sortNode(sortTxt, matched);
      s.note = `sorts ${matched} row(s) · carries only ${neededCols.length} col(s)`;
      top.children.push(s);
      top = s;
    }

    if (condText) {
      const f = filterNode(condText, matched, total);
      f.note = `pushed to scan: reads ${total} row(s), emits ${matched}`;
      top.children.push(f);
      top = f;
      applied.push('Predicate pushdown');
      notes.push(`Predicate pushdown - the ${condText} filter is evaluated directly at the scan, so only ${matched} of ${total} rows flow upward instead of carrying all ${total} rows through the sort.`);
    }

    if (neededCols.length < t.order.length) {
      const pdown = projectNode(neededCols, t.order.length, total, ' · below σ/τ');
      top.children.push(pdown);
      const scan = scanNode(ast.from, db);
      pdown.children.push(scan);
      scan.note = `reads all ${total} row(s) · ${t.order.length} col(s) but only ${neededCols.length} are propagated`;
      applied.push('Projection pushdown');
      notes.push(`Projection pushdown - only the ${neededCols.length} column(s) actually referenced (${neededCols.join(', ')}) are propagated below the filter/sort; the other ${t.order.length - neededCols.length} column(s) are discarded early.`);
    } else {
      const scan = scanNode(ast.from, db);
      top.children.push(scan);
    }

    if (!applied.length) {
      notes.push('No optimization was applicable - the query already touches every column of the table.');
      applied.push('None required');
    }

    return { original, optimized, applied, notes };
  }

  // ---- DML plans ----
  const applied = [];
  const notes = [];

  if (ast.kind === 'createTable' || ast.kind === 'insert') {
    const node = emptyPlan(ast, db);
    return {
      original: node,
      optimized: node,
      applied: ['None required'],
      notes: [`A ${ast.kind.toUpperCase()} operation does not traverse the table - ${ast.kind === 'insert' ? 'it appends pre-computed values, so no scan-level optimization applies.' : 'nothing to scan yet, the relation is created empty.'}`],
      node,
    };
  }

  // UPDATE / DELETE
  const t = db.tables[ast.table];
  const total = t.rows.length;
  const matched =
    execRes && typeof execRes.matched === 'number'
      ? execRes.matched
      : ast.where
        ? t.rows.filter((r) => evalCond(ast.where, r)).length
        : total;

  const label =
    ast.kind === 'update'
      ? `UPDATE set ${ast.set.map((s) => `${s.col} = ${s.value.raw}`).join(', ')}`
      : ast.where
        ? 'DELETE matched rows'
        : 'DELETE all rows';

  const node = {
    sym: 'δ',
    label,
    note: `touches ${matched} of ${total} row(s)`,
    cls: 'modify',
    children: [],
  };

  if (ast.where) {
    const f = filterNode(conditionText(ast.where), matched, total);
    f.note = `pushed to scan: only ${matched} row(s) survive the filter`;
    f.children.push(scanNode(ast.table, db));
    node.children.push(f);
    applied.push('Predicate pushdown');
    notes.push(`Predicate pushdown - the ${conditionText(ast.where)} predicate is evaluated at the scan, so the ${ast.kind} operator only ever sees the ${matched} of ${total} matching row(s).`);
  } else {
    node.children.push(scanNode(ast.table, db));
    notes.push(`No WHERE clause - the ${ast.kind.toUpperCase()} touches every one of the ${total} row(s); no filtering possible.`);
  }

  return {
    original: { ...node, children: [...node.children] },
    optimized: { ...node, children: [...node.children] },
    applied: applied.length ? applied : ['None required'],
    notes,
    node,
  };
}

function conditionText(cond) {
  if (!cond) return null;
  switch (cond.kind) {
    case 'and': return `${conditionText(cond.left)} AND ${conditionText(cond.right)}`;
    case 'or': return `${conditionText(cond.left)} OR ${conditionText(cond.right)}`;
    case 'not': return `NOT (${conditionText(cond.operand)})`;
    case 'cmp': return `${cond.left.name} ${cond.op} ${valueText(cond.right)}`;
    case 'in': return `${cond.col} IN (${cond.values.map((v) => v.raw).join(', ')})`;
    case 'like': return `${cond.col} LIKE '${cond.pattern}'`;
    case 'null': return `${cond.col} IS ${cond.neg ? 'NOT ' : ''}NULL`;
    default: return '?';
  }
}

function valueText(node) {
  if (!node) return '?';
  if (node.kind === 'col') return node.name;
  return node.raw ?? String(node.value);
}