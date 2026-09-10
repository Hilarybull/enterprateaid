import { useState, useMemo } from "react";

export function StatusBadge({ status }) {
  const s = String(status || "").toLowerCase();
  const cls =
    s === "paid" || s === "accepted" || s === "signed"
      ? "bg-emerald-50 text-emerald-700"
      : s === "overdue" || s === "rejected"
        ? "bg-rose-50 text-rose-700"
        : s === "partially paid" || s === "partial"
          ? "bg-violet-50 text-violet-700"
          : s === "pending" || s === "sent"
            ? "bg-amber-50 text-amber-700"
            : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status || "—"}
    </span>
  );
}

const PAGE_SIZE = 10;

export default function ReportTable({ columns, rows, emptyText = "No data.", paginate = false }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => String(row[col.key] ?? "").toLowerCase().includes(q))
    );
  }, [rows, search, columns]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = paginate ? filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) : filtered;

  const handleSearch = (v) => { setSearch(v); setPage(1); };

  if (!rows.length)
    return <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">{emptyText}</div>;

  return (
    <div className="space-y-2">
      {paginate && (
        <div className="flex items-center justify-between gap-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-brand-300 focus:ring focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
          <span className="text-xs text-slate-400">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      <div className="overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${col.right ? "text-right" : "text-left"}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length ? paged.map((row, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/50">
                {columns.map((col) => (
                  <td key={col.key} className={`px-3 py-2 ${col.right ? "text-right" : ""} ${col.bold ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                    {row[col.key] ?? "—"}
                  </td>
                ))}
              </tr>
            )) : (
              <tr><td colSpan={columns.length} className="px-3 py-4 text-center text-xs text-slate-400">No results match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {paginate && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
          <span className="text-xs text-slate-400">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">
              ‹ Prev
            </button>
            <span className="px-2 text-xs text-slate-500">{safePage} / {totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
