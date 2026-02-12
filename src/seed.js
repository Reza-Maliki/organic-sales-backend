require("dotenv").config();
const {randomUUID} = require("crypto");
const {initDb, get, run} = require("./db");
const {categories, products} = require("./db/seed-data");

const seed = async () => {
    await initDb();

    for (const category of categories) {
        const existing = await get("SELECT id FROM categories WHERE slug = ?", [category.slug]);
        if (!existing) {
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
        const existing = await get("SELECT id FROM products WHERE slug = ?", [product.slug]);
        if (existing) continue;

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

    console.log("Seed completed");
};

seed().catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
});
