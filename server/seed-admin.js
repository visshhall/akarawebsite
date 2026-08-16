// Creates (or updates the password of) the ONE admin account. This is
// deliberately the ONLY way an admin account can ever come into existence
// — there is no public signup endpoint for admins anywhere in the app,
// on purpose. Run this once, directly, from Railway's Console/CLI (same
// place you ran migrate/seed) whenever you need to create the account or
// change its password.
//
// Usage:
//   node server/seed-admin.js you@example.com "Your Name" "YourPassword1!"
//
// Safe to re-run with the same email — it UPDATES the password and name
// rather than creating a duplicate, so this doubles as "how you change
// the admin password" later.
import { hashPassword } from "./auth.js";
import { pool, query } from "./db.js";

const [, , email, name, password] = process.argv;

function passwordOk(pw = "") {
  return pw.length >= 10 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

async function main() {
  if (!email || !name || !password) {
    console.error(
      'Usage: node server/seed-admin.js "you@example.com" "Your Name" "YourPassword1!"\n' +
      "All three arguments are required."
    );
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("That doesn't look like a valid email address.");
    process.exit(1);
  }
  // A higher bar than customer passwords (10+ chars, not 8+) — this account
  // can edit the entire catalog and every order, worth the stricter minimum.
  if (!passwordOk(password)) {
    console.error("Password must be 10+ characters with an uppercase letter, a number, and a special character.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await query(
    `INSERT INTO admins (email, name, password_hash) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET name=$2, password_hash=$3`,
    [email.toLowerCase(), name, passwordHash]
  );
  console.log(`Admin account ready: ${email.toLowerCase()}`);
  console.log("You can now log in at /admin/login with this email and password.");
  await pool.end();
}

main().catch((err) => {
  console.error("Failed to create admin account:", err);
  process.exit(1);
});
