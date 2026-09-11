import { NextResponse } from "next/server";
import { z } from "zod";
import { createUser } from "@/lib/models/users";

const schema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
  organization: z.string().optional(),
  country: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const user = createUser(parsed.data);
    return NextResponse.json({ id: user.id, email: user.email });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Something went wrong." }, { status: 400 });
  }
}
