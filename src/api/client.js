const TOKEN_KEY = 'calliphony_auth_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}


export async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  login: (email, password) =>
    apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => apiRequest('/api/auth/me'),
  getEvents: () => apiRequest('/api/events'),
  createEvent: (payload) =>
    apiRequest('/api/events', { method: 'POST', body: JSON.stringify(payload) }),
  updateEvent: (id, payload) =>
    apiRequest(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteEvent: (id) => apiRequest(`/api/events/${id}`, { method: 'DELETE' }),
  getSecretaries: () => apiRequest('/api/secretaries'),
  createSecretary: (payload) =>
    apiRequest('/api/secretaries', { method: 'POST', body: JSON.stringify(payload) }),
  updateSecretary: (id, payload) =>
    apiRequest(`/api/secretaries/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSecretary: (id) => apiRequest(`/api/secretaries/${id}`, { method: 'DELETE' }),
  getPublicForm: () => apiRequest('/api/forms/public'),
  getForm: (id) => apiRequest(`/api/forms/${id}`),
  submitFormResponse: (formId, answers) =>
    apiRequest(`/api/forms/${formId}/responses`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
  getForms: () => apiRequest('/api/forms'),
  createForm: (payload) =>
    apiRequest('/api/forms', { method: 'POST', body: JSON.stringify(payload) }),
  updateForm: (id, payload) =>
    apiRequest(`/api/forms/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteForm: (id) => apiRequest(`/api/forms/${id}`, { method: 'DELETE' }),
  getFormResponses: (id) => apiRequest(`/api/forms/${id}/responses`),
  updateFormResponse: (formId, responseId, answers) =>
    apiRequest(`/api/forms/${formId}/responses/${responseId}`, {
      method: 'PUT',
      body: JSON.stringify({ answers }),
    }),
  deleteFormResponse: (formId, responseId) =>
    apiRequest(`/api/forms/${formId}/responses/${responseId}`, { method: 'DELETE' }),
  getSharedFormResponses: (token) => apiRequest(`/api/forms/share/${token}/responses`),
  enableFormShareLink: (id, { regenerate = false } = {}) =>
    apiRequest(`/api/forms/${id}/share-link`, {
      method: 'POST',
      body: JSON.stringify({ regenerate }),
    }),
  revokeFormShareLink: (id) =>
    apiRequest(`/api/forms/${id}/share-link`, { method: 'DELETE' }),
  exportFormResponses: async (id) => {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api/forms/${id}/responses/export`, { headers });
    if (!res.ok) {
      let message = `Export failed (${res.status})`;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'form-responses.xlsx';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  getSiteSettings: () => apiRequest('/api/settings'),
  updateSiteSettings: (payload) =>
    apiRequest('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
};
