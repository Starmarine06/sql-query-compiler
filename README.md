# SQL Query Compiler — BCSE307L Case Study

A web app that walks an SQL command through the seven stages of a compiler and
**previews the change the command would make**, without actually executing it
against a real database.

## Architecture (maps to the case study)

```
1. SQL Query Input     -> editor + live sample database
2. Lexical Analyzer    -> token stream (keywords / identifiers / operators / constants)
3. Parser              -> grammar check -> parse tree (AST)
4. Semantic Analyzer   -> table & column validation against the catalog
5. IR Generator        -> relational algebra tree (π, σ, τ, ∂)
6. Query Optimizer     -> original vs. optimized plan (predicate + projection pushdown)
7. Impact Preview      -> the before/after data change this command would make
```

## Run

```bash
npm start
```

or directly:

```bash
node server.js
```

A browser opens at `http://localhost:5173`. No build step, no dependencies.

## Live demo

https://starmarine06.github.io/sql-query-compiler/

Hosted on GitHub Pages — the whole compiler runs in the browser, so there is no
backend to install. Open the link and click **Run** on any example. To test
locally, clone the repo and run `npm start`.

## Tests

```bash
node test.js
```

Exercises the full pipeline (lex → parse → semantic → simulate → optimize → apply)
against 21 example commands.

## Supported SQL

- `SELECT [DISTINCT] cols | * FROM t [WHERE …] [ORDER BY …] [LIMIT n]`
- `INSERT INTO t [(cols)] VALUES (…), (…)`
- `UPDATE t SET col = value [, …] [WHERE …]`
- `DELETE FROM t [WHERE …]`
- `CREATE TABLE t (col TYPE [, …])` — types: INT, TEXT/VARCHAR, REAL/FLOAT, BOOLEAN, DATE

`WHERE` supports `AND`, `OR`, `NOT`, `( )`, comparisons (`= < > <= >= <> !=`),
`IN (…)`, `LIKE '…%…'` and `IS [NOT] NULL`.

## Demo script (for a presentation)

1. **`SELECT * FROM employees;`** — result set, no mutation.
2. **`SELECT name, salary FROM employees WHERE department = 'Engineering' ORDER BY salary DESC;`** — watch the optimizer: predicate pushdown drops 10→3 rows, projection pushdown drops 5→3 columns.
3. **`UPDATE employees SET salary = 95000 WHERE city = 'Pune';`** — Impact Preview highlights the changed cell (old 64000 → new 95000) in yellow→green.
4. **`DELETE FROM employees WHERE department = 'HR' AND salary < 60000;`** — red "removed" rows, count drops 10→9.
5. **`INSERT INTO employees (id, name, department, salary, city) VALUES (11, 'Zoe', 'Sales', 99000, 'Noida');`** — new green row appended.
6. Click **Apply changes** after a mutation, then **`SELECT * FROM employees;`** to prove the state changed. Use **Reset DB** to restore.
7. Type a bad reference like `SELECT unknown_col FROM employees;` to show the semantic analyzer stopping the pipeline.

## Files

```
server.js        zero-dependency static server
index.html       UI shell (7 stage cards)
css/style.css    styling
js/database.js   sample in-memory DB (employees, departments)
js/lexer.js      Phase 2
js/parser.js     Phase 3
js/semantic.js   Phase 4
js/eval.js       boolean expression evaluator (WHERE)
js/executor.js   dry-run simulate + real apply
js/optimizer.js  Phase 5+6 relational algebra & pushdown
js/ui.js         rendering (tokens, parse tree, plans, diff)
js/main.js       pipeline driver
```

## References

- Funke, Mühlig & Teubner, *Low-Latency Query Compilation*, VLDB Journal 2022 (base paper).
- Selinger et al., *Access Path Selection in a Relational Database Management System*, SIGMOD 1979.