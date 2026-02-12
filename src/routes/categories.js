const express = require("express");
const {randomUUID} = require("crypto");
const {all, get, run} = require("../db");
const {requireAuth, requireAdmin} = require("../middleware/auth");

const router = express.Router();

const slugify = (value) =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^\w\-]+/g, "");

router.get("/", async (_req, res) => {
    const rows = await all("SELECT id, name, slug, image_url FROM categories ORDER BY created_at DESC");
    res.json(rows);
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
    const {name, slug, imageUrl} = req.body || {};
    if (!name) return res.status(400).json({error: "name_required"});

    const finalSlug = slug ? slugify(slug) : slugify(name);
    const existing = await get("SELECT id FROM categories WHERE slug = ?", [finalSlug]);
    if (existing) return res.status(409).json({error: "slug_exists"});

    const id = randomUUID();
    await run(
        "INSERT INTO categories (id, name, slug, image_url, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, name, finalSlug, imageUrl || null, new Date().toISOString()]
    );
    res.json({id, name, slug: finalSlug, imageUrl: imageUrl || null});
});

module.exports = router;
