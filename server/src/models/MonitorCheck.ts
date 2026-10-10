import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { owned } from "../lib/tenant";

const RETENTION_DAYS = Number(process.env.THEMIS_CHECK_RETENTION_DAYS) || 90;

const checkSchema = new Schema(
  {
    monitorId: { type: Schema.Types.ObjectId, ref: "Monitor", required: true },
    status: { type: String, enum: ["up", "degraded", "down"], required: true },
    statusCode: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    ttfbMs: Number,
    sizeBytes: Number,
    error: { code: String, message: String },
    // One-line reasons this check wasn't "up"
    failures: { type: [String], default: [] },
    assertions: [
      {
        _id: false,
        source: String,
        path: String,
        operator: String,
        expected: String,
        severity: String,
        passed: Boolean,
        message: String,
      },
    ],
    contract: {
      contractId: { type: Schema.Types.ObjectId, ref: "Contract" },
      validationId: { type: Schema.Types.ObjectId },
      version: Number,
      valid: Boolean,
      skipped: String,
      errorCount: Number,
      driftCount: Number,
      errors: [{ _id: false, path: String, message: String, keyword: String }],
      drift: [{ _id: false, path: String, kind: { type: String }, message: String }],
    },
    // ran inside a maintenance window: kept for the record, left out of uptime
    maintenance: { type: Boolean, default: false },
    // "scheduled" or "manual" (run now)
    trigger: { type: String, default: "scheduled" },
    checkedAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false },
);

checkSchema.index({ monitorId: 1, checkedAt: -1 });
checkSchema.index({ checkedAt: -1 });
checkSchema.index({ checkedAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 3600, name: "retention" });

export type MonitorCheckDoc = InferSchemaType<typeof checkSchema> & { _id: Types.ObjectId };
checkSchema.plugin(owned);
export const MonitorCheck = model("MonitorCheck", checkSchema);
