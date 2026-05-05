require("dotenv").config();
const express = require("express");
const cors = require("cors");
const {initDb} = require("./db");

const authRoutes = require("./routes/auth");
const categoryRoutes = require("./routes/categories");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");
const favoriteRoutes = require("./routes/favorites");
const passwordRoutes = require("./routes/password");
const addressRoutes = require("./routes/addresses");
const paymentRoutes = require("./routes/payments");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({status: "ok"});
});

app.use("/auth", authRoutes);
app.use("/password", passwordRoutes);
app.use("/categories", categoryRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes);
app.use("/favorites", favoriteRoutes);
app.use("/addresses", addressRoutes);
app.use("/payments", paymentRoutes);

const port = Number(process.env.PORT || 4000);

initDb()
    .then(() => {
        app.listen(port, () => {
            console.log(`API listening on http://localhost:${port}`);
        });
    })
    .catch((error) => {
        console.error("Failed to init DB", error);
        process.exit(1);
    });
