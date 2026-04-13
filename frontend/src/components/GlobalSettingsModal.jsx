import '../pages/Profile.css';
import AppModal from './AppModal';
import SettingsContent from './SettingsContent';

export default function GlobalSettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <AppModal title="Account Settings" titleId="global-settings-title" onClose={onClose}>
      <SettingsContent />
    </AppModal>
  );
}
