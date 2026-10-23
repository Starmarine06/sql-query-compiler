import { SAMPLE_DB, cloneDb, parseCSV, addTableFromCSV, exportTableToCSV } from './js/database.js';
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

// ---------- CSV Tests ----------
console.log('\n--- Running CSV Import & Custom DB Tests ---');
const sampleCsv = `Product ID, Product Name, Category, Price, In Stock, Release Date
101, "Super Widget, Pro", Hardware, 199.99, true, 2023-01-15
102, Mega Gadget, Hardware, 49.50, false, 2022-11-01
103, Software Suite, Digital, 299, true, 2024-05-10
104, "Cloud ""Storage"" Plan", Digital, 9.99, true, 2021-08-20`;

try {
  const csvTable = parseCSV(sampleCsv, 'Products Catalog!');
  console.log(`CSV Parsed Table: name="${csvTable.name}", cols=[${csvTable.order.join(', ')}]`);
  console.log(`Inferred schema:`, JSON.stringify(csvTable.columns));
  console.log(`Row count: ${csvTable.rows.length}`);

  // Add to DB
  const customDb = cloneDb(SAMPLE_DB);
  addTableFromCSV(customDb, sampleCsv, 'products');

  // Run SQL on imported CSV table
  const testSqls = [
    "SELECT product_name, price FROM products WHERE price > 50 ORDER BY price DESC;",
    "UPDATE products SET in_stock = true WHERE category = 'Hardware';",
    "DELETE FROM products WHERE in_stock = false;",
    "SELECT * FROM products;"
  ];

  for (const sql of testSqls) {
    const tokens = lex(sql);
    const ast = parse(tokens);
    const sem = analyze(ast, customDb);
    if (sem.errors.length) {
      throw new Error(`CSV SQL Semantic error: ${sem.errors.join('; ')}`);
    }
    const res = simulate(customDb, ast);
    apply(customDb, ast);
    console.log(`CSV SQL Success [${sql}] -> result rows=${res.rows ? res.rows.length : res.after.length}`);
  }

  // Export back to CSV
  const exported = exportTableToCSV(customDb.tables.products);
  console.log(`Exported CSV length: ${exported.length} chars`);

  console.log('CSV Import & Query tests PASSED successfully!\n');
} catch (e) {
  console.error('CSV Test Failed:', e);
  process.exit(1);
}
