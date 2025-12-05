// main.js – Deno Deploy + Hono

import { Hono } from "jsr:@hono/hono";
import { serveStatic } from "jsr:@hono/hono/deno"; 

// -------------------- CONFIG --------------------

const PIC_API_URL = "https://pic.in.th/api/1/upload";
const PIC_API_KEY = Deno.env.get("PIC_API_KEY") ?? "";

const MAILEROO_API_URL = "https://smtp.maileroo.com/api/v2/emails";
const MAILEROO_API_KEY = Deno.env.get("MAILEROO_API_KEY") ?? "";

const MAIL_FROM_ADDRESS = Deno.env.get("MAIL_FROM_ADDRESS") ?? "";
const MAIL_FROM_NAME = Deno.env.get("MAIL_FROM_NAME") ?? "My-Web";

const app = new Hono();

app.use("/*", serveStatic({ root: "./public" }));
app.get("/", (c) => c.redirect("/index.html"));

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

    // sanitize filename
    const originalName = file.name || `upload-${Date.now()}`;
    const safeName = String(originalName).replace(/[^a-zA-Z0-9.\-_]/g, "_");

    // ชื่อโฟลเดอร์ในเครื่อง (local)
    const folderName = "ZMQhq";
    const savedRelPath = `${folderName}/${safeName}`; // returned relative path

    // --- Try to save locally (Node.js) ---
    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      const dirPath = path.join(process.cwd(), folderName);
      await fs.mkdir(dirPath, { recursive: true });

      const savePath = path.join(dirPath, safeName);

      const ab = await file.arrayBuffer();
      const buffer = Buffer.from(ab);
      await fs.writeFile(savePath, buffer);
    } catch (saveErr) {
      console.warn("Could not save uploaded file locally:", saveErr);
    }

    // --- proxy to PIC API ---
    const fd = new FormData();
    fd.append("source", file, file.name || safeName);
    fd.append("format", "json");

    // ตรงนี้คือ key สำคัญ ให้ส่ง album_id = ZMQhq ไป
    fd.append("album_id", "ZMQhq"); // ให้รูปเข้าอัลบั้ม/โฟลเดอร์ ZMQhq

    if (PIC_API_KEY) {
      fd.append("key", PIC_API_KEY);
      // หรือจะใช้ header X-API-Key แทนก็ได้ ตาม docs
      // headers["X-API-Key"] = PIC_API_KEY;
    }

    const resp = await fetch(PIC_API_URL, {
      method: "POST",
      body: fd,
      // headers, ถ้าใช้ X-API-Key
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    const out = {
      ...data,
      local_path: savedRelPath, // path ไฟล์ในเครื่อง (best-effort)
    };

    return c.json(out, resp.status);
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

// -------------------- /api/send-mail-maileroo --------------------
app.post("/api/send-mail-maileroo", async (c) => {
  // check required envs
  if (!MAILEROO_API_KEY) {
    return c.json({ error: "missing_env", detail: "MAILEROO_API_KEY not configured" }, 500);
  }
  if (!MAIL_FROM_ADDRESS) {
    return c.json({ error: "missing_env", detail: "MAIL_FROM_ADDRESS not configured" }, 500);
  }

  // parse form
  const form = await c.req.formData();
  const to = (form.get("to") ?? "").toString().trim();
  const subject = (form.get("subject") ?? "").toString().trim();
  const message = (form.get("message") ?? "").toString().trim();

  // validate
  if (!to || !subject || !message) {
    return c.json(
      { error: "invalid_input", detail: "Fields 'to', 'subject' and 'message' are required" },
      400,
    );
  }

  // ----- สร้าง footer -----
  const footerHtml =
    `<hr>` +
    `<p style="font-size:12px;color:#666;margin-top:16px;">` +
    `Sent with <strong>Pototype</strong> · ` +
    `<a href="https://github.com/reqiler/Prototype" target="_blank" rel="noopener noreferrer">` +
    `https://github.com/reqiler/Prototype` +
    `</a>` +
    `</p>`;

  const footerPlain =
    `\n\n-- \n` +
    `Sent with Pototype\n` +
    `https://github.com/reqiler/Prototype`;

  const payload = {
    from: {
      address: MAIL_FROM_ADDRESS,
      display_name: MAIL_FROM_NAME,
    },
    to: [{ address: to }],
    subject,
    // html: เนื้อความ + footer
    html: `<p>${message.replace(/\n/g, "<br>")}</p>${footerHtml}`,
    // plain text: เนื้อความ + footer
    plain: `${message}${footerPlain}`,
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
      data = { raw: bodyText };
    }

    if (resp.ok) {
      return c.json({ success: true, to, maileroo: data }, 200);
    } else {
      console.error("Maileroo API error:", resp.status, data);
      return c.json(
        { error: "maileroo_error", status: resp.status, detail: data },
        resp.status,
      );
    }
  } catch (err) {
    console.error("Maileroo API request failed:", err);
    return c.json(
      { error: "request_failed", detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// ให้ Deno Deploy ใช้ app.fetch เป็น handler
export default app;
