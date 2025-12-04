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

    // folder name you wanted
    const folderName = "ZMQhq";
    const savedRelPath = `${folderName}/${safeName}`; // returned relative path

    // --- Try to save locally (Node.js) ---
    try {
      // dynamic import so code doesn't crash in non-Node environments
      const fs = await import("fs/promises");
      const path = await import("path");

      const dirPath = path.join(process.cwd(), folderName);
      await fs.mkdir(dirPath, { recursive: true });

      const savePath = path.join(dirPath, safeName);

      // convert File -> ArrayBuffer -> Buffer (Node)
      const ab = await file.arrayBuffer();
      const buffer = Buffer.from(ab);
      await fs.writeFile(savePath, buffer);

      // optional: set file mode, etc.
      // await fs.chmod(savePath, 0o644);
    } catch (saveErr) {
      // don't fail the whole request if saving locally fails — log and continue to proxy
      console.warn("Could not save uploaded file locally:", saveErr);
    }

    // --- proxy to PIC API as before ---
    const fd = new FormData();
    // append original File object so your previous flow is preserved
    fd.append("source", file, file.name || safeName);
    fd.append("format", "json");
    if (PIC_API_KEY) fd.append("key", PIC_API_KEY);

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

    // include local path info (best-effort)
    const out = {
      ...data,
      local_path: savedRelPath,
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
    return c.json({ error: "invalid_input", detail: "Fields 'to', 'subject' and 'message' are required" }, 400);
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
      data = { raw: bodyText };
    }

    if (resp.ok) {
      // success -> return JSON for frontend to handle
      return c.json({ success: true, to, maileroo: data }, 200);
    } else {
      // Maileroo returned non-2xx -> forward details and status
      console.error("Maileroo API error:", resp.status, data);
      return c.json({ error: "maileroo_error", status: resp.status, detail: data }, resp.status);
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
