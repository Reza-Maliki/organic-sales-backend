const express = require("express");
const {randomUUID} = require("crypto");
const {all, get, run} = require("../db");
const {requestPayment, verifyPayment} = require("../payments/zarinpal");
const {createTipaxShipment} = require("../shipping/tipax");

const router = express.Router();

const getBackendBaseUrl = (req) => {
    const configured = process.env.BACKEND_BASE_URL && String(process.env.BACKEND_BASE_URL).trim();
    if (configured) return configured.replace(/\/+$/, "");
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.get("host");
    return `${proto}://${host}`;
};

const renderResult = ({ok, title, details, orderId}) => {
    const statusText = ok ? "success" : "failed";
    return `<!doctype html>
<html lang="fa" dir="rtl">
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head>
  <body style="font-family: sans-serif; background:#f4f6f7; padding:24px;">
    <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;">
      <h1 style="margin:0 0 8px;">${title}</h1>
      <p style="margin:0 0 16px;color:#444;">وضعیت: <b>${statusText}</b></p>
      ${orderId ? `<p style="margin:0 0 16px;color:#444;">کد سفارش: <code>${orderId}</code></p>` : ""}
      ${details ? `<pre style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:12px;overflow:auto;">${details}</pre>` : ""}
      <a href="/" style="display:inline-block;margin-top:12px;color:#fff;background:#ef394e;padding:10px 14px;border-radius:10px;text-decoration:none;">بازگشت</a>
    </div>
  </body>
</html>`;
};

router.get("/zarinpal/callback", async (req, res) => {
    const {Authority, Status, orderId} = req.query || {};
    if (!orderId) {
        return res.status(400).send(renderResult({ok: false, title: "پارامتر orderId موجود نیست"}));
    }

    const order = await get(
        "SELECT id, total, payment_authority FROM orders WHERE id = ?",
        [String(orderId)]
    );
    if (!order) {
        return res.status(404).send(renderResult({ok: false, title: "سفارش پیدا نشد", orderId: String(orderId)}));
    }

    if (String(Status || "").toUpperCase() !== "OK") {
        await run("UPDATE orders SET payment_status = ?, status = ? WHERE id = ?", ["canceled", "payment_canceled", order.id]);
        return res.send(renderResult({ok: false, title: "پرداخت لغو شد", orderId: order.id}));
    }

    const authority = String(Authority || "");
    if (!authority || (order.payment_authority && order.payment_authority !== authority)) {
        return res.status(400).send(
            renderResult({ok: false, title: "authority نامعتبر است", orderId: order.id})
        );
    }

    const merchantId = process.env.ZARINPAL_MERCHANT_ID || randomUUID();
    try {
        const verify = await verifyPayment({
            merchantId,
            amount: Number(order.total),
            authority,
        });
        const code = verify?.data?.code;
        const refId = verify?.data?.ref_id;
        const ok = code === 100 || code === 101;

        if (!ok) {
            await run("UPDATE orders SET payment_status = ?, status = ? WHERE id = ?", ["failed", "payment_failed", order.id]);
            return res.send(
                renderResult({
                    ok: false,
                    title: "پرداخت تایید نشد",
                    orderId: order.id,
                    details: JSON.stringify(verify, null, 2),
                })
            );
        }

        const items = await all(
            `SELECT oi.product_id, oi.quantity, oi.price, p.name, p.slug, p.image_url
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = ?`,
            [order.id]
        );
        const orderRow = await get("SELECT shipping_address FROM orders WHERE id = ?", [order.id]);
        let shippingAddress = null;
        if (orderRow?.shipping_address) {
            try {
                shippingAddress = JSON.parse(orderRow.shipping_address);
            } catch {
                shippingAddress = orderRow.shipping_address;
            }
        }

        const {trackingCode} = await createTipaxShipment({
            orderId: order.id,
            address: shippingAddress,
            items,
            total: Number(order.total),
        });

        await run(
            "UPDATE orders SET payment_provider = ?, payment_authority = ?, payment_ref_id = ?, payment_status = ?, tipax_tracking_code = ?, status = ? WHERE id = ?",
            ["zarinpal", authority, String(refId || ""), "paid", trackingCode, "submitted", order.id]
        );

        return res.send(
            renderResult({
                ok: true,
                title: "پرداخت موفق بود",
                orderId: order.id,
                details: refId ? `ref_id: ${refId}\ntracking: ${trackingCode}` : `tracking: ${trackingCode}`,
            })
        );
    } catch (error) {
        await run("UPDATE orders SET payment_status = ?, status = ? WHERE id = ?", ["error", "payment_error", order.id]);
        return res.status(500).send(
            renderResult({
                ok: false,
                title: "خطا در تایید پرداخت",
                orderId: order.id,
                details: error?.message || "verify_failed",
            })
        );
    }
});

router.post("/zarinpal/request", async (req, res) => {
    const {orderId} = req.body || {};
    if (!orderId) return res.status(400).json({error: "orderId_required"});

    const order = await get("SELECT id, total FROM orders WHERE id = ?", [String(orderId)]);
    if (!order) return res.status(404).json({error: "not_found"});

    const merchantId = process.env.ZARINPAL_MERCHANT_ID || randomUUID();
    const callbackUrl = `${getBackendBaseUrl(req)}/payments/zarinpal/callback?orderId=${encodeURIComponent(order.id)}`;
    const description = `Order ${order.id}`;

    try {
        const {authority, paymentUrl} = await requestPayment({
            merchantId,
            amount: Number(order.total),
            currency: "IRT",
            callbackUrl,
            description,
            metadata: {order_id: order.id},
        });

        await run(
            "UPDATE orders SET payment_provider = ?, payment_authority = ?, payment_status = ?, status = ? WHERE id = ?",
            ["zarinpal", authority, "pending", "payment_pending", order.id]
        );

        return res.json({orderId: order.id, authority, paymentUrl});
    } catch (error) {
        return res.status(502).json({error: "gateway_error", message: error?.message || "gateway_error"});
    }
});

module.exports = router;
