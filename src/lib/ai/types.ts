export type ProviderKind = "builtin" | "custom";

export type HeaderPair = {
  id: string;
  name: string;
  value: string;
};

export type Provider = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  extraHeaders: HeaderPair[];
  chatPath: string;
  models: string[];
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null;
  imageModel?: string;
};

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
};

export type Source = {
  title: string;
  url: string;
  snippet: string;
};

export type ChatFile = {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "text" | "audio" | "file";
  dataUrl?: string;
  text?: string;
  url?: string;
  size?: number;
};

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  model?: string;
  modelLabel?: string;
  providerName?: string;
  usage?: Usage;
  error?: string;
  stopped?: boolean;
  truncated?: boolean;
  live?: boolean;
  sync?: number;
  image?: boolean;
  web?: boolean;
  calc?: boolean;
  clock?: boolean;
  brief?: boolean;
  translate?: boolean;
  ask?: boolean;
  imageUrl?: string;
  sources?: Source[];
  files?: ChatFile[];
  reasoning?: string;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  unread?: boolean;
};

export type ThemeMode = "dark" | "light";

export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string | ChatPart[];
  reasoning?: string;
};
