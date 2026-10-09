import { Schema, model } from "mongoose";

// A signed-in browser
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: "", maxlength: 300 },
    ip: { type: String, default: "", maxlength: 64 },
    lastSeenAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiry" });

export const Session = model("Session", sessionSchema);
