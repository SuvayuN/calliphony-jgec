import React, { useMemo } from 'react';

export function formatAnswer(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
  if (value == null || value === '') return '—';
  return String(value);
}

export function buildResponseColumns(form, responses) {
  const fields = form?.format?.fields || form?.fields || [];
  if (fields.length) return fields;
  const keys = new Set();
  responses.forEach((row) => Object.keys(row.answers || {}).forEach((k) => keys.add(k)));
  return [...keys].map((id) => ({ id, label: id }));
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function renderAnswer(value) {
  const text = formatAnswer(value);
  if (text === '—') return text;
  if (looksLikeUrl(text)) {
    return (
      <a href={text} target="_blank" rel="noreferrer" className="form-responses-link">
        {text}
      </a>
    );
  }
  return text;
}

function compareResponses(a, b, sortKey, sortDir) {
  const dir = sortDir === 'desc' ? -1 : 1;
  if (sortKey === 'submitted') {
    const av = new Date(a.createdAt).getTime();
    const bv = new Date(b.createdAt).getTime();
    return (av - bv) * dir;
  }
  const av = formatAnswer(a.answers?.[sortKey]).toLowerCase();
  const bv = formatAnswer(b.answers?.[sortKey]).toLowerCase();
  if (av < bv) return -1 * dir;
  if (av > bv) return 1 * dir;
  return 0;
}

export function sortResponsesList(responses, sortKey, sortDir) {
  return [...responses].sort((a, b) => compareResponses(a, b, sortKey, sortDir));
}

export default function FormResponsesTable({
  form,
  responses,
  adminMode = false,
  onEdit,
  onDelete,
  deleteConfirmId = '',
}) {
  const columns = useMemo(() => buildResponseColumns(form, responses), [form, responses]);

  if (!responses.length) {
    return <p style={{ color: 'var(--ink-muted)' }}>No responses yet.</p>;
  }

  return (
    <div className="form-responses-table-wrap glass-card">
      <table className="form-responses-table">
        <thead>
          <tr>
            <th className="form-responses-col-index">#</th>
            {columns.map((col) => (
              <th key={col.id}>{col.label}</th>
            ))}
            <th className="form-responses-col-date">Submitted</th>
            {adminMode && <th className="form-responses-col-actions">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {responses.map((row, i) => (
            <tr key={row.id}>
              <td className="form-responses-col-index">{i + 1}</td>
              {columns.map((col) => (
                <td key={col.id} className="form-responses-cell">
                  {renderAnswer(row.answers?.[col.id])}
                </td>
              ))}
              <td className="form-responses-col-date">
                {new Date(row.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              {adminMode && (
                <td className="form-responses-col-actions">
                  <div className="form-responses-row-actions">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => onEdit?.(row)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => onDelete?.(row)}
                      style={{ color: 'var(--riso-red)', borderColor: 'var(--riso-red)' }}
                    >
                      {deleteConfirmId === row.id ? 'Confirm' : 'Delete'}
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
