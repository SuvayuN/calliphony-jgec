import mongoose from 'mongoose';

const FIELD_TYPES = ['text', 'textarea', 'email', 'url', 'tel', 'number', 'select', 'radio', 'checkbox'];

const formFieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: FIELD_TYPES, default: 'text' },
    required: { type: Boolean, default: true },
    placeholder: { type: String, default: '', trim: true },
    options: { type: [String], default: [] },
  },
  { _id: false }
);

const formSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    buttonLabel: { type: String, default: '', trim: true },
    submitLabel: { type: String, default: 'Submit', trim: true },
    published: { type: Boolean, default: false },
    /** When published and true, show a button in the site navbar. False = unlisted (URL only). */
    showInNavbar: { type: Boolean, default: true },
    /** Read-only live share token for response viewing (field absent = disabled). */
    responseShareToken: { type: String, sparse: true, unique: true },
    fields: { type: [formFieldSchema], default: [] },
    /** Canonical form layout saved in Mongo so any client can render it. */
    format: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

formSchema.index({ published: 1, showInNavbar: 1, updatedAt: -1 });

export const FORM_FIELD_TYPES = FIELD_TYPES;
export default mongoose.model('Form', formSchema);
