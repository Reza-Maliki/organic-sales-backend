const ZARINPAL_REQUEST_PATH = "/pg/v4/payment/request.json";
const ZARINPAL_VERIFY_PATH = "/pg/v4/payment/verify.json";

const getZarinpalHost = () => {
    const sandbox = String(process.env.ZARINPAL_SANDBOX || "true").toLowerCase() !== "false";
    return sandbox ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com";
};

const getStartPayUrl = (authority) => `${getZarinpalHost()}/pg/StartPay/${authority}`;

const requestPayment = async ({merchantId, amount, description, callbackUrl, metadata, currency}) => {
    const url = `${getZarinpalHost()}${ZARINPAL_REQUEST_PATH}`;
    const body = {
        merchant_id: merchantId,
        amount,
        callback_url: callbackUrl,
        description,
        ...(currency ? {currency} : null),
        ...(metadata ? {metadata} : null),
    };

    const res = await fetch(url, {
        method: "POST",
        headers: {Accept: "application/json", "Content-Type": "application/json"},
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const message = json?.errors?.[0]?.message || json?.data?.message || "zarinpal_request_failed";
        const error = new Error(message);
        error.details = json;
        throw error;
    }

    const code = json?.data?.code;
    const authority = json?.data?.authority;
    if (code !== 100 || !authority) {
        const message = json?.data?.message || "zarinpal_request_rejected";
        const error = new Error(message);
        error.details = json;
        throw error;
    }

    return {authority, paymentUrl: getStartPayUrl(authority), raw: json};
};

const verifyPayment = async ({merchantId, amount, authority}) => {
    const url = `${getZarinpalHost()}${ZARINPAL_VERIFY_PATH}`;
    const res = await fetch(url, {
        method: "POST",
        headers: {Accept: "application/json", "Content-Type": "application/json"},
        body: JSON.stringify({merchant_id: merchantId, amount, authority}),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const message = json?.errors?.[0]?.message || json?.data?.message || "zarinpal_verify_failed";
        const error = new Error(message);
        error.details = json;
        throw error;
    }
    return json;
};

module.exports = {requestPayment, verifyPayment, getStartPayUrl};

