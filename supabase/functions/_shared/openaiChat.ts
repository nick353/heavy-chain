type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatCompletionBody = {
  messages: ChatMessage[];
  response_format?: { type: 'json_object' };
  max_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
};

export function hasOpenAiChatApiKey() {
  return Boolean(Deno.env.get('OPENAI_CHAT_API_KEY') || Deno.env.get('OPENAI_API_KEY'));
}

function openAiChatApiKey() {
  return Deno.env.get('OPENAI_CHAT_API_KEY') || Deno.env.get('OPENAI_API_KEY');
}

function openAiChatBaseUrl() {
  return (Deno.env.get('OPENAI_CHAT_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function openAiChatModel(defaultModel: string) {
  return Deno.env.get('OPENAI_CHAT_MODEL') || defaultModel;
}

export async function createOpenAiChatCompletion(body: ChatCompletionBody, defaultModel: string) {
  const apiKey = openAiChatApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  return await fetch(`${openAiChatBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...body,
      model: openAiChatModel(defaultModel),
    }),
  });
}
