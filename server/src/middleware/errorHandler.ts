/**
 * 📘 LESSON: Middleware
 * Middleware = a function that runs between the request arriving and the response
 * leaving. Express runs them in order: (req, res, next) => { ...; next(); }
 *
 * An ERROR middleware has 4 parameters (err, req, res, next). Express calls it
 * whenever something throws or calls next(err). One central place for errors =
 * consistent responses, and we never leak stack traces to the client.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("💥", err);
  const status = typeof err?.status === "number" ? err.status : 500;
  if (res.headersSent) return; // response already started (e.g. streaming)
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
};
