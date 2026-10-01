import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getUserByEmail, verifyPassword } from "@/lib/models/users";
import { AUTH_SERVICE_UNAVAILABLE } from "@/lib/auth-errors";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        // A DB failure here (timeout, dead pooled connection, Neon waking from suspend) must not
        // look like a wrong password: returning null gives the client "CredentialsSignin", while
        // a thrown Error's message is passed through as `error` instead — the login page keys off
        // this exact string to show a "try again" message, and the real cause lands in the logs.
        let user;
        try {
          user = await getUserByEmail(credentials.email);
        } catch (err) {
          console.error("[auth] user lookup failed during sign-in:", err);
          throw new Error(AUTH_SERVICE_UNAVAILABLE);
        }
        if (!user) return null;
        if (!verifyPassword(user, credentials.password)) return null;
        return {
          id: user.id,
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = (user as any).id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).id = token.id;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
