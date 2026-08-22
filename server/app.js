import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import secretaryRoutes from './routes/secretaries.js';
import formRoutes from './routes/forms.js';
import settingsRoutes from './routes/settings.js';
import Form from './models/Form.js';
import FormResponse from './models/FormResponse.js';
import IntakeRegistration from './models/IntakeRegistration.js';
import { isCloudinaryAdminConfigured } from './utils/cloudinary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/calliphony';

async function connectMongo() {
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  const useMemory = process.env.MEMORY_MONGO === '1' || process.env.MEMORY_MONGO === 'true';

  if (useMemory && process.env.NODE_ENV !== 'production') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const memory = await MongoMemoryServer.create();
    const uri = memory.getUri('calliphony');
    await mongoose.connect(uri);
    console.log('Connected to in-memory MongoDB (MEMORY_MONGO)');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error(`MongoDB connection failed (${err.message}).`);
    
    // only fallback to memory server in dev mode
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Falling back to in-memory MongoDB for local development.');
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      const memory = await MongoMemoryServer.create();
      const uri = memory.getUri('calliphony');
      await mongoose.connect(uri);
      console.log('Connected to in-memory MongoDB (fallback)');
    } else {
      // in production we throw because vercel cannot run the memory server
      throw new Error('Database connection failed in production.');
    }
  }
}

let seedPromise = null;
async function seedAdmin() {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const email = (process.env.ADMIN_EMAIL || 'admin@calliphony.local').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const passwordHash = await bcrypt.hash(password, 12);

    const users = await User.find().sort({ createdAt: 1 });
    if (users.length === 0) {
      await User.create({ email, passwordHash });
      console.log(`Seeded admin user: ${email}`);
      return;
    }

    // single-admin app: keep the first user in sync with .env (email + password)
    const admin = users[0];
    const emailChanged = admin.email !== email;
    const passwordMatches = await bcrypt.compare(password, admin.passwordHash);

    if (emailChanged || !passwordMatches) {
      admin.email = email;
      admin.passwordHash = passwordHash;
      await admin.save();
      console.log(`Updated admin credentials: ${email}`);
    }

    if (users.length > 1) {
      await User.deleteMany({ _id: { $ne: admin._id } });
      console.log(`Removed ${users.length - 1} extra admin user(s).`);
    }
  })();

  return seedPromise;
}

async function migrateIntakeToForm() {
  const existing = await Form.countDocuments();
  if (existing > 0) return;

  const registrations = await IntakeRegistration.find().sort({ createdAt: 1 }).lean();
  const form = await Form.create({
    title: 'Intake',
    description: 'Register for the intake of Calliphony by providing the details below. Stay tuned for updates!',
    buttonLabel: 'Intake',
    submitLabel: 'Register',
    published: true,
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Your full name', options: [] },
      {
        id: 'department',
        label: 'Department',
        type: 'select',
        required: true,
        placeholder: '',
        options: ['CSE', 'IT', 'ECE', 'EE', 'CE', 'ME'],
      },
      { id: 'rollNumber', label: 'Roll Number', type: 'text', required: true, placeholder: 'Your college roll number', options: [] },
      {
        id: 'role',
        label: 'Instrumentalist / Singer',
        type: 'text',
        required: true,
        placeholder: 'Instruments you play or if you sing',
        options: [],
      },
    ],
  });
  form.format = {
    title: form.title,
    description: form.description,
    buttonLabel: form.buttonLabel,
    submitLabel: form.submitLabel,
    fields: form.fields,
  };
  form.markModified('format');
  await form.save();

  if (registrations.length > 0) {
    await FormResponse.insertMany(
      registrations.map((reg) => ({
        formId: form._id,
        answers: {
          name: reg.name || '',
          department: reg.department || '',
          rollNumber: reg.rollNumber || '',
          role: reg.role || '',
        },
        format: form.format,
        createdAt: reg.createdAt,
        updatedAt: reg.updatedAt || reg.createdAt,
      }))
    );
  }

  console.log(`Migrated intake into dynamic form (${registrations.length} response(s)).`);
}

async function backfillFormFormats() {
  const forms = await Form.find();
  let updated = 0;
  for (const form of forms) {
    const hasFormat = form.format && Array.isArray(form.format.fields) && form.format.fields.length;
    if (hasFormat) continue;
    form.format = {
      title: form.title,
      description: form.description || '',
      buttonLabel: form.buttonLabel || form.title,
      submitLabel: form.submitLabel || 'Submit',
      fields: (form.fields || []).map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        required: Boolean(field.required),
        placeholder: field.placeholder || '',
        options: field.options || [],
      })),
    };
    form.markModified('format');
    await form.save();
    updated += 1;
  }
  if (updated > 0) {
    console.log(`Backfilled form format for ${updated} form(s).`);
  }
}

async function cleanupNullShareTokens() {
  const result = await Form.updateMany(
    { responseShareToken: null },
    { $unset: { responseShareToken: 1 } }
  );
  if (result.modifiedCount > 0) {
    console.log(`Removed null responseShareToken from ${result.modifiedCount} form(s).`);
  }
}

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET missing — using insecure development default.');
  process.env.JWT_SECRET = 'dev-calliphony-jwt-secret-change-me';
}

const app = express();

function parseCorsOrigins() {
  const fromEnv = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  if (process.env.NODE_ENV === 'production') return DEFAULT_CORS_ORIGINS;
  return true;
}

app.use(cors({ origin: parseCorsOrigins(), credentials: true }));
app.use(express.json({ limit: '2mb' }));

// serverless initialization
let isInitialized = false;
app.use(async (req, res, next) => {
  if (!isInitialized) {
    try {
      await connectMongo();
      await seedAdmin();
      await migrateIntakeToForm();
      await backfillFormFormats();
      await cleanupNullShareTokens();
      isInitialized = true;
    } catch (err) {
      console.error('Serverless initialization failed:', err);
      return res.status(500).json({ error: 'Database initialization failed.' });
    }
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, cloudinaryDelete: isCloudinaryAdminConfigured(), build: 'cloudinary-prefix-v2' });
});

app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/secretaries', secretaryRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/settings', settingsRoutes);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

export default app;
