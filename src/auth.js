import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET não definido");
  return process.env.JWT_SECRET;
};

export function login(email, password) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) throw new Error("Admin não configurado");
  const ok =
    String(email).toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
    bcrypt.compareSync(String(password), ADMIN_PASSWORD_HASH);
  if (!ok) return null;
  const user = { email: ADMIN_EMAIL, name: ADMIN_NAME || "Administrador", role: "admin" };
  return { token: jwt.sign(user, secret(), { expiresIn: "12h" }), user };
}

export function requireAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    res.status(401).json({ error: "Não autenticado" });
  }
}
