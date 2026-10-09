import { Schema, model } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
    // Optional public handle, shown on the profile card
    username: { type: String, trim: true, lowercase: true, maxlength: 20, unique: true, sparse: true },
    // `scrypt$<N>$<salt b64>$<hash b64>`; never leaves the server. Absent for accounts made with Google.
    passwordHash: { type: String, select: false },
    // Google's stable account id ("sub"), once the account has signed in with Google
    googleId: { type: String, unique: true, sparse: true, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = model("User", userSchema);
