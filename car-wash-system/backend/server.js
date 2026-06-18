const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Cấu hình CORS thủ công siêu nghiêm ngặt để vượt qua Proxy của GitHub Codespaces
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    
    // Xử lý nhanh các yêu cầu kiểm tra (Preflight request) từ trình duyệt
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Kết nối PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || 'carwash',
    port: 5432,
});

// Tự động khởi tạo cấu trúc các bảng Cơ sở dữ liệu
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cars (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                brand VARCHAR(50),
                price NUMERIC,
                year INT,
                status VARCHAR(20) DEFAULT 'Còn hàng'
            );
            CREATE TABLE IF NOT EXISTS purchases (
                id SERIAL PRIMARY KEY,
                customer_name VARCHAR(100),
                phone VARCHAR(20),
                id_card VARCHAR(20),
                car_id INT REFERENCES cars(id),
                payment_method VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS maintenance (
                id SERIAL PRIMARY KEY,
                plate_number VARCHAR(20),
                customer_name VARCHAR(100),
                phone VARCHAR(20),
                service_type VARCHAR(100),
                appointment_time TIMESTAMP,
                notes TEXT
            );
        `);
        
        const res = await pool.query('SELECT COUNT(*) FROM cars');
        if (parseInt(res.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO cars (name, brand, price, year, status) VALUES
                ('Toyota Camry 2026', 'Toyota', 1100000000, 2026, 'Còn hàng'),
                ('Honda Civic Type R', 'Honda', 2400000000, 2025, 'Còn hàng'),
                ('Mazda CX-5', 'Mazda', 850000000, 2026, 'Còn hàng'),
                ('Ford Ranger Raptor', 'Ford', 1300000000, 2026, 'Đã bán');
            `);
        }
        console.log("Khởi tạo Database thành công!");
    } catch (err) {
        console.error("Lỗi khởi tạo Database:", err);
    }
};
initDB();

// 1. API Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        return res.json({ success: true, token: 'mock-jwt-token' });
    }
    res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
});

// 2. API Trang tổng quan (Dashboard)
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const totalCars = await pool.query('SELECT COUNT(*) FROM cars');
        const totalSales = await pool.query('SELECT COUNT(*) FROM purchases');
        const totalServices = await pool.query('SELECT COUNT(*) FROM maintenance');
        res.json({
            carsCount: totalCars.rows[0].count,
            salesCount: totalSales.rows[0].count,
            servicesCount: totalServices.rows[0].count
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. API Danh sách xe
app.get('/api/cars', async (req, res) => {
    try {
        const search = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 2; 
        const offset = (page - 1) * limit;

        const countQuery = await pool.query('SELECT COUNT(*) FROM cars WHERE name ILIKE $1', [`%${search}%`]);
        const totalItems = parseInt(countQuery.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        const carsQuery = await pool.query(
            'SELECT * FROM cars WHERE name ILIKE $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
            [`%${search}%`, limit, offset]
        );

        res.json({ cars: carsQuery.rows, totalPages, currentPage: page });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Chi tiết xe
app.get('/api/cars/:id', async (req, res) => {
    try {
        const car = await pool.query('SELECT * FROM cars WHERE id = $1', [req.params.id]);
        if (car.rows.length === 0) return res.status(404).json({ message: 'Không tìm thấy xe' });
        res.json(car.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Thêm xe
app.post('/api/cars', async (req, res) => {
    const { name, brand, price, year } = req.body;
    try {
        const newCar = await pool.query(
            'INSERT INTO cars (name, brand, price, year) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, brand, price, year]
        );
        res.json(newCar.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Xóa xe
app.delete('/api/cars/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM cars WHERE id = $1', [req.params.id]);
        res.json({ message: 'Xóa xe thành công' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. API Khách hàng mua xe
app.post('/api/purchases', async (req, res) => {
    const { customer_name, phone, id_card, car_id, payment_method } = req.body;
    try {
        await pool.query(
            'INSERT INTO purchases (customer_name, phone, id_card, car_id, payment_method) VALUES ($1, $2, $3, $4, $5)',
            [customer_name, phone, id_card, car_id, payment_method]
        );
        await pool.query("UPDATE cars SET status = 'Đã bán' WHERE id = $1", [car_id]);
        res.json({ success: true, message: 'Đăng ký mua xe thành công!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. API Đăng ký bảo dưỡng
app.post('/api/maintenance', async (req, res) => {
    const { plate_number, customer_name, phone, service_type, appointment_time, notes } = req.body;
    try {
        await pool.query(
            'INSERT INTO maintenance (plate_number, customer_name, phone, service_type, appointment_time, notes) VALUES ($1, $2, $3, $4, $5, $6)',
            [plate_number, customer_name, phone, service_type, appointment_time, notes]
        );
        res.json({ success: true, message: 'Đặt lịch bảo dưỡng thành công!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));