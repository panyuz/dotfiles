// Read-only receipt protocol, vendored copy of wait-report.mjs validation rules.
// Source: dotfiles/mac/skills/rex-loop/scripts/wait-report.mjs
// Keep in sync with wait-report.mjs. Parity is asserted by receipt-check.test.mjs.
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export const STATUSES = new Set(["reported", "blocked", "failed"]);
export const MAX_BYTES = 64 * 1024;

// Mirrors wait-report.mjs readReceipt(), but returns a structured result so the
// batch checker can distinguish permission errors from missing files.
export function inspectReceipt(file) {
  let info;
  try {
    info = statSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing", file };
    if (error.code === "EACCES" || error.code === "EPERM") return { kind: "permission", file, detail: error.code };
    return { kind: "invalid", file, detail: error.message };
  }
  if (!info.isFile()) return { kind: "invalid", file, detail: "not a regular file" };
  if (info.size >= MAX_BYTES) return { kind: "too-large", file, detail: `size ${info.size} >= 64 KiB` };
  let data;
  try {
    data = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") return { kind: "permission", file, detail: error.code };
    return { kind: "invalid", file, detail: error.message };
  }
  let receipt;
  try {
    receipt = JSON.parse(data);
  } catch (error) {
    return { kind: "invalid-json", file, detail: error.message };
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { kind: "invalid-field", file, detail: "receipt must be an object" };
  for (const key of ["taskId", "attemptId", "reportPath"]) {
    if (typeof receipt[key] !== "string" || !receipt[key].trim()) return { kind: "invalid-field", file, detail: `missing string field: ${key}` };
  }
  if (!STATUSES.has(receipt.status)) return { kind: "invalid-status", file, detail: String(receipt.status) };
  if (!isAbsolute(receipt.reportPath)) return { kind: "invalid-field", file, detail: "reportPath must be absolute" };
  return { kind: "ok", file, taskId: receipt.taskId, attemptId: receipt.attemptId, status: receipt.status, reportPath: receipt.reportPath };
}

// Report checks are metadata-only. The report body is never read.
export function inspectReport(path) {
  let info;
  try {
    info = statSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "report-missing", detail: path };
    if (error.code === "EACCES" || error.code === "EPERM") return { kind: "report-unreadable", detail: error.code };
    return { kind: "report-unreadable", detail: error.message };
  }
  if (!info.isFile()) return { kind: "report-not-file", detail: path };
  try {
    accessSync(path, constants.R_OK);
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") return { kind: "report-unreadable", detail: error.code };
    return { kind: "report-unreadable", detail: error.message };
  }
  return { kind: "ok" };
}
