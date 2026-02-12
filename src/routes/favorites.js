const express = require("express");
const {randomUUID} = require("crypto");
const {all, get, run} = require("../db");
const {requireAuth} = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
    const rows = await all(
        `SELECT f.id, p.id as product_id, p.name, p.slug, p.description, p.price, p.image_url
         FROM favorites f
         JOIN products p ON p.id = f.product_id
         WHERE f.user_id = ?
         ORDER BY f.created_at DESC`,
        [req.user.sub]
    );
    res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
    const {productId, productSlug} = req.body || {};
    const user = await get("SELECT id FROM users WHERE id = ?", [req.user.sub]);
    if (!user) return res.status(401).json({error: "invalid_user"});

    let product = null;
    if (productId) {
        product = await get("SELECT id FROM products WHERE id = ?", [productId]);
    } else if (productSlug) {
        product = await get("SELECT id FROM products WHERE slug = ?", [productSlug]);
    }
    if (!product) return res.status(400).json({error: "invalid_product"});

    const existing = await get(
        "SELECT id FROM favorites WHERE user_id = ? AND product_id = ?",
        [req.user.sub, product.id]
    );
    if (existing) return res.json({status: "already_favorited"});

    const id = randomUUID();
    await run(
        "INSERT INTO favorites (id, user_id, product_id, created_at) VALUES (?, ?, ?, ?)",
        [id, req.user.sub, product.id, new Date().toISOString()]
    );
    res.json({id, productId: product.id});
});

router.delete("/:id", requireAuth, async (req, res) => {
    await run("DELETE FROM favorites WHERE id = ? AND user_id = ?", [req.params.id, req.user.sub]);
    res.json({status: "deleted"});
});

module.exports = router;
