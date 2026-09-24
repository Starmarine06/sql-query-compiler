import { SAMPLE_DB, cloneDb } from './js/database.js';
import { lex } from './js/lexer.js';
import { parse } from './js/parser.js';
import { analyze } from './js/semantic.js';
import { simulate, apply } from './js/executor.js';
import { buildPlans } from './js/optimizer.js';

const cases = [
  "SELECT * FROM employees;",
  "SELECT DISTINCT city FROM employees WHERE salary >= 90000;",
  "SELECT name, salary FROM employees WHERE department = 'Engineering' AND salary > 100000 ORDER BY salary DESC;",
  "SELECT name FROM employees WHERE department LIKE 'Sa%' LIMIT 3;",
  "SELECT name FROM employees WHERE city IN ('Pune', 'Mumbai');",
  "UPDATE employees SET salary = 95000 WHERE city = 'Pune';",
  "UPDATE employees SET salary = 999999 WHERE city = 'Nowhere';",
  "DELETE FROM employees WHERE department = 'HR' AND salary < 60000;",
  "DELETE FROM employees WHERE department = 'Sales';",
  "INSERT INTO employees (id, name, department, salary, city) VALUES (11, 'Zoe', 'Sales', 99000, 'Noida'), (12, 'Max', 'HR', 70000, 'Delhi');",
  "INSERT INTO employees VALUES (13, 'Tom', 'Sales', 80000, 'Pune');",
  "CREATE TABLE projects (id INT, title TEXT, budget INT);",
  "SELECT missing_col FROM employees;",
  "SELECT * FROM missing_table;",
  "INSERT INTO employees (id, name, department, salary, city) VALUES (1);",
  "UPDATE missing_t SET salary = 1;",
  "SELECT name FROM employees;",
  "DELETE FROM departments;",
  "SELECT id FROM employees WHERE salary IS NULL;",
  "SELECT name FROM employees WHERE department = 'hr';",
  "SELECT * FROM employees ORDER BY salary;",
];

let pass = 0, fail = 0;
for (const sql of cases) {
  try {
    const tokens = lex(sql);
    const ast = parse(tokens);
    const sem = analyze(ast, SAMPLE_DB);
    if (sem.errors.length) {
      console.log('SEMERR  :', sql, '->', sem.errors.join(' | '));
      pass++;
      continue;
    }
    const res = simulate(SAMPLE_DB, ast);
    const plans = buildPlans(ast, SAMPLE_DB, res);
    if (res.kind === 'select') {
      console.log(`OK      : ${sql} -> ${res.resultCount} of ${res.matched} matched (of ${res.totalRows}), cols [${res.outCols}]`);
    } else if (res.kind === 'createTable') {
      console.log(`OK      : ${sql} -> new table ${res.table}, ${res.columns.length} cols`);
    } else {
      const del = res.deletedRids ? res.deletedRids.size : 0;
      const chg = Object.keys(res.changedByRid || {}).length;
      console.log(`OK      : ${sql} -> before=${res.before.length} after=${res.after.length} deleted=${del} changed=${chg}`);
    }
    if (plans.notes) {
      for (const n of plans.notes) console.log('         note:', n);
    }
    pass++;
  } catch (e) {
    fail++;
    console.log('ERR     :', sql, '->', e.kind || 'runtime', e.message || e);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);

// apply(reapply) sanity sequence
const db = cloneDb(SAMPLE_DB);
const seq = [];
seq.push('start=' + db.tables.employees.rows.length);
apply(db, parse(lex("UPDATE employees SET salary = 100000 WHERE department = 'Sales';")));
seq.push('updated=' + db.tables.employees.rows.filter(r => r.salary === 100000).length);
apply(db, parse(lex("DELETE FROM employees WHERE city = 'Pune';")));
seq.push('del-pune=' + db.tables.employees.rows.length);
apply(db, parse(lex("INSERT INTO employees (id, name, department, salary, city) VALUES (11, 'Zoe', 'Sales', 99000, 'Noida');")));
seq.push('inserted=' + db.tables.employees.rows.length);
apply(db, parse(lex("CREATE TABLE projects (id INT);")));
seq.push('tables=' + Object.keys(db.tables).join(','));
console.log('apply() sequence:', seq.join('  '));
// sanity: values
const row = db.tables.employees.rows.find(r => r.name === 'Zoe');
console.log('row check:', JSON.stringify(row));