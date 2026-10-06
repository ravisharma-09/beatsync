import { db } from "@/db";
import type { UserType } from "@beatsync/shared";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  created_at: number;
}

const toUser = (row: UserRow): UserType => ({
  id: row.id,
  email: row.email,
  username: row.username,
  createdAt: row.created_at,
});

/** Only the hash is stored, so a leaked database does not leak usable sessions. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
  }
}

export async function createUser(input: { email: string; username: string; password: string }): Promise<UserType> {
  const row: UserRow = {
    id: nanoid(),
    email: input.email,
    username: input.username,
    password_hash: await Bun.password.hash(input.password),
    created_at: Date.now(),
  };

  try {
    db.query(
      "INSERT INTO users (id, email, username, password_hash, created_at) VALUES ($id, $email, $username, $password_hash, $created_at)"
    ).run({ ...row });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new EmailTakenError();
    throw error;
  }

  return toUser(row);
}

// Verified against when the email is unknown, so both failure paths cost the same time.
const DUMMY_HASH = Bun.password.hash("not-a-real-password");

export async function verifyCredentials(email: string, password: string): Promise<UserType | null> {
  const row = db.query<UserRow, [string]>("SELECT * FROM users WHERE email = ?").get(email);
  const ok = await Bun.password.verify(password, row?.password_hash ?? (await DUMMY_HASH));
  return row && ok ? toUser(row) : null;
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now,
    now + SESSION_TTL_MS
  );
  return token;
}

export function deleteSession(token: string): void {
  db.query("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function getUserByToken(token: string | null | undefined): UserType | null {
  if (!token) return null;
  const row = db
    .query<UserRow, [string, number]>(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
    )
    .get(hashToken(token), Date.now());
  return row ? toUser(row) : null;
}

export function deleteExpiredSessions(): void {
  db.query("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function getUserFromRequest(req: Request): UserType | null {
  return getUserByToken(getBearerToken(req));
}

// ── Login throttling ────────────────────────────────────────────────────────
// In-memory is enough for a single-process server; it resets on restart.

const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 1000 * 60 * 15;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

export function isLoginBlocked(key: string): boolean {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED_LOGINS;
}

export function recordFailedLogin(key: string): void {
  const now = Date.now();
  const entry = failedLogins.get(key);
  if (!entry || entry.resetAt <= now) {
    failedLogins.set(key, { count: 1, resetAt: now + FAILED_LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
}

export function clearFailedLogins(key: string): void {
  failedLogins.delete(key);
}
