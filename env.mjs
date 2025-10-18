export const CONFIG = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "SUA_CHAVE_OPENAI_AQUI",
  RESET_LOGS_TOKEN: process.env.RESET_LOGS_TOKEN || "admin123",
  PRIMARY_MODEL: "gpt-4-turbo",
  FALLBACK_MODEL: "gpt-5",
  PORT: process.env.PORT || 10000
};
