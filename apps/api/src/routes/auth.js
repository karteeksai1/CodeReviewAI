import bcrypt from "bcryptjs";
import express from "express";
import { findUserByEmail, query } from "../db/index.js";
import { requireJwt, signUserToken } from "../middleware/auth.js";
import { config } from "../config.js";

export const authRouter = express.Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const user = await findUserByEmail(String(email).trim().toLowerCase());
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(String(password), user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    res.json({
      token: signUserToken(user),
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.email.toLowerCase() === config.adminEmail.toLowerCase()
      }
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/signup", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const existingUser = await findUserByEmail(trimmedEmail);
    if (existingUser) {
      res.status(409).json({ error: "User already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = await query(
      "insert into users (email, password_hash) values ($1, $2) returning id, email",
      [trimmedEmail, passwordHash]
    );
    const user = result.rows[0];

    res.status(201).json({
      token: signUserToken(user),
      user: {
        id: user.id,
        email: user.email,
        isAdmin: false
      }
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/google-mock", async (req, res, next) => {
  try {
    const email = "google-user@codereviewai.local";
    let user = await findUserByEmail(email);
    if (!user) {
      const passwordHash = await bcrypt.hash("google-mock-password", 10);
      const result = await query(
        "insert into users (email, password_hash) values ($1, $2) returning id, email",
        [email, passwordHash]
      );
      user = result.rows[0];
    }

    res.json({
      token: signUserToken(user),
      user: {
        id: user.id,
        email: user.email,
        isAdmin: false
      }
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireJwt, (req, res) => {
  res.json({
    user: {
      id: req.user.sub,
      email: req.user.email,
      isAdmin: req.user.email.toLowerCase() === config.adminEmail.toLowerCase()
    }
  });
});

