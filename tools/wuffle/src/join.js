// wuffle — JOINS: a table's columns onto measurements, by a key (a station, a sample, a domain). Pure.
// A LEFT join: every measurement stays, with the table's columns where its key matched, blank where it didn't;
// written as a NEW dataset with lineage (the data you measured is never edited by a join). Keys match as text,
// trimmed (12 and "12" are one station); a key the table holds twice takes its first row, and the answer says so.
// A table column whose name the data already has comes in as "<name> (<table>)".

export function joinTable(p, dataId, tableId, { on, onTable = null } = {}) {
  const D = p.dataset(dataId), T = p.dataset(tableId);
  if (!D || !T) throw new Error('join: no such dataset');
  if (D.kind === 'table') throw new Error(`“${D.name}” is a table — join a table ONTO measurements: join <measurements> ${D.name} on <column>`);
  const kd = on, kt = onTable || on;
  if (!D.columns.includes(kd)) throw new Error(`“${D.name}” has no column “${kd}” — its columns: ${D.columns.join(', ')}`);
  if (!T.columns.includes(kt)) throw new Error(`“${T.name}” has no column “${kt}” — its columns: ${T.columns.join(', ')}${onTable ? '' : ` (a different name there: on ${kd}=<its column>)`}`);
  const key = (v) => (v == null ? '' : String(v).trim());
  const index = new Map(); let dupes = 0;
  for (const r of T.rows) { const k = key(r[kt]); if (k === '') continue; if (index.has(k)) dupes++; else index.set(k, r); }
  const bring = T.columns.filter((c) => c !== kt), named = new Map(bring.map((c) => [c, D.columns.includes(c) ? `${c} (${T.name})` : c]));
  let matched = 0; const unmatched = new Set();
  const rows = D.rows.map((r) => {
    const hit = index.get(key(r[kd])), out = { ...r };
    if (hit) matched++; else if (key(r[kd]) !== '') unmatched.add(key(r[kd]));
    for (const c of bring) out[named.get(c)] = hit ? hit[c] : '';
    return out;
  });
  const columns = [...D.columns, ...bring.map((c) => named.get(c))];
  // (calculated columns come as their VALUES; the formulas stay with the source dataset)
  const id = p.derive({ name: `${D.name} + ${T.name}`, kind: D.kind, rows, columns, roles: D.roles, notation: D.notation, op: 'join', params: { on: kd, onTable: kt }, sources: [dataId, tableId] });
  return { id, matched, of: D.rows.length, unmatched: [...unmatched], dupes, columns: bring.map((c) => named.get(c)) };
}
