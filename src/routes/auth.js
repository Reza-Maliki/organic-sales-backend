const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {randomUUID} = require("crypto");
const {get, run} = require("../db");
const {requireAuth} = require("../middleware/auth");

const router = express.Router();
const authSecret = process.env.AUTH_SECRET || "change-me";

router.post("/register", async (req, res) => {
    const {email, password, role, name} = req.body || {};
    if (!email || !password) {
        return res.status(400).json({error: "email_and_password_required"});
    }
    const safeName = name && String(name).trim() ? String(name).trim() : "کاربر باغستان";

    const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
        return res.status(409).json({error: "email_already_used"});
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRole = role === "admin" ? "admin" : "customer";
    const userId = randomUUID();

    await run(
        "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [userId, email, safeName, passwordHash, userRole, new Date().toISOString()]
    );

    return res.json({id: userId, email, name: safeName, role: userRole});
});

router.post("/login", async (req, res) => {
    const {email, password} = req.body || {};
    if (!email || !password) {
        return res.status(400).json({error: "email_and_password_required"});
    }

    const user = await get(
        "SELECT id, email, name, password_hash, role FROM users WHERE email = ?",
        [email]
    );
    if (!user) {
        return res.status(401).json({error: "invalid_credentials"});
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({error: "invalid_credentials"});
    }

    const token = jwt.sign(
        {sub: user.id, email: user.email, name: user.name, role: user.role},
        authSecret,
        {
        expiresIn: "7d",
        }
    );

    return res.json({token, user: {id: user.id, email: user.email, name: user.name, role: user.role}});
});

router.get("/me", requireAuth, async (req, res) => {
    const user = await get("SELECT id, email, name, role FROM users WHERE id = ?", [req.user.sub]);
    if (!user) return res.status(404).json({error: "not_found"});
    res.json(user);
});

router.put("/profile", requireAuth, async (req, res) => {
    const {name, password} = req.body || {};
    let passwordHash = null;
    if (password) {
        passwordHash = await bcrypt.hash(password, 10);
    }
    await run(
        "UPDATE users SET name = COALESCE(?, name), password_hash = COALESCE(?, password_hash) WHERE id = ?",
        [name, passwordHash, req.user.sub]
    );
    const user = await get("SELECT id, email, name, role FROM users WHERE id = ?", [req.user.sub]);
    res.json(user);
});

module.exports = router;
