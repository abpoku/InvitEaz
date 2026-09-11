import { getDb } from "@/lib/db";
import { newId } from "@/lib/utils";
import bcrypt from "bcryptjs";

export type Plan = "FREE" | "PRO" | "BUSINESS";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  organization: string | null;
  country: string | null;
  plan: Plan;
  email_verified: number;
  created_at: string;
}

export const PLAN_LIMITS: Record<Plan, { activeEvents: number; inviteesPerEvent: number; coPlanners: number; label: string }> = {
  FREE: { activeEvents: 2, inviteesPerEvent: 40, coPlanners: 0, label: "Free" },
  PRO: { activeEvents: 15, inviteesPerEvent: 750, coPlanners: 5, label: "Pro" },
  BUSINESS: { activeEvents: Infinity, inviteesPerEvent: Infinity, coPlanners: Infinity, label: "Business" },
};

export function createUser(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  organization?: string;
  country?: string;
}): User {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(input.email.toLowerCase());
  if (existing) throw new Error("An account with this email already exists.");

  const id = newId("usr");
  const hash = bcrypt.hashSync(input.password, 10);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, organization, country, plan, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FREE', 1)`
  ).run(
    id,
    input.email.toLowerCase(),
    hash,
    input.firstName,
    input.lastName,
    input.phone || null,
    input.organization || null,
    input.country || null
  );
  return getUserById(id)!;
}

export function getUserByEmail(email: string): User | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as User | undefined;
}

export function getUserById(id: string): User | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function verifyPassword(user: User, password: string): boolean {
  return bcrypt.compareSync(password, user.password_hash);
}

export function updateUserPlan(userId: string, plan: Plan) {
  const db = getDb();
  db.prepare("UPDATE users SET plan = ? WHERE id = ?").run(plan, userId);
}
