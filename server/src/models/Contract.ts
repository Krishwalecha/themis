import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { owned } from "../lib/tenant";

const changeSchema = new Schema(
  { location: String, path: String, type: { type: String }, breaking: Boolean, message: String },
  { _id: false },
);

const contractSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    kind: { type: String, enum: ["openapi", "jsonschema"], required: true },
    // Current document (parsed JSON; YAML input is converted on save)
    document: { type: Schema.Types.Mixed, required: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

const contractVersionSchema = new Schema(
  {
    contractId: { type: Schema.Types.ObjectId, ref: "Contract", required: true },
    version: { type: Number, required: true },
    document: { type: Schema.Types.Mixed, required: true },
    note: { type: String, trim: true, maxlength: 500 },
    // Changes compared with the previous version
    changes: { type: [changeSchema], default: [] },
    breakingCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, minimize: false },
);
contractVersionSchema.index({ contractId: 1, version: -1 }, { unique: true });

const RETENTION_DAYS = Number(process.env.THEMIS_CHECK_RETENTION_DAYS) || 90;

// Log of every validation, used for pass-rate stats on contracts and the dashboard
const validationSchema = new Schema(
  {
    contractId: { type: Schema.Types.ObjectId, ref: "Contract", required: true },
    contractVersion: Number,
    source: { type: String, enum: ["workspace", "history", "monitor", "manual"], required: true },
    sourceId: { type: Schema.Types.ObjectId },
    method: String,
    url: String,
    status: Number,
    valid: Boolean,
    skipped: String,
    matched: { path: String, method: String, status: String },
    errorCount: Number,
    driftCount: Number,
    errors: [{ _id: false, path: String, message: String, keyword: String }],
    drift: [{ _id: false, path: String, kind: { type: String }, message: String }],
    at: { type: Date, default: Date.now },
  },
  { versionKey: false, suppressReservedKeysWarning: true },
);
validationSchema.index({ contractId: 1, at: -1 });
validationSchema.index({ at: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 3600, name: "retention" });

export type ContractDoc = InferSchemaType<typeof contractSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
contractSchema.plugin(owned);
export const Contract = model("Contract", contractSchema);
contractVersionSchema.plugin(owned);
export const ContractVersion = model("ContractVersion", contractVersionSchema);
validationSchema.plugin(owned);
export const ContractValidationLog = model("ContractValidation", validationSchema);
