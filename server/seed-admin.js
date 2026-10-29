// Creates (or updates the password of) an admin account, with a real
// role. Deliberately the ONLY way to create the FIRST super_admin
// account (bootstrapping the whole role system) — there is no public
// signup endpoint for admins anywhere in the app, on purpose. Once at
// least one super_admin exists, day-to-day account creation (admin/
// staff, or additional super_admins) happens through the in-app
// "Manage Accounts" screen, which only a super_admin can reach — this
// script remains available as a recovery path if that's ever locked out.
//
// Usage:
//   node server/seed-admin.js you@example.com "Your Name" "YourPassword1!" [role]
//   role defaults to "super_admin" if omitted — the sensible default for
//   a script whose whole reason to exist is bootstrapping/recovery.
//
// Safe to re-run with the same email — it UPDATES the password, name,
// AND role rather than creating a duplicate, so this doubles as "how
// you change the admin password" or "how you fix a locked-out role"
// later.
import { hashPassword } from "./auth.js";
import { pool, query } from "./db.js";

const [, , email, name, password, roleArg] = process.argv;
const VALID_ROLES = ["staff", "admin", "super_admin"];
const role = roleArg || "super_admin";

function passwordOk(pw = "") {
  return pw.length >= 10 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

async function main() {
  if (!email || !name || !password) {
    console.error(
      'Usage: node server/seed-admin.js "you@example.com" "Your Name" "YourPassword1!" [role]\n' +
      "email, name, and password are required. role is optional (staff/admin/super_admin), defaults to super_admin."
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
  if (!VALID_ROLES.includes(role)) {
    console.error(`Role must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await query(
    `INSERT INTO admins (email, name, password_hash, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name=$2, password_hash=$3, role=$4`,
    [email.toLowerCase(), name, passwordHash, role]
  );
  console.log(`Admin account ready: ${email.toLowerCase()} (role: ${role})`);
  console.log("You can now log in at /admin/login with this email and password.");
  await pool.end();
}

main().catch((err) => {
  console.error("Failed to create admin account:", err);
  process.exit(1);
});
