import React, { useEffect, useMemo, useState } from 'react';

function emptyAnswers(fields = []) {
  const next = {};
  fields.forEach((field) => {
    next[field.id] = field.type === 'checkbox' ? [] : '';
  });
  return next;
}

function hydrateAnswers(response, fields) {
  const base = emptyAnswers(fields);
  const incoming = response?.answers || {};
  fields.forEach((field) => {
    if (field.type === 'checkbox') {
      base[field.id] = Array.isArray(incoming[field.id]) ? [...incoming[field.id]] : [];
    } else if (incoming[field.id] != null) {
      base[field.id] = incoming[field.id];
    }
  });
  return base;
}

export default function ResponseEditModal({ open, response, form, saving, onClose, onSave }) {
  const fields = useMemo(
    () =>
      (response?.format?.fields?.length ? response.format.fields : null) ||
      form?.format?.fields ||
      form?.fields ||
      [],
    [response, form]
  );
  const [answers, setAnswers] = useState({});

  useEffect(() => {
    if (open && response) {
      setAnswers(hydrateAnswers(response, fields));
    }
  }, [open, response, fields]);

  if (!open || !response) return null;

  const setAnswer = (fieldId, value) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  };

  const toggleCheckbox = (fieldId, option) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[fieldId]) ? prev[fieldId] : [];
      const next = current.includes(option) ? current.filter((v) => v !== option) : [...current, option];
      return { ...prev, [fieldId]: next };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(answers);
  };

  return (
    <div className="response-edit-overlay" role="dialog" aria-modal="true" aria-labelledby="response-edit-title">
      <div className="response-edit-modal glass-card">
        <div className="response-edit-header">
          <div>
            <span className="admin-tag">■ Edit response</span>
            <h2 id="response-edit-title" className="section-heading" style={{ fontSize: '1.6rem', marginTop: '8px' }}>
              update submission.
            </h2>
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
              Submitted{' '}
              {new Date(response.createdAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>

        <form className="admin-form" onSubmit={handleSubmit}>
          {fields.map((field) => (
            <div className="form-group" key={field.id}>
              <label htmlFor={`edit-${field.id}`}>
                {field.label}
                {field.required ? '' : ' (optional)'}
              </label>

              {field.type === 'textarea' && (
                <textarea
                  id={`edit-${field.id}`}
                  className="form-input"
                  rows={4}
                  value={answers[field.id] || ''}
                  onChange={(e) => setAnswer(field.id, e.target.value)}
                  required={field.required}
                  disabled={saving}
                />
              )}

              {(field.type === 'text' ||
                field.type === 'email' ||
                field.type === 'url' ||
                field.type === 'tel' ||
                field.type === 'number') && (
                <input
                  id={`edit-${field.id}`}
                  type={field.type === 'url' ? 'url' : field.type}
                  className="form-input"
                  value={answers[field.id] || ''}
                  onChange={(e) => setAnswer(field.id, e.target.value)}
                  required={field.required}
                  disabled={saving}
                />
              )}

              {field.type === 'select' && (
                <select
                  id={`edit-${field.id}`}
                  className="form-input"
                  value={answers[field.id] || ''}
                  onChange={(e) => setAnswer(field.id, e.target.value)}
                  required={field.required}
                  disabled={saving}
                >
                  <option value="" disabled>
                    Select an option
                  </option>
                  {(field.options || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              {field.type === 'radio' && (
                <div className="form-choice-list">
                  {(field.options || []).map((opt) => (
                    <label key={opt} className="form-check-row">
                      <input
                        type="radio"
                        name={`edit-${field.id}`}
                        value={opt}
                        checked={answers[field.id] === opt}
                        onChange={() => setAnswer(field.id, opt)}
                        required={field.required}
                        disabled={saving}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              )}

              {field.type === 'checkbox' && (
                <div className="form-choice-list">
                  {(field.options || []).map((opt) => (
                    <label key={opt} className="form-check-row">
                      <input
                        type="checkbox"
                        value={opt}
                        checked={(answers[field.id] || []).includes(opt)}
                        onChange={() => toggleCheckbox(field.id, opt)}
                        disabled={saving}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button type="submit" className="btn-primary btn-ink-stamp" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
