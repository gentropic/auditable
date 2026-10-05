"""gcu.condenser.io — never-resident readers for the kernel side.

The analysis complement to the widget (compute where the data lives: resident →
pandas; huge → these batch readers + :mod:`gcu.condenser.stats`). The flagship
is the Datamine ``.dm`` reader — **nothing else in Python reads Datamine** — a
second implementation of the same format spec as `@gcu/dm` (reverse-engineered
from public sources; see ext/dm/SPEC.md), round-trip-testable against it.

``read_dm`` is fully vectorized over ``np.memmap``: a column is one strided
slice of the page lattice, so the OS pages in only what the slice touches —
micro's strided-projection trick, for free.

    from gcu.condenser import io
    cols = io.read_dm("model.dm", columns=["XC", "FE"])   # dict of numpy arrays
    src = io.batches("model.dm")                          # a cd.open-able source
    cd.open(src, x="XC", y="YC", z="ZC", value="FE")
"""
from __future__ import annotations

import itertools
import pathlib
from typing import Any

import numpy as np

_SENTINEL = 0.9e30   # |value| above this = a Datamine special (missing/inf/trace)
_USABLE_WORDS = 508  # per page, both SP and EP (16-byte legacy security tail)


# ── the Data Definition (page 1) ─────────────────────────────────────────────
def _read_text(b: bytes, off: int, n_words: int, ws: int) -> str:
    """N words as text: 4 ASCII chars per word (EP pads the high half)."""
    s = []
    for w in range(n_words):
        base = off + w * ws
        for c in b[base:base + 4]:
            if 32 <= c < 127:
                s.append(chr(c))
    return "".join(s).strip()


def _read_long_name(b: bytes, o: int, ws: int) -> str | None:
    """EP extended field names (9–24 chars) hide in bytes a legacy reader skips,
    flagged by ASCII 'LONG' in the high half of the type word (spec §3.2.1)."""
    if ws != 8 or o + ws * 5 + 8 > len(b):
        return None
    if b[o + ws * 2 + 4:o + ws * 2 + 8] != b"LONG":
        return None
    segs = (o, o + ws, o + 4, o + ws + 4, o + ws * 5, o + ws * 5 + 4)
    s = []
    for base in segs:
        for c in b[base:base + 4]:
            s.append(chr(c) if 32 <= c < 127 else " ")
    return "".join(s).rstrip()


def _detect(b: bytes):
    """{precision, byte_order} from the file head — no magic number: validate
    NVAR (1–500, integral) + a printable first field name."""
    for precision in ("sp", "ep"):
        ws = 8 if precision == "ep" else 4
        date_off = 192 if precision == "ep" else 96
        for bo in ("<", ">"):
            fc_off = date_off + ws
            if fc_off + ws > len(b):
                continue
            fc = float(np.frombuffer(b[fc_off:fc_off + ws], dtype=f"{bo}f{ws}")[0])
            n = round(fc)
            if n < 1 or n > 500 or abs(fc - n) > 0.01:
                continue
            fs = date_off + ws * 4
            head = b[fs:fs + 4]
            if len(head) == 4 and all(32 <= c < 127 for c in head):
                return {"precision": precision, "bo": bo, "ws": ws,
                        "ps": 4096 if precision == "ep" else 2048, "date_off": date_off}
    return None


def dm_info(path) -> dict:
    """Parse a ``.dm`` file's Data Definition: schema, counts, layout."""
    p = pathlib.Path(path)
    with open(p, "rb") as f:
        head = f.read(4096)
    fmt = _detect(head)
    if fmt is None:
        raise ValueError(f"gcu-condenser: {path} is not a recognizable .dm file")
    ws, bo, ps = fmt["ws"], fmt["bo"], fmt["ps"]
    dt = f"{bo}f{ws}"
    num = lambda o: float(np.frombuffer(head[o:o + ws], dtype=dt)[0])
    date_off = fmt["date_off"]
    nvar = round(num(date_off + ws))
    last_page = round(num(date_off + ws * 2))
    last_rec = round(num(date_off + ws * 3))
    if not 1 <= nvar <= 256:
        raise ValueError(f"gcu-condenser: .dm NVAR out of range ({nvar})")

    field_start, field_size = date_off + ws * 4, ws * 7
    raw = []
    for i in range(nvar):
        o = field_start + i * field_size
        if o + field_size > ps:
            break   # single-page DD
        raw.append({
            "name": _read_long_name(head, o, ws) or _read_text(head, o, 2, ws),
            "type": (_read_text(head, o + ws * 2, 1, ws)[:1] or "N").upper(),
            "sw": round(num(o + ws * 3)),
            "wordno": round(num(o + ws * 4)),
            "def": num(o + ws * 6),
        })

    # logical columns: alpha fields >4 chars span entries sharing a name
    cols: dict[str, dict] = {}
    max_len = 0
    for e in raw:
        cols.setdefault(e["name"], {"name": e["name"], "type": e["type"], "entries": []})["entries"].append(e)
    columns = []
    for c in cols.values():
        entries = sorted(c["entries"], key=lambda e: e["wordno"])
        sw = [e["sw"] for e in entries]
        max_len = max(max_len, *sw)
        is_const = entries[0]["sw"] == 0
        const_val: Any = None
        if is_const:
            if c["type"] == "A":
                parts = []
                for e in entries:
                    wb = np.array([e["def"]], dtype=dt).tobytes()
                    parts.append("".join(chr(x) for x in wb[:4] if 32 <= x < 127))
                const_val = "".join(parts).strip()
            else:
                v = entries[0]["def"]
                const_val = None if abs(v) > _SENTINEL else v
        columns.append({"name": c["name"], "type": c["type"], "sw": sw,
                        "constant": is_const, "constant_value": const_val})

    rpp = _USABLE_WORDS // max_len if max_len else 0
    count = (last_page - 2) * rpp + last_rec if last_page > 1 else last_rec
    return {
        "path": str(p), "precision": fmt["precision"], "byte_order": bo,
        "word_size": ws, "page_size": ps, "nvar": nvar,
        "max_len": max_len, "records_per_page": rpp, "count": count,
        "last_page": last_page, "columns": columns,
        "names": [c["name"] for c in columns],
    }


def _dm_record_lattice(info, mm_words, mm_bytes):
    """The data pages as (record, word) / (record, byte) views — lazy over the
    memmap, so slicing a column touches only its stride."""
    ps, ws = info["page_size"], info["word_size"]
    wpp = ps // ws
    npages = info["last_page"] - 1
    rpp, max_len = info["records_per_page"], info["max_len"]
    pages_w = mm_words[wpp:(npages + 1) * wpp].reshape(npages, wpp)
    recs_w = pages_w[:, :rpp * max_len].reshape(npages * rpp, max_len)
    pages_b = mm_bytes[ps:(npages + 1) * ps].reshape(npages, ps)
    recs_b = pages_b[:, :rpp * max_len * ws].reshape(npages * rpp, max_len * ws)
    return recs_w[:info["count"]], recs_b[:info["count"]]


def read_dm(path, columns=None, start=0, stop=None) -> dict:
    """Read ``.dm`` columns into numpy arrays — numeric → float64 with NaN for
    Datamine sentinels, alpha → str. ``columns`` limits the decode (the strided
    projection: other fields are never touched); start/stop slice records."""
    info = dm_info(path)
    dt = f"{info['byte_order']}f{info['word_size']}"
    mm = np.memmap(info["path"], dtype=np.uint8, mode="r")
    mm_words = mm.view(dt)
    recs_w, recs_b = _dm_record_lattice(info, mm_words, mm)
    stop = info["count"] if stop is None else min(stop, info["count"])
    n = max(0, stop - start)
    want = columns or info["names"]
    out: dict[str, np.ndarray] = {}
    for col in info["columns"]:
        if col["name"] not in want:
            continue
        if col["constant"]:
            cv = col["constant_value"]
            out[col["name"]] = (np.full(n, np.nan) if cv is None and col["type"] != "A"
                                else np.full(n, cv if cv is not None else "", dtype=object if col["type"] == "A" else None))
        elif col["type"] == "A":
            ws = info["word_size"]
            parts = [recs_b[start:stop, (sw - 1) * ws:(sw - 1) * ws + 4] for sw in col["sw"]]
            raw = np.concatenate(parts, axis=1) if len(parts) > 1 else parts[0]
            flat = np.ascontiguousarray(raw).view(f"S{raw.shape[1]}").ravel()
            out[col["name"]] = np.char.strip(np.char.decode(flat, "latin-1"))
        else:
            v = np.asarray(recs_w[start:stop, col["sw"][0] - 1], dtype=np.float64)
            v = v.copy()
            v[np.abs(v) > _SENTINEL] = np.nan
            out[col["name"]] = v
    return out


# ── batch sources (the cd.open / stats contract) ─────────────────────────────
def _dm_batches(path, batch_rows, columns):
    info = dm_info(path)

    def it():
        for at in range(0, info["count"], batch_rows):
            yield read_dm(path, columns=columns, start=at, stop=at + batch_rows)
    return it


def _csv_batches(path, batch_rows, columns):
    def it():
        with open(path, "r", encoding="utf8", errors="replace") as f:
            header = f.readline()
            delim = ";" if header.count(";") > header.count(",") else ("\t" if "\t" in header else ",")
            names = [c.strip() for c in header.strip().split(delim)]
            idx = {nm: i for i, nm in enumerate(names)}
            want = [c for c in (columns or names) if c in idx]
            while True:
                lines = list(itertools.islice(f, batch_rows))
                if not lines:
                    break
                rows = [ln.rstrip("\r\n").split(delim) for ln in lines if ln.strip()]
                out = {}
                for nm in want:
                    j = idx[nm]
                    vals = [(r[j].strip() if j < len(r) else "") for r in rows]
                    try:
                        out[nm] = np.array([v if v else "nan" for v in vals], dtype=np.float64)
                    except ValueError:
                        out[nm] = np.array(vals)
                yield out
    return it


def _parquet_batches(path, batch_rows, columns):
    try:
        import pyarrow.parquet as pq
    except ImportError as e:
        raise ImportError("gcu-condenser: Parquet batches need pyarrow (pip install pyarrow)") from e
    pf = pq.ParquetFile(str(path))

    def it():
        for b in pf.iter_batches(batch_size=batch_rows, columns=columns):
            yield {nm: b.column(nm).to_numpy(zero_copy_only=False) for nm in b.schema.names}
    return it


def batches(path, batch_rows: int = 1_048_576, columns=None):
    """A two-pass batch source over a file — exactly what :func:`gcu.condenser.open`
    and :mod:`gcu.condenser.stats` eat. Dispatches on extension:
    ``.dm`` (native, strided), ``.parquet`` (pyarrow, column-projected),
    anything else = delimited text."""
    ext = pathlib.Path(path).suffix.lower()
    if ext == ".dm":
        return _dm_batches(path, batch_rows, columns)
    if ext in (".parquet", ".pq"):
        return _parquet_batches(path, batch_rows, columns)
    return _csv_batches(path, batch_rows, columns)
