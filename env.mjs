// Template de env (não subir a chave real no GitHub)
export const config = {
  OPENAI_USE_GPT: process.env.OPENAI_USE_GPT || "false",
  OPENAI_PRIMARY_MODEL: process.env.OPENAI_PRIMARY_MODEL || "gpt-4o-mini",
  OPENAI_FALLBACK_MODEL: process.env.OPENAI_FALLBACK_MODEL || "gpt-5-mini",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
};
export default config;