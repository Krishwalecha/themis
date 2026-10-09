import { isValidObjectId } from "mongoose";
import { z } from "zod";

export const objectId = z.string().refine((v) => isValidObjectId(v), { message: "Invalid id" });
