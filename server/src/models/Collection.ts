import { Schema, model } from "mongoose";
import { owned } from "../lib/tenant";

const savedRequestSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    request: { type: Schema.Types.Mixed, required: true },
    contractId: { type: Schema.Types.ObjectId, ref: "Contract", default: null },
    // values to capture from the response into variables for the requests after it
    extract: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

const collectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    environmentId: { type: Schema.Types.ObjectId, ref: "Environment", default: null },
    requests: { type: [savedRequestSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

collectionSchema.plugin(owned);
collectionSchema.index({ ownerId: 1, name: 1 }, { unique: true });
export const Collection = model("Collection", collectionSchema);
