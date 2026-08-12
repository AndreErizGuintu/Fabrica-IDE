import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export type TabKey = 'ask' | 'plan' | 'translate' | 'explain';
export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

// All chat/session state for the AI panel, lifted out of AIPanel so a single
// source of truth survives the docked <-> floating swap in EditorLayout (each
// mode renders its own <AIPanel> instance; without this, toggling remounts the
// component and wipes local state). Owned by EditorLayout, passed to both
// instances via the `panelState` prop.
export interface AIPanelState {
  activeTab: TabKey;
  setActiveTab: Dispatch<SetStateAction<TabKey>>;
  response: string;
  setResponse: Dispatch<SetStateAction<string>>;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  saveMessage: string | null;
  setSaveMessage: Dispatch<SetStateAction<string | null>>;
  language: string;
  setLanguage: Dispatch<SetStateAction<string>>;
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  askMessages: ChatMessage[];
  setAskMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  askPrompt: string;
  setAskPrompt: Dispatch<SetStateAction<string>>;
  askLoading: boolean;
  setAskLoading: Dispatch<SetStateAction<boolean>>;
  planMessages: ChatMessage[];
  setPlanMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  planPrompt: string;
  setPlanPrompt: Dispatch<SetStateAction<string>>;
  planLoading: boolean;
  setPlanLoading: Dispatch<SetStateAction<boolean>>;
  explainPrompt: string;
  setExplainPrompt: Dispatch<SetStateAction<string>>;
  explainResponse: string;
  setExplainResponse: Dispatch<SetStateAction<string>>;
  explainLoading: boolean;
  setExplainLoading: Dispatch<SetStateAction<boolean>>;
}

export function useAIPanelState(): AIPanelState {
  const [activeTab, setActiveTab] = useState<TabKey>('ask');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [language, setLanguage] = useState('JavaScript');
  const [prompt, setPrompt] = useState('');
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [askPrompt, setAskPrompt] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [planMessages, setPlanMessages] = useState<ChatMessage[]>([]);
  const [planPrompt, setPlanPrompt] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [explainPrompt, setExplainPrompt] = useState('');
  const [explainResponse, setExplainResponse] = useState('');
  const [explainLoading, setExplainLoading] = useState(false);

  return {
    activeTab, setActiveTab,
    response, setResponse,
    loading, setLoading,
    saving, setSaving,
    saveMessage, setSaveMessage,
    language, setLanguage,
    prompt, setPrompt,
    askMessages, setAskMessages,
    askPrompt, setAskPrompt,
    askLoading, setAskLoading,
    planMessages, setPlanMessages,
    planPrompt, setPlanPrompt,
    planLoading, setPlanLoading,
    explainPrompt, setExplainPrompt,
    explainResponse, setExplainResponse,
    explainLoading, setExplainLoading,
  };
}
