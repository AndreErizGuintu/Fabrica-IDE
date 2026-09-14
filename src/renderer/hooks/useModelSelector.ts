import { useEffect, useState } from 'react';

export type ModelOption = { key: 'primary' | 'cpuFallback'; displayName: string };

// Backs the interactive model dropdown in SettingsScreen ONLY -- the
// read-only label elsewhere (MainMenu, TemplatesScreen) stays on
// useActiveModel() in App.tsx, unchanged. Manual selection here overrides the
// automatic gpu-isolation fallback for the rest of this session: nothing else
// calls setActiveModel() again after app startup, so there is no later
// automatic pass this could race with (see llm.ts).
export default function useModelSelector() {
  const [activeKey, setActiveKey] = useState<ModelOption['key'] | null>(null);
  const [modelName, setModelName] = useState('Loading...');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.model.getActiveModel().then((result) => {
      if (result.success && result.name) {
        setModelName(result.name);
        if (result.key) setActiveKey(result.key);
      }
    });
    window.model.listModels().then((result) => {
      if (result.success && result.models) {
        setModels(result.models);
      }
    });
  }, []);

  const selectModel = async (modelKey: ModelOption['key']) => {
    if (switching || modelKey === activeKey) return;
    setSwitching(true);
    setError(null);
    try {
      // Can take several seconds -- kills/respawns the worker and warms up
      // the new model (a real, awaited generate() call) before resolving.
      const result = await window.model.setActiveModel(modelKey);
      if (result.success) {
        setActiveKey(modelKey);
        if (result.name) setModelName(result.name);
      } else {
        setError(result.error ?? 'Failed to switch model.');
      }
    } finally {
      setSwitching(false);
    }
  };

  return { activeKey, modelName, models, switching, error, selectModel };
}
