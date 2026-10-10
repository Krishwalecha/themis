import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { owned } from "../lib/tenant";

const incidentSchema = new Schema(
  {
    monitorId: { type: Schema.Types.ObjectId, ref: "Monitor", required: true },
    monitorName: { type: String, required: true },
    status: { type: String, enum: ["open", "resolved"], default: "open" },
    severity: { type: String, enum: ["degraded", "down"], required: true },
    cause: { type: String, required: true },
    startedAt: { type: Date, required: true },
    resolvedAt: Date,
    durationMs: Number,
    failedChecks: { type: Number, default: 1 },
    lastCheckAt: Date,
    timeline: [
      {
        _id: false,
        at: { type: Date, default: Date.now },
        type: {
          type: String,
          enum: ["opened", "escalated", "downgraded", "resolved", "alert_sent", "alert_failed"],
        },
        message: String,
      },
    ],
  },
  { timestamps: true, versionKey: false },
);

incidentSchema.index({ status: 1, startedAt: -1 });
incidentSchema.index({ monitorId: 1, startedAt: -1 });

export type IncidentDoc = InferSchemaType<typeof incidentSchema> & { _id: Types.ObjectId };
incidentSchema.plugin(owned);
export const Incident = model("Incident", incidentSchema);
