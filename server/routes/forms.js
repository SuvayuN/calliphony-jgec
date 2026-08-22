import mongoose from 'mongoose';
import { Router } from 'express';
import crypto from 'crypto';
import Form, { FORM_FIELD_TYPES } from '../models/Form.js';
import FormResponse from '../models/FormResponse.js';
import { requireAuth } from '../middleware/auth.js';
import { buildXlsx, slugFilename } from '../utils/xlsx.js';

const router = Router();

function serializeField(field) {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    placeholder: field.placeholder || '',
    options: Array.isArray(field.options) ? field.options.filter(Boolean) : [],
  };
}

function serializeForm(doc, { includeMeta = false } = {}) {
  const obj = doc.toObject ? doc.toObject() : doc;
  const format = ensureFormat(obj);
  const payload = {
    id: String(obj._id),
    title: format.title,
    description: format.description,
    buttonLabel: format.buttonLabel,
    submitLabel: format.submitLabel,
    published: Boolean(obj.published),
    showInNavbar: obj.showInNavbar !== false,
    fields: format.fields,
    format,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
  if (includeMeta) {
    payload.responseCount = obj.responseCount || 0;
    payload.responseShareEnabled = Boolean(obj.responseShareToken);
    if (obj.responseShareToken) {
      payload.responseShareToken = obj.responseShareToken;
    }
  }
  return payload;
}

function serializeResponse(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
    return {
    id: String(obj._id),
    formId: String(obj.formId),
    answers: obj.answers && typeof obj.answers === 'object' ? obj.answers : {},
    format: obj.format && typeof obj.format === 'object' ? obj.format : null,
    createdAt: obj.createdAt,
  };
}

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function invalidId(res) {
  return res.status(400).json({ error: 'Invalid form id.' });
}

function normalizeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname.includes('.')) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function newFieldId() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeFields(list = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((raw) => {
      const label = String(raw?.label || '').trim();
      if (!label) return null;
      const type = FORM_FIELD_TYPES.includes(raw?.type) ? raw.type : 'text';
      let id = String(raw?.id || '').trim() || newFieldId();
      if (seen.has(id)) id = newFieldId();
      seen.add(id);
      const needsOptions = type === 'select' || type === 'radio' || type === 'checkbox';
      const options = needsOptions
        ? (Array.isArray(raw.options) ? raw.options : [])
            .map((opt) => String(opt || '').trim())
            .filter(Boolean)
        : [];
      return {
        id,
        label,
        type,
        required: raw?.required !== false,
        placeholder: String(raw?.placeholder || '').trim(),
        options,
      };
    })
    .filter(Boolean);
}

function buildFormat({ title, description, buttonLabel, submitLabel, fields }) {
  const resolvedTitle = String(title || '').trim();
  return {
    title: resolvedTitle,
    description: String(description || '').trim(),
    buttonLabel: String(buttonLabel || resolvedTitle).trim() || resolvedTitle,
    submitLabel: String(submitLabel || 'Submit').trim() || 'Submit',
    fields: (fields || []).map(serializeField),
  };
}

function ensureFormat(obj) {
  if (obj?.format && Array.isArray(obj.format.fields) && obj.format.fields.length) {
    return {
      title: obj.format.title || obj.title,
      description: obj.format.description ?? obj.description ?? '',
      buttonLabel: obj.format.buttonLabel || obj.buttonLabel || obj.title || '',
      submitLabel: obj.format.submitLabel || obj.submitLabel || 'Submit',
      fields: obj.format.fields.map(serializeField),
    };
  }
  return buildFormat(obj);
}

function stampFormat(form) {
  form.format = buildFormat(form);
  form.markModified('fields');
  form.markModified('format');
}

function publicFormPayload(form) {
  const serialized = serializeForm(form);
  return {
    id: serialized.id,
    title: serialized.title,
    description: serialized.description,
    buttonLabel: serialized.buttonLabel,
    submitLabel: serialized.submitLabel,
    showInNavbar: serialized.showInNavbar,
    fields: serialized.fields,
    format: serialized.format,
  };
}

function formatAnswerCell(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value == null) return '';
  return String(value);
}

function validateAnswers(fields, answers) {
  const incoming = answers && typeof answers === 'object' ? answers : {};
  const cleaned = {};

  for (const field of fields) {
    const raw = incoming[field.id];
    const isEmptyArray = Array.isArray(raw) && raw.filter((v) => String(v).trim()).length === 0;
    const isEmpty =
      raw == null ||
      (typeof raw === 'string' && !raw.trim()) ||
      isEmptyArray;

    if (field.required && isEmpty) {
      return { error: `${field.label} is required.` };
    }
    if (isEmpty) {
      cleaned[field.id] = field.type === 'checkbox' ? [] : '';
      continue;
    }

    if (field.type === 'checkbox') {
      const selected = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim()).filter(Boolean);
      if (field.options.length && selected.some((v) => !field.options.includes(v))) {
        return { error: `Invalid option for ${field.label}.` };
      }
      cleaned[field.id] = selected;
      continue;
    }

    const value = String(raw).trim();
    if ((field.type === 'select' || field.type === 'radio') && field.options.length && !field.options.includes(value)) {
      return { error: `Invalid option for ${field.label}.` };
    }
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { error: `Enter a valid email for ${field.label}.` };
    }
    if (field.type === 'url') {
      const href = normalizeHttpUrl(value);
      if (!href) {
        return { error: `Enter a valid link for ${field.label} (e.g. https://example.com).` };
      }
      cleaned[field.id] = href;
      continue;
    }
    cleaned[field.id] = value;
  }

  return { answers: cleaned };
}

function newShareToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sharedResponsesPayload(form, responses) {
  const format = ensureFormat(form);
  return {
    form: {
      title: format.title,
      format,
      fields: format.fields,
    },
    responses: responses.map(serializeResponse),
  };
}

router.get('/public', async (_req, res) => {
  try {
    const navForms = await Form.find({ published: true, showInNavbar: { $ne: false } }).sort({ updatedAt: -1 });
    const forms = navForms.map(publicFormPayload);
    return res.json({
      forms,
      /** First navbar form — used by `/form` when no id is provided. */
      form: forms[0] || null,
    });
  } catch (err) {
    console.error('Public form error:', err);
    return res.status(500).json({ error: 'Could not load form.' });
  }
});

router.get('/share/:token/responses', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Invalid share link.' });
    }
    const form = await Form.findOne({ responseShareToken: token });
    if (!form) {
      return res.status(404).json({ error: 'This share link is invalid or has been revoked.' });
    }
    const responses = await FormResponse.find({ formId: form._id }).sort({ createdAt: 1 });
    return res.json(sharedResponsesPayload(form, responses));
  } catch (err) {
    console.error('Shared form responses error:', err);
    return res.status(500).json({ error: 'Could not load responses.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }
    if (!form.published) {
      return res.status(404).json({ error: 'This form is not currently open.' });
    }
    return res.json({ form: publicFormPayload(form) });
  } catch (err) {
    console.error('Get form error:', err);
    return res.status(500).json({ error: 'Could not load form.' });
  }
});

router.post('/:id/responses', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form || !form.published) {
      return res.status(404).json({ error: 'This form is not currently open.' });
    }
    const format = ensureFormat(form);
    if (!format.fields.length) {
      return res.status(400).json({ error: 'This form has no questions yet.' });
    }

    const checked = validateAnswers(format.fields, req.body.answers);
    if (checked.error) {
      return res.status(400).json({ error: checked.error });
    }

    const response = await FormResponse.create({
      formId: form._id,
      answers: checked.answers,
      format,
    });
    return res.status(201).json({ response: serializeResponse(response) });
  } catch (err) {
    console.error('Submit form response error:', err);
    return res.status(500).json({ error: 'Could not submit the form.' });
  }
});

router.get('/', requireAuth, async (_req, res) => {
  try {
    const forms = await Form.find().sort({ updatedAt: -1 }).lean();
    const counts = await FormResponse.aggregate([
      { $group: { _id: '$formId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((row) => [String(row._id), row.count]));
    return res.json({
      forms: forms.map((form) =>
        serializeForm({ ...form, responseCount: countMap.get(String(form._id)) || 0 }, { includeMeta: true })
      ),
    });
  } catch (err) {
    console.error('List forms error:', err);
    return res.status(500).json({ error: 'Could not load forms.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'Form title is required.' });
    }

    const fields = normalizeFields(req.body.fields);
    const published = Boolean(req.body.published);
    const showInNavbar = req.body.showInNavbar == null ? true : Boolean(req.body.showInNavbar);
    const form = await Form.create({
      title,
      description: String(req.body.description || '').trim(),
      buttonLabel: String(req.body.buttonLabel || title).trim(),
      submitLabel: String(req.body.submitLabel || 'Submit').trim() || 'Submit',
      published,
      showInNavbar,
      fields,
    });
    stampFormat(form);
    await form.save();

    return res.status(201).json({ form: serializeForm(form, { includeMeta: true }) });
  } catch (err) {
    console.error('Create form error:', err);
    return res.status(500).json({ error: 'Could not create form.' });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }

    if (req.body.title != null) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ error: 'Form title is required.' });
      form.title = title;
    }
    if (req.body.description != null) form.description = String(req.body.description).trim();
    if (req.body.buttonLabel != null) form.buttonLabel = String(req.body.buttonLabel).trim();
    if (req.body.submitLabel != null) {
      form.submitLabel = String(req.body.submitLabel).trim() || 'Submit';
    }
    if (Array.isArray(req.body.fields)) {
      form.fields = normalizeFields(req.body.fields);
    }
    if (req.body.published != null) {
      form.published = Boolean(req.body.published);
    }
    if (req.body.showInNavbar != null) {
      form.showInNavbar = Boolean(req.body.showInNavbar);
    }

    if (!form.buttonLabel) form.buttonLabel = form.title;
    stampFormat(form);
    await form.save();

    const responseCount = await FormResponse.countDocuments({ formId: form._id });
    return res.json({ form: serializeForm({ ...form.toObject(), responseCount }, { includeMeta: true }) });
  } catch (err) {
    console.error('Update form error:', err);
    return res.status(500).json({ error: 'Could not update form.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }

    const responseCount = await FormResponse.countDocuments({ formId: form._id });
    if (responseCount > 0) {
      return res.status(409).json({
        error: `This form has ${responseCount} saved response(s). Unpublish it instead of deleting so answers stay on record.`,
      });
    }

    await Form.findByIdAndDelete(form._id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete form error:', err);
    return res.status(500).json({ error: 'Could not delete form.' });
  }
});

router.post('/:id/share-link', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }

    if (req.body.regenerate || !form.responseShareToken) {
      form.responseShareToken = newShareToken();
      await form.save();
    }

    return res.json({
      token: form.responseShareToken,
      path: `/responses/share/${form.responseShareToken}`,
    });
  } catch (err) {
    console.error('Create share link error:', err);
    return res.status(500).json({ error: 'Could not create share link.' });
  }
});

router.delete('/:id/share-link', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }

    await Form.updateOne({ _id: form._id }, { $unset: { responseShareToken: 1 } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Revoke share link error:', err);
    return res.status(500).json({ error: 'Could not revoke share link.' });
  }
});

router.get('/:id/responses/export', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }

    const format = ensureFormat(form);
    const responses = await FormResponse.find({ formId: form._id }).sort({ createdAt: 1 });

    const columnMap = new Map();
    for (const field of format.fields) {
      columnMap.set(field.id, field.label);
    }
    for (const row of responses) {
      const snapFields = row.format?.fields;
      if (Array.isArray(snapFields)) {
        for (const field of snapFields) {
          if (field?.id && !columnMap.has(field.id)) {
            columnMap.set(field.id, field.label || field.id);
          }
        }
      }
      for (const key of Object.keys(row.answers || {})) {
        if (!columnMap.has(key)) columnMap.set(key, key);
      }
    }

    const columns = [...columnMap.entries()];
    const headers = ['#', ...columns.map(([, label]) => label), 'Submitted at'];
    const rows = responses.map((row, index) => {
      const answers = row.answers || {};
      return [
        String(index + 1),
        ...columns.map(([id]) => formatAnswerCell(answers[id])),
        row.createdAt ? new Date(row.createdAt).toISOString() : '',
      ];
    });

    const buffer = buildXlsx({
      sheetName: (format.title || 'Responses').slice(0, 31),
      headers,
      rows,
    });

    const filename = slugFilename(format.title || form.title);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    console.error('Export form responses error:', err);
    return res.status(500).json({ error: 'Could not export responses.' });
  }
});

router.put('/:id/responses/:responseId', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    if (!isValidId(req.params.responseId)) {
      return res.status(400).json({ error: 'Invalid response id.' });
    }

    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }

    const response = await FormResponse.findOne({ _id: req.params.responseId, formId: form._id });
    if (!response) {
      return res.status(404).json({ error: 'Response not found.' });
    }

    const snapFormat = response.format && typeof response.format === 'object' ? response.format : null;
    const fields =
      snapFormat && Array.isArray(snapFormat.fields) && snapFormat.fields.length
        ? snapFormat.fields.map(serializeField)
        : ensureFormat(form).fields;

    const checked = validateAnswers(fields, req.body.answers);
    if (checked.error) {
      return res.status(400).json({ error: checked.error });
    }

    response.answers = checked.answers;
    await response.save();

    const responseCount = await FormResponse.countDocuments({ formId: form._id });
    return res.json({
      response: serializeResponse(response),
      form: serializeForm({ ...form.toObject(), responseCount }, { includeMeta: true }),
    });
  } catch (err) {
    console.error('Update form response error:', err);
    return res.status(500).json({ error: 'Could not update response.' });
  }
});

router.delete('/:id/responses/:responseId', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    if (!isValidId(req.params.responseId)) {
      return res.status(400).json({ error: 'Invalid response id.' });
    }

    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }

    const response = await FormResponse.findOneAndDelete({ _id: req.params.responseId, formId: form._id });
    if (!response) {
      return res.status(404).json({ error: 'Response not found.' });
    }

    const responseCount = await FormResponse.countDocuments({ formId: form._id });
    return res.json({
      ok: true,
      form: serializeForm({ ...form.toObject(), responseCount }, { includeMeta: true }),
    });
  } catch (err) {
    console.error('Delete form response error:', err);
    return res.status(500).json({ error: 'Could not delete response.' });
  }
});

router.get('/:id/responses', requireAuth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return invalidId(res);
    const form = await Form.findById(req.params.id);
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }
    const responses = await FormResponse.find({ formId: form._id }).sort({ createdAt: 1 });
    return res.json({
      form: serializeForm(form, { includeMeta: true }),
      responses: responses.map(serializeResponse),
    });
  } catch (err) {
    console.error('List form responses error:', err);
    return res.status(500).json({ error: 'Could not load responses.' });
  }
});

export default router;

