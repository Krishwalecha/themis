import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { owned } from "../lib/tenant";

export const MONITOR_STATUSES = ["pending", "up", "degraded", "down", "paused"] as const;

const monitorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    // Request spec (same shape as the workspace request; may contain `{{variables}}`)
    request: { type: Schema.Types.Mixed, required: true },
    // when set, every check runs this collection in order instead (request then mirrors its first request, for display)
    collectionId: { type: Schema.Types.ObjectId, ref: "Collection" },
    environmentId: { type: Schema.Types.ObjectId, ref: "Environment" },
    schedule: { type: Schema.Types.Mixed, required: true },
    // Success rules
    assertions: { type: [Schema.Types.Mixed], default: [] },
    // Consecutive failing checks required before an incident opens
    failureThreshold: { type: Number, default: 1, min: 1, max: 10 },
    enabled: { type: Boolean, default: true },
    alerts: {
      webhookUrl: { type: String, trim: true },
      notifyOnRecovery: { type: Boolean, default: true },
    },
    tags: { type: [String], default: [] },
    // planned downtime: checks still run and are recorded, but open no incidents and send no alerts
    maintenance: { type: [{ _id: false, startsAt: Date, endsAt: Date, note: String }], default: [] },
    // Optional contract every response is validated against
    contractId: { type: Schema.Types.ObjectId, ref: "Contract" },
    // Contract violations mark a check degraded ("warning") or down ("critical")
    contractSeverity: { type: String, enum: ["warning", "critical"], default: "warning" },
    state: {
      status: { type: String, enum: MONITOR_STATUSES, default: "pending" },
      lastCheckedAt: Date,
      lastStatusCode: Number,
      lastLatencyMs: Number,
      lastError: String,
      consecutiveFailures: { type: Number, default: 0 },
      nextRunAt: Date,
      openIncidentId: { type: Schema.Types.ObjectId, ref: "Incident" },
    },
  },
  { timestamps: true, versionKey: false },
);

export type MonitorDoc = InferSchemaType<typeof monitorSchema> & { _id: Types.ObjectId };
monitorSchema.plugin(owned);
export const Monitor = model("Monitor", monitorSchema);
