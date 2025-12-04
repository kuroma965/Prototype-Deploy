// server.js (CommonJS)

require('dotenv').config();

const express = require('express');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- CONFIG UPLOAD → pic.in.th -------------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const PIC_API_URL = 'https://pic.in.th/api/1/upload';
const PIC_API_KEY = process.env.PIC_API_KEY; // เก็บคีย์ใน .env

if (!PIC_API_KEY) {
  console.warn('Warning: PIC_API_KEY not set. Set it in .env before running server.');
}

/* -------------------- CONFIG Maileroo Email API (ใหม่) -------------------- */

const MAILEROO_API_URL = 'https://smtp.maileroo.com/api/v2/emails';
const MAILEROO_API_KEY = process.env.MAILEROO_API_KEY;

if (!MAILEROO_API_KEY) {
  console.warn('Warning: MAILEROO_API_KEY not set. Set it in .env before running server.');
}

/* -------------------- MIDDLEWARE ทั่วไป -------------------- */

// อ่านข้อมูลจาก form (urlencoded) สำหรับฟอร์มส่งเมล
app.use(express.urlencoded({ extended: true }));
// ถ้าเผื่อมีการส่ง JSON ในอนาคต
app.use(express.json());

// เสิร์ฟไฟล์ static ในโฟลเดอร์ public (index.html, upload.html, mail.html, maileroo.html)
app.use(express.static(path.join(__dirname, 'public')));

/* -------------------- ROUTE หน้าแรก -------------------- */

// GET / -> หน้าเลือกเมนู (index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* -------------------- ROUTE อัปโหลดรูป /api/upload -------------------- */

// POST /api/upload => รับไฟล์จาก client แล้ว forward ให้ pic.in.th
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    // สร้าง form-data สำหรับส่งไป pic.in.th
    const fd = new FormData();

    // pic.in.th accepts "source" (file binary) and "format=json"
    fd.append('source', req.file.buffer, {
      filename: req.file.originalname || 'upload.bin',
      contentType: req.file.mimetype || 'application/octet-stream',
      knownLength: req.file.size,
    });
    fd.append('format', 'json');

    if (PIC_API_KEY) {
      // ส่งเป็นฟิลด์ 'key' เพื่อเลี่ยง custom header preflight
      fd.append('key', PIC_API_KEY);
    }

    const headers = fd.getHeaders();

    const upstream = await axios.post(PIC_API_URL, fd, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: null, // ให้เราตรวจ status code เอง
    });

    // ส่ง response กลับไปให้ client ตามที่ pic.in.th ตอบมา
    res.status(upstream.status).json(upstream.data);
  } catch (err) {
    console.error('Upload proxy error:', err && err.stack ? err.stack : err);
    res.status(500).json({
      error: 'proxy_error',
      detail: err && err.message ? err.message : String(err),
    });
  }
});

/* -------------------- ROUTE ส่งเมลแบบเก่า (Gmail SMTP) /api/send-mail -------------------- */

// ตัวนี้ของเก่า ไม่ไปยุ่ง
app.post('/api/send-mail', async (req, res) => {
  const { to, subject, message } = req.body;

  // สร้าง transporter สำหรับส่งเมลด้วย Gmail
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // ใช้ true กับ port 465
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"My-Web" <${process.env.MAIL_USER}>`,
    to,
    subject,
    text: message,
    // html: `<p>${message}</p>`
  };

  try {
    await transporter.sendMail(mailOptions);
    res.send(`
      <h2>ส่งเมล (Gmail SMTP) สำเร็จ!</h2>
      <p>ส่งไปที่: ${to}</p>
      <a href="/">กลับหน้าหลัก</a>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send(`
      <h2>เกิดข้อผิดพลาดในการส่งเมล (Gmail)</h2>
      <pre>${error.message}</pre>
      <a href="/">ลองใหม่ / กลับหน้าหลัก</a>
    `);
  }
});

/* -------------------- ROUTE ส่งเมลแบบใหม่ (Maileroo API) /api/send-mail-maileroo -------------------- */

app.post('/api/send-mail-maileroo', async (req, res) => {
  const { to, subject, message } = req.body;

  if (!MAILEROO_API_KEY) {
    return res.status(500).send(`
      <h2>MAILEROO_API_KEY ไม่ถูกตั้งค่า</h2>
      <p>กรุณาเช็คไฟล์ .env ให้มีค่า MAILEROO_API_KEY</p>
      <a href="/">กลับหน้าหลัก</a>
    `);
  }

  const fromAddress = process.env.MAIL_FROM_ADDRESS; // เช่น no-reply@059a583b4ef0a6eb.maileroo.org
  const fromName = process.env.MAIL_FROM_NAME || 'My-Web';

  if (!fromAddress) {
    return res.status(500).send(`
      <h2>MAIL_FROM_ADDRESS ไม่ถูกตั้งค่า</h2>
      <p>กรุณาใส่ MAIL_FROM_ADDRESS ในไฟล์ .env เช่น no-reply@059a583b4ef0a6eb.maileroo.org</p>
      <a href="/">กลับหน้าหลัก</a>
    `);
  }

  const payload = {
    from: {
      address: fromAddress,
      display_name: fromName,
    },
    to: [
      { address: to },
    ],
    subject,
    html: `<p>${(message || '').replace(/\n/g, '<br>')}</p>`,
    plain: message,
    tracking: true,
  };

  try {
    const response = await axios.post(MAILEROO_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MAILEROO_API_KEY}`,
      },
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      res.send(`
        <h2>ส่งเมลผ่าน Maileroo สำเร็จ!</h2>
        <p>ส่งไปที่: ${to}</p>
        <a href="/">กลับหน้าหลัก</a>
      `);
    } else {
      console.error('Maileroo API error:', response.status, response.data);
      res.status(response.status).send(`
        <h2>Maileroo API ตอบกลับด้วย error</h2>
        <p>Status: ${response.status}</p>
        <pre>${JSON.stringify(response.data, null, 2)}</pre>
        <a href="/">กลับหน้าหลัก</a>
      `);
    }
  } catch (error) {
    console.error('Maileroo API request failed:', error);
    res.status(500).send(`
      <h2>เกิดข้อผิดพลาดในการเรียก Maileroo API</h2>
      <pre>${error.message}</pre>
      <a href="/">กลับหน้าหลัก</a>
    `);
  }
});

/* -------------------- START SERVER -------------------- */

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
