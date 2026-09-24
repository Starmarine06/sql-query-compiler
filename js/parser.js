// parser.js
// Phase 2 - Syntax Analysis.
// Receives the token stream, checks the SQL grammar, and produces
// an Abstract Syntax Tree (presented as the parse tree).

export function parse(tokens) {
  let idx = 0;

  const tok = () => tokens[idx];
  const at = (kw) => tok().type === 'keyword' && tok().value === kw;
  const atPunct = (p) => tok().type === 'punct' && tok().value === p;
  const next = () => tokens[idx++];

  const syn = (msg, t) => {
    const tk = t || tok();
    throw { kind: 'syntax', message: `${msg} at line ${tk.pos.line}, col ${tk.pos.col}`, pos: tk.pos };
  };

  const expectKeyword = (kw) => {
    if (!at(kw)) syn(`Expected '${kw}'`);
    return next();
  };
  const expectPunct = (p) => {
    if (!atPunct(p)) syn(`Expected '${p}'`);
    return next();
  };
  const expectOp = (op) => {
    if (tok().type !== 'op' || tok().value !== op) syn(`Expected operator '${op}'`);
    return next();
  };
  const expectIdent = (what) => {
    const t = tok();
    if (t.type !== 'identifier' && t.type !== 'keyword') syn(`Expected ${what || 'identifier'}, got '${t.raw}'`);
    return next();
  };
  const expectNumber = () => {
    const t = tok();
    if (t.type !== 'number') syn('Expected a number');
    next();
    return Math.floor(t.value);
  };

  // parses zero-or-more comma-separated items; the comma is consumed AFTER each item
  function commaSeparated(p) {
    const items = [];
    while (true) {
      items.push(p());
      if (!atPunct(',')) break;
      next();
    }
    return items;
  }

  // --- values ---
  function parseValue() {
    const t = tok();
    if (t.type === 'number') {
      next();
      return { kind: 'lit', type: 'number', value: t.value, raw: t.raw };
    }
    if (t.type === 'string') {
      next();
      return { kind: 'lit', type: 'string', value: t.value, raw: t.raw };
    }
    if (at('TRUE')) {
      next();
      return { kind: 'lit', type: 'boolean', value: true, raw: 'TRUE' };
    }
    if (at('FALSE')) {
      next();
      return { kind: 'lit', type: 'boolean', value: false, raw: 'FALSE' };
    }
    if (at('NULL')) {
      next();
      return { kind: 'lit', type: 'null', value: null, raw: 'NULL' };
    }
    syn(`Expected a value, got '${t.raw}'`);
  }

  // --- boolean expressions (WHERE / ON) ---
  // precedence: NOT > AND > OR
  function parseBool() {
    let left = parseTerm();
    while (at('OR')) {
      next();
      left = { kind: 'or', left, right: parseTerm() };
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (at('AND')) {
      next();
      left = { kind: 'and', left, right: parseFactor() };
    }
    return left;
  }
  function parseFactor() {
    if (at('NOT')) {
      next();
      return { kind: 'not', operand: parseFactor() };
    }
    if (atPunct('(')) {
      next();
      const inner = parseBool();
      expectPunct(')');
      return inner;
    }
    return parsePredicate();
  }
  function parseColumnRef() {
    const t = tok();
    if (t.type !== 'identifier' && t.type !== 'keyword') syn('Expected a column name');
    next();
    return { kind: 'col', name: t.raw };
  }
  function parsePredicate() {
    const colRef = parseColumnRef();
    const name = colRef.name;

    if (at('IN')) {
      next();
      expectPunct('(');
      const values = commaSeparated(() => parseValue());
      expectPunct(')');
      return { kind: 'in', col: name, values };
    }
    if (at('LIKE')) {
      next();
      const pat = tok();
      if (pat.type !== 'string') syn("Expected a pattern string after LIKE, e.g. 'D%'");
      next();
      return { kind: 'like', col: name, pattern: pat.value };
    }
    if (at('IS')) {
      next();
      let neg = false;
      if (at('NOT')) {
        next();
        neg = true;
      }
      expectKeyword('NULL');
      return { kind: 'null', col: name, neg };
    }

    const t = tok();
    if (t.type !== 'op' || !['=', '<>', '!=', '<', '>', '<=', '>='].includes(t.value)) {
      syn(`Expected a comparison operator after '${name}'`, t);
    }
    next();
    const rightTok = tok();
    let right;
    if (rightTok.type === 'identifier' || rightTok.type === 'keyword') {
      right = parseColumnRef();
    } else {
      right = parseValue();
    }
    return { kind: 'cmp', op: t.value, left: colRef, right };
  }

  function optionalSemicolonAndDone() {
    if (atPunct(';')) next();
    if (tok().type !== 'eof') syn(`Unexpected token '${tok().raw}' after end of statement`);
  }

  // --- statements ---

  function parseSelect() {
    expectKeyword('SELECT');
    let distinct = false;
    if (at('DISTINCT')) {
      next();
      distinct = true;
    }
    const columns = [];
    if (atPunct('*')) {
      next();
      columns.push({ expr: { kind: 'star' }, alias: null });
    } else {
      columns.push(
        ...commaSeparated(() => {
          const t = tok();
          if (t.type !== 'identifier' && t.type !== 'keyword') syn('Expected a column name', t);
          next();
          let alias = null;
          if (at('AS')) {
            next();
            alias = expectIdent('alias name').raw;
          } else if (tok().type === 'identifier') {
            alias = tok().raw;
            next();
          }
          return { expr: { kind: 'col', name: t.raw }, alias };
        })
      );
    }

    expectKeyword('FROM');
    const fromTok = expectIdent('table name');
    const from = fromTok.raw;

    let where = null;
    if (at('WHERE')) {
      next();
      where = parseBool();
    }

    const orderBy = [];
    if (at('ORDER')) {
      next();
      expectKeyword('BY');
      orderBy.push(
        ...commaSeparated(() => {
          const c = expectIdent('column name in ORDER BY').raw;
          let dir = 'ASC';
          if (at('ASC')) {
            next();
          } else if (at('DESC')) {
            next();
            dir = 'DESC';
          }
          return { col: c, dir };
        })
      );
    }

    let limit = null;
    if (at('LIMIT')) {
      next();
      limit = expectNumber();
    }

    optionalSemicolonAndDone();
    return { type: 'query', kind: 'select', distinct, columns, from, where, orderBy, limit };
  }

  function parseInsert() {
    expectKeyword('INSERT');
    expectKeyword('INTO');
    const table = expectIdent('table name').raw;

    const columns = [];
    if (atPunct('(')) {
      next();
      columns.push(...commaSeparated(() => expectIdent('column name').raw));
      expectPunct(')');
    }

    expectKeyword('VALUES');
    const rows = commaSeparated(() => {
      expectPunct('(');
      const row = commaSeparated(() => parseValue());
      expectPunct(')');
      return row;
    });

    optionalSemicolonAndDone();
    return { type: 'query', kind: 'insert', table, columns, rows };
  }

  function parseUpdate() {
    expectKeyword('UPDATE');
    const table = expectIdent('table name').raw;
    expectKeyword('SET');
    const set = commaSeparated(() => {
      const col = expectIdent('column name in SET').raw;
      expectOp('=');
      return { col, value: parseValue() };
    });

    let where = null;
    if (at('WHERE')) {
      next();
      where = parseBool();
    }

    optionalSemicolonAndDone();
    return { type: 'query', kind: 'update', table, set, where };
  }

  function parseDelete() {
    expectKeyword('DELETE');
    expectKeyword('FROM');
    const table = expectIdent('table name').raw;

    let where = null;
    if (at('WHERE')) {
      next();
      where = parseBool();
    }

    optionalSemicolonAndDone();
    return { type: 'query', kind: 'delete', table, where };
  }

  function parseCreate() {
    expectKeyword('CREATE');
    expectKeyword('TABLE');
    const table = expectIdent('table name').raw;
    expectPunct('(');
    const columns = commaSeparated(() => {
      const name = expectIdent('column name').raw;
      const typeTok = tok();
      if (typeTok.type !== 'identifier' && typeTok.type !== 'keyword') syn('Expected a column type (INT, TEXT, ...)', typeTok);
      next();
      const type = typeTok.raw.toUpperCase();
      let width = null;
      if (atPunct('(')) {
        next();
        width = expectNumber();
        expectPunct(')');
      }
      return { name, type, width };
    });
    expectPunct(')');

    optionalSemicolonAndDone();
    return { type: 'query', kind: 'createTable', table, columns };
  }

  if (at('SELECT')) return parseSelect();
  if (at('INSERT')) return parseInsert();
  if (at('UPDATE')) return parseUpdate();
  if (at('DELETE')) return parseDelete();
  if (at('CREATE')) return parseCreate();

  syn(`Unsupported statement beginning with '${tok().raw || 'nothing'}'`);
}