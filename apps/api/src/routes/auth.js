import bcrypt from "bcryptjs";
import express from "express";
import crypto from "crypto";
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

authRouter.get("/config", (req, res) => {
  res.json({
    googleClientId: config.googleClientId ?? null
  });
});

authRouter.post("/google", async (req, res, next) => {
  try {
    const { token, code } = req.body ?? {};
    if (!token && !code) {
      res.status(400).json({ error: "Google ID token (token) or authorization code (code) is required" });
      return;
    }

    let idToken = token;
    if (code) {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.googleClientId,
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          redirect_uri: "http://localhost:3000/api/auth/callback/google",
          grant_type: "authorization_code"
        })
      });
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        res.status(401).json({ error: "Failed to exchange authorization code: " + errorText });
        return;
      }
      const tokenData = await tokenResponse.json();
      idToken = tokenData.id_token;
    }

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!response.ok) {
      res.status(401).json({ error: "Invalid Google ID token" });
      return;
    }

    const payload = await response.json();
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && Number(payload.exp) < now) {
      res.status(401).json({ error: "Google ID token has expired" });
      return;
    }

    const validIssuer = ["accounts.google.com", "https://accounts.google.com"].includes(payload.iss);
    if (!validIssuer) {
      res.status(401).json({ error: "Invalid token issuer" });
      return;
    }

    if (config.googleClientId && payload.aud !== config.googleClientId) {
      res.status(401).json({ error: "Invalid token audience" });
      return;
    }

    const email = payload.email?.toLowerCase();
    if (!email) {
      res.status(400).json({ error: "Email claim is missing in Google ID token" });
      return;
    }

    let user = await findUserByEmail(email);
    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
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
        isAdmin: user.email.toLowerCase() === config.adminEmail.toLowerCase()
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

