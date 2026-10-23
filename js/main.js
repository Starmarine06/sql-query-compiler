// main.js
// Pipeline driver. Runs: Input -> Lexer -> Parser -> Semantic -> IR/Optimizer -> Execution preview.

import { SAMPLE_DB, cloneDb, addTableFromCSV, exportTableToCSV } from './database.js';
import { lex } from './lexer.js';
import { parse } from './parser.js';
import { analyze } from './semantic.js';
import { simulate, apply } from './executor.js';
import { buildPlans } from './optimizer.js';
import {
  renderTokens,
  renderParseTree,
  renderSemantic,
  renderPlans,
  renderDiff,
  renderImpact,
  renderDbExplorer,
  planHtml,
  esc,
} from './ui.js';

const $ = (id) => document.getElementById(id);

let liveDb = cloneDb(SAMPLE_DB);
let lastAst = null;
let lastSim = null;
let lastPlans = null;

const DEFAULT_EXAMPLES = [
  "SELECT * FROM employees;",
  "SELECT name, salary FROM employees WHERE department = 'Engineering' ORDER BY salary DESC;",
  "SELECT DISTINCT city FROM employees WHERE salary >= 90000;",
  "UPDATE employees SET salary = 95000 WHERE city = 'Pune';",
  "DELETE FROM employees WHERE department = 'HR' AND salary < 60000;",
  "INSERT INTO employees (id, name, department, salary, city) VALUES (11, 'Zoe', 'Sales', 99000, 'Noida');",
  "CREATE TABLE projects (id INT, title TEXT, budget INT);",
];

let activeExamples = [...DEFAULT_EXAMPLES];

function describe(ast) {
  switch (ast.kind) {
    case 'select': {
      const cols = ast.columns.map((c) => (c.expr.kind === 'star' ? '*' : c.alias ? `${c.expr.name} AS ${c.alias}` : c.expr.name)).join(', ');
      let s = `Reads rows of '${ast.from}', projects [${cols}]`;
      if (ast.where) s += `, keeping only rows where (${condText(ast.where)})`;
      if (ast.orderBy.length) s += `, sorted by ${ast.orderBy.map((o) => o.col + ' ' + o.dir).join(', ')}`;
      if (ast.limit !== null) s += `, limited to the first ${ast.limit}`;
      if (ast.distinct) s = `Removes duplicates, then ` + s.slice(0, 1).toLowerCase() + s.slice(1);
      return s + '.';
    }
    case 'insert': return `Appends ${ast.rows.length} row(s) of values to '${ast.table}'.`;
    case 'update': return `Sets ${ast.set.map((s) => `${s.col} = ${s.value.raw}`).join(', ')} on rows of '${ast.table}'${ast.where ? ` where (${condText(ast.where)})` : ''}.`;
    case 'delete': return `Removes rows from '${ast.table}'${ast.where ? ` where (${condText(ast.where)})` : ' (all rows!)'}.`;
    case 'createTable': return `Creates a new empty table '${ast.table}' with columns ${ast.columns.map((c) => c.name + ' ' + c.type).join(', ')}.`;
    default: return '';
  }
}

function condText(c) {
  if (!c) return '';
  switch (c.kind) {
    case 'and': return `${condText(c.left)} AND ${condText(c.right)}`;
    case 'or': return `${condText(c.left)} OR ${condText(c.right)}`;
    case 'not': return `NOT (${condText(c.operand)})`;
    case 'cmp': return `${c.left.name} ${c.op} ${c.right.raw ?? c.right.name}`;
    case 'in': return `${c.col} IN (${c.values.map((v) => v.raw).join(', ')})`;
    case 'like': return `${c.col} LIKE '${c.pattern}'`;
    case 'null': return `${c.col} IS ${c.neg ? 'NOT ' : ''}NULL`;
    default: return '?';
  }
}

function setStage(id, html, ok = true) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = html || '<div class="empty">—</div>';
  el.classList.toggle('stage-fail', !ok);
  return el;
}

function setProgress(upTo) {
  for (let i = 1; i <= 7; i++) {
    const dot = $('prog-' + i);
    if (!dot) continue;
    dot.dataset.state = i === upTo ? 'current' : i < upTo ? 'done' : 'todo';
  }
}

function showErrorBanner(msg) {
  const b = $('error-banner');
  b.innerHTML = `<strong>Pipeline stopped.</strong> ${esc(msg)} <button onclick="this.parentElement.innerHTML=''">&times; dismiss</button>`;
  b.style.display = 'block';
}

function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function renderDb() {
  $('db-explorer').innerHTML = renderDbExplorer(liveDb);
  const counts = Object.values(liveDb.tables).map((t) => `${t.name} (${t.rows.length})`).join(' · ');
  $('db-summary').textContent = counts ? `(${counts})` : '(empty catalog)';

  // Attach dynamic table actions (export CSV / remove table)
  document.querySelectorAll('.export-csv-btn').forEach((btn) => {
    btn.onclick = () => {
      const tblName = btn.dataset.table;
      const tbl = liveDb.tables[tblName];
      if (!tbl) return;
      const csvStr = exportTableToCSV(tbl);
      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${tblName}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(`Exported ${tblName}.csv`);
    };
  });

  document.querySelectorAll('.drop-table-btn').forEach((btn) => {
    btn.onclick = () => {
      const tblName = btn.dataset.table;
      if (confirm(`Remove table '${tblName}' from database catalog?`)) {
        delete liveDb.tables[tblName];
        renderDb();
        updateExamplesForCatalog();
        showToast(`Table '${tblName}' removed.`);
        run();
      }
    };
  });
}

function updateExamplesForCatalog() {
  const tableNames = Object.keys(liveDb.tables);
  if (!tableNames.length) {
    activeExamples = ["CREATE TABLE items (id INT, name TEXT, qty INT);"];
  } else {
    activeExamples = [...DEFAULT_EXAMPLES];
    // Add dynamic query examples for imported custom tables
    const customTables = tableNames.filter((t) => t !== 'employees' && t !== 'departments');
    customTables.forEach((t) => {
      activeExamples.unshift(`SELECT * FROM ${t};`);
    });
  }
  renderExamples();
}

function renderExamples() {
  const wrap = $('examples');
  wrap.innerHTML = '';
  activeExamples.slice(0, 8).forEach((ex) => {
    const btn = document.createElement('button');
    btn.className = 'chip example-chip';
    btn.textContent = ex.slice(0, 50).replace(/\s+/g, ' ') + (ex.length > 50 ? '…' : '');
    btn.title = ex;
    btn.onclick = () => {
      $('sql-input').value = ex;
      $('sql-input').dispatchEvent(new Event('input'));
      run();
    };
    wrap.appendChild(btn);
  });
}

function handleCSVTextImport(csvText, fileName) {
  try {
    const rawName = fileName.replace(/\.[^/.]+$/, '');
    const importedTable = addTableFromCSV(liveDb, csvText, rawName);
    renderDb();
    updateExamplesForCatalog();
    showToast(`Table '${importedTable.name}' successfully imported from CSV (${importedTable.rows.length} rows).`);

    // Auto load a sample query for the imported table
    $('sql-input').value = `SELECT * FROM ${importedTable.name};`;
    $('sql-input').dispatchEvent(new Event('input'));
    run();
  } catch (e) {
    alert(`CSV Import Error: ${e.message}`);
  }
}

function run() {
  const sql = $('sql-input').value;
  $('error-banner').style.display = 'none';

  setProgress(0);

  // Stage 1 - Lexical
  let tokens;
  try {
    tokens = lex(sql);
  } catch (e) {
    setStage('stage-tokens', `<div class="err-banner">Lexical error.${e.message ? ' ' + esc(e.message) : ''}</div>`, false);
    setStage('stage-parse', '');
    setStage('stage-semantic', '');
    setStage('stage-ir', '');
    setStage('stage-opt', '');
    setStage('stage-change', '');
    setProgress(1);
    return;
  }
  const lexStripped = tokens.filter((t) => t.type !== 'eof');
  setStage('stage-tokens', lexStripped.length ? renderTokens(tokens) : `<div class="empty">No tokens - input is empty.</div>`);
  setProgress(1);
  if (!lexStripped.length) return;

  // Stage 2 - Parse
  let ast;
  try {
    ast = parse(tokens);
  } catch (e) {
    setStage('stage-parse', `<div class="err-banner">Syntax error.<br>${esc(e.message)}</div>`, false);
    setStage('stage-semantic', '');
    setStage('stage-ir', '');
    setStage('stage-opt', '');
    setStage('stage-change', '');
    setProgress(2);
    return;
  }
  lastAst = ast;
  setStage('stage-parse', renderParseTree(ast));
  setProgress(2);

  // Stage 3 - Semantic
  const sem = analyze(ast, liveDb);
  setStage('stage-semantic', renderSemantic(sem));
  setProgress(3);
  if (sem.errors.length) {
    setStage('stage-ir', '');
    setStage('stage-opt', '');
    setStage('stage-change', '');
    showErrorBanner('Semantic check failed - fix the errors above.');
    return;
  }

  // Stage 4 (5) - IR / Relational algebra
  const sim = simulate(liveDb, ast);
  lastSim = sim;

  // Stage 4+5 - plans & optimization
  const plans = buildPlans(ast, liveDb, sim);
  lastPlans = plans;
  setStage('stage-ir', `<div class="plan">${planHtml(plans.original)}</div>`);
  setProgress(4);
  setStage('stage-opt', renderPlans(plans));
  setProgress(5);

  // Stage 7 - Change preview
  setStage('stage-change', `<div class="impact-wrap">${renderImpact(sim)}${renderDiff(sim)}</div>`);
  setProgress(7);

  // Description
  $('stmt-description').innerHTML = descHtml(ast, plans);
  $('apply-btn').disabled = ast.kind === 'select';
  $('apply-btn').classList.toggle('hidden', ast.kind === 'select');
}

function descHtml(ast, plans) {
  const chips = plans.applied.map((a) => `<span class="chip ${a.includes('None') ? 'chip-dim' : ''} opt-chip">${esc(a)}</span>`).join('');
  return `
    <div class="desc-line"><strong>What this command does:</strong> ${esc(describe(ast))}</div>
    <div class="desc-line"><strong>Optimization:</strong> ${chips}</div>`;
}

function applyChanges() {
  if (!lastAst) return;
  const msg = apply(liveDb, lastAst);
  renderDb();
  showToast(msg.message);
  run();
}

function resetDb() {
  liveDb = cloneDb(SAMPLE_DB);
  renderDb();
  updateExamplesForCatalog();
  const b = $('error-banner');
  b.innerHTML = `<div class="ok-banner">Database restored to default sample state.</div>`;
  b.style.display = 'block';
  setTimeout(() => (b.style.display = 'none'), 2500);
  run();
}

// ---- init ----
function init() {
  renderDb();
  updateExamplesForCatalog();

  const ta = $('sql-input');
  ta.addEventListener('input', () => $('run-btn').disabled = !ta.value.trim());
  $('run-btn').addEventListener('click', run);
  $('apply-btn').addEventListener('click', applyChanges);
  $('reset-btn').addEventListener('click', resetDb);

  // CSV File upload events
  const fileInput = $('csv-file-input');
  const uploadBtn = $('upload-csv-btn');
  const dropZone = $('csv-drop-zone');

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => handleCSVTextImport(evt.target.result, file.name);
    reader.readAsText(file);
    fileInput.value = '';
  });

  // Drag and drop setup
  if (dropZone) {
    dropZone.addEventListener('click', () => fileInput.click());
    ['dragenter', 'dragover'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-active');
      });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-active');
      });
    });
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => handleCSVTextImport(evt.target.result, file.name);
        reader.readAsText(file);
      }
    });
  }

  ta.value = DEFAULT_EXAMPLES[1];
  $('run-btn').disabled = false;

  $('sql-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });

  run();
}

document.addEventListener('DOMContentLoaded', init);
