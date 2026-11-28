import { z } from "zod";

const csvInts = (padrao: string) =>
  z
    .string()
    .default(padrao)
    .transform((s) => s.split(",").map((x) => Number.parseInt(x.trim(), 10)))
    .pipe(z.array(z.number().int().positive()).min(1));

const inteiro = (padrao: number) => z.coerce.number().int().positive().default(padrao);

/** Valor colado na Vercel com espaço, quebra de linha ou aspas: limpa; vazio conta como não cadastrado. */
function limpar(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim().replace(/^(["'])(.*)\1$/s, "$2").trim();
  return s === "" ? undefined : s;
}

/** Texto opcional (chaves, usuário, senha): limpo; vazio = não cadastrado. */
const textoOpc = () => z.preprocess(limpar, z.string().optional());

/**
 * Configuração opcional (e-mail, Resend, segredo do link): se vier errada, fica desligada e avisa no log,
 * em vez de derrubar o sistema inteiro (28/11/2026: um EMAIL_REMETENTE recusado parou o Importar e a fila).
 */
function opcional<T extends z.ZodType>(nome: string, tipo: T) {
  return z.preprocess(limpar, tipo.optional()).catch((ctx) => {
    console.error(`Configuração: ${nome} inválida e ignorada (${ctx.error.issues.map((i) => i.message).join("; ")}). Corrija na Vercel e faça Redeploy.`);
    return undefined;
  });
}

/** Remetente: aceita "notas@dominio" ou "Nome <notas@dominio>" (fica só o endereço; o nome vem da empresa). */
function soEndereco(v: unknown): unknown {
  const s = limpar(v);
  if (typeof s !== "string") return s;
  const m = s.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  return m ? m[1] : s;
}

const servidorSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CERT_MASTER_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "CERT_MASTER_KEY precisa ter 32 bytes em base64"),
  CERT_KEY_VERSION: inteiro(1),
  NFSE_AMBIENTE: z.enum(["restrita", "producao"]),
  SEFIN_BASE_URL: z.url(),
  ADN_BASE_URL: z.url(),
  WORKER_SECRET: z.string().min(32, "WORKER_SECRET precisa ter pelo menos 32 caracteres"),
  WORKER_BUDGET_MS: inteiro(50_000),
  RETRY_MINUTOS: csvInts("5,15,60"),
  LOGIN_MAX_FALHAS: inteiro(3),
  LOGIN_BLOQUEIO_MIN: inteiro(15),
  PLANILHA_MAX_LINHAS: inteiro(30),
  CERT_ALERTA_DIAS: csvInts("30,15"),
  MUNICIPIOS_ALERTA_DIAS: inteiro(30),
  BLOB_READ_WRITE_TOKEN: textoOpc(),
  BLOB_STORE_ID: textoOpc(),
  // Envio da nota ao tomador por e-mail: Gmail do escritório (SMTP com senha de app do Google).
  // Sem SMTP_USUARIO/SMTP_SENHA o botão de e-mail avisa que falta configurar.
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORTA: inteiro(465),
  SMTP_USUARIO: textoOpc(),
  SMTP_SENHA: textoOpc(),
  // Domínio próprio: com RESEND_API_KEY e EMAIL_REMETENTE (ex.: notas@dominio.com.br) o e-mail sai pelo Resend;
  // sem os dois, continua pelo Gmail (SMTP).
  RESEND_API_KEY: textoOpc(),
  EMAIL_REMETENTE: opcional("EMAIL_REMETENTE", z.preprocess(soEndereco, z.email())),
  // Resposta quando a empresa não tem e-mail no cadastro; vazio usa o SMTP_USUARIO.
  EMAIL_ESCRITORIO: textoOpc(),
  // Assina o link temporário do WhatsApp; sem ele usa o WORKER_SECRET.
  ENVIO_LINK_SECRET: opcional("ENVIO_LINK_SECRET", z.string().min(32)),
  // IBS/CBS do Simples na DPS (NT 009): desligado até a Receita liberar; "grupo" manda só o grupo IBSCBS
  // (esquema atual), "completo" manda também regApIBSCBSSN e cAtvSN (Release 4).
  NFSE_IBSCBS_SIMPLES: z.enum(["desligado", "grupo", "completo"]).default("desligado"),
});

export type ConfigServidor = z.infer<typeof servidorSchema>;

let cache: ConfigServidor | undefined;

/** Lê e valida as variáveis do servidor uma vez. Falha cedo com a lista do que falta. */
export function config(env: NodeJS.ProcessEnv = process.env): ConfigServidor {
  if (cache && env === process.env) return cache;
  const r = servidorSchema.safeParse(env);
  if (!r.success) {
    const faltando = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${faltando}`);
  }
  // Teste nunca vira nota real: URLs da produção só com NFSE_AMBIENTE=producao e vice-versa.
  const urlRestrita = /producaorestrita/.test(r.data.SEFIN_BASE_URL) && /producaorestrita/.test(r.data.ADN_BASE_URL);
  if ((r.data.NFSE_AMBIENTE === "restrita") !== urlRestrita) {
    throw new Error("NFSE_AMBIENTE não combina com SEFIN_BASE_URL/ADN_BASE_URL");
  }
  if (env === process.env) cache = r.data;
  return r.data;
}

/** Só o que o navegador pode ver. */
export const configPublica = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};
