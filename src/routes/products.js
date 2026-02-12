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

router.get("/", async (req, res) => {
    const {category, q} = req.query;
    let sql =
        "SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p JOIN categories c ON c.id = p.category_id";
    const params = [];
    const filters = [];

    if (category) {
        filters.push("c.slug = ?");
        params.push(category);
    }
    if (q) {
        filters.push("(p.name LIKE ? OR p.description LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
    }
    if (filters.length) {
        sql += ` WHERE ${filters.join(" AND ")}`;
    }
    sql += " ORDER BY p.created_at DESC";

    const rows = await all(sql, params);
    res.json(rows);
});

router.get("/:id", async (req, res) => {
    const row = await get(
        "SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?",
        [req.params.id]
    );
    if (!row) return res.status(404).json({error: "not_found"});
    res.json(row);
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
    const {name, slug, description, price, stock, imageUrl, categoryId, categorySlug} = req.body || {};
    if (!name || price == null) return res.status(400).json({error: "name_and_price_required"});

    let category = null;
    if (categoryId) {
        category = await get("SELECT id FROM categories WHERE id = ?", [categoryId]);
    } else if (categorySlug) {
        category = await get("SELECT id FROM categories WHERE slug = ?", [categorySlug]);
    }
    if (!category) return res.status(400).json({error: "category_required"});

    const finalSlug = slug ? slugify(slug) : slugify(name);
    const existing = await get("SELECT id FROM products WHERE slug = ?", [finalSlug]);
    if (existing) return res.status(409).json({error: "slug_exists"});

    const id = randomUUID();
    await run(
        `INSERT INTO products
         (id, name, slug, description, price, stock, image_url, category_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            id,
            name,
            finalSlug,
            description || null,
            Number(price),
            Number(stock || 0),
            imageUrl || null,
            category.id,
            new Date().toISOString(),
        ]
    );
    res.json({id, name, slug: finalSlug});
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
    const {name, description, price, stock, imageUrl, categoryId} = req.body || {};
    const existing = await get("SELECT id FROM products WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({error: "not_found"});

    await run(
        `UPDATE products
         SET name = COALESCE(?, name),
             description = COALESCE(?, description),
             price = COALESCE(?, price),
             stock = COALESCE(?, stock),
             image_url = COALESCE(?, image_url),
             category_id = COALESCE(?, category_id)
         WHERE id = ?`,
        [name, description, price, stock, imageUrl, categoryId, req.params.id]
    );
    res.json({status: "updated"});
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
    await run("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.json({status: "deleted"});
});

module.exports = router;
