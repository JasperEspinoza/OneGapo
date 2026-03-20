import '../pages/Profile.css';
import { useEffect, useState } from 'react';
import { updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
import AppModal from './AppModal';

export default function GlobalSettingsModal({ isOpen, onClose }) {
  const { currentUser, userClaims, accountVerified, refreshUser } = useAuth();
  const role = userClaims?.role;

  const [saved, setSaved] = useState({ fullName: '', phone: '', address: '' });
  const [draft, setDraft] = useState({ fullName: '', phone: '', address: '' });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');

  const [themeMode, setThemeMode] = useState(() => {
    const savedTheme = localStorage.getItem('onegapo-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark') {
      root.classList.add('theme-dark');
    } else {
      root.classList.remove('theme-dark');
    }
    localStorage.setItem('onegapo-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!currentUser || !isOpen) return;

    (async () => {
      setLoadingProfile(true);
      try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid));
        const initial = {
          fullName: currentUser.displayName || '',
          phone: '',
          address: '',
        };

        if (snap.exists()) {
          const data = snap.data();
          initial.fullName = data.fullName || currentUser.displayName || '';
          initial.phone = data.phone || '';
          initial.address = data.address || '';
        }

        setSaved(initial);
        setDraft(initial);
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [currentUser, isOpen]);

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    if (!currentUser) return;

    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);

    try {
      const trimmedName = draft.fullName.trim();

      if (trimmedName !== auth.currentUser?.displayName) {
        await updateProfile(auth.currentUser, { displayName: trimmedName });
        await refreshUser();
      }

      await setDoc(
        doc(db, 'users', currentUser.uid),
        {
          fullName: trimmedName,
          phone: draft.phone.trim(),
          address: draft.address.trim(),
        },
        { merge: true }
      );

      const committed = {
        fullName: trimmedName,
        phone: draft.phone.trim(),
        address: draft.address.trim(),
      };

      setSaved(committed);
      setDraft(committed);
      setSaveSuccess(true);
    } catch {
      setSaveError('Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!currentUser) return;

    setResetLoading(true);
    setResetError('');
    setResetSent(false);

    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      setResetSent(true);
    } catch {
      setResetError('Could not send reset email. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  if (!isOpen || !currentUser) return null;

  return (
    <AppModal title="Account Settings" titleId="global-settings-title" onClose={onClose}>
      <div className="profile-modal-sections">
        <section className="profile-card">
          <h2 className="profile-card-title">Account Details</h2>

          <div className="profile-row">
            <span className="profile-label">Email</span>
            <span className="profile-value">{currentUser.email}</span>
          </div>

          <div className="profile-row">
            <span className="profile-label">Email status</span>
            {accountVerified
              ? <span className="badge badge-verified">Verified</span>
              : <span className="badge badge-unverified">Not verified</span>
            }
          </div>

          <div className="profile-row">
            <span className="profile-label">Role</span>
            {role
              ? <span className={`badge badge-${role}`}>{role}</span>
              : <span className="profile-value text-gray-400">-</span>
            }
          </div>

          {userClaims?.location && (
            <div className="profile-row">
              <span className="profile-label">Assigned location</span>
              <span className="profile-value">{userClaims.location}</span>
            </div>
          )}
        </section>

        <section className="profile-card">
          <h2 className="profile-card-title">Personal Information</h2>

          {saveError && <div role="alert" className="auth-error mb-3">{saveError}</div>}
          {saveSuccess && <div role="status" className="auth-success mb-3">Profile saved successfully.</div>}

          {loadingProfile ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <form onSubmit={handleSaveProfile} className="auth-form">
              <div>
                <label htmlFor="settings-full-name" className="form-label">Full name</label>
                <input
                  id="settings-full-name"
                  type="text"
                  value={draft.fullName}
                  onChange={(e) => setDraft((prev) => ({ ...prev, fullName: e.target.value }))}
                  className="form-input"
                  placeholder="Your full name"
                  disabled={saving}
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="settings-phone" className="form-label">Phone number</label>
                <input
                  id="settings-phone"
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
                  className="form-input"
                  placeholder="+63 900 000 0000"
                  disabled={saving}
                />
              </div>

              <div>
                <label htmlFor="settings-address" className="form-label">Home address</label>
                <input
                  id="settings-address"
                  type="text"
                  value={draft.address}
                  onChange={(e) => setDraft((prev) => ({ ...prev, address: e.target.value }))}
                  className="form-input"
                  placeholder="House / Street / Barangay"
                  disabled={saving}
                />
              </div>

              <div className="profile-form-actions">
                <button
                  type="submit"
                  disabled={saving || !draft.fullName.trim()}
                  className="btn-primary"
                >
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="profile-card">
          <h2 className="profile-card-title">Password and Recovery</h2>

          {resetError && <div role="alert" className="auth-error mb-3">{resetError}</div>}
          {resetSent && (
            <div role="status" className="auth-success mb-3">
              Password reset email sent to <strong>{currentUser.email}</strong>. Check your inbox.
            </div>
          )}

          <p className="text-sm text-gray-500 mb-4">
            We will send a password reset link to <strong>{currentUser.email}</strong>.
          </p>

          <button
            onClick={handlePasswordReset}
            disabled={resetLoading || resetSent}
            className="btn-outline"
            type="button"
          >
            {resetLoading ? 'Sending...' : 'Send password reset email'}
          </button>
        </section>

        <section className="profile-card">
          <h2 className="profile-card-title">Appearance</h2>
          <div className="profile-settings-row">
            <div>
              <p className="profile-settings-label">Theme</p>
              <p className="profile-settings-help">Switch between light and dark mode.</p>
            </div>

            <button
              type="button"
              className="btn-outline profile-theme-toggle"
              onClick={() => setThemeMode((prev) => (prev === 'light' ? 'dark' : 'light'))}
            >
              {themeMode === 'light' ? 'Use dark mode' : 'Use light mode'}
            </button>
          </div>
        </section>
      </div>
    </AppModal>
  );
}
