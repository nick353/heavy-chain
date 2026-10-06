export type VerifiedProtectedProvider = {provider:'workers_ai'|'openai';backendProvider:'cloudflare-workers-ai'|'openai-images-api';model:string};
export const PROTECTED_OPENAI_EDIT_MODELS=new Set(['gpt-image-1.5','gpt-image-1','gpt-image-1-mini','chatgpt-image-latest']);
