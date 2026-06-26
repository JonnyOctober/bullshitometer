// Per-tool access gate, reading the SAME SQLite permissions.db the makeshift
// hub's admin dashboard writes. A faithful port of auth.py's check_access:
// admin bypass -> explicit grant -> explicit revoke -> domain inheritance.
//
// Fails CLOSED: if the DB is missing/unreadable, access is denied.
import Database from "better-sqlite3";

const DB_PATH = process.env.PERMISSIONS_DB;

let _db = null;
let _failed = false;
function getDb() {
  if (_failed) return null;
  if (_db) return _db;
  if (!DB_PATH) {
    _failed = true;
    return null;
  }
  try {
    _db = new Database(DB_PATH, { fileMustExist: true });
    _db.pragma("busy_timeout = 5000");
    return _db;
  } catch (e) {
    console.error("auth: cannot open PERMISSIONS_DB:", e.message);
    _failed = true;
    return null;
  }
}

// Cloudflare Access injects the verified email; X-Dev-Email is a local-dev fallback.
export function getUserEmail(req) {
  const cf = (req.headers["cf-access-authenticated-user-email"] || "").trim().toLowerCase();
  if (cf) return cf;
  const dev = (req.headers["x-dev-email"] || "").trim().toLowerCase();
  return dev || null;
}

export function checkAccess(email, toolSlug) {
  if (!email) return false;
  const db = getDb();
  if (!db) return false;
  try {
    const user = db
      .prepare("SELECT is_admin FROM users WHERE email = ? COLLATE NOCASE")
      .get(email);
    if (user && user.is_admin) return true;

    const perm = db
      .prepare("SELECT granted FROM permissions WHERE email = ? COLLATE NOCASE AND tool_slug = ?")
      .get(email, toolSlug);
    if (perm !== undefined) return !!perm.granted; // explicit grant/revoke wins

    const at = email.indexOf("@");
    if (at !== -1) {
      const domain = email.slice(at + 1);
      const dp = db
        .prepare("SELECT 1 FROM domain_permissions WHERE domain = ? COLLATE NOCASE AND tool_slug = ?")
        .get(domain, toolSlug);
      if (dp) return true;
    }
    return false;
  } catch (e) {
    console.error("auth: check failed:", e.message);
    return false; // fail closed
  }
}
