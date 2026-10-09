import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { owned } from "../lib/tenant";

const headerPair = new Schema({ key: String, value: String }, { _id: false });

const historySchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 200 },
    // The request exactly as authored (with `{{variables}}`), so it can be re-run against any environment
    request: { type: Schema.Types.Mixed, required: true },
    environmentId: { type: Schema.Types.ObjectId, ref: "Environment" },
    // Denormalised fields for listing/filtering without loading the full document
    method: { type: String, required: true, index: true },
    url: { type: String, required: true },
    resolvedUrl: { type: String, required: true },
    status: { type: Number, required: true, index: true },
    latencyMs: { type: Number, required: true },
    sizeBytes: { type: Number, required: true },
    errorCode: { type: String },
    response: {
      statusText: String,
      headers: [headerPair],
      contentType: String,
      body: String,
      bodyEncoding: { type: String, enum: ["utf8", "base64"], default: "utf8" },
      truncated: Boolean,
      storedBodyTruncated: Boolean,
      ttfbMs: Number,
      redirected: Boolean,
      finalUrl: String,
      error: { code: String, message: String },
    },
    requestHeaders: [headerPair],
    unresolvedVariables: [String],
    rerunOf: { type: Schema.Types.ObjectId, ref: "History" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

historySchema.index({ createdAt: -1 });

export type HistoryDoc = InferSchemaType<typeof historySchema> & { _id: Types.ObjectId; createdAt: Date };
historySchema.plugin(owned);
export const History = model("History", historySchema);
