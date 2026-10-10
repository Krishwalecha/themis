import { Schema, model } from "mongoose";
import { owned } from "../lib/tenant";

const aiSummarySchema = new Schema(
  {
    targetType: { type: String, enum: ["history", "monitor", "contractValidation", "ops"], required: true },
    // History/validation id, monitor id + window, or the ops window
    targetKey: { type: String, required: true },
    source: { type: String, enum: ["groq", "heuristic"], required: true },
    model: String,
    note: String,
    summary: {
      headline: String,
      severity: String,
      summary: String,
      highlights: [{ _id: false, level: String, text: String }],
      recommendations: [String],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

aiSummarySchema.index({ targetType: 1, targetKey: 1, createdAt: -1 });
aiSummarySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600, name: "retention" });

aiSummarySchema.plugin(owned);
export const AiSummary = model("AiSummary", aiSummarySchema);
