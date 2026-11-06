import express from "express";
import cors from "cors";
import { z } from "zod";
import { prisma } from "./db.js";
import { login, requireAdmin } from "./auth.js";
import { presign } from "./storage.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
const origins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const str = z.string().trim().min(1).max(5000);
const opt = z.string().trim().max(20000).nullish();
const date = z.coerce.date().nullish();

// tipo -> { modelo Prisma, validação, estados permitidos }
const TYPES = {
  noticias: { model: "noticia", status: ["rascunho", "publicado", "agendado"],
    schema: z.object({ titulo: str, resumo: opt, corpo: opt, categoria: opt, dataPublicacao: date, capa: opt, destaque: z.boolean().optional() }) },
  eventos: { model: "evento", status: ["rascunho", "publicado"],
    schema: z.object({ nome: str, tipo: opt, dataHora: date, local: opt, descricao: opt, capa: opt, destaque: z.boolean().optional() }) },
  programas: { model: "programa", status: ["rascunho", "publicado"],
    schema: z.object({ nome: str, descricao: opt, prazo: date, link: opt }) },
  mensagens: { model: "mensagem", status: ["por-responder", "respondida"],
    schema: z.object({ nome: str, email: z.string().email(), assunto: str, mensagem: str, resposta: opt }) },
  avaliacoes: { model: "avaliacao", status: ["por-rever", "revista", "contactada"],
    schema: z.object({ startup: str, fundador: str, email: z.string().email(), telefone: str, sector: str, provincia: str, respostas: z.record(z.any()).optional(), pontuacao: z.number().optional(), notas: opt }) },
};
const PLATAFORMAS = ["facebook", "instagram", "linkedin", "x", "youtube", "tiktok", "whatsapp", "website"];

const issue = (path, message) => new z.ZodError([{ code: "custom", path: [path], message }]);

function parse(t, body, partial = false) {
  const { status, ...rest } = body ?? {};
  const data = (partial ? t.schema.partial() : t.schema).parse(rest);
  if (status !== undefined && !t.status.includes(status)) throw issue("status", "Estado inválido");
  return status === undefined ? data : { ...data, status };
}
const typed = (req, res, next) => {
  req.t = TYPES[req.params.type];
  req.t ? next() : res.status(404).json({ error: "Tipo desconhecido" });
};

app.get("/", (_req, res) => res.json({ ok: true, service: "angola-startup-api" }));

// ---------- Público ----------
app.get("/api/public/:type(noticias|eventos|programas)", wrap(async (req, res) => {
  const t = TYPES[req.params.type];
  res.json(await prisma[t.model].findMany({ where: { status: "publicado" }, orderBy: { createdAt: "desc" } }));
}));
app.get("/api/public/noticias/:id(\\d+)", wrap(async (req, res) => {
  const n = await prisma.noticia.findFirst({ where: { id: Number(req.params.id), status: "publicado" } });
  n ? res.json(n) : res.status(404).json({ error: "Notícia não encontrada" });
}));
app.get("/api/public/eventos/:id(\\d+)", wrap(async (req, res) => {
  const e = await prisma.evento.findFirst({ where: { id: Number(req.params.id), status: "publicado" } });
  e ? res.json(e) : res.status(404).json({ error: "Evento não encontrado" });
}));
app.get("/api/public/redes", wrap(async (_req, res) => {
  res.json(await prisma.redeSocial.findMany({ where: { ativo: true }, select: { plataforma: true, url: true } }));
}));
app.post("/api/contactos", wrap(async (req, res) => {
  res.status(201).json(await prisma.mensagem.create({ data: parse(TYPES.mensagens, req.body) }));
}));
app.post("/api/avaliacoes", wrap(async (req, res) => {
  res.status(201).json(await prisma.avaliacao.create({ data: parse(TYPES.avaliacoes, req.body) }));
}));
app.post("/api/newsletter", wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
  await prisma.subscritor.upsert({ where: { email }, update: {}, create: { email } });
  res.status(201).json({ ok: true });
}));

// ---------- Auth ----------
app.post("/api/auth/login", (req, res) => {
  const result = login(req.body?.email, req.body?.password);
  if (!result) return res.status(401).json({ error: "Credenciais inválidas" });
  res.json(result);
});
app.get("/api/auth/me", requireAdmin, (req, res) => res.json({ user: req.user }));

// ---------- Admin ----------
const admin = express.Router();
admin.use(requireAdmin);

admin.get("/stats", wrap(async (_req, res) => {
  const [avaliacoes, mensagens, newsletter, eventos, msgs, avs, nots, evs] = await Promise.all([
    prisma.avaliacao.count(),
    prisma.mensagem.count({ where: { status: "por-responder" } }),
    prisma.subscritor.count({ where: { status: "activo" } }),
    prisma.evento.count({ where: { status: "publicado" } }),
    prisma.mensagem.findMany({ where: { status: "por-responder" }, take: 10, orderBy: { createdAt: "desc" } }),
    prisma.avaliacao.findMany({ where: { status: "por-rever" }, take: 10, orderBy: { createdAt: "desc" } }),
    prisma.noticia.findMany({ where: { status: "rascunho" }, take: 10, orderBy: { createdAt: "desc" } }),
    prisma.evento.findMany({ where: { status: "rascunho" }, take: 10, orderBy: { createdAt: "desc" } }),
  ]);
  const atencao = [
    ...msgs.map((x) => ({ type: "mensagens", id: x.id, titulo: `${x.nome} · ${x.assunto}`, status: x.status, createdAt: x.createdAt })),
    ...avs.map((x) => ({ type: "avaliacoes", id: x.id, titulo: x.startup, status: x.status, createdAt: x.createdAt })),
    ...nots.map((x) => ({ type: "noticias", id: x.id, titulo: x.titulo, status: x.status, createdAt: x.createdAt })),
    ...evs.map((x) => ({ type: "eventos", id: x.id, titulo: x.nome, status: x.status, createdAt: x.createdAt })),
  ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  res.json({ avaliacoes, mensagens, newsletter, eventos, atencao });
}));

// Redes sociais (definido antes de /:type)
admin.get("/redes", wrap(async (_req, res) => {
  const rows = await prisma.redeSocial.findMany();
  const by = Object.fromEntries(rows.map((r) => [r.plataforma, r]));
  res.json(PLATAFORMAS.map((p) => ({ plataforma: p, url: by[p]?.url ?? "", ativo: by[p]?.ativo ?? false })));
}));
admin.put("/redes", wrap(async (req, res) => {
  const items = z.array(z.object({
    plataforma: z.enum(PLATAFORMAS),
    url: z.string().trim().max(500),
    ativo: z.boolean().optional(),
  })).parse(req.body);
  for (const it of items) {
    if (!it.url) { await prisma.redeSocial.deleteMany({ where: { plataforma: it.plataforma } }); continue; }
    if (!/^https?:\/\//i.test(it.url)) throw issue("url", `URL inválido em ${it.plataforma} (tem de começar por http:// ou https://)`);
    await prisma.redeSocial.upsert({
      where: { plataforma: it.plataforma },
      update: { url: it.url, ativo: it.ativo ?? true },
      create: { plataforma: it.plataforma, url: it.url, ativo: it.ativo ?? true },
    });
  }
  res.json(await prisma.redeSocial.findMany());
}));

admin.post("/uploads/presign", wrap(async (req, res) => {
  const b = z.object({ filename: z.string().min(1).max(200), contentType: z.string(), size: z.number().int().positive(), base: z.string().uuid().optional(), suffix: z.string().regex(/^\d{2,4}$/).optional() }).parse(req.body);
  res.json(await presign(b));
}));

admin.get("/subscritores", wrap(async (_req, res) => {
  res.json(await prisma.subscritor.findMany({ orderBy: { createdAt: "desc" } }));
}));

admin.delete("/subscritores/:id", wrap(async (req, res) => {
  await prisma.subscritor.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
}));

admin.post("/mensagens/:id/responder", wrap(async (req, res, next) => {
  const resposta = z.string().trim().min(1).parse(req.body?.resposta);
  res.json(await prisma.mensagem.update({ where: { id: Number(req.params.id) }, data: { resposta, status: "respondida" } }));
}));

admin.get("/:type", typed, wrap(async (req, res) => {
  const where = req.query.status ? { status: String(req.query.status) } : {};
  res.json(await prisma[req.t.model].findMany({ where, orderBy: { createdAt: "desc" } }));
}));
admin.post("/:type", typed, wrap(async (req, res) => {
  res.status(201).json(await prisma[req.t.model].create({ data: parse(req.t, req.body) }));
}));
admin.get("/:type/:id", typed, wrap(async (req, res) => {
  const r = await prisma[req.t.model].findUnique({ where: { id: Number(req.params.id) } });
  r ? res.json(r) : res.status(404).json({ error: "Não encontrado" });
}));
admin.put("/:type/:id", typed, wrap(async (req, res) => {
  res.json(await prisma[req.t.model].update({ where: { id: Number(req.params.id) }, data: parse(req.t, req.body, true) }));
}));
admin.delete("/:type/:id", typed, wrap(async (req, res) => {
  await prisma[req.t.model].delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
}));
app.use("/api/admin", admin);

app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada" }));
app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Dados inválidos", issues: err.issues });
  if (err?.code === "P2025") return res.status(404).json({ error: "Não encontrado" });
  console.error(err);
  res.status(500).json({ error: "Erro interno" });
});

export default app;
