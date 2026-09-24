// lexer.js
// Phase 1 - Lexical Analysis.
// Scans the raw SQL text and breaks it into meaningful tokens:
// keywords, identifiers, operators, constants (numbers/strings), punctuation.

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'ORDER', 'BY', 'LIMIT', 'DISTINCT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
  'ASC', 'DESC', 'AS', 'IN', 'LIKE', 'IS', 'NULL', 'TRUE', 'FALSE',
  'INT', 'INTEGER', 'TEXT', 'VARCHAR', 'CHAR', 'REAL', 'FLOAT', 'DECIMAL', 'BOOLEAN', 'DATE',
];

const KEYWORD_SET = new Set(KEYWORDS.map((k) => k.toUpperCase()));
const TWO_CHAR_OPS = ['>=', '<=', '<>', '!='];

export { KEYWORDS };

export function lex(sql) {
  const tokens = [];
  const n = sql.length;
  let i = 0;

  const lineCol = (idx) => {
    const before = sql.slice(0, idx);
    const lines = before.split('\n');
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  };

  while (i < n) {
    const ch = sql[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // comments
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) {
        throw { kind: 'lex', message: 'Unterminated block comment', pos: lineCol(i) };
      }
      i = close + 2;
      continue;
    }

    const start = i;
    const pos = lineCol(i);

    if (TWO_CHAR_OPS.includes(sql.slice(i, i + 2))) {
      const op = sql.slice(i, i + 2);
      tokens.push({ type: 'op', value: op, raw: op, pos });
      i += 2;
      continue;
    }
    if ('=<>'.includes(ch)) {
      tokens.push({ type: 'op', value: ch, raw: ch, pos });
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let end = null;
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          end = j;
          break;
        }
        j++;
      }
      if (end === null) {
        throw { kind: 'lex', message: `Unterminated string literal at line ${pos.line}`, pos };
      }
      const raw = sql.slice(i, end + 1);
      let value = sql.slice(i + 1, end);
      value = value.split(ch + ch).join(ch);
      tokens.push({ type: 'string', value, raw, pos });
      i = end + 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9.]/.test(sql[j])) j++;
      const raw = sql.slice(i, j);
      const dotCount = (raw.match(/\./g) || []).length;
      if (dotCount > 1) {
        throw { kind: 'lex', message: `Invalid number '${raw}'`, pos };
      }
      tokens.push({ type: 'number', value: parseFloat(raw), raw, pos });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const raw = sql.slice(i, j);
      const upper = raw.toUpperCase();
      if (KEYWORD_SET.has(upper)) {
        tokens.push({ type: 'keyword', value: upper, raw, pos });
      } else {
        tokens.push({ type: 'identifier', value: raw, raw, pos });
      }
      i = j;
      continue;
    }

    if ('(),;*'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, raw: ch, pos });
      i++;
      continue;
    }

    throw { kind: 'lex', message: `Unexpected character '${ch}' at line ${pos.line}, col ${pos.col}`, pos };
  }

  tokens.push({ type: 'eof', value: 'EOF', raw: '', pos: lineCol(n) });
  return tokens;
}