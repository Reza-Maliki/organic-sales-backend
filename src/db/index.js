const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {randomUUID} = require("crypto");
const {categories, products} = require("./seed-data");

const dbFile = process.env.DATABASE_FILE || "./data/dev.db";
const resolvedPath = path.resolve(__dirname, "..", "..", dbFile);
const db = new sqlite3.Database(resolvedPath);

const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });

const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });

const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });

const initDb = async () => {
    await run(
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer',
            created_at TEXT NOT NULL
        )`
    );
    await run(
        `CREATE TABLE IF NOT EXISTS favorites (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )`
    );
    await run(
        `CREATE TABLE IF NOT EXISTS password_resets (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )`
    );
    await run(
        `CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            image_url TEXT,
            created_at TEXT NOT NULL
        )`
    );
    await run(
        `CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT,
            price INTEGER NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0,
            image_url TEXT,
            category_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        )`
    );
    await run(
        `CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            total INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    );
    await run(
        `CREATE TABLE IF NOT EXISTS order_items (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price INTEGER NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )`
    );

    const userColumns = await all("PRAGMA table_info(users)");
    const hasName = userColumns.some((col) => col.name === "name");
    if (!hasName) {
        await run("ALTER TABLE users ADD COLUMN name TEXT");
    }

    const categoryColumns = await all("PRAGMA table_info(categories)");
    const hasCategoryImage = categoryColumns.some((col) => col.name === "image_url");
    if (!hasCategoryImage) {
        await run("ALTER TABLE categories ADD COLUMN image_url TEXT");
    }

    const breakfastCategory = await get("SELECT id FROM categories WHERE slug = 'breakfast'");
    const honeyCategory = await get("SELECT id FROM categories WHERE slug = 'honey'");
    if (breakfastCategory && honeyCategory && breakfastCategory.id !== honeyCategory.id) {
        await run("UPDATE products SET category_id = ? WHERE category_id = ?", [honeyCategory.id, breakfastCategory.id]);
        await run("DELETE FROM categories WHERE id = ?", [breakfastCategory.id]);
    } else if (breakfastCategory && !honeyCategory) {
        await run(
            "UPDATE categories SET slug = ?, name = ?, image_url = ? WHERE id = ?",
            ["honey", "عسل", "/images/categories-real/honey.png", breakfastCategory.id]
        );
    }

    for (const category of categories) {
        const exists = await get("SELECT id FROM categories WHERE slug = ?", [category.slug]);
        if (!exists) {
            await run(
                "INSERT INTO categories (id, name, slug, image_url, created_at) VALUES (?, ?, ?, ?, ?)",
                [randomUUID(), category.name, category.slug, category.imageUrl || null, new Date().toISOString()]
            );
        } else {
            await run(
                "UPDATE categories SET name = ?, image_url = COALESCE(?, image_url) WHERE slug = ?",
                [category.name, category.imageUrl || null, category.slug]
            );
        }
    }

    for (const product of products) {
        const existingProduct = await get("SELECT id FROM products WHERE slug = ?", [product.slug]);
        if (existingProduct) continue;

        const category = await get("SELECT id FROM categories WHERE name = ?", [product.category]);
        if (!category) continue;

        await run(
            `INSERT INTO products
             (id, name, slug, description, price, stock, image_url, category_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
            [
                randomUUID(),
                product.name,
                product.slug,
                product.description,
                product.price,
                product.stock,
                product.imageUrl,
                category.id,
                new Date().toISOString(),
            ]
        );
    }
};

module.exports = {db, run, get, all, initDb};
