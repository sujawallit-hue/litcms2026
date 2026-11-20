import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import apiHandler from "./netlify/functions/api.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";

app.use("/api", express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
  try {
    const protocol = req.protocol || "http";
    const host = req.headers.host || `${HOST}:${PORT}`;
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;
    const method = req.method.toUpperCase();
    const hasBody =
      method !== "GET" &&
      method !== "HEAD" &&
      Buffer.isBuffer(req.body) &&
      req.body.length > 0;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach((v) => headers.append(key, v));
        } else {
          headers.set(key, String(value));
        }
      }
    }

    const webRequest = new Request(fullUrl, {
      method,
      headers,
      body: hasBody ? req.body : undefined
    });

    const webResponse = await apiHandler(webRequest);
    res.status(webResponse.status);
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const buffer = Buffer.from(await webResponse.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    console.error("API adapter error:", error);
    res.status(500).json({ ok: false, message: "Internal server error." });
  }
});

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) {
    return res.sendFile(path.join(publicDir, "index.html"));
  }
  next();
});

app.listen(PORT, HOST, () => {
  console.log(`Laar Institute Management System running on http://${HOST}:${PORT}`);
});
