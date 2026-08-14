// Express 4 (unlike Express 5) does NOT automatically forward a rejected
// promise from an async route handler to the error-handling middleware —
// an unhandled rejection would otherwise just hang the request or crash
// the process. Wrap every async route handler with this so a thrown error
// (e.g. the database being briefly unreachable) correctly reaches the
// error handler in server.js and returns a real JSON error response.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}