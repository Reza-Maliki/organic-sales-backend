const express = require("express");
const bcrypt = require("bcryptjs");
const {randomUUID} = require("crypto");
const {get, run} = require("../db");

const router = express.Router();

router.post("/request", async (req, res) => {
    const {email} = req.body || {};
    if (!email) return res.status(400).json({error: "email_required"});

    const user = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (!user) return res.status(404).json({error: "user_not_found"});

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await run("DELETE FROM password_resets WHERE email = ?", [email]);
    await run(
        "INSERT INTO password_resets (id, email, code, expires_at) VALUES (?, ?, ?, ?)",
        [randomUUID(), email, code, expiresAt]
    );

    res.json({code, message: "کد بازیابی شما آماده است", expiresAt});
});

router.post("/reset", async (req, res) => {
    const {email, code, newPassword} = req.body || {};
    if (!email || !code || !newPassword) {
        return res.status(400).json({error: "invalid_request"});
    }

    const user = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (!user) return res.status(404).json({error: "user_not_found"});

    const reset = await get(
        "SELECT id, code, expires_at FROM password_resets WHERE email = ?",
        [email]
    );
    if (!reset || reset.code !== String(code)) {
        return res.status(400).json({error: "invalid_code"});
    }
    if (new Date(reset.expires_at).getTime() < Date.now()) {
        return res.status(400).json({error: "code_expired"});
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, user.id]);
    await run("DELETE FROM password_resets WHERE id = ?", [reset.id]);

    res.json({status: "password_updated"});
});

module.exports = router;
