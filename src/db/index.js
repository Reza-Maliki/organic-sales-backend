const mysql = require("mysql2/promise");
const {randomUUID} = require("crypto");
const {categories, products} = require("./seed-data");

const DEFAULT_STOCK = 100;

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    namedPlaceholders: false,
    timezone: "Z",
});

const execQuery = async (sql, params = [], connection = null) => {
    const executor = connection || pool;
    const [rows] = await executor.execute(sql, params);
    return rows;
};

const run = async (sql, params = [], connection = null) => execQuery(sql, params, connection);

const get = async (sql, params = [], connection = null) => {
    const rows = await execQuery(sql, params, connection);
    return Array.isArray(rows) ? rows[0] || null : rows || null;
};

const all = async (sql, params = [], connection = null) => {
    const rows = await execQuery(sql, params, connection);
    return Array.isArray(rows) ? rows : [];
};

const withTransaction = async (fn) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await fn({
            run: (sql, params = []) => run(sql, params, connection),
            get: (sql, params = []) => get(sql, params, connection),
            all: (sql, params = []) => all(sql, params, connection),
        });
        await connection.commit();
        return result;
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // ignore rollback errors
        }
        throw error;
    } finally {
        connection.release();
    }
};

const initDb = async () => {
    if (!process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) {
        throw new Error("MYSQL_USER and MYSQL_DATABASE are required");
    }

    await run(`CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'customer',
        created_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await run(`CREATE TABLE IF NOT EXISTS password_resets (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(32) NOT NULL,
        expires_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await run(`CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        slug VARCHAR(255) NOT NULL UNIQUE,
        image_url TEXT NULL,
        created_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await run(`CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        description TEXT NULL,
        price INT NOT NULL,
        stock INT NOT NULL DEFAULT 0,
        image_url TEXT NULL,
        category_id VARCHAR(36) NOT NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_products_category_id (category_id),
        CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id)
            ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await run(`CREATE TABLE IF NOT EXISTS addresses (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        recipient_name VARCHAR(255) NULL,
        phone VARCHAR(64) NULL,
        province VARCHAR(255) NULL,
        city VARCHAR(255) NOT NULL,
        address_line TEXT NOT NULL,
        postal_code VARCHAR(64) NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_addresses_user_id (user_id),
        CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await run(`CREATE TABLE IF NOT EXISTS favorites (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        created_at DATETIME NOT NULL,
        UNIQUE KEY uniq_favorites_user_product (user_id, product_id),
        INDEX idx_favorites_user_id (user_id),
        INDEX idx_favorites_product_id (product_id),
        CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_favorites_product FOREIGN KEY (product_id) REFERENCES products(id)
            ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await run(`CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        status VARCHAR(64) NOT NULL,
        total INT NOT NULL,
        address_id VARCHAR(36) NULL,
        shipping_address TEXT NULL,
        tipax_tracking_code VARCHAR(255) NULL,
        payment_provider VARCHAR(64) NULL,
        payment_authority VARCHAR(255) NULL,
        payment_ref_id VARCHAR(255) NULL,
        payment_status VARCHAR(64) NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_orders_user_id (user_id),
        CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
            ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await run(`CREATE TABLE IF NOT EXISTS order_items (
        id VARCHAR(36) PRIMARY KEY,
        order_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        quantity INT NOT NULL,
        price INT NOT NULL,
        INDEX idx_order_items_order_id (order_id),
        INDEX idx_order_items_product_id (product_id),
        CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id)
            ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
            ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

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
        const id = randomUUID();
        await run(
            `INSERT INTO categories (id, name, slug, image_url, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 name = VALUES(name),
                 image_url = COALESCE(VALUES(image_url), image_url)`,
            [id, category.name, category.slug, category.imageUrl || null, new Date()]
        );
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
                product.description || null,
                product.price,
                DEFAULT_STOCK,
                product.imageUrl || null,
                category.id,
                new Date(),
            ]
        );
    }

    await run("UPDATE products SET stock = ?", [DEFAULT_STOCK]);
};

module.exports = {pool, run, get, all, initDb, withTransaction};

