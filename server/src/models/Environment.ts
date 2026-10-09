import { Schema, model } from "mongoose";
import { owned } from "../lib/tenant";

const variableSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    value: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    // Secret values are masked in list responses and the UI
    secret: { type: Boolean, default: false },
  },
  { _id: false },
);

const environmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    variables: { type: [variableSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

environmentSchema.plugin(owned);
environmentSchema.index({ ownerId: 1, name: 1 }, { unique: true });
export const Environment = model("Environment", environmentSchema);
