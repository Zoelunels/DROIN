import { HttpError } from "./errors";
import { isValidTimezone } from "./time";

// Simple hand-written validation (no library) — every function throws 400 on invalid input.

export type TransactionType = "income" | "expense";

export function parseId(value: unknown, field = "id"): number {
  const id = Number(value);
  if (value === null || value === "" || !Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return id;
}

// null/undefined/"" → null, otherwise a valid id.
export function optionalId(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  return parseId(value, field);
}

export function requireString(value: unknown, field: string, maxLength = 100): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field} is required`);
  }
  if (value.trim().length > maxLength) {
    throw new HttpError(400, `${field} must be at most ${maxLength} characters`);
  }
  return value.trim();
}

// null/undefined/"" → null; otherwise it must be a string.
export function optionalString(value: unknown, field: string, maxLength = 1000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text`);
  if (value.trim().length > maxLength) {
    throw new HttpError(400, `${field} must be at most ${maxLength} characters`);
  }
  return value.trim() === "" ? null : value.trim();
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function requireType(value: unknown): TransactionType {
  if (value !== "income" && value !== "expense") {
    throw new HttpError(400, "type must be 'income' or 'expense'");
  }
  return value;
}

export function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new HttpError(400, `${field} must be true or false`);
  return value;
}

// Query-string flags: "true"/"1" → true, anything else → false.
export function queryFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

// Matches the NUMERIC(15, 2) columns: positive, at most 2 decimals, at most 13 digits before the point.
export function requireAmount(value: unknown, field = "amount"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a number greater than 0`);
  }
  if (Math.round(value * 100) / 100 !== value) {
    throw new HttpError(400, `${field} can have at most 2 decimal places`);
  }
  if (value >= 1e13) throw new HttpError(400, `${field} is too large`);
  return value;
}

// Like requireAmount, but 0 is allowed and missing means 0 (e.g. a transfer fee).
export function optionalAmount(value: unknown, field: string): number {
  if (value === undefined || value === null || value === 0) return 0;
  return requireAmount(value, field);
}

// "YYYY-MM", e.g. "2026-09".
export function requireMonth(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, `${field} must use the format YYYY-MM`);
  }
  return value;
}

// "YYYY-MM-DD", and it must be a real date (2026-02-30 is rejected).
export function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field} must use the format YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${field} is not a valid date`);
  }
  return value;
}

export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireDate(value, field);
}

// "HH:MM" in 24-hour time.
export function requireTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, `${field} must use the format HH:MM`);
  }
  return value;
}

// "#RRGGBB" or nothing.
export function optionalColor(value: unknown, field = "color"): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new HttpError(400, `${field} must be a hex color like #F4A259`);
  }
  return value.toUpperCase();
}

// Icon names are free-form keys the app maps to its own icon set (e.g. "utensils", "bus").
export function optionalIcon(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[a-z0-9-]{1,50}$/.test(value)) {
    throw new HttpError(400, "icon must be lowercase letters, digits or dashes (max 50)");
  }
  return value;
}

export function requireEmail(value: unknown): string {
  if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+$/.test(value.trim()) || value.length > 255) {
    throw new HttpError(400, "email is invalid");
  }
  return value.trim().toLowerCase();
}

export function requirePassword(value: unknown, field = "password"): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new HttpError(400, `${field} must be at least 8 characters`);
  }
  if (value.length > 200) throw new HttpError(400, `${field} is too long`);
  return value;
}

export function requireTimezone(value: unknown): string {
  if (typeof value !== "string" || !isValidTimezone(value)) {
    throw new HttpError(400, "timezone must be an IANA name like Asia/Jakarta");
  }
  return value;
}
