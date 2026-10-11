import { Schema, model } from "mongoose";
import { owned } from "../lib/tenant";

// A public, read-only page showing the health of the monitors an account picks
const statusPageSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    title: { type: String, trim: true, maxlength: 80, default: "" },
    monitorIds: { type: [Schema.Types.ObjectId], ref: "Monitor", default: [] },
  },
  { timestamps: true, versionKey: false },
);

statusPageSchema.plugin(owned);
statusPageSchema.index({ slug: 1 }, { unique: true });
export const StatusPage = model("StatusPage", statusPageSchema);
