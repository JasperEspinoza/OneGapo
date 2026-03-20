import { createContext, useContext, useMemo, useState } from 'react';
import GlobalSettingsModal from '../components/GlobalSettingsModal';

const SettingsModalContext = createContext(null);

export function SettingsModalProvider({ children }) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const value = useMemo(
    () => ({
      isSettingsOpen,
      openSettings: () => setIsSettingsOpen(true),
      closeSettings: () => setIsSettingsOpen(false),
    }),
    [isSettingsOpen]
  );

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
      <GlobalSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  const context = useContext(SettingsModalContext);
  if (!context) {
    throw new Error('useSettingsModal must be used within <SettingsModalProvider>.');
  }
  return context;
}
