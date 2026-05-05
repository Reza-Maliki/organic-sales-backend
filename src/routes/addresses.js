const express = require("express");
const {randomUUID} = require("crypto");
const {all, get, run} = require("../db");
const {requireAuth} = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
    const rows = await all(
        `SELECT id, recipient_name, phone, province, city, address_line, postal_code, created_at
         FROM addresses
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [req.user.sub]
    );
    res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
    const {recipientName, phone, province, city, addressLine, postalCode} = req.body || {};
    if (!addressLine || !city) {
        return res.status(400).json({error: "address_required"});
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await run(
        `INSERT INTO addresses
         (id, user_id, recipient_name, phone, province, city, address_line, postal_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            req.user.sub,
            recipientName ? String(recipientName).trim() : null,
            phone ? String(phone).trim() : null,
            province ? String(province).trim() : null,
            String(city).trim(),
            String(addressLine).trim(),
            postalCode ? String(postalCode).trim() : null,
            createdAt,
        ]
    );

    const row = await get(
        `SELECT id, recipient_name, phone, province, city, address_line, postal_code, created_at
         FROM addresses
         WHERE id = ?`,
        [id]
    );
    res.json(row);
});

router.put("/:id", requireAuth, async (req, res) => {
    const existing = await get("SELECT id FROM addresses WHERE id = ? AND user_id = ?", [req.params.id, req.user.sub]);
    if (!existing) return res.status(404).json({error: "not_found"});

    const {recipientName, phone, province, city, addressLine, postalCode} = req.body || {};
    await run(
        `UPDATE addresses
         SET recipient_name = COALESCE(?, recipient_name),
             phone = COALESCE(?, phone),
             province = COALESCE(?, province),
             city = COALESCE(?, city),
             address_line = COALESCE(?, address_line),
             postal_code = COALESCE(?, postal_code)
         WHERE id = ? AND user_id = ?`,
        [
            recipientName != null ? String(recipientName).trim() : null,
            phone != null ? String(phone).trim() : null,
            province != null ? String(province).trim() : null,
            city != null ? String(city).trim() : null,
            addressLine != null ? String(addressLine).trim() : null,
            postalCode != null ? String(postalCode).trim() : null,
            req.params.id,
            req.user.sub,
        ]
    );

    const row = await get(
        `SELECT id, recipient_name, phone, province, city, address_line, postal_code, created_at
         FROM addresses
         WHERE id = ?`,
        [req.params.id]
    );
    res.json(row);
});

router.delete("/:id", requireAuth, async (req, res) => {
    const existing = await get("SELECT id FROM addresses WHERE id = ? AND user_id = ?", [req.params.id, req.user.sub]);
    if (!existing) return res.status(404).json({error: "not_found"});
    await run("DELETE FROM addresses WHERE id = ? AND user_id = ?", [req.params.id, req.user.sub]);
    res.json({status: "deleted"});
});

module.exports = router;

