import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import FormResponsesTable from './FormResponsesTable';
import { BrandLogo } from './ThemeControls';

const POLL_MS = 8000;

export default function SharedFormResponses() {
  const { token } = useParams();
  const [form, setForm] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function load() {
      try {
        const data = await api.getSharedFormResponses(token);
        if (cancelled) return;
        setForm(data.form || null);
        setResponses(data.responses || []);
        setError('');
        setLastUpdated(new Date());
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not load responses.');
          setForm(null);
          setResponses([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  return (
    <div className="shared-responses-page">
      <header className="shared-responses-header">
        <Link to="/" className="nav-logo" aria-label="Calliphony home">
          <BrandLogo />
        </Link>
        <span className="shared-responses-live-pill">● Live view</span>
      </header>

      <main className="shared-responses-main container">
        {loading ? (
          <p style={{ color: 'var(--ink-muted)', textAlign: 'center', padding: '3rem 0' }}>Loading responses…</p>
        ) : error ? (
          <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--riso-red)', marginBottom: '8px' }}>{error}</p>
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
              This link may have been revoked or is invalid.
            </p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '24px' }}>
              <span className="admin-tag">■ Form responses</span>
              <h1 className="section-heading" style={{ fontSize: 'clamp(1.8rem, 5vw, 2.8rem)', marginTop: '8px' }}>
                {form?.title || 'Responses'}
              </h1>
              <p style={{ color: 'var(--ink-muted)', fontSize: '0.92rem' }}>
                {responses.length} response{responses.length === 1 ? '' : 's'} · read-only · updates every few seconds
                {lastUpdated && (
                  <>
                    {' '}
                    · last refreshed{' '}
                    {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </>
                )}
              </p>
            </div>
            <FormResponsesTable form={form} responses={responses} />
          </>
        )}
      </main>
    </div>
  );
}
