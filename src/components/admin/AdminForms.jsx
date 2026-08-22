import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import FormResponsesTable, { buildResponseColumns, sortResponsesList } from '../FormResponsesTable';
import ResponseEditModal from './ResponseEditModal';

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'Link' },
  { value: 'tel', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Single choice' },
  { value: 'checkbox', label: 'Multiple choice' },
];

function newField() {
  return {
    id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    label: '',
    type: 'text',
    required: true,
    placeholder: '',
    options: [],
  };
}

function emptyDraft() {
  return {
    title: '',
    description: '',
    buttonLabel: '',
    submitLabel: 'Submit',
    published: false,
    showInNavbar: true,
    fields: [newField()],
  };
}

function needsOptions(type) {
  return type === 'select' || type === 'radio' || type === 'checkbox';
}

export default function AdminForms() {
  const [view, setView] = useState('list');
  const [forms, setForms] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState('');
  const [responses, setResponses] = useState([]);
  const [responseForm, setResponseForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [sortKey, setSortKey] = useState('submitted');
  const [sortDir, setSortDir] = useState('asc');
  const [editingResponse, setEditingResponse] = useState(null);
  const [responseSaving, setResponseSaving] = useState(false);
  const [responseDeleteConfirmId, setResponseDeleteConfirmId] = useState('');

  const loadForms = async () => {
    const data = await api.getForms();
    setForms(data.forms || []);
    return data.forms || [];
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await loadForms();
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load forms.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const startCreate = () => {
    setEditingId('');
    setDraft(emptyDraft());
    setError('');
    setSuccess('');
    setView('edit');
  };

  const startEdit = (form) => {
    const format = form.format && typeof form.format === 'object' ? form.format : form;
    const sourceFields = (format.fields || []).length ? format.fields : form.fields || [];
    setEditingId(form.id);
    setDraft({
      title: format.title || form.title || '',
      description: format.description || form.description || '',
      buttonLabel: format.buttonLabel || form.buttonLabel || form.title || '',
      submitLabel: format.submitLabel || form.submitLabel || 'Submit',
      published: Boolean(form.published),
      showInNavbar: form.showInNavbar !== false,
      fields: sourceFields.length ? sourceFields.map((f) => ({ ...f, options: f.options || [] })) : [newField()],
    });
    setError('');
    setSuccess('');
    setView('edit');
  };

  const openResponses = async (form) => {
    setError('');
    setSuccess('');
    try {
      const data = await api.getFormResponses(form.id);
      const loadedForm = data.form || form;
      setResponseForm(loadedForm);
      setResponses(data.responses || []);
      setShareLink(
        loadedForm.responseShareToken
          ? `${window.location.origin}/responses/share/${loadedForm.responseShareToken}`
          : ''
      );
      setSortKey('submitted');
      setSortDir('asc');
      setEditingResponse(null);
      setResponseDeleteConfirmId('');
      setView('responses');
    } catch (err) {
      setError(err.message || 'Failed to load responses.');
    }
  };

  const updateField = (index, patch) => {
    setDraft((prev) => {
      const fields = prev.fields.map((field, i) => (i === index ? { ...field, ...patch } : field));
      return { ...prev, fields };
    });
  };

  const moveField = (index, direction) => {
    setDraft((prev) => {
      const next = index + direction;
      if (next < 0 || next >= prev.fields.length) return prev;
      const fields = [...prev.fields];
      [fields[index], fields[next]] = [fields[next], fields[index]];
      return { ...prev, fields };
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!draft.title.trim()) {
      setError('Give the form a title — this also becomes the site button label unless you set one.');
      return;
    }
    const fields = draft.fields.filter((f) => f.label.trim());
    if (fields.length === 0) {
      setError('Add at least one question with a label.');
      return;
    }
    for (const field of fields) {
      if (needsOptions(field.type) && !(field.options || []).filter((o) => String(o).trim()).length) {
        setError(`Add options for “${field.label}”.`);
        return;
      }
    }

    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      buttonLabel: (draft.buttonLabel || draft.title).trim(),
      submitLabel: (draft.submitLabel || 'Submit').trim(),
      published: Boolean(draft.published),
      showInNavbar: Boolean(draft.showInNavbar),
      fields: fields.map((f) => ({
        ...f,
        label: f.label.trim(),
        options: (f.options || []).map((o) => String(o).trim()).filter(Boolean),
      })),
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.updateForm(editingId, payload);
        setSuccess('Form saved. Existing responses are kept.');
      } else {
        const created = await api.createForm(payload);
        setEditingId(created.form.id);
        setSuccess('Form created.');
      }
      await loadForms();
    } catch (err) {
      setError(err.message || 'Could not save form.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishToggle = async (form, published) => {
    setError('');
    try {
      await api.updateForm(form.id, { published });
      await loadForms();
      if (!published) {
        setSuccess('Form unpublished.');
      } else if (form.showInNavbar !== false) {
        setSuccess(`“${form.buttonLabel || form.title}” is live and shown in the top nav.`);
      } else {
        setSuccess(`“${form.buttonLabel || form.title}” is live as an unlisted form (URL only).`);
      }
    } catch (err) {
      setError(err.message || 'Could not update publish state.');
    }
  };

  const handleNavbarToggle = async (form, showInNavbar) => {
    setError('');
    try {
      await api.updateForm(form.id, { showInNavbar });
      await loadForms();
      setSuccess(
        showInNavbar
          ? `“${form.buttonLabel || form.title}” will show in the top nav when published.`
          : `“${form.buttonLabel || form.title}” is unlisted — share /form/${form.id} directly.`
      );
    } catch (err) {
      setError(err.message || 'Could not update navbar visibility.');
    }
  };

  const handleExport = async (form) => {
    setError('');
    try {
      await api.exportFormResponses(form.id);
      setSuccess(`Exported responses for “${form.title}”.`);
    } catch (err) {
      setError(err.message || 'Could not export responses.');
    }
  };

  const handleEnableShareLink = async (form, { regenerate = false } = {}) => {
    setError('');
    setShareBusy(true);
    try {
      const data = await api.enableFormShareLink(form.id, { regenerate });
      const url = `${window.location.origin}${data.path}`;
      setShareLink(url);
      setResponseForm((prev) =>
        prev && prev.id === form.id ? { ...prev, responseShareToken: data.token, responseShareEnabled: true } : prev
      );
      await loadForms();
      setSuccess(regenerate ? 'Share link regenerated.' : 'Live share link enabled.');
    } catch (err) {
      setError(err.message || 'Could not create share link.');
    } finally {
      setShareBusy(false);
    }
  };

  const handleRevokeShareLink = async (form) => {
    setError('');
    setShareBusy(true);
    try {
      await api.revokeFormShareLink(form.id);
      setShareLink('');
      setResponseForm((prev) =>
        prev && prev.id === form.id ? { ...prev, responseShareToken: null, responseShareEnabled: false } : prev
      );
      await loadForms();
      setSuccess('Share link revoked.');
    } catch (err) {
      setError(err.message || 'Could not revoke share link.');
    } finally {
      setShareBusy(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setSuccess('Share link copied to clipboard.');
    } catch {
      setError('Could not copy link — select and copy it manually.');
    }
  };

  const handleEditResponse = (row) => {
    setError('');
    setSuccess('');
    setResponseDeleteConfirmId('');
    setEditingResponse(row);
  };

  const handleSaveResponse = async (answers) => {
    if (!responseForm || !editingResponse) return;
    setError('');
    setSuccess('');
    setResponseSaving(true);
    try {
      const data = await api.updateFormResponse(responseForm.id, editingResponse.id, answers);
      setResponses((prev) => prev.map((row) => (row.id === editingResponse.id ? data.response : row)));
      if (data.form) setResponseForm(data.form);
      setEditingResponse(null);
      await loadForms();
      setSuccess('Response updated.');
    } catch (err) {
      setError(err.message || 'Could not update response.');
    } finally {
      setResponseSaving(false);
    }
  };

  const handleDeleteResponse = async (row) => {
    if (responseDeleteConfirmId !== row.id) {
      setResponseDeleteConfirmId(row.id);
      return;
    }
    if (!responseForm) return;
    setError('');
    try {
      const data = await api.deleteFormResponse(responseForm.id, row.id);
      setResponses((prev) => prev.filter((r) => r.id !== row.id));
      if (data.form) setResponseForm(data.form);
      setResponseDeleteConfirmId('');
      if (editingResponse?.id === row.id) setEditingResponse(null);
      await loadForms();
      setSuccess('Response deleted.');
    } catch (err) {
      setError(err.message || 'Could not delete response.');
      setResponseDeleteConfirmId('');
    }
  };

  const handleDelete = async (form) => {
    if (deleteConfirmId !== form.id) {
      setDeleteConfirmId(form.id);
      return;
    }
    setError('');
    try {
      await api.deleteForm(form.id);
      setDeleteConfirmId('');
      await loadForms();
      setSuccess('Empty form deleted.');
      if (editingId === form.id) {
        setView('list');
        setEditingId('');
      }
    } catch (err) {
      setError(err.message || 'Could not delete form.');
      setDeleteConfirmId('');
    }
  };

  useEffect(() => {
    if (view !== 'responses' || !responseForm?.id || editingResponse) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const data = await api.getFormResponses(responseForm.id);
        if (!cancelled) setResponses(data.responses || []);
      } catch {
        /* keep last snapshot on poll failure */
      }
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [view, responseForm?.id, editingResponse]);

  const responseColumns = useMemo(
    () => buildResponseColumns(responseForm, responses),
    [responseForm, responses]
  );

  const sortedResponses = useMemo(
    () => sortResponsesList(responses, sortKey, sortDir),
    [responses, sortKey, sortDir]
  );

  if (loading) {
    return (
      <div className="admin-page-container" style={{ padding: '2rem', textAlign: 'center' }}>
        <span className="admin-spinner" style={{ width: '32px', height: '32px', borderWidth: '3px', borderTopColor: 'var(--riso-red)' }} />
      </div>
    );
  }

  return (
    <div className="admin-upload-container">
      <div className="admin-upload-header" style={{ marginBottom: '28px' }}>
        <span className="admin-tag">■ Forms</span>
        <h1 className="section-heading" style={{ fontSize: '2rem', marginTop: '8px' }}>
          {view === 'edit' ? (editingId ? 'edit form.' : 'new form.') : view === 'responses' ? 'responses.' : 'forms.'}
        </h1>
        <p style={{ color: 'var(--ink-muted)', maxWidth: '640px' }}>
          Build public forms. Publish as many as you need — choose which ones get a top-nav button, or keep them unlisted and share the link. Export responses as Excel anytime.
        </p>
      </div>

      {error && (
        <div className="admin-error-banner">
          <span>⚠</span> {error}
        </div>
      )}
      {success && (
        <div className="admin-success-banner">
          <span>✓</span> {success}
        </div>
      )}

      {view === 'list' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <button type="button" className="btn-primary btn-ink-stamp" onClick={startCreate}>
              Create form →
            </button>
          </div>
          {forms.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)' }}>No forms yet. Create one to show a button on the site.</p>
          ) : (
            <div className="form-admin-list">
              {forms.map((form) => (
                <article key={form.id} className="glass-card form-admin-card">
                  <div>
                    <h2>{form.title}</h2>
                    <p>
                      Nav button: <strong>{form.buttonLabel || form.title}</strong>
                      {' · '}
                      {form.fields?.length || 0} field{(form.fields?.length || 0) === 1 ? '' : 's'}
                      {' · '}
                      {form.responseCount || 0} response{(form.responseCount || 0) === 1 ? '' : 's'}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                      <span className={`form-status-pill ${form.published ? 'is-live' : ''}`}>
                        {form.published ? 'Published' : 'Unpublished'}
                      </span>
                      {form.published && (
                        <span className={`form-status-pill ${form.showInNavbar !== false ? 'is-live' : ''}`}>
                          {form.showInNavbar !== false ? 'In navbar' : 'Unlisted'}
                        </span>
                      )}
                    </div>
                    {form.published && (
                      <p style={{ marginTop: '8px', fontSize: '0.82rem' }}>
                        Public URL:{' '}
                        <a href={`/form/${form.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--riso-red)' }}>
                          /form/{form.id}
                        </a>
                      </p>
                    )}
                  </div>
                  <div className="form-admin-card-actions">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => startEdit(form)}>
                      Edit
                    </button>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => openResponses(form)}>
                      Responses
                    </button>
                    {(form.responseCount || 0) > 0 && (
                      <button type="button" className="btn-secondary btn-sm" onClick={() => handleExport(form)}>
                        Export XLSX
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handlePublishToggle(form, !form.published)}
                    >
                      {form.published ? 'Unpublish' : 'Publish'}
                    </button>
                    {form.published && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleNavbarToggle(form, form.showInNavbar === false)}
                      >
                        {form.showInNavbar !== false ? 'Hide from nav' : 'Show in nav'}
                      </button>
                    )}
                    {(form.responseCount || 0) === 0 && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleDelete(form)}
                        style={{ color: 'var(--riso-red)', borderColor: 'var(--riso-red)' }}
                      >
                        {deleteConfirmId === form.id ? 'Confirm' : 'Delete'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'edit' && (
        <div className="admin-upload-card glass-card">
          <form className="admin-form" onSubmit={handleSave}>
            <div className="form-group">
              <label htmlFor="form-title">Form title</label>
              <input
                id="form-title"
                className="form-input"
                value={draft.title}
                onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Auditions 2026"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="form-button">Top button label</label>
              <input
                id="form-button"
                className="form-input"
                value={draft.buttonLabel}
                onChange={(e) => setDraft((p) => ({ ...p, buttonLabel: e.target.value }))}
                placeholder="Leave blank to use the title"
              />
            </div>
            <div className="form-group">
              <label htmlFor="form-desc">Description</label>
              <textarea
                id="form-desc"
                className="form-input"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                placeholder="Shown above the public form"
              />
            </div>
            <div className="form-group">
              <label htmlFor="form-submit">Submit button text</label>
              <input
                id="form-submit"
                className="form-input"
                value={draft.submitLabel}
                onChange={(e) => setDraft((p) => ({ ...p, submitLabel: e.target.value }))}
              />
            </div>
            <label className="form-check-row">
              <input
                type="checkbox"
                checked={draft.published}
                onChange={(e) => setDraft((p) => ({ ...p, published: e.target.checked }))}
              />
              Publish (open for submissions — multiple forms can be live at once)
            </label>
            <label className="form-check-row">
              <input
                type="checkbox"
                checked={draft.showInNavbar}
                onChange={(e) => setDraft((p) => ({ ...p, showInNavbar: e.target.checked }))}
                disabled={!draft.published}
              />
              Show button in site navbar (off = unlisted; share the form URL only)
            </label>

            <div className="form-builder-header">
              <h3>Questions</h3>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft((p) => ({ ...p, fields: [...p.fields, newField()] }))}>
                Add question
              </button>
            </div>

            {draft.fields.map((field, index) => (
              <div key={field.id} className="form-builder-field">
                <div className="form-builder-field-top">
                  <span>Q{index + 1}</span>
                  <div>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => moveField(index, -1)} disabled={index === 0}>
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => moveField(index, 1)}
                      disabled={index === draft.fields.length - 1}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          fields: p.fields.length === 1 ? [newField()] : p.fields.filter((_, i) => i !== index),
                        }))
                      }
                      style={{ color: 'var(--riso-red)' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Label</label>
                  <input
                    className="form-input"
                    value={field.label}
                    onChange={(e) => updateField(index, { label: e.target.value })}
                    placeholder="Question shown to respondents"
                  />
                </div>
                <div className="form-builder-row">
                  <div className="form-group">
                    <label>Type</label>
                    <select
                      className="form-input"
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value })}
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="form-check-row" style={{ marginTop: '28px' }}>
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(index, { required: e.target.checked })}
                    />
                    Required
                  </label>
                </div>
                {!needsOptions(field.type) && (
                  <div className="form-group">
                    <label>Placeholder</label>
                    <input
                      className="form-input"
                      value={field.placeholder || ''}
                      onChange={(e) => updateField(index, { placeholder: e.target.value })}
                    />
                  </div>
                )}
                {needsOptions(field.type) && (
                  <div className="form-group">
                    <label>Options (one per line)</label>
                    <textarea
                      className="form-input"
                      rows={4}
                      value={(field.options || []).join('\n')}
                      onChange={(e) =>
                        updateField(index, {
                          options: e.target.value.split('\n'),
                        })
                      }
                    />
                  </div>
                )}
              </div>
            ))}

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button type="submit" className="btn-primary btn-ink-stamp" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save form' : 'Create form'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setView('list');
                  setError('');
                  setSuccess('');
                }}
              >
                Back to list
              </button>
            </div>
          </form>
        </div>
      )}

      {view === 'responses' && (
        <>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setView('list')}>
              ← All forms
            </button>
            {responseForm && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => startEdit(responseForm)}>
                Edit this form
              </button>
            )}
            {responseForm && responses.length > 0 && (
              <button type="button" className="btn-primary btn-sm" onClick={() => handleExport(responseForm)}>
                Export XLSX ↓
              </button>
            )}
          </div>
          <p style={{ color: 'var(--ink-muted)', marginBottom: '16px' }}>
            {responses.length} response{responses.length === 1 ? '' : 's'} saved for {responseForm?.title}. Sorting below is local only — the database order is unchanged.
          </p>

          {responses.length > 0 && (
            <div className="form-responses-sort-bar glass-card">
              <label htmlFor="response-sort-key">Sort by</label>
              <select
                id="response-sort-key"
                className="form-input"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
              >
                <option value="submitted">Submitted date</option>
                {responseColumns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.label}
                  </option>
                ))}
              </select>
              <label htmlFor="response-sort-dir">Order</label>
              <select
                id="response-sort-dir"
                className="form-input"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value)}
              >
                <option value="asc">Ascending (A→Z / oldest first)</option>
                <option value="desc">Descending (Z→A / newest first)</option>
              </select>
            </div>
          )}

          {responseForm && (
            <div className="form-share-panel glass-card">
              <div>
                <strong style={{ fontFamily: 'var(--font-label)', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Live share link
                </strong>
                <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', margin: '6px 0 0' }}>
                  Anyone with this link can view responses in real time. They cannot edit or export.
                </p>
              </div>
              {shareLink ? (
                <div className="form-share-panel-actions">
                  <input className="form-input" readOnly value={shareLink} aria-label="Share link URL" />
                  <button type="button" className="btn-secondary btn-sm" onClick={handleCopyShareLink} disabled={shareBusy}>
                    Copy
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => handleEnableShareLink(responseForm, { regenerate: true })}
                    disabled={shareBusy}
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => handleRevokeShareLink(responseForm)}
                    disabled={shareBusy}
                    style={{ color: 'var(--riso-red)', borderColor: 'var(--riso-red)' }}
                  >
                    Revoke
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => handleEnableShareLink(responseForm)}
                  disabled={shareBusy}
                >
                  Create share link
                </button>
              )}
            </div>
          )}

          <FormResponsesTable
            form={responseForm}
            responses={sortedResponses}
            adminMode
            onEdit={handleEditResponse}
            onDelete={handleDeleteResponse}
            deleteConfirmId={responseDeleteConfirmId}
          />

          <ResponseEditModal
            open={Boolean(editingResponse)}
            response={editingResponse}
            form={responseForm}
            saving={responseSaving}
            onClose={() => {
              if (!responseSaving) setEditingResponse(null);
            }}
            onSave={handleSaveResponse}
          />
        </>
      )}
    </div>
  );
}
