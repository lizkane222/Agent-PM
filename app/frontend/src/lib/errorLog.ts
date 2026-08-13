import type { AppError } from "../types/errors";

const STORAGE_KEY = "appErrorLog";
const MAX_ENTRIES = 100;

function readAll(): AppError[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as AppError[];
  } catch {
    return [];
  }
}

function writeAll(errors: AppError[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(errors.slice(-MAX_ENTRIES)));
}

export function addError(entry: Omit<AppError, "id" | "ts">): AppError {
  const full: AppError = {
    ...entry,
    id: Math.random().toString(36).slice(2),
    ts: Date.now(),
  };
  const existing = readAll();
  writeAll([...existing, full]);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "1" }));
  return full;
}

export function getErrors(): AppError[] {
  return readAll().slice().reverse();
}

export { STORAGE_KEY as ERROR_LOG_KEY };
