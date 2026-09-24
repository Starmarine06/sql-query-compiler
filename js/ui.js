// ui.js
// Pure rendering helpers - build HTML strings from pipeline outputs.

export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function fmtVal(v) {
  if (v === null || v === undefined) return '<span class="null-v">NULL</span>';
  if (typeof v === 'boolean') return v ? '<span class="bool-v">TRUE</span>' : '<span class="bool-v">FALSE</span>';
  if (typeof v === 'number') return esc(String(v));
  return esc(String(v));
}

// ---------- Tokens ----------

const TOKEN_COLOR = {
  keyword: 'tk-key',
  identifier: 'tk-id',
  number: 'tk-num',
  string: 'tk-str',
  op: 'tk-op',
  punct: 'tk-punc',
  eof: 'tk-eof',
};

export function renderTokens(tokens) {
  const body = tokens
    .map((t) => {
      if (t.type === 'eof') return '';
      const chip = `<span class="chip ${TOKEN_COLOR[t.type] || ''}">${esc(t.raw)}</span>`;
      return `<tr>
        <td>${t.pos.line}:${t.pos.col}</td>
        <td><span class="tt">${esc(t.type)}</span></td>
        <td>${chip}</td>
      </tr>`;
    })
    .join('');
  return `<table class="tbl token-tbl">
    <thead><tr><th>Pos</th><th>Type</th><th>Lexeme</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// ---------- Parse tree ----------

export function astToTree(ast) {
  const col = (n) => ({ label: n, cls: 'col' });
  const lit = (n) => ({ label: n.raw ?? String(n.value), cls: 'lit' });

  const condTree = (c) => {
    switch (c.kind) {
      case 'and':
      case 'or':
        return { label: c.kind.toUpperCase(), cls: 'bool', children: [condTree(c.left), condTree(c.right)] };
      case 'not':
        return { label: 'NOT', cls: 'bool', children: [condTree(c.operand)] };
      case 'cmp': {
        const right = c.right.kind === 'col' ? col(c.right.name) : lit(c.right);
        return { label: c.op, cls: 'op', children: [col(c.left.name), right] };
      }
      case 'in':
        return { label: 'IN', cls: 'pred', children: [col(c.col), ...c.values.map(lit)] };
      case 'like':
        return { label: 'LIKE', cls: 'pred', children: [col(c.col), lit({ raw: `'${c.pattern}'` })] };
      case 'null':
        return { label: `IS ${c.neg ? 'NOT ' : ''}NULL`, cls: 'pred', children: [col(c.col)] };
      default:
        return { label: '?', cls: 'lit' };
    }
  };

  switch (ast.kind) {
    case 'select': {
      const children = [];
      if (ast.distinct) children.push({ label: 'DISTINCT', cls: 'mod' });
      const colsNode = {
        label: ast.columns.map((c) => (c.expr.kind === 'star' ? '*' : c.alias ? `${c.expr.name} AS ${c.alias}` : c.expr.name)).join(', '),
        cls: 'cols',
      };
      children.push(colsNode);
      children.push({ label: ast.from, cls: 'table' });
      if (ast.where) children.push(condTree(ast.where));
      if (ast.orderBy.length) children.push({ label: ast.orderBy.map((o) => `${o.col} ${o.dir}`).join(', '), cls: 'order' });
      if (ast.limit !== null) children.push({ label: `LIMIT ${ast.limit}`, cls: 'mod' });
      return { label: 'SELECT', cls: 'root', children };
    }
    case 'insert':
      return {
        label: 'INSERT INTO ' + ast.table,
        cls: 'root',
        children: ast.columns.length
          ? [{ label: ast.columns.join(', '), cls: 'cols' }]
          : [],
      };
    case 'update':
      return {
        label: 'UPDATE ' + ast.table,
        cls: 'root',
        children: [
          { label: ast.set.map((s) => `${s.col} = ${s.value.raw}`).join(', '), cls: 'cols' },
          ...(ast.where ? [condTree(ast.where)] : []),
        ],
      };
    case 'delete':
      return {
        label: 'DELETE FROM ' + ast.table,
        cls: 'root',
        children: ast.where ? [condTree(ast.where)] : [],
      };
    case 'createTable':
      return {
        label: 'CREATE TABLE ' + ast.table,
        cls: 'root',
        children: [{ label: ast.columns.map((c) => `${c.name} ${c.type}`).join(', '), cls: 'cols' }],
      };
    default:
      return { label: '?', cls: 'root' };
  }
}

function treeHtml(node) {
  const kids = node.children && node.children.length
    ? `<ul>${node.children.map(treeHtml).join('')}</ul>`
    : '';
  return `<li class="tn ${node.cls || ''}">${esc(node.label)}${kids}</li>`;
}

export function renderParseTree(ast) {
  return `<ul class="ptree">${treeHtml(astToTree(ast))}</ul>`;
}

// ---------- Semantic ----------

export function renderSemantic(result) {
  const { errors, warnings } = result;
  const parts = [];
  if (!errors.length && !warnings.length) {
    parts.push(`<div class="ok-banner">✓ Semantic check passed - column and table references are valid.</div>`);
  }
  if (errors.length) {
    parts.push(`<div class="err-banner">✗ ${errors.length} semantic error(s):</div><ul class="emsg">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
  }
  if (warnings.length) {
    parts.push(`<div class="warn-banner">⚠ ${warnings.length} warning(s):</div><ul class="emsg warn">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`);
  }
  return parts.join('');
}

// ---------- Plan trees ----------

export function renderPlans(plans) {
  const t = (node) => `<div class="plan">${planHtml(node)}</div>`;
  const chips = plans.applied
    .map((a) => `<span class="chip opt-chip ${a.includes('None') ? 'chip-dim' : ''}">${esc(a)}</span>`)
    .join('');
  const notes = plans.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  return `
    <div class="plan-grid">
      <div class="plan-col">
        <div class="plan-head">Original query plan <span class="muted">(naive)</span></div>
        ${t(plans.original)}
      </div>
      <div class="plan-col plan-opt">
        <div class="plan-head">Optimized query plan</div>
        ${t(plans.optimized)}
      </div>
    </div>
    <div class="opt-foot">
      <div><strong>Optimizations applied:</strong> ${chips}</div>
      <ul class="opt-notes">${notes}</ul>
    </div>`;
}

export function planHtml(node) {
  const kids = node.children && node.children.length
    ? `<ul>${node.children.map(planHtml).join('')}</ul>`
    : '';
  return `<li class="pn ${node.cls}"><span class="psym">${esc(node.sym)}</span><span class="plab">${esc(node.label)}</span>${node.note ? `<span class="pnote">${esc(node.note)}</span>` : ''}${kids}</li>`;
}

// ---------- Change preview ----------

export function renderSelectResult(sim) {
  const head = sim.outCols.map((c) => `<th>${esc(c)}</th>`).join('');
  const rows = sim.rows
    .map((r) => `<tr>${sim.outCols.map((c) => `<td>${fmtVal(r[c])}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="tbl diff-tbl"><thead><tr>${head}</tr></thead><tbody>${rows || '<tr><td class="empty" colspan="99">No rows</td></tr>'}</tbody></table>`;
}

export function renderDiff(sim) {
  if (sim.kind === 'select') return renderSelectResult(sim);

  const columns = sim.columns || [];
  const changed = sim.changedByRid || {};
  const deleted = sim.deletedRids || new Set();
  const added = sim.addedRids || new Set();

  const beforeById = new Map(sim.before.map((r) => [r._rid, r]));
  const afterById = new Map(sim.after.map((r) => [r._rid, r]));

  // display order: rows that existed before (in original order), then inserted rows
  const order = [...sim.before.map((r) => r._rid), ...sim.after.filter((r) => typeof r._rid === 'string').map((r) => r._rid)];

  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');

  // Before table
  const beforeRows = sim.before
    .map((r) => {
      const isDel = deleted.has(r._rid);
      const cls = isDel ? 'row-del' : '';
      const tds = columns
        .map((c) => {
          const isOld = !isDel && changed[r._rid] && r._rid in changed && Object.prototype.hasOwnProperty.call(changed[r._rid], c);
          return `<td class="${isOld ? 'cell-old' : ''}">${isOld ? '<span class="old-mark">' + fmtVal(r[c]) + '</span>' : fmtVal(r[c])}</td>`;
        })
        .join('');
      return `<tr class="${cls}">${tds}</tr>`;
    })
    .join('');

  // After table (same row order, deleted rows shown as ghost placeholders)
  const afterRows = order
    .map((rid) => {
      if (deleted.has(rid)) {
        return `<tr class="row-ghost"><td class="ghost-note" colspan="${columns.length}">row removed</td></tr>`;
      }
      const r = afterById.get(rid);
      if (!r) return '';
      const isAdded = added.has(rid);
      const tds = columns
        .map((c) => {
          if (isAdded) return `<td class="cell-add">${fmtVal(r[c])}</td>`;
          const beforeRow = beforeById.get(rid);
          const isNew =
            beforeRow && Object.prototype.hasOwnProperty.call(changed[rid] || {}, c) &&
            beforeRow[c] !== r[c];
          return `<td class="${isNew ? 'cell-new' : ''}">${fmtVal(r[c])}</td>`;
        })
        .join('');
      return `<tr class="${isAdded ? 'row-add' : ''}">${tds}</tr>`;
    })
    .join('');

  const beforeTbl = sim.before.length
    ? `<table class="tbl diff-tbl"><thead><tr>${head}</tr></thead><tbody>${beforeRows}</tbody></table>`
    : `<div class="empty">Table is empty</div>`;
  const afterTbl = afterRows.replace(/<tr class=""><\/tr>/g, '')
    ? `<table class="tbl diff-tbl"><thead><tr>${head}</tr></thead><tbody>${afterRows}</tbody></table>`
    : `<div class="empty">Table is empty</div>`;

  return `
    <div class="diff-grid">
      <div>
        <div class="diff-label">Before</div>
        ${beforeTbl}
      </div>
      <div class="diff-arrow">→</div>
      <div>
        <div class="diff-label">After</div>
        ${afterTbl}
      </div>
    </div>`;
}

export function renderImpact(sim) {
  const cards = [];
  const detail = [];
  let headline = '';

  if (sim.kind === 'select') {
    cards.push(card(sim.resultCount, 'rows returned'));
    cards.push(card(sim.totalRows - sim.matched, 'rows filtered out'));
    headline = `SELECT returns ${sim.resultCount} of ${sim.totalRows} row(s) from '${sim.from}' - no data is modified.`;
  }

  if (sim.kind === 'insert') {
    const afterCount = sim.after.length;
    cards.push(card(sim.affectedRows, 'rows inserted'));
    cards.push(card(sim.totalRows, 'rows before'));
    cards.push(card(afterCount, 'rows after'));
    headline = `INSERT would add ${sim.affectedRows} row(s) to '${sim.table}' (${sim.totalRows} → ${afterCount}).`;
    sim.after
      .filter((r) => typeof r._rid === 'string')
      .forEach((r) => detail.push(`+ added ${sim.columns.map((c) => `${c}=${fmt(entity(r[c]))}`).join(', ')}`));
  }

  if (sim.kind === 'update') {
    const matched = sim.affectedRows;
    const rowsChanged = sim.rowsChanged;
    cards.push(card(rowsChanged, 'rows changed'));
    cards.push(card(matched, 'rows matched'));
    cards.push(card(sim.totalRows - matched, 'rows untouched'));
    headline =
      matched === 0
        ? `No rows in '${sim.table}' match the WHERE clause - this UPDATE would change nothing.`
        : `UPDATE would modify ${rowsChanged} of ${matched} matching row(s) in '${sim.table}'.`;
    for (const [rid, cell] of Object.entries(sim.changedByRid)) {
      const row = sim.before.find((r) => r._rid === rid);
      const cols = Object.keys(cell);
      cols.forEach((c) => detail.push(`~ ${row && row.name ? row.name : `row ${rid}`}: ${c} ${fmt(entity(row[c]))} → ${fmt(entity(cell[c]))}`));
    }
  }

  if (sim.kind === 'delete') {
    const removed = sim.matched;
    const afterCount = sim.after.length;
    cards.push(card(removed, 'rows removed'));
    cards.push(card(sim.totalRows, 'rows before'));
    cards.push(card(afterCount, 'rows after'));
    headline =
      removed === 0
        ? `No rows in '${sim.table}' match the WHERE clause - nothing would be deleted.`
        : `DELETE would remove ${removed} row(s) from '${sim.table}' (${sim.totalRows} → ${afterCount}).`;
    sim.before
      .filter((r) => sim.deletedRids.has(r._rid))
      .forEach((r) => detail.push(`− removed ${sim.columns.map((c) => `${c}=${fmt(entity(r[c]))}`).join(', ')}`));
  }

  if (sim.kind === 'createTable') {
    cards.push(card(sim.columns.length, 'new columns'));
    cards.push(card(0, 'rows'));
    headline = `CREATE TABLE would add a new empty relation '${sim.table}' with ${sim.columns.length} column(s): ${sim.columns.join(', ')}.`;
  }

  const flags = sim.affectedRows === 0 && sim.kind !== 'createTable'
    ? `<div class="warn-banner">⚠ This command would have <strong>no effect</strong> on the current data.</div>`
    : '';

  return `
    <div class="impact-head">${esc(headline)}</div>
    ${flags}
    <div class="impact-cards">${cards.join('')}</div>
    ${detail.length ? `<ul class="impact-detail">${detail.map((d) => `<li>${d}</li>`).join('')}</ul>` : ''}
  `;
}

function card(num, label) {
  return `<div class="stat-card"><div class="stat-num">${num ?? 0}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function entity(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return typeof v === 'object' ? JSON.stringify(v) : v;
}
function fmt(v) {
  return v === null || v === undefined ? 'NULL' : String(v);
}

// ---------- DB explorer ----------

export function renderDbExplorer(db) {
  const tables = Object.values(db.tables)
    .map((t) => {
      const head = t.order.map((c) => `<th>${esc(c)}</th>`).join('');
      const body = t.rows
        .map((r) => `<tr>${t.order.map((c) => `<td>${fmtVal(r[c])}</td>`).join('')}</tr>`)
        .join('') || '<tr><td class="empty" colspan="99">empty</td></tr>';
      return `
        <div class="explorer-tbl">
          <div class="explorer-name">${esc(t.name)} <span class="muted">(${Object.keys(t.columns).length} cols · ${t.rows.length} rows)</span></div>
          <table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        </div>`;
    })
    .join('');
  return tables;
}