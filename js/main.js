// main.js
// Pipeline driver. Runs: Input -> Lexer -> Parser -> Semantic -> IR/Optimizer -> Execution preview.

import { SAMPLE_DB, cloneDb } from './database.js';
import { lex } from './lexer.js';
import { parse } from './parser.js';
import { analyze } from './semantic.js';
import { simulate, apply, runSelect } from './executor.js';
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

const EXAMPLES = [
  "SELECT * FROM employees;",
  "SELECT name, salary FROM employees WHERE department = 'Engineering' ORDER BY salary DESC;",
  "SELECT DISTINCT city FROM employees WHERE salary >= 90000;",
  "UPDATE employees SET salary = 95000 WHERE city = 'Pune';",
  "DELETE FROM employees WHERE department = 'HR' AND salary < 60000;",
  "INSERT INTO employees (id, name, department, salary, city) VALUES (11, 'Zoe', 'Sales', 99000, 'Noida');",
  "CREATE TABLE projects (id INT, title TEXT, budget INT);",
];

function describe(ast) {
  switch (ast.kind) {
    case 'select': {
      const cols = ast.columns.map((c) => (c.expr.kind === 'star' ? '*' : c.expr.name)).join(', ');
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

function renderDb() {
  $('db-explorer').innerHTML = renderDbExplorer(liveDb);
  const counts = Object.values(liveDb.tables).map((t) => `${t.name} (${t.rows.length})`).join(' · ');
  $('db-summary').textContent = counts;
}

function loadExample(i) {
  $('sql-input').value = EXAMPLES[i];
  $('sql-input').dispatchEvent(new Event('input'));
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
  setStage('stage-tokens', lexStripped.length ? renderTokens(tokens) : `<div class="empty">No tokens - the input is empty.</div>`);
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
  const toast = $('toast');
  toast.textContent = msg.message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
  run();
}

function resetDb() {
  liveDb = cloneDb(SAMPLE_DB);
  renderDb();
  const b = $('error-banner');
  b.innerHTML = `<div class="ok-banner">Database restored to its original sample state.</div>`;
  b.style.display = 'block';
  setTimeout(() => (b.style.display = 'none'), 2500);
  run();
}

// ---- init ----
function init() {
  renderDb();

  // example buttons
  const wrap = $('examples');
  EXAMPLES.forEach((ex, i) => {
    const btn = document.createElement('button');
    btn.className = 'chip example-chip';
    btn.textContent = ex.slice(0, 52).replace(/\s+/g, ' ') + (ex.length > 52 ? '…' : '');
    btn.title = ex;
    btn.onclick = () => loadExample(i);
    wrap.appendChild(btn);
  });

  const ta = $('sql-input');
  ta.addEventListener('input', () => $('run-btn').disabled = !ta.value.trim());
  $('run-btn').addEventListener('click', run);
  $('apply-btn').addEventListener('click', applyChanges);
  $('reset-btn').addEventListener('click', resetDb);

  ta.value = EXAMPLES[1];
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