import crypto from "node:crypto";

// MOCKED @netlify/blobs — in-memory store (ephemeral in AI Studio)
const blobMemory = new Map();
function getStore(name) {
  if (!blobMemory.has(name)) blobMemory.set(name, new Map());
  const map = blobMemory.get(name);
  return {
    async get(key, opts) {
      if (!map.has(key)) return null;
      const val = map.get(key);
      return opts?.type === "json" ? structuredClone(val) : val;
    },
    async setJSON(key, value) {
      map.set(key, structuredClone(value));
    },
    async delete(key) {
      map.delete(key);
    }
  };
}

const store = getStore("laar-data");

const ENTITIES = [
  "students", "teachers", "courses", "shifts", "batches", "modules",
  "topics", "lessons", "attendance", "progress", "practicals", "tests", "results"
];

const send = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const defaults = () => Object.fromEntries(ENTITIES.map(name => [name, []]));

async function database() {
  const saved = await store.get("database", { type: "json" });
  return saved && typeof saved === "object" ? { ...defaults(), ...saved } : defaults();
}

async function saveDatabase(data) {
  await store.setJSON("database", data);
}

function credentials() {
  return {
    username: process.env.PRINCIPAL_USERNAME || "litprincicpal",
    password: process.env.PRINCIPAL_PASSWORD || "lit2026"
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string" || !storedHash.includes(":")) {
    return false;
  }
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, "hex");
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}

function sanitizeTeacher(teacher) {
  const { password, passwordHash, ...rest } = teacher;
  return {
    ...rest,
    hasPassword: Boolean(passwordHash)
  };
}

function sanitizeDatabase(data) {
  return {
    ...data,
    teachers: Array.isArray(data.teachers) ? data.teachers.map(sanitizeTeacher) : []
  };
}

const TEACHER_WRITABLE_ENTITIES = new Set([
  "lessons", "attendance", "progress", "practicals", "tests", "results"
]);

async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  await store.setJSON(`session:${token}`, {
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    user
  });
  return token;
}

async function getSession(request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const session = await store.get(`session:${token}`, { type: "json" });
  if (!session || Number(session.expiresAt) <= Date.now()) return null;
  return session;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
    const method = request.method.toUpperCase();

    if (method === "GET" && path === "health") {
      return send(200, { ok: true, service: "LIT Management API" });
    }

    if (method === "POST" && path === "login") {
      const body = await readJson(request);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const creds = credentials();

      if (username === creds.username && password === creds.password) {
        const user = { username: creds.username, name: "Principal", role: "Principal" };
        const token = await createSession(user);
        return send(200, { ok: true, token, user });
      }

      const data = await database();
      const teacher = (data.teachers || []).find(
        (t) =>
          typeof t.username === "string" &&
          t.username.trim().toLowerCase() === username.toLowerCase() &&
          verifyPassword(password, t.passwordHash)
      );

      if (teacher) {
        const user = {
          id: teacher.id,
          username: teacher.username,
          name: teacher.name || teacher.username,
          role: "Teacher"
        };
        const token = await createSession(user);
        return send(200, { ok: true, token, user });
      }

      return send(401, { ok: false, message: "Invalid username or password." });
    }

    const session = await getSession(request);
    if (!session) {
      return send(401, { ok: false, message: "Unauthorized. Please login again." });
    }
    const user = session.user || { username: "principal", name: "Principal", role: "Principal" };

    if (method === "POST" && path === "logout") {
      const auth = request.headers.get("authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token) await store.delete(`session:${token}`);
      return send(200, { ok: true });
    }

    if (method === "GET" && (path === "" || path === "data")) {
      return send(200, { ok: true, user, data: sanitizeDatabase(await database()) });
    }

    if (method === "POST" && path === "data") {
      const body = await readJson(request);
      if (!body || !ENTITIES.includes(body.entity)) {
        return send(400, { ok: false, message: "Invalid entity." });
      }

      if (user.role !== "Principal" && !TEACHER_WRITABLE_ENTITIES.has(body.entity)) {
        return send(403, { ok: false, message: "Only Principal can manage this section." });
      }

      const data = await database();
      const list = Array.isArray(data[body.entity]) ? data[body.entity] : [];

      if (Array.isArray(body.records)) {
        if (body.entity === "teachers") {
          return send(400, { ok: false, message: "Bulk save is not supported for teachers." });
        }
        const saved = [];
        for (const rawItem of body.records) {
          const record = { ...(rawItem || {}) };
          let existingIndex = record.id ? list.findIndex(item => item.id === record.id) : -1;

          if (existingIndex < 0 && body.entity === "attendance" && record.date && record.student) {
            const d = String(record.date).trim();
            const s = String(record.student).trim().toLowerCase();
            existingIndex = list.findIndex(
              item => String(item.date || "").trim() === d && String(item.student || "").trim().toLowerCase() === s
            );
          } else if (existingIndex < 0 && body.entity === "progress" && record.student && record.topic) {
            const s = String(record.student).trim().toLowerCase();
            const t = String(record.topic).trim().toLowerCase();
            existingIndex = list.findIndex(
              item => String(item.student || "").trim().toLowerCase() === s && String(item.topic || "").trim().toLowerCase() === t
            );
          } else if (existingIndex < 0 && body.entity === "results" && record.test && record.student) {
            const tst = String(record.test).trim().toLowerCase();
            const s = String(record.student).trim().toLowerCase();
            existingIndex = list.findIndex(
              item => String(item.test || "").trim().toLowerCase() === tst && String(item.student || "").trim().toLowerCase() === s
            );
          }

          if (existingIndex >= 0) {
            record.id = list[existingIndex].id;
          } else {
            record.id ||= crypto.randomUUID();
          }
          record.updatedAt = new Date().toISOString();

          if (existingIndex >= 0) list[existingIndex] = record;
          else list.push(record);
          saved.push(record);
        }
        data[body.entity] = list;
        await saveDatabase(data);
        return send(200, { ok: true, count: saved.length, records: saved });
      }

      const incoming = { ...(body.record || {}) };
      const existingIndex = incoming.id ? list.findIndex(item => item.id === incoming.id) : -1;
      const existing = existingIndex >= 0 ? list[existingIndex] : null;

      const record = { ...incoming };
      record.id ||= crypto.randomUUID();
      record.updatedAt = new Date().toISOString();

      if (body.entity === "teachers") {
        const creds = credentials();
        const teacherUsername = String(record.username || "").trim();
        const plainPassword = typeof record.password === "string" ? record.password : "";
        delete record.password;
        delete record.passwordHash;
        delete record.hasPassword;

        if (teacherUsername) {
          if (teacherUsername.toLowerCase() === creds.username.toLowerCase()) {
            return send(400, { ok: false, message: "This username is reserved for the Principal." });
          }
          const duplicate = list.find(
            (item) =>
              item.id !== record.id &&
              typeof item.username === "string" &&
              item.username.trim().toLowerCase() === teacherUsername.toLowerCase()
          );
          if (duplicate) {
            return send(400, { ok: false, message: "This username is already assigned to another teacher." });
          }
          record.username = teacherUsername;
        } else {
          record.username = "";
        }

        if (plainPassword) {
          if (!teacherUsername) {
            return send(400, { ok: false, message: "Please enter a username before setting a password." });
          }
          if (plainPassword.length < 4) {
            return send(400, { ok: false, message: "Password must be at least 4 characters." });
          }
          record.passwordHash = hashPassword(plainPassword);
        } else if (existing?.passwordHash && teacherUsername) {
          record.passwordHash = existing.passwordHash;
        } else if (teacherUsername && !existing?.passwordHash) {
          return send(400, { ok: false, message: "Please enter a password for this teacher login." });
        }
      }

      if (existingIndex >= 0) list[existingIndex] = record;
      else list.push(record);

      data[body.entity] = list;
      await saveDatabase(data);
      const savedRecord = body.entity === "teachers" ? sanitizeTeacher(record) : record;
      return send(200, { ok: true, record: savedRecord });
    }

    if (method === "DELETE" && path === "data") {
      const body = await readJson(request);
      if (!body || !ENTITIES.includes(body.entity) || !body.id) {
        return send(400, { ok: false, message: "Invalid delete request." });
      }

      if (user.role !== "Principal" && !TEACHER_WRITABLE_ENTITIES.has(body.entity)) {
        return send(403, { ok: false, message: "Only Principal can delete records in this section." });
      }

      const data = await database();
      data[body.entity] = (data[body.entity] || []).filter(item => item.id !== body.id);
      await saveDatabase(data);
      return send(200, { ok: true });
    }

    return send(404, { ok: false, message: "Endpoint not found." });
  } catch (error) {
    console.error("LIT API error:", error);
    return send(500, { ok: false, message: "Server error. Check server logs." });
  }
}
