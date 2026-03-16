import './Profile.css';
import { useState, useEffect } from 'react';
import { updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import AppModal from '../components/AppModal';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { currentUser, userClaims, accountVerified, refreshUser } = useAuth();
  const role = userClaims?.role;

  // Saved (committed) values — what's shown in view mode
  const [saved, setSaved] = useState({ fullName: '', phone: '', address: '' });

  // Draft values — what's in the edit form
  const [draft, setDraft] = useState({ fullName: '', phone: '', address: '' });

  const [editMode,       setEditMode]       = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [saveSuccess,    setSaveSuccess]    = useState(false);
  const [saveError,      setSaveError]      = useState('');

  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent,    setResetSent]    = useState(false);
  const [resetError,   setResetError]   = useState('');

  // Load Firestore profile on mount
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid));
        const initial = {
          fullName: currentUser.displayName || '',
          phone:    '',
          address:  '',
        };
        if (snap.exists()) {
          const data = snap.data();
          initial.fullName = data.fullName || currentUser.displayName || '';
          initial.phone    = data.phone    || '';
          initial.address  = data.address  || '';
        }
        setSaved(initial);
        setDraft(initial);
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [currentUser]);

  const handleEdit = () => {
    setDraft({ ...saved });
    setSaveSuccess(false);
    setSaveError('');
    setEditMode(true);
  };

  const handleCancel = () => {
    setDraft({ ...saved });
    setSaveError('');
    setEditMode(false);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const trimmedName = draft.fullName.trim();

      if (trimmedName !== auth.currentUser.displayName) {
        await updateProfile(auth.currentUser, { displayName: trimmedName });
        await refreshUser();
      }

      await setDoc(
        doc(db, 'users', currentUser.uid),
        {
          fullName: trimmedName,
          phone:    draft.phone.trim(),
          address:  draft.address.trim(),
        },
        { merge: true }
      );

      const committed = {
        fullName: trimmedName,
        phone:    draft.phone.trim(),
        address:  draft.address.trim(),
      };
      setSaved(committed);
      setDraft(committed);
      setSaveSuccess(true);
      setEditMode(false);
    } catch {
      setSaveError('Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
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

  return (
    <main className="app-page">
      <div className="profile-container app-page-inner">
        <h1 className="page-title">My Profile</h1>

      {/* ── Account details ─────────────────────────────────── */}
      <div className="profile-card">
        <h2 className="profile-card-title">Account Details</h2>

        <div className="profile-row">
          <span className="profile-label">Email</span>
          <span className="profile-value">{currentUser?.email}</span>
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
            : <span className="profile-value text-gray-400">—</span>
          }
        </div>

        {userClaims?.location && (
          <div className="profile-row">
            <span className="profile-label">Assigned location</span>
            <span className="profile-value">{userClaims.location}</span>
          </div>
        )}
      </div>

      {/* ── Personal information ─────────────────────────────── */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2 className="profile-card-title">Personal Information</h2>
            {!loadingProfile && (
              <button onClick={handleEdit} className="btn-outline btn-sm">
                Edit details
              </button>
            )}
          </div>

          {saveSuccess && <div role="status" className="auth-success mb-3">Profile saved successfully.</div>}

          {loadingProfile ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="profile-view">
              <div className="profile-row">
                <span className="profile-label">Full name</span>
                <span className="profile-value">{saved.fullName || <span className="text-gray-400">—</span>}</span>
              </div>
              <div className="profile-row">
                <span className="profile-label">Phone number</span>
                <span className="profile-value">{saved.phone || <span className="text-gray-400">—</span>}</span>
              </div>
              <div className="profile-row">
                <span className="profile-label">Home address</span>
                <span className="profile-value">{saved.address || <span className="text-gray-400">—</span>}</span>
              </div>
            </div>
          )}
        </div>

      {/* ── Password / Account recovery ──────────────────────── */}
        <div className="profile-card">
        <h2 className="profile-card-title">Password &amp; Account Recovery</h2>

        {resetError && <div role="alert"  className="auth-error   mb-3">{resetError}</div>}
        {resetSent  && (
          <div role="status" className="auth-success mb-3">
            Password reset email sent to <strong>{currentUser?.email}</strong>. Check your inbox.
          </div>
        )}

        <p className="text-sm text-gray-500 mb-4">
          We&apos;ll send a password reset link to <strong>{currentUser?.email}</strong>.
          Use this if you&apos;ve forgotten your password or want to change it.
        </p>

        <button
          onClick={handlePasswordReset}
          disabled={resetLoading || resetSent}
          className="btn-outline"
        >
          {resetLoading ? 'Sending…' : 'Send password reset email'}
        </button>
        </div>

        {editMode && (
          <AppModal title="Edit Personal Information" titleId="profile-edit-title" onClose={handleCancel}>
            {saveError && <div role="alert" className="auth-error mb-3">{saveError}</div>}

            <form onSubmit={handleSaveProfile} className="auth-form">
              <div>
                <label htmlFor="fullName" className="form-label">Full name</label>
                <input
                  id="fullName"
                  type="text"
                  value={draft.fullName}
                  onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
                  className="form-input"
                  placeholder="Your full name"
                  disabled={saving}
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="phone" className="form-label">Phone number</label>
                <input
                  id="phone"
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  className="form-input"
                  placeholder="+63 900 000 0000"
                  disabled={saving}
                />
              </div>

              <div>
                <label htmlFor="address" className="form-label">Home address</label>
                <input
                  id="address"
                  type="text"
                  value={draft.address}
                  onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
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
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="btn-outline"
                >
                  Cancel
                </button>
              </div>
            </form>
          </AppModal>
        )}
      </div>
    </main>
  );
}
