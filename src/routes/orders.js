const express = require("express");
const {randomUUID} = require("crypto");
const {all, get, run, withTransaction} = require("../db");
const {requireAuth} = require("../middleware/auth");
const {requestPayment} = require("../payments/zarinpal");

const router = express.Router();

const getBackendBaseUrl = (req) => {
    const configured = process.env.BACKEND_BASE_URL && String(process.env.BACKEND_BASE_URL).trim();
    if (configured) return configured.replace(/\/+$/, "");
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.get("host");
    return `${proto}://${host}`;
};

router.get("/me", requireAuth, async (req, res) => {
    const orders = await all(
        "SELECT id, status, total, address_id, shipping_address, tipax_tracking_code, payment_provider, payment_authority, payment_ref_id, payment_status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC",
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
            let shippingAddress = null;
            if (order.shipping_address) {
                try {
                    shippingAddress = JSON.parse(order.shipping_address);
                } catch {
                    shippingAddress = order.shipping_address;
                }
            }
            return {...order, shippingAddress, items};
        })
    );

    res.json(withItems);
});

router.post("/", requireAuth, async (req, res) => {
    const {items, addressId} = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({error: "items_required"});
    }
    if (!addressId) {
        return res.status(400).json({error: "address_required"});
    }

    const address = await get(
        `SELECT id, recipient_name, phone, province, city, address_line, postal_code
         FROM addresses
         WHERE id = ? AND user_id = ?`,
        [addressId, req.user.sub]
    );
    if (!address) {
        return res.status(400).json({error: "invalid_address"});
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
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return res.status(400).json({error: "invalid_quantity"});
        }
        total += product.price * quantity;
        prepared.push({productId: product.id, price: product.price, quantity});
    }

    const orderId = randomUUID();
    const createdAt = new Date().toISOString();
    const shippingAddress = {
        id: address.id,
        recipientName: address.recipient_name,
        phone: address.phone,
        province: address.province,
        city: address.city,
        addressLine: address.address_line,
        postalCode: address.postal_code,
    };

    // Final step: لحظه‌ای موجودی را چک کن و در صورت کافی بودن کم کن.
    try {
        const result = await withTransaction(async (tx) => {
            for (const line of prepared) {
                const current = await tx.get("SELECT stock FROM products WHERE id = ?", [line.productId]);
                if (!current) {
                    throw Object.assign(new Error("invalid_product"), {code: "invalid_product"});
                }
                const available = Number(current.stock || 0);
                if (available < line.quantity) {
                    throw Object.assign(new Error("insufficient_stock"), {
                        code: "insufficient_stock",
                        productId: line.productId,
                        available,
                        requested: line.quantity,
                    });
                }
                await tx.run("UPDATE products SET stock = stock - ? WHERE id = ?", [line.quantity, line.productId]);
            }

            await tx.run(
                `INSERT INTO orders
                 (id, user_id, status, total, address_id, shipping_address, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [orderId, req.user.sub, "pending", total, addressId, JSON.stringify(shippingAddress), createdAt]
            );

            for (const line of prepared) {
                await tx.run(
                    "INSERT INTO order_items (id, order_id, product_id, quantity, price) VALUES (?, ?, ?, ?, ?)",
                    [randomUUID(), orderId, line.productId, line.quantity, line.price]
                );
            }

            const merchantId =
                process.env.ZARINPAL_MERCHANT_ID ||
                // sandbox allows any UUID
                randomUUID();
            const callbackUrl = `${getBackendBaseUrl(req)}/payments/zarinpal/callback?orderId=${encodeURIComponent(orderId)}`;
            const description = `Order ${orderId}`;
            const {authority, paymentUrl} = await requestPayment({
                merchantId,
                amount: Number(total),
                currency: "IRT",
                callbackUrl,
                description,
                metadata: {order_id: orderId},
            });

            await tx.run(
                "UPDATE orders SET payment_provider = ?, payment_authority = ?, payment_status = ?, status = ? WHERE id = ?",
                ["zarinpal", authority, "pending", "payment_pending", orderId]
            );

            return {authority, paymentUrl};
        });

        return res.json({id: orderId, total, paymentUrl: result.paymentUrl, authority: result.authority});
    } catch (error) {
        if (error?.code === "insufficient_stock") {
            return res.status(409).json({
                error: "insufficient_stock",
                productId: error.productId,
                available: error.available,
                requested: error.requested,
            });
        }
        if (error?.code === "invalid_product" || error?.message === "invalid_product") {
            return res.status(400).json({error: "invalid_product"});
        }
        console.error("Failed to create order", error);
        return res.status(500).json({error: "server_error"});
    }
});

module.exports = router;
