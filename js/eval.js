// eval.js
// Boolean expression evaluator used by both the executor (WHERE/SET filtering)
// and the optimizer (to compute real row counts for its plan annotations).

export function resolve(node, row) {
  if (!node) return null;
  if (node.kind === 'col') return row[node.name] ?? null;
  if (node.kind === 'lit') return node.value;
  return null;
}

// returns <0, 0, >0
export function compare(a, b) {
  if (a === null || b === null) return a === b ? 0 : (a === null ? -1 : 1);
  const na = Number(a);
  const nb = Number(b);
  const aNum = a !== '' && a !== true && a !== false && !Number.isNaN(na);
  const bNum = b !== '' && b !== true && b !== false && !Number.isNaN(nb);
  if (aNum && bNum) return na - nb;
  return String(a).localeCompare(String(b));
}

export function evalCond(cond, row) {
  switch (cond.kind) {
    case 'and':
      return evalCond(cond.left, row) && evalCond(cond.right, row);
    case 'or':
      return evalCond(cond.left, row) || evalCond(cond.right, row);
    case 'not':
      return !evalCond(cond.operand, row);
    case 'cmp': {
      const l = resolve(cond.left, row);
      const r = resolve(cond.right, row);
      if (l === null || r === null) return false;
      const c = compare(l, r);
      switch (cond.op) {
        case '=': return c === 0;
        case '<>':
        case '!=': return c !== 0;
        case '<': return c < 0;
        case '>': return c > 0;
        case '<=': return c <= 0;
        case '>=': return c >= 0;
        default: return false;
      }
    }
    case 'in': {
      const l = row[cond.col] ?? null;
      if (l === null) return false;
      return cond.values.some((v) => compare(l, v.value) === 0);
    }
    case 'like': {
      const l = row[cond.col] ?? null;
      if (l === null) return false;
      const escaped = cond.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('^' + escaped.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
      return re.test(String(l));
    }
    case 'null': {
      const l = row[cond.col] ?? null;
      return cond.neg ? l !== null : l === null;
    }
    default:
      return false;
  }
}