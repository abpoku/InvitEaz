import { query, queryOne, exec } from "@/lib/db";
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

export const PLAN_LIMITS: Record<Plan, { activeEvents: number; inviteesPerEvent: number; coPlanners: number; assembliesPerEvent: number; label: string }> = {
  FREE: { activeEvents: 2, inviteesPerEvent: 40, coPlanners: 0, assembliesPerEvent: 1, label: "Free" },
  PRO: { activeEvents: 15, inviteesPerEvent: 750, coPlanners: 5, assembliesPerEvent: 5, label: "Pro" },
  BUSINESS: { activeEvents: Infinity, inviteesPerEvent: Infinity, coPlanners: Infinity, assembliesPerEvent: Infinity, label: "Business" },
};

export async function createUser(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  organization?: string;
  country?: string;
}): Promise<User> {
  const existing = await queryOne("SELECT id FROM users WHERE email = ?", [input.email.toLowerCase()]);
  if (existing) throw new Error("An account with this email already exists.");

  const id = newId("usr");
  const hash = bcrypt.hashSync(input.password, 10);
  await exec(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, organization, country, plan, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FREE', 1)`,
    [
      id,
      input.email.toLowerCase(),
      hash,
      input.firstName,
      input.lastName,
      input.phone || null,
      input.organization || null,
      input.country || null,
    ]
  );
  return (await getUserById(id))!;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return queryOne<User>("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
}

export async function getUserById(id: string): Promise<User | undefined> {
  return queryOne<User>("SELECT * FROM users WHERE id = ?", [id]);
}

export function verifyPassword(user: User, password: string): boolean {
  return bcrypt.compareSync(password, user.password_hash);
}

export async function updateUserPlan(userId: string, plan: Plan) {
  await exec("UPDATE users SET plan = ? WHERE id = ?", [plan, userId]);
}
