import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Express, RequestHandler } from "express";

const PgSession = connectPgSimple(session);

export type SessionUser = {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
};

declare global {
  namespace Express {
    interface User extends SessionUser {}
  }
}

export function setupAuth(app: Express) {
  app.set("trust proxy", 1);

  const sessionMiddleware = session({
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      tableName: "user_sessions",
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  });

  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username));

        if (!user) {
          return done(null, false, { message: "Usuario nao encontrado" });
        }

        if (!user.active) {
          return done(null, false, { message: "Usuario desativado" });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return done(null, false, { message: "Senha incorreta" });
        }

        return done(null, {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        });
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id));

      if (!user || !user.active) {
        return done(null, false);
      }

      done(null, {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      });
    } catch (err) {
      done(err);
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: SessionUser | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Credenciais invalidas" });
      }
      req.logIn(user, (err) => {
        if (err) return next(err);
        db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).then(() => {}).catch(() => {});
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          return res.json({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            role: user.role,
          });
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Erro ao sair" });
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logout realizado" });
      });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated()) {
      return res.json(req.user);
    }
    return res.status(401).json({ message: "Nao autenticado" });
  });
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Nao autenticado" });
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated() && req.user?.role === "admin") return next();
  return res.status(403).json({ message: "Acesso restrito a administradores" });
};

export async function ensureDefaultUser() {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.username, "admin"));

  if (!existing) {
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    await db.insert(users).values({
      username: "admin",
      password: hashedPassword,
      displayName: "Administrador",
      role: "admin",
      active: 1,
    });
    console.log("[Auth] Usuario padrao criado");
  }
}
