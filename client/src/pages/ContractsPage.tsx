import { EmptyState, Eyebrow, Pagination } from "../components/ui";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BulkBar, SelectBox, useSelection } from "../components/Bulk";
import { useConfirm, useToast } from "../components/Feedback";
import { Link, useNavigate } from "react-router-dom";
import { formatPct, uptimeTone } from "../components/MonitorBits";
import { ContractStatus } from "../components/ContractBits";
import { api } from "../lib/api";
import { useFitPageSize } from "../lib/pageSize";
import { timeAgo } from "../lib/format";
import type { ContractListItem } from "../lib/types";

export const ContractsPage = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<ContractListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);
  // as many rows as fit on screen
  const pageSize = useFitPageSize(tableRef);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const visible = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  const sel = useSelection(useMemo(() => visible.map((c) => c._id), [visible]));

  const removeSelected = async () => {
    const ok = await confirm({
      title: `Delete ${sel.count} contract${sel.count === 1 ? "" : "s"}?`,
      body: "Their versions and validation history go with them. Monitors using them stop validating.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const ids = [...sel.selected];
      const { deleted } = await api.contracts.bulkDelete(ids);
      setItems((list) => list.filter((c) => !ids.includes(c._id)));
      sel.clear();
      toast(`Deleted ${deleted} contract${deleted === 1 ? "" : "s"}`);
    } catch (e) {
      toast("Couldn't delete", { tone: "error", body: (e as Error).message });
    }
  };

  useEffect(() => {
    api.contracts
      .list()
      .then(({ items }) => setItems(items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>Contract validation</Eyebrow>
          <h1>Contracts</h1>
          <p className="muted">Guard your APIs with OpenAPI or JSON Schema contracts. Catch violations, drift and breaking changes.</p>
        </div>
        {(loading || items.length > 0) && (
          <Link className="btn primary" to="/contracts/new">
            <Plus size={15} />
            New contract
          </Link>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="table-wrap" ref={tableRef}>
        <table className="table">
          <thead>
            <tr>
              <th className="check-cell">
                <SelectBox label="Select all on this page" checked={sel.all} indeterminate={sel.some} onChange={sel.toggleAll} />
              </th>
              <th>Contract</th>
              <th>Type</th>
              <th className="num">Operations</th>
              <th className="num">Version</th>
              <th>Status</th>
              <th className="num">Pass rate 24h</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c._id} className={`clickable${sel.has(c._id) ? " selected" : ""}`} onClick={() => navigate(`/contracts/${c._id}`)}>
                <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                  <SelectBox label={`Select ${c.name}`} checked={sel.has(c._id)} onChange={() => sel.toggle(c._id)} />
                </td>
                <td>
                  <div className="strong">{c.name}</div>
                  {c.title && c.title !== c.name && <div className="muted small">{c.title}</div>}
                </td>
                <td>
                  <span className="chip">{c.kind === "openapi" ? "OpenAPI" : "JSON Schema"}</span>
                </td>
                <td className="num">{c.kind === "openapi" ? c.operationCount : "–"}</td>
                <td className="num">v{c.version}</td>
                <td>
                  <ContractStatus verdict={c.lastValidation} version={c.version} />
                </td>
                <td className={`num tone-${uptimeTone(c.last24h.passRate) ?? "none"}`}>
                  {formatPct(c.last24h.passRate)}
                  {c.last24h.validations > 0 && <span className="muted small"> ({c.last24h.validations})</span>}
                </td>
                <td className="muted">{timeAgo(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <EmptyState
            title="Add your first contract"
            action={
              <Link className="btn primary" to="/contracts/new">
                <Plus size={15} />
                New contract
              </Link>
            }
          >
            Paste an OpenAPI spec (JSON or YAML) or a JSON Schema, or generate one from a response in the workspace.
          </EmptyState>
        )}
      </div>
      <BulkBar count={sel.count} noun="contract" onClear={sel.clear}>
        <button className="btn destructive small" onClick={() => void removeSelected()}>
          Delete
        </button>
      </BulkBar>
      <Pagination page={page} pageSize={pageSize} total={items.length} onPage={setPage} />
    </div>
  );
};
