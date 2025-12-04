// main.js – Deno Deploy + Hono

import { Hono } from "jsr:@hono/hono";
import { serveStatic } from "jsr:@hono/hono/deno"; // 👈 เพิ่มบรรทัดนี้

// -------------------- CONFIG --------------------

const PIC_API_URL = "https://pic.in.th/api/1/upload";
const PIC_API_KEY = Deno.env.get("PIC_API_KEY") ?? "";

const MAILEROO_API_URL = "https://smtp.maileroo.com/api/v2/emails";
const MAILEROO_API_KEY = Deno.env.get("MAILEROO_API_KEY") ?? "";

const MAIL_FROM_ADDRESS = Deno.env.get("MAIL_FROM_ADDRESS") ?? "";
const MAIL_FROM_NAME = Deno.env.get("MAIL_FROM_NAME") ?? "My-Web";

const app = new Hono();

// 👇 เสิร์ฟไฟล์ทั้งหมดในโฟลเดอร์ ./public
app.use("/*", serveStatic({ root: "./public" }));

/**
 * หน้าแรก -> redirect ไป index.html
 */
app.get("/", (c) => c.redirect("/index.html"));

/**
 * กันกรณีใน HTML เรียก /public/xxx
 */
app.get("/public/*", (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/public/, "");
  return c.redirect(path || "/index.html");
});

// -------------------- /api/upload --------------------

app.post("/api/upload", async (c) => {
  try {
    const incomingForm = await c.req.formData();
    const file = incomingForm.get("file");

    if (!(file instanceof File)) {
      return c.json({ error: "no_file" }, 400);
    }

    const fd = new FormData();
    fd.append("source", file, file.name || "upload.bin");
    fd.append("format", "json");

    if (PIC_API_KEY) {
      fd.append("key", PIC_API_KEY);
    }

    const resp = await fetch(PIC_API_URL, {
      method: "POST",
      body: fd,
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return c.json(data, resp.status);
  } catch (err) {
    console.error("Upload proxy error:", err);
    return c.json(
      {
        error: "proxy_error",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

// -------------------- /api/send-mail (ไม่รองรับ Gmail SMTP) --------------------

app.post("/api/send-mail", () => {
  const html = `
    <h2>ไม่รองรับ Gmail SMTP บน Deno Deploy</h2>
    <p>เส้นทางนี้เคยใช้ Nodemailer + Gmail ซึ่งใช้ TCP โดยตรง (Deno Deploy ไม่อนุญาต)</p>
    <p>กรุณาใช้เส้นทาง <code>/api/send-mail-maileroo</code> แทน</p>
    <a href="/">กลับหน้าหลัก</a>
  `;
  return new Response(html, {
    status: 501,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

// -------------------- /api/send-mail-maileroo --------------------

app.post("/api/send-mail-maileroo", async (c) => {
  if (!MAILEROO_API_KEY) {
    const html = `
      <h2>MAILEROO_API_KEY ไม่ถูกตั้งค่า</h2>
      <p>ต้องตั้ง Environment Variable: <code>MAILEROO_API_KEY</code> ใน Deno Deploy</p>
      <a href="/">กลับหน้าหลัก</a>
    `;
    return c.html(html, 500);
  }

  if (!MAIL_FROM_ADDRESS) {
    const html = `
      <h2>MAIL_FROM_ADDRESS ไม่ถูกตั้งค่า</h2>
      <p>ต้องตั้งค่า <code>MAIL_FROM_ADDRESS</code> เช่น <code>no-reply@xxxx.maileroo.org</code></p>
      <a href="/">กลับหน้าหลัก</a>
    `;
    return c.html(html, 500);
  }

  const form = await c.req.formData();
  const to = (form.get("to") ?? "").toString();
  const subject = (form.get("subject") ?? "").toString();
  const message = (form.get("message") ?? "").toString();

  if (!to || !subject || !message) {
    return c.html(
      `
      <h2>ข้อมูลไม่ครบ</h2>
      <p>ต้องมี to, subject, message</p>
      <a href="/">กลับหน้าหลัก</a>
    `,
      400,
    );
  }

  const payload = {
    from: {
      address: MAIL_FROM_ADDRESS,
      display_name: MAIL_FROM_NAME,
    },
    to: [{ address: to }],
    subject,
    html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
    plain: message,
    tracking: true,
  };

  try {
    const resp = await fetch(MAILEROO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MAILEROO_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await resp.text();
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = bodyText;
    }

    if (resp.ok) {
      const html = `
        <h2>ส่งเมลผ่าน Maileroo สำเร็จ!</h2>
        <p>ส่งไปที่: ${to}</p>
        <a href="/">กลับหน้าหลัก</a>
      `;
      return c.html(html);
    } else {
      console.error("Maileroo API error:", resp.status, data);
      const html = `
        <h2>Maileroo API ตอบกลับด้วย error</h2>
        <p>Status: ${resp.status}</p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <a href="/">กลับหน้าหลัก</a>
      `;
      return c.html(html, resp.status);
    }
  } catch (err) {
    console.error("Maileroo API request failed:", err);
    const html = `
      <h2>เกิดข้อผิดพลาดในการเรียก Maileroo API</h2>
      <pre>${err instanceof Error ? err.message : String(err)}</pre>
      <a href="/">กลับหน้าหลัก</a>
    `;
    return c.html(html, 500);
  }
});

// ❌ อย่าเรียก Deno.serve เอง
// Deno.serve(app.fetch);

// ให้ Deno Deploy ใช้ app.fetch เป็น handler
export default app;
