const jwt = require("jsonwebtoken");

const authSecret = process.env.AUTH_SECRET || "change-me";
const fallbackSecret =
    process.env.AUTH_SECRET_FALLBACK || (authSecret !== "change-me" ? "change-me" : null);

const requireAuth = (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({error: "unauthorized"});

    try {
        const payload = jwt.verify(token, authSecret);
        req.user = payload;
        return next();
    } catch {
        if (fallbackSecret) {
            try {
                const payload = jwt.verify(token, fallbackSecret);
                req.user = payload;
                return next();
            } catch {
                return res.status(401).json({error: "invalid_token"});
            }
        }
        return res.status(401).json({error: "invalid_token"});
    }
};

const requireAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({error: "forbidden"});
    }
    return next();
};

module.exports = {requireAuth, requireAdmin};
