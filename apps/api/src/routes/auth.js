import bcrypt from "bcryptjs";
import express from "express";
import { findUserByEmail } from "../db/index.js";
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

authRouter.get("/me", requireJwt, (req, res) => {
  res.json({
    user: {
      id: req.user.sub,
      email: req.user.email,
      isAdmin: req.user.email.toLowerCase() === config.adminEmail.toLowerCase()
    }
  });
});
