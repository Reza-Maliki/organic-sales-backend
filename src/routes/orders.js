const express = require("express");
const {randomUUID} = require("crypto");
const {all, get, run} = require("../db");
const {requireAuth} = require("../middleware/auth");

const router = express.Router();

router.get("/me", requireAuth, async (req, res) => {
    const orders = await all(
        "SELECT id, status, total, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC",
        [req.user.sub]
    );

    const withItems = await Promise.all(
        orders.map(async (order) => {
            const items = await all(
                `SELECT oi.product_id, oi.quantity, oi.price, p.name, p.slug, p.image_url
                 FROM order_items oi
                 JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            return {...order, items};
        })
    );

    res.json(withItems);
});

router.post("/", requireAuth, async (req, res) => {
    const {items} = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({error: "items_required"});
    }

    let total = 0;
    const prepared = [];
    for (const item of items) {
        let product = null;
        if (item.productId) {
            product = await get("SELECT id, price, stock FROM products WHERE id = ?", [item.productId]);
        }
        if (!product && item.productSlug) {
            product = await get("SELECT id, price, stock FROM products WHERE slug = ?", [item.productSlug]);
        }
        if (!product) {
            return res.status(400).json({error: "invalid_product"});
        }
        const quantity = Number(item.quantity || 1);
        total += product.price * quantity;
        prepared.push({productId: product.id, price: product.price, quantity});
    }

    const orderId = randomUUID();
    await run(
        "INSERT INTO orders (id, user_id, status, total, created_at) VALUES (?, ?, ?, ?, ?)",
        [orderId, req.user.sub, "pending", total, new Date().toISOString()]
    );

    for (const line of prepared) {
        await run(
            "INSERT INTO order_items (id, order_id, product_id, quantity, price) VALUES (?, ?, ?, ?, ?)",
            [randomUUID(), orderId, line.productId, line.quantity, line.price]
        );
        await run(
            "UPDATE products SET stock = CASE WHEN stock > 0 THEN stock - ? ELSE stock END WHERE id = ?",
            [line.quantity, line.productId]
        );
    }

    res.json({id: orderId, total});
});

module.exports = router;
