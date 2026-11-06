#!/usr/bin/env bun
// Read-only local notification. A receipt is evidence to inspect, never acceptance.
import { readFileSync, statSync, watch, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const statuses = new Set(["reported", "blocked", "failed"]);
const maxBytes = 64 * 1024;

function readReceipt(file) {
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size >= maxBytes) {
      throw new Error("Receipt must be a regular file smaller than 64 KiB");
    }
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      throw new Error("Receipt must be an object");
    }
    for (const key of ["taskId", "attemptId", "reportPath"]) {
      if (typeof receipt[key] !== "string" || !receipt[key].trim()) {
        throw new Error(`Missing string field: ${key}`);
      }
    }
    if (!statuses.has(receipt.status) || !isAbsolute(receipt.reportPath)) {
      throw new Error("Invalid status or non-absolute reportPath");
    }
    return {
      reason: "report", file, taskId: receipt.taskId,
      attemptId: receipt.attemptId, status: receipt.status,
      reportPath: receipt.reportPath,
    };
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    return { reason: "invalid-report", file, detail: error.message };
  }
}

export function waitForReports(files, { timeoutMs = 30000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new Error("timeout-ms must be an integer from 1 to 60000");
  }
  if (!files.length || files.some(file => typeof file !== "string" || !isAbsolute(file))) {
    throw new Error("Provide at least one absolute receipt path");
  }
  const paths = [...new Set(files.map(file => resolve(file)))];
  return new Promise(resolveResult => {
    const watchers = [];
    let timer;
    let finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      resolveResult(result);
    };
    const inspect = () => {
      if (finished) return;
      for (const file of paths) {
        const result = readReceipt(file);
        if (result) { finish(result); return; }
      }
    };
    inspect();
    if (finished) return;
    try {
      for (const directory of new Set(paths.map(file => dirname(file)))) {
        const watcher = watch(directory, inspect);
        watchers.push(watcher);
        watcher.on("error", error => finish({
          reason: "watch-error", directory, detail: error.message,
        }));
      }
      timer = setTimeout(() => finish({ reason: "timeout", pending: paths }), timeoutMs);
      inspect(); // Catch an atomic rename between the initial read and watch setup.
    } catch (error) {
      finish({ reason: "watch-error", detail: error.message });
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const files = [];
  let timeoutMs = 30000;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--timeout-ms") {
      timeoutMs = Number(args[++index]);
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      files.push(argument);
    }
  }
  const result = await waitForReports(files, { timeoutMs });
  console.log(JSON.stringify(result));
  if (result.reason === "watch-error" || result.reason === "invalid-report") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => {
    console.log(JSON.stringify({ reason: "watch-error", detail: error.message }));
    process.exitCode = 1;
  });
}
