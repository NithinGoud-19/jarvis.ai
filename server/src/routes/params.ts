/**
 * 📘 LESSON: URL parameters
 * In "/api/conversations/:id", ":id" is a PARAMETER. For /api/conversations/7,
 * req.params.id === "7" — always a STRING, so we must check it is a real number.
 */
import { z } from "zod";

export const idParam = z.coerce.number().int().positive();
